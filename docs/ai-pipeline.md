# Pipeline AI — trích xuất câu hỏi từ tài liệu

Bốn bước. Bước 3 là con người và **không được phép bỏ qua**.

```
[0] Tiền xử lý ảnh   →  [1] Trích xuất   →  [2] Đối chiếu chéo   →  [3] Giáo viên duyệt
    OpenCV / sharp       Claude vision       Gemini vision           màn hình review
    không dùng GenAI     → JSON schema       → lệch + confidence     → vào kho
```

---

## Bước 0 — Tiền xử lý (không dùng model sinh ảnh)

PDF số (không phải scan) thì bỏ qua hẳn bước này, đưa thẳng PDF vào bước 1.

Với ảnh chụp / scan:
- tách trang, xoay đúng chiều, deskew
- khử nhiễu, cân bằng sáng, cắt lề
- upscale bằng thuật toán cổ điển nếu DPI thấp

**Quy tắc cứng: không chạy model sinh ảnh ("làm nét" bằng AI) lên vùng có chữ và số.**
Model sinh ảnh vẽ lại pixel — nó có thể biến `0,05` thành `0,06`, `10^{-3}` thành
`10^{-8}`, và không có tín hiệu nào để phát hiện. Một con số sai trong đề đã in ra
là 40 học sinh chịu hậu quả. Deskew/denoise cổ điển không bao giờ bịa ra pixel mới.

Model sinh ảnh chỉ được dùng ở bước xử lý **hình vẽ** (xem cuối file), nơi giáo viên
nhìn phát là biết sai.

---

## Bước 1 — Trích xuất (Claude vision, structured output)

Input: ảnh trang đã tiền xử lý hoặc PDF gốc. Output: JSON đúng schema, không text tự do.

### JSON schema

```jsonc
{
  "page": 3,
  "questions": [
    {
      "type": "MC",                         // MC | TF | SHORT | ESSAY
      "stem_latex": "Một vật dao động điều hoà với biên độ $A = 5\\,\\mathrm{cm}$...",
      "images": [
        { "slot": 1, "bbox": [0.12, 0.34, 0.48, 0.61], "caption": "đồ thị x-t" }
      ],
      "mc_choices": [
        { "label": "A", "text_latex": "$2\\,\\mathrm{Hz}$" },
        { "label": "B", "text_latex": "$4\\,\\mathrm{Hz}$" },
        { "label": "C", "text_latex": "$0{,}5\\,\\mathrm{Hz}$" },
        { "label": "D", "text_latex": "$1\\,\\mathrm{Hz}$" }
      ],
      "mc_correct": "C",
      "tf_statements": null,
      "short_answer": null,
      "solution_latex": null,
      "grade": 11,
      "topic_code": "p11.oscillation",
      "difficulty": "TH",
      "notes": "đáp án suy ra từ phần lời giải ở trang 12"
    }
  ]
}
```

`TF` thì `tf_statements` có **đúng 4 phần tử**:
```jsonc
[{ "idx": "a", "text_latex": "...", "is_true": true }, ...]
```
`SHORT` thì `short_answer` là `{ "value": 3.14, "unit": "m/s", "tolerance": 0.01 }`.

`bbox` dùng toạ độ chuẩn hoá 0–1 theo khổ trang, để bước cắt hình dùng lại được.

### Quy ước LaTeX bắt buộc trong prompt

- Toán học bọc trong `$...$`, không dùng `\(...\)` (pandoc xử lý `$` ổn định hơn).
- Đơn vị dùng `\mathrm{}`: `$5\,\mathrm{m/s}$`, không viết `5 m/s` trần.
- **Dấu thập phân giữ nguyên dấu phẩy kiểu Việt Nam**: `$0{,}5$` chứ không phải `$0.5$`.
  Đây là lỗi hay gặp nhất khi model quen tài liệu tiếng Anh.
- Vector: `$\vec{v}$`. Độ: `$30^\circ$`.
- Không tự chế macro, không dùng package ngoài — chỉ subset pandoc hiểu.
- Chỗ có hình: chèn `[[IMG:1]]` đúng vị trí trong thân câu.

### Quy tắc nội dung

- **Chép, không sáng tác.** Không sửa số liệu, không "làm đẹp" câu chữ, không bổ sung
  dữ kiện thiếu. Trang bị mờ không đọc được thì để `null` và ghi vào `notes`.
- Đáp án chỉ điền khi tài liệu có ghi. Không tự giải để đoán đáp án ở bước này.
- `difficulty` và `topic_code` là **phỏng đoán**, giáo viên sẽ sửa — cứ đoán, đừng bỏ trống.
- Một trang có nhiều câu thì trả nhiều phần tử. Câu bị cắt ngang trang thì đánh dấu
  `"continues": true` để ghép ở bước sau.

Xử lý theo lô 2–4 trang/lần: đủ ngữ cảnh để ghép câu bị cắt trang mà không loãng.

---

## Bước 2 — Đối chiếu chéo (Gemini vision)

Đây là bước "AI chỉnh lại câu chữ", nhưng wire theo hướng an toàn.

**Sai lầm cần tránh:** đưa mỗi JSON (không có ảnh) cho một model text-only rồi bảo nó
"sửa cho mượt". Model sẽ sửa cả những chỗ vốn đã đúng — đặc biệt là số liệu lạ và
đơn vị — và không ai biết nó đã sửa gì.

**Cách làm đúng:** đưa **ảnh gốc + JSON của bước 1** cho một model **khác vendor**, và
nó chỉ được trả về *danh sách chỗ lệch*, không được viết lại cả câu.

```jsonc
{
  "question_index": 0,
  "confidence": 0.62,
  "discrepancies": [
    {
      "field": "mc_choices[2].text_latex",
      "extracted": "$0.5\\,\\mathrm{Hz}$",
      "observed":  "$0{,}5\\,\\mathrm{Hz}$",
      "severity": "low",
      "reason": "dấu thập phân"
    },
    {
      "field": "stem_latex",
      "extracted": "$A = 5\\,\\mathrm{cm}$",
      "observed":  "$A = 6\\,\\mathrm{cm}$",
      "severity": "high",
      "reason": "số liệu khác với ảnh"
    }
  ]
}
```

Xử lý kết quả:
- `severity: low` (chính tả, dấu câu, spacing quanh `$`) → **tự áp dụng**, ghi log.
- `severity: high` (số liệu, đơn vị, đáp án, tên đại lượng) → **không tự sửa**, đẩy vào
  `questions.ai_flags` và highlight đỏ trên màn hình duyệt.
- `confidence` = hàm của số lượng và mức nghiêm trọng của chỗ lệch → điều khiển nút
  "duyệt tất cả câu tin cậy cao".

Dùng model khác nhà cho bước này là có chủ đích: hai model cùng nhà sai theo cùng một
kiểu nên đồng thuận với nhau ở đúng chỗ chúng cùng sai. Khác nhà thì chỗ chúng bất
đồng chính là chỗ đáng ngờ thật.

Bước 2 tuỳ chọn bật/tắt: nguồn là PDF số rõ nét thì tắt để tiết kiệm; ảnh chụp bằng
điện thoại thì luôn bật.

---

## Bước 3 — Giáo viên duyệt

Xem mục 7 của [PLAN.md](../PLAN.md). Ràng buộc quan trọng nhất: **dưới 15 giây/câu**.
Chậm hơn thì giáo viên tự gõ còn nhanh hơn.

Mọi lần giáo viên sửa đều ghi lại (trường nào, từ gì sang gì). Sau vài trăm lượt sẽ
thấy rõ model hay sai ở đâu → chỉnh prompt, hoặc chỉnh riêng theo thói quen từng người.

---

## Hình vẽ — ba mức, theo đúng thứ tự

### Mức 1 (mặc định): cắt hình gốc

- PDF số: `PyMuPDF` lấy hình nhúng sẵn, hoặc render vùng `bbox` ra PNG 300 DPI.
- Ảnh chụp: crop theo `bbox`, và cho giáo viên kéo-chỉnh khung trong màn hình duyệt.

Đúng 100%, 3 giây, không rủi ro. 90% nhu cầu dừng ở đây.

### Mức 2: vẽ lại bằng TikZ

Chỉ áp cho hình **đơn giản và có cấu trúc rõ**: mặt phẳng nghiêng, ròng rọc, mạch điện,
hệ trục toạ độ, sơ đồ lực. Không áp cho hình phức tạp, hình có số liệu dày, ảnh thực tế.

Quy trình bắt buộc:
1. Sinh TikZ từ ảnh gốc.
2. **Compile ngay** trong service render. Compile lỗi → thử lại tối đa 2 lần → bỏ, quay về mức 1.
3. Hiển thị **cạnh nhau**: ảnh gốc | hình TikZ.
4. Luôn có nút "giữ ảnh gốc", và đó là lựa chọn mặc định.
5. Giữ nguyên `tikz_source` trong DB để sửa tay sau — người dùng đã quen LaTeX sẽ cần.

Đừng tin TikZ do model sinh ra mà không nhìn: chiều vector, góc, và nhãn là ba thứ nó
sai thường xuyên nhất, và đều là thứ làm hỏng cả câu vật lý.

### Mức 3: làm nét bằng model sinh ảnh (nano banana)

Chỉ áp lên **crop hình vẽ** đã tách khỏi vùng text, khi hình scan quá mờ và TikZ không
áp dụng được.

- Không bao giờ áp lên cả trang, không bao giờ áp lên vùng có chữ/số.
- Luôn lưu `original_path`, hiển thị trước/sau, cho hoàn tác một click.
- Prompt theo hướng phục hồi ("khử nhiễu, làm rõ nét vẽ, giữ nguyên mọi ký hiệu và
  chữ số"), không theo hướng sáng tạo ("vẽ lại cho đẹp").

---

## Đo đạc cần có từ ngày đầu

Ghi vào `usage_ledger` mọi lần gọi model: `model`, `input_tokens`, `output_tokens`,
`cost_usd`, `pages`. Không có số này thì không định giá gói premium được, và cũng
không biết bước 2 có đáng tiền không.

Bộ đánh giá cố định: **20 trang đề Vật lý thật** (10 PDF số, 10 ảnh chụp), gõ tay đáp
án chuẩn một lần. Mỗi lần đổi prompt hay đổi model thì chạy lại và so:
- % câu trích đúng hoàn toàn
- % số liệu sai (chỉ số nghiêm trọng nhất)
- giây/trang, đồng/trang
