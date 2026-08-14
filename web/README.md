# EduVault Web

Ứng dụng local gồm frontend tĩnh, HTTP API, SQLite, pipeline OCR và bộ xuất DOCX.

## Chạy

```powershell
cd D:\NewApp\web
npm install
npm start
```

Mở <http://127.0.0.1:5173/>.

### Bản beta public tách dữ liệu

```powershell
npm run beta
```

Instance beta chạy ở `http://127.0.0.1:5174`, dùng `web/data-beta/` riêng,
tự cấp gói Plus cho tài khoản mới và giới hạn 20 job OCR mỗi tài khoản. Chỉ
public cổng này qua Quick Tunnel để không làm lộ database local ở cổng 5173.

Tài khoản admin local:

```text
admin@eduvault.local
Admin@123456
```

## Yêu cầu

- Node 22.5+.
- `pdftoppm` nếu nhập PDF.
- API key/model OCR đọc từ `phase0/.env` (hoặc biến môi trường). Kiểm tra bằng `GET /api/ocr/health`.

Runtime data nằm ở `web/data/`. Ảnh format/preset được lưu trong
`web/data/style-references/<user-id>/`; workspace chỉ giữ URL asset để tránh lặp
chuỗi base64 trong nhiều preset.

## Chức năng

- Auth bằng cookie session HttpOnly; dữ liệu riêng theo người dùng.
- Kho v2: tạo, đổi tên và chuyển Kho; mỗi Kho giữ câu, nhóm, nguồn, hàng duyệt và draft riêng.
- Workspace Toán/Vật lí cũ tự migrate thành `Kho Vật lí` và `Kho Toán` mà không đổi ID dữ liệu.
- Upload một PDF hoặc tối đa 50 ảnh bằng chọn file, kéo thả hay dán clipboard.
- Một batch nhiều ảnh được xem là một tài liệu nhiều trang.
- OCR câu MC/TF/SHORT/ESSAY, đáp án in sẵn và nhóm câu dùng chung dữ liệu.
- Không tự giải câu thiếu đáp án.
- OCR chạy nền: upload trả về ngay, client theo dõi qua `GET /api/jobs/:id`, tiến độ đếm theo trang thật.
- Job lỗi giữ nguyên file gốc và có nút `Thử lại`; kết quả từng trang được cache nên thử lại chỉ tốn lượt cho trang còn thiếu.
- Server khởi động lại thì job đang dở tự chạy tiếp.
- Ghép đáp án và nhóm xuyên trang.
- Duyệt bằng bảng đối chiếu OCR ↔ trang gốc (bấm một dòng là mở đúng trang), kèm crop/thay hình trực tiếp trên trang.
- Popup "Soát cả tài liệu": xem toàn bộ câu AI đọc được, chọn nhiều câu rồi xoá hàng loạt;
  tích một câu của cụm là tích cả cụm; bấm một dòng là đóng bảng và mở đúng trang gốc.
- Phóng ảnh trang 75%–400% bằng nút hoặc `Ctrl` + lăn chuột; crop vẫn đúng toạ độ ở mọi mức phóng.
- Workspace có mốc phiên bản: tab cũ không ghi đè được kết quả OCR mà máy chủ vừa ghi.
- Duyệt/lưu nhóm nguyên tử; UI riêng cho nhóm trong kho.
- Ráp đề tuỳ biến và xuất DOCX equation-native.
- Xuất PDF biên dịch trực tiếp bằng pdfLaTeX; lề mặc định 1 cm bốn phía, giữ hình câu và cụm dữ liệu.
- Màn Ráp đề xem trước bằng **PDF thật** (đúng file sẽ tải về), có nút Làm mới; vẫn giữ chế độ "Bản nhanh" dựng bằng HTML.
- Bốn kiểu phương án (`plain`, `circle`, `cards`, `tabular`) khớp một-một giữa xem trước, Word và PDF.
- Trong Kho: chọn hết theo bộ lọc, chọn nhiều câu rồi xoá hàng loạt; xoá một câu của cụm là xoá cả cụm.
- Style: `classic`, `exam-blue`, `specialist-pink`, `logic-green`.
- Preset trình bày lưu riêng theo Kho; một preset gồm đầu đề, palette, form MC/TF/TLN/tự luận, tiêu đề phần, khối trên/dưới, ảnh, logo và watermark.
- Preset BK dùng Latin Modern thật; phương án trắc nghiệm mặc định nằm trong ô tròn kiểu HCMUT, đồng bộ giữa preview, Word (Ⓐ) và PDF (`	extcircled`).
- Nhập ảnh/PDF format tham chiếu: trang đầu được chuẩn hoá thành asset, lấy palette cục bộ không tốn token rồi áp cùng ngôn ngữ hình ảnh cho cả bốn dạng câu.
- Preview và DOCX đồng bộ số cột MC, số ô TLN, vùng trình bày TLN và số dòng bài làm tự luận.

## Thành phần chính

| File | Vai trò |
|---|---|
| `server.mjs` | server và API routes |
| `backend.mjs` | auth, persistence và domain services |
| `ocr-model.mjs` | gọi model OCR trong tiến trình: prompt, schema, retry, phân loại lỗi |
| `ocr.mjs` | canonical page, cắt hình và reconcile nhiều trang |
| `app.js` | UI/state |
| `docx.js` | export Word |
| `styles.css` | layout, crop và preview styles |

## Test

```powershell
npm test
node --check app.js
node --check backend.mjs
node --check ocr.mjs
node --check server.mjs
```

## Chưa production-ready

Job OCR chạy trong chính tiến trình server và chưa giới hạn số job song song.
Import format v1 chỉ lấy trang đầu và palette, chưa tự suy toàn bộ hình học của một layout bất kỳ; người dùng vẫn chốt các block trong editor. Hệ thống còn thiếu queue/worker bền vững, reset mật khẩu, xác minh email, rate limit, antivirus, backup/restore, observability và kiểm thử tải.
