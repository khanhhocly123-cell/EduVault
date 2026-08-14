# EduVault — giới thiệu sản phẩm

## Một câu

EduVault biến ảnh hoặc PDF đề thi thành kho câu hỏi có cấu trúc, cho giáo viên duyệt trên ảnh gốc, ráp lại theo nhiều chuẩn thi và xuất Word có công thức sửa được.

## Vấn đề cần giải quyết

Nguồn đề của giáo viên thường nằm rải rác trong PDF scan, ảnh điện thoại và file Word cũ. Việc gõ lại mất thời gian; dán ảnh thì khó sửa, khó tìm kiếm và chất lượng in không ổn định.

EduVault tập trung vào toàn bộ khâu **số hoá → duyệt → lưu kho → ráp đề → xuất bản**, thay vì chỉ làm một OCR đơn lẻ.

## Luồng sản phẩm hiện tại

```text
PDF / nhiều ảnh / dán clipboard
  → OCR có cấu trúc
  → đối chiếu đáp án in sẵn và nhận diện nhóm câu
  → giáo viên duyệt trên ảnh gốc
  → lưu kho
  → ráp đề THPT / ĐGNL / TSA / HSA
  → DOCX đề, đáp án và lời giải
```

## Điểm khác biệt

- Tuỳ biến cấu trúc đề ở cấp phần, dạng câu, số lượng, điểm, thứ tự và phong cách trình bày.
- Hỗ trợ câu độc lập lẫn **nhóm câu dùng chung một cụm dữ liệu**, kể cả khi dữ liệu và câu con nằm ở nhiều trang/ảnh.
- AI chỉ chép nội dung và đáp án được in trong tài liệu; **không tự giải để đoán đáp án**.
- Màn duyệt có bảng đối chiếu OCR ↔ trang gốc: bấm một câu là mở đúng trang mà nó được đọc ra. Hình được cắt tự động trên đúng ảnh trang đã xoay chuẩn, cắt lệch thì kéo lại vùng ngay trên trang trước khi câu vào kho.
- Một lần tải có thể gồm tối đa 50 ảnh; kéo thả, chọn nhiều file và dán từ clipboard đều tạo được tài liệu nhiều trang.
- Có bốn phong cách đầu ra: `classic`, `exam-blue`, `specialist-pink`, `logic-green`.
- Có preset riêng theo Kho: nhập ảnh/PDF format tham chiếu, chỉnh đầu đề, màu, số ô TLN, vùng tự luận, ảnh và các block trên/dưới rồi lưu để tái dùng.
- Công thức trong DOCX là equation native, không phải ảnh chụp công thức.

## Năm khu vực chính

| Khu vực | Vai trò |
|---|---|
| Trang chính | Tổng quan kho, tài liệu và việc cần duyệt |
| Tài liệu | Tải PDF/nhiều ảnh, theo dõi tiến trình OCR |
| Duyệt | So ảnh gốc với dữ liệu OCR, sửa vùng, crop hình, duyệt câu hoặc nhóm |
| Kho câu hỏi | Tìm, sửa và quản lý câu độc lập/nhóm câu |
| Ráp đề | Cấu hình cấu trúc, phong cách và xuất DOCX |

## Trạng thái

Ứng dụng đang ở mức **MVP nâng cao / pilot nội bộ**:

- Đã có server local, tài khoản, session HttpOnly, SQLite và vùng dữ liệu riêng theo người dùng.
- Đã nối upload, OCR, review, kho, ráp đề và xuất Word thành một luồng.
- Đã có test backend, self-test pipeline, kiểm tra type và kiểm tra cú pháp.

Chưa production-ready vì còn thiếu reset mật khẩu, xác minh email, rate limit, quota server-side hoàn chỉnh, antivirus, backup/restore, observability và kiểm thử tải.

## Đánh giá thẳng

Sự độc đáo không nằm ở một model OCR riêng lẻ. Lợi thế có thể bền hơn nằm ở:

1. workflow duyệt nhanh nhưng vẫn giữ bằng chứng từ ảnh gốc;
2. mô hình dữ liệu đủ linh hoạt cho nhiều chuẩn thi và nhóm câu;
3. kho cá nhân tích luỹ theo thời gian;
4. đầu ra Word dùng được thật trong công việc của giáo viên.

Rủi ro lớn nhất vẫn là chất lượng OCR trên tài liệu thật và thời gian người dùng phải sửa. Pilot nên đo tỷ lệ câu phải sửa, giây/câu, tỷ lệ export thành công và tỷ lệ người dùng quay lại.
