# EduVault — kế hoạch kỹ thuật

Cập nhật: 13/08/2026.

## Định vị

Gia sư/giáo viên đưa PDF hoặc ảnh đề vào EduVault, duyệt nội dung AI đọc được,
lưu thành kho riêng và ráp ra file Word sửa được. App tập trung vào **soạn đề và
quản lý kho**, không cạnh tranh trực tiếp ở khâu giao bài/chấm bài.

Điểm khác biệt cần bảo vệ:

1. Tuỳ biến đủ để làm THPT, ĐGNL, TSA, HSA và đề chuyên.
2. Câu hỏi nhóm/cụm dữ liệu là đối tượng thật, không phải đoạn chữ nhân bản.
3. Word xuất ra dùng equation, bảng và chữ native; không dán cả câu thành ảnh.
4. AI là bộ nhập liệu. Mọi câu phải qua mắt người trước khi vào kho.

## Luồng cốt lõi

```text
PDF / nhiều ảnh liên quan
        ↓
OCR từng trang → nối câu, cụm dữ liệu và đáp án xuyên trang
        ↓
Giáo viên duyệt trên ảnh gốc → kho câu hỏi/nhóm câu
        ↓
Ráp đề → preview → DOCX đề / đáp án / lời giải / ma trận
```

## Trạng thái hiện tại

### Đã có

- Auth mật khẩu, session HttpOnly, workspace tách theo user.
- SQLite + filesystem, autosave kho/hàng duyệt/tài liệu/đề.
- Upload PDF hoặc tối đa 50 ảnh; kéo-thả, chọn nhiều và dán `Ctrl+V`.
- Nhiều ảnh liên quan được lưu như một tài liệu nhiều trang.
- OCR bốn dạng `MC`, `TF`, `SHORT`, `ESSAY` với LaTeX-subset.
- AI không tự giải; chỉ ghép đáp án/lời giải in sẵn theo `(dạng, số câu)`.
- Câu hỏi nhóm nối xuyên trang, lưu/duyệt/ráp đề nguyên khối.
- Ảnh canonical auto-rotate dùng chung cho OCR, hiển thị và crop.
- Đối chiếu bằng bảng câu ↔ trang, không dùng highlight; toạ độ chỉ còn cắt hình.
- OCR chạy nền, cache theo trang nên thử lại không tốn lại lượt đã đọc xong.
- Crop hình câu/hình cụm trực tiếp trên trang gốc; sửa vùng thủ công là fallback.
- Kho câu hỏi có tìm/lọc/sửa/xoá; bắt trùng exact-normalized.
- Ráp đề tự do, rút ngẫu nhiên theo nhóm, preview bốn chế độ.
- Bốn style: `classic`, `exam-blue`, `specialist-pink`, `logic-green`.
- DOCX equation-native, bảng/style Word native, logo/lề/watermark.
- Preset trình bày theo Kho: nhập ảnh/PDF tham chiếu, lấy palette cục bộ, lưu đầu đề/block trên-dưới/ảnh và tái dùng.
- Preview đủ MC/TF/TLN/tự luận; số cột MC, số ô TLN và vùng bài làm đồng bộ sang DOCX.

### Chưa production-ready

- OCR còn chạy trong HTTP request; chưa có queue nền/progress/resume từng trang.
- Workspace vẫn là snapshot JSON; chưa chuẩn hoá toàn bộ question/group/exam rows.
- Kho v2 đã có migration tương thích ngược, tạo/đổi tên/chuyển Kho và draft riêng theo Kho.
- Chưa có email verification, reset mật khẩu, OAuth và billing.
- Quota chưa được cưỡng chế đầy đủ phía server; chưa có rate limit/antivirus/backup.
- Trùng câu mới exact; chưa có fuzzy/semantic duplicate.
- Highlight cần benchmark thêm trên đề hai cột, ảnh photo xấu và bố cục rất tự do.
- Import format hiện lấy trang đầu + palette; chưa tự nhận diện pixel-perfect mọi khối header/footer và chưa import trực tiếp `.sty`.

## Ưu tiên tiếp theo

1. Đưa cho 3–5 gia sư chạy hai vòng thật: upload → duyệt → tạo preset → xuất Word.
2. Đo tỉ lệ OCR phải sửa, thời gian duyệt/câu, tỉ lệ hình phải crop lại và tỉ lệ export thành công.
3. Làm queue nền + progress + retry/resume từng trang.
4. Chuẩn hoá database thành `sources`, `groups`, `questions`, `exams`, `exam_items`.
5. Thêm fuzzy duplicate, audit log và backup.
6. Chỉ sau khi có retention pilot mới làm billing/deploy production.

## Nguyên tắc kỹ thuật

- Không dùng model sinh ảnh lên vùng có chữ/số.
- Không tự suy đáp án. Không in đáp án không có bằng chứng từ tài liệu/người dùng.
- Nhóm câu là đơn vị nguyên tử khi duyệt, lưu, rút ngẫu nhiên và ráp đề.
- Không hiển thị thứ mình không chắc; thà báo cần xem còn hơn vẽ một khung sai.
- Nguồn nội dung là LaTeX-subset + asset; đầu ra web/DOCX không được raster hoá toàn câu.
- Không scale hạ tầng trước khi pilot chứng minh người dùng quay lại.

## Tiêu chí qua pilot

- OCR đúng hoàn toàn hoặc chỉ cần sửa nhẹ ở phần lớn câu.
- Median duyệt dưới 15 giây/câu.
- Highlight/crop sai phải phát hiện được và sửa ngay trong màn duyệt.
- DOCX mở bằng Word, công thức và bảng vẫn chỉnh được.
- Có người dùng quay lại nhập tài liệu lần hai mà không cần hướng dẫn trực tiếp.
