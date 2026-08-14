# Phase 0 — OCR và DOCX core

Thư mục này chứa CLI, schema và prompt của spike ban đầu, dùng để thử trích xuất
ngoài app và xác nhận DOCX có công thức Word native.

> **Không còn nằm trên đường chạy của app.** Từ 13/08/2026, web gọi model OCR
> ngay trong tiến trình server qua `web/ocr-model.mjs` — xem `HANDOFF.md` mục 8.1
> để biết ba kiểu hỏng đã buộc phải bỏ cách spawn `tsx` từ đây. Prompt và schema
> trong `src/prompt.ts` / `src/types.ts` **chưa được đồng bộ** với bản trong web
> (bản web đã bỏ bbox của câu và cho phép quá 4 phương án). Muốn dùng thư mục này
> làm bộ eval thì phải đồng bộ trước, hoặc viết eval mới gọi thẳng
> `web/ocr-model.mjs`.

File `.env` ở đây vẫn là nơi app đọc `DE_MODEL` và API key.

## Cài đặt

```powershell
cd D:\NewApp\phase0
npm install
npm run doctor
```

Yêu cầu:

- Node 22.5+.
- Pandoc để render tài liệu.
- `pdftoppm` để xử lý PDF.
- MiKTeX/`pdflatex` chỉ khi thử TikZ.

Sao chép `.env.example` thành `.env` và tự điền API key. Không commit hoặc dán key vào chat.

## Lệnh chính

```powershell
npm run extract -- duong\dan\tai-lieu.pdf
npm run full -- duong\dan\trang-de.jpg
npm run render
npm run tikz
npm run selftest
npm run typecheck
```

- `extract`: ảnh/PDF → JSON có schema.
- `full`: extract rồi xuất DOCX.
- `render`: fixture JSON → đề, đáp án và lời giải.
- `selftest`: kiểm tra schema, parsing và các bất biến.

## Hợp đồng OCR

- Nhận MC, TF, SHORT, ESSAY và nhóm câu dùng chung dữ liệu.
- Mỗi câu giữ `printed_number`, `page`, `group_ref` và vùng hình.
- Bbox dùng toạ độ chuẩn hoá 0–1 theo toàn bộ ảnh trang đã chuẩn hoá.
- Đáp án/lời giải chỉ được điền khi in trong nguồn.
- Nếu nguồn không có đáp án thì giữ `null`; pipeline **không tự giải**.
- `printed_answers` cho phép đáp án nằm ở trang khác và được web reconcile theo loại câu + số in.
- Một nhóm có `ref`, stem/dữ liệu chung, ảnh chung và danh sách số câu.

Chi tiết xem [pipeline AI](../docs/ai-pipeline.md).

## Cấu trúc

```text
src/
  cli.ts        doctor | render | tikz | extract | full
  types.ts      schema và validation
  prompt.ts     chỉ dẫn OCR không tự giải
  providers.ts adapter model và usage
  render.ts     JSON → Markdown → DOCX
  tikz.ts       TikZ → PDF → PNG
```

## Phạm vi

Phase 0 là lõi kỹ thuật, không phải app hoàn chỉnh. Auth, SQLite, review UI, crop, kho câu hỏi và ráp đề nằm trong `web/`.

TikZ chỉ là thử nghiệm phụ. Luồng sản phẩm mặc định giữ/crop hình gốc vì bảo toàn dữ liệu tốt hơn.
