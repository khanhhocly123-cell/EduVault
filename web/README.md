# EduVault Phase 1 — tích hợp trực tiếp

Đây là app chính, không phải bản thay thế UI. Phase 1 giữ nguyên màn Trang chính, Kho câu hỏi,
Ráp đề, Duyệt và Tài liệu; phần giả lập/localStorage đã được thay bằng backend chạy thật.

## Chạy

Yêu cầu Node.js 22.5+; nếu upload PDF cần `pdftoppm` trong PATH. Pipeline đọc model/API key từ
`../phase0/.env`.

```powershell
npm install
npm start
```

Mở `http://localhost:5173/index.html`. Dữ liệu nằm trong `web/data/` và đã bị Git ignore.

## Đã làm trong Phase 1

- Git baseline ở repo gốc; secret/build/runtime data không được commit.
- Đăng ký/đăng nhập mật khẩu hash scrypt; cookie session HttpOnly; kho tách theo user.
- SQLite + filesystem; autosave kho, hàng duyệt, source, metadata và đề đang ráp.
- Upload PDF/PNG/JPG/WebP tối đa 15 MB; source/job/error được lưu trước và sau OCR.
- Gọi trực tiếp pipeline `phase0` bằng Node/tsx, output tách riêng theo job để không ghi đè.
- Review file gốc thật, sửa metadata/đáp án, duyệt/bỏ/bulk approve; bắt trùng normalize tuyệt đối.
- Kho tìm/lọc/sửa/xoá, ráp đề và xuất DOCX ngay trong UI cũ; kill test equation-native vẫn qua.
- Test tự động cách ly workspace và mapping output OCR; smoke test UI qua reload không mất dữ liệu.

## Còn lại trước khi scale

- OCR hiện chạy trong request: cần queue nền, retry/resume từng trang và progress polling.
- Chưa crop hình từ PDF để gắn asset thật vào câu và DOCX.
- Workspace đang autosave snapshot JSON trong SQLite để giữ toàn bộ engine cũ; cần chuẩn hoá
  question/source/exam rows trước khi chạy nhiều server instance.
- Chưa có reset mật khẩu/email verification, quota server-side, rate limit, antivirus, backup và
  observability.
- Cảnh báo trùng mới là exact normalize, chưa fuzzy/embedding.
- Google OAuth, billing và pricing trên landing page chưa bật; hiện chỉ là giả thuyết cần pilot.

Không làm tiếp Phase 2 chỉ vì roadmap. Trước hết đưa cho 3–5 gia sư dùng hai vòng đầy đủ và đo:
tỉ lệ OCR phải sửa, giây/câu khi duyệt, tỉ lệ export thành công và số người quay lại lần hai.
