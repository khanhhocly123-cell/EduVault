# EduVault

EduVault biến PDF/ảnh đề thi thành các Kho câu hỏi có cấu trúc, cho phép duyệt trên ảnh gốc,
ráp đề và xuất Word có công thức chỉnh sửa được. Toán/Vật lí chỉ là metadata mặc định; mỗi Kho
có thể chứa tài liệu, câu hỏi, nhóm câu và draft đề riêng.

Mỗi Kho còn có preset trình bày riêng: người dùng có thể nhập ảnh/PDF format tham chiếu,
chỉnh đầu đề, palette, form MC/TF/TLN/tự luận, block trên/dưới và tái dùng khi xuất DOCX.

## Chạy local

Yêu cầu Node.js 22.5+. Upload PDF cần `pdftoppm` trong `PATH`.

```powershell
cd web
npm install
npm start
```

Mở [http://127.0.0.1:5173](http://127.0.0.1:5173).

Tài khoản test:

- Email: `admin@eduvault.local`
- Mật khẩu: `Admin@123456`

## Cấu trúc repo

- `web/`: app chính, backend Node, SQLite, OCR orchestration và DOCX browser-native.
- `phase0/`: schema, prompt, provider AI và CLI kiểm chứng.
- `docs/ai-pipeline.md`: hợp đồng dữ liệu và guardrail OCR.
- `PLAN.md`: trạng thái và roadmap kỹ thuật.
- `HANDOFF.md`: thông tin bàn giao ngắn gọn.
- `GIOI-THIEU.md`: định vị sản phẩm và đánh giá cơ hội.

## Kiểm tra

```powershell
npm.cmd --prefix web test
npm.cmd --prefix phase0 run typecheck
npm.cmd --prefix phase0 run selftest
```

Trạng thái hiện tại: **MVP nâng cao / pilot nội bộ**, chưa phải production scale.
