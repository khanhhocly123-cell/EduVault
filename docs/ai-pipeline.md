# Pipeline AI — tài liệu hiện hành

Pipeline ưu tiên khả năng kiểm chứng. AI chép nội dung có trên tài liệu; giáo viên là người duyệt cuối.

```text
[0] Chuẩn hoá trang
  → [1] OCR có cấu trúc theo từng trang (chạy nền, cache theo trang)
  → [2] Reconcile toàn tài liệu
  → [3] Đối chiếu bằng bảng + duyệt trên ảnh gốc
  → [4] Lưu kho / ráp đề / xuất DOCX & PDF
```

Toàn bộ bước 1 nằm trong `web/ocr-model.mjs` và chạy **trong tiến trình server**.
Không còn spawn `tsx` sang `phase0/` — xem HANDOFF.md mục 8.1 để biết vì sao.

## 0. Chuẩn hoá trang

- PDF được render thành từng trang bằng `pdftoppm`.
- Ảnh được đọc hướng xoay EXIF và tạo một bản **canonical** `page-N.png`.
- Ảnh canonical là nguồn duy nhất cho OCR, hiển thị và crop.
- Không dùng model sinh ảnh để "làm nét" vùng có chữ hoặc số.

## 1. OCR theo trang

Mỗi trang trả JSON, không trả văn xuôi tự do:

```jsonc
{
  "page": 3,
  // "de" | "dap_an" | "hon_hop" | "khac"
  "page_role": "de",
  // CÓ NHÌN THẤY dòng tiêu đề "ĐÁP ÁN"/"LỜI GIẢI" trên trang này không.
  "answers_heading": false,
  "groups": [{
    "ref": "g1",
    "problem_ref": "Ж3",
    "label": "Ж3. Thí nghiệm Geiger – Marsden",
    "stem_latex": "...",
    "images": [],
    "question_numbers": ["1", "2", "3"]
  }],
  "questions": [{
    "type": "ESSAY",
    "problem_ref": "Ж3",       // số hiệu BÀI LỚN
    "printed_number": "2",     // số câu con TRONG bài đó
    "stem_latex": "...",
    "group_ref": "g1",
    "images": [{ "slot": 1, "bbox": [0.31, 0.42, 0.68, 0.55], "caption": null, "note": "..." }],
    "mc_choices": null,
    "mc_correct": null,
    "tf_statements": null,
    "short_answer": null,
    "solution_latex": null,
    "answer_source": "none"
  }],
  "printed_answers": []
}
```

### Đề nhiều bài lớn

`problem_ref` là số hiệu **bài lớn** ("Ж3", "Bài 2", "Câu III"); `printed_number`
là số **câu con** bên trong bài đó. Đề HSG, olympiad và đề đại học đánh số câu
con lại từ 1 trong mỗi bài, nên thiếu `problem_ref` thì đáp án bị ghép sai câu.
Đề trắc nghiệm đánh số liên tục 1..40 thì `problem_ref` = null.

### Đề có phần ĐÁP ÁN ở nửa sau

- `answers_heading` là **sự kiện nhìn thấy được**, không phải phán đoán: trang có
  in dòng tiêu đề "ĐÁP ÁN"/"LỜI GIẢI"/"HƯỚNG DẪN CHẤM" hay không.
- Chỉ mốc này mới lật cả tài liệu sang chế độ lời giải. Từ trang đó trở đi,
  `questions` của mỗi trang được chuyển thành `printed_answers` rồi ghép về câu
  ở phần đề.
- `page_role` một mình **không được** xoá câu hỏi: model gọi nhầm một trang đề là
  `dap_an` là chuyện có thật, và nhãn sai chỉ được làm mất dữ liệu khi có mốc
  khách quan xác nhận.
- Bối cảnh tuần tự (đã qua mốc đáp án chưa, bài lớn nào đang mở) do **backend**
  chèn vào prompt của trang sau; model chỉ nhìn được một trang mỗi lượt.

### Quy tắc nội dung

- Chép nguyên dữ kiện; không sửa số, thêm điều kiện hay viết lại "cho hay".
- Không đọc được thì để `null` và ghi chú vào `notes`.
- Toán học dùng LaTeX subset mà renderer hỗ trợ.
- Giữ dấu thập phân tiếng Việt, ví dụ `$0{,}5$`.
- Không tự suy độ đúng/sai, đáp án MC hay kết quả ngắn.
- **Số phương án lấy đúng như đề.** Đề phổ thông thường 4 (A–D); đề đại học có
  thể 5 (A–E, hay có phương án "Các câu khác sai"). Ép về 4 là làm hỏng cả trang.

### Quy tắc đáp án

- Chỉ gắn đáp án/lời giải được **in trong nguồn**.
- Không có đáp án in sẵn → trường đáp án là `null`, `answer_source = "none"`.
- Có đáp án ở trang khác → ghi vào `printed_answers`, backend ghép ở bước 2.
- Không có bước gọi model thứ hai để tự giải hoặc "xác minh".

### Quy tắc bbox

- **Chỉ hình mới có bbox.** Câu và cụm dữ liệu không còn trường toạ độ.
- Định dạng `[x0, y0, x1, y1]` chuẩn hoá 0–1 theo toàn bộ ảnh canonical, gồm cả
  lề, đầu trang và chân trang.
- Adapter tự chấp nhận hệ 0–100 và 0–1000 mà một số vision model vẫn trả về.
- Bbox trùm quá 72% diện tích trang bị bỏ kèm ghi chú "crop lại khi duyệt", thay
  vì nhét cả trang vào làm hình minh hoạ.

### Độ bền của lời gọi

- Streaming SSE, đọc chunk bằng tay.
- Treo im lặng quá 75 giây giữa hai chunk → huỷ và thử lại; tổng quá 240 giây → huỷ.
- Chạm trần token → vá JSON về phần tử cuối còn nguyên vẹn, giữ phần đã đọc và
  ghi chú vào câu cuối.
- **Vá escape LaTeX trong JSON, chạy trước mỗi lần parse.** Hai kiểu hỏng khác
  nhau: `\dfrac` thiếu gạch chéo làm `JSON.parse` ném lỗi và mất cả trang; còn
  `\right`, `\theta`, `\frac`, `\beta` thiếu gạch chéo lại là JSON **hợp lệ** —
  parse thành ký tự điều khiển, không lỗi, chỉ có công thức sai âm thầm. Kiểu
  thứ hai nhận diện theo tên lệnh nên `\nb)` vẫn được hiểu là xuống dòng.
- Model trả hai ký tự `\` + `n` thay cho xuống dòng thì dọn ở phần chữ; trong
  `$…$` không đụng vào vì `\ne`, `\nabla` là lệnh thật.
- Cổng không nhận `json_schema` → tự hạ xuống `json_object` kèm schema trong prompt.
- Lỗi phân loại thành `network | quota | auth | model | schema | config`; chỉ
  nhóm tạm thời mới thử lại (3 lần, backoff).
- Kết quả mỗi trang ghi ra `extraction-N.json` ngay khi xong, nên "Thử lại" chỉ
  tốn lượt gọi cho những trang còn thiếu.

## 2. Reconcile toàn tài liệu

Sau khi OCR từng trang, backend ghép các phần bằng logic xác định, không tốn
thêm lượt AI:

- nối `printed_answers` vào câu theo `(type, printed_number)`;
- nối câu với nhóm theo `group_ref` và `question_numbers`;
- giữ quan hệ khi dữ liệu chung, đáp án hoặc câu con nằm ở trang khác;
- khớp đáp án MC theo **nhãn in trên đề** trước, rồi mới đến vị trí.

## 3. Đối chiếu và duyệt

Màn Duyệt có hai phần:

- **Bảng đối chiếu** (mới): mỗi dòng là một câu — số câu in trên đề, trang, đề
  bài rút gọn, đáp án, dạng, lý do cần xem kĩ. Bấm một dòng là nhảy sang câu đó
  và mở đúng trang gốc. Đây là cách kiểm "OCR có đúng không" và "câu này ở đâu".
- **Ảnh trang gốc**, không có lớp highlight. Toạ độ chỉ còn phục vụ việc cắt hình.

Người dùng có thể: sửa stem/phương án/metadata/đáp án in, crop lại hình của câu
hoặc của cụm, duyệt hoặc bỏ, và duyệt cả nhóm như một đơn vị.

## 4. Lưu và xuất

- Câu độc lập và nhóm câu là hai loại entity rõ ràng.
- Random/ráp đề không được tách câu con khỏi nhóm.
- DOCX xuất công thức dạng equation native.
- Style đầu ra: `classic`, `exam-blue`, `specialist-pink`, `logic-green`.
- Kiểu phương án: `plain`, `circle` (ô tròn kiểu BK/HCMUT), `cards`, `tabular`.
  Ô tròn phải là **chữ** ở mọi đường ra (Ⓐ trong Word, `\textcircled` trong
  LaTeX), không phải shape hay ảnh.
- Import ảnh/PDF format không gọi model: backend chuẩn hoá trang đầu, lấy palette
  bằng thuật toán rồi để người dùng chốt cấu trúc block.

## Kiểm thử và số đo

Tối thiểu cần theo dõi:

- tỷ lệ câu trích đúng hoàn toàn;
- tỷ lệ gắn đúng đáp án in;
- precision/recall nhận diện nhóm;
- tỷ lệ hình phải crop lại tay;
- giây/câu trong màn duyệt;
- token, thời gian và chi phí mỗi trang;
- tỷ lệ DOCX/PDF xuất thành công.

Bộ eval nên có PDF số, scan mờ, ảnh điện thoại, đề nhiều cột, đáp án cuối tài
liệu, nhóm câu xuyên trang, và đề đại học 5 phương án.
