# Phase 0 — spike kiểm chứng

Mục tiêu duy nhất: trả lời câu hỏi sinh tử trước khi đầu tư 2 tháng vào app.

> Từ dữ liệu câu hỏi có cấu trúc, ta có xuất được file `.docx` mà giáo viên
> **mở bằng Word rồi click vào công thức là sửa được ngay** hay không?

Không auth, không UI, không database. Một CLI.

## Cần có sẵn

| Công cụ | Dùng để | Cài |
|---|---|---|
| Node 20+ | chạy CLI | đã có |
| **pandoc** | markdown → docx, công thức → OMML | `winget install --id JohnMacFarlane.Pandoc -e` |
| MiKTeX (`pdflatex`, `pdftoppm`) | biên dịch hình TikZ | chỉ cần cho phần hình |

`latexmk` của MiKTeX là script Perl và thường chết vì máy không có Perl —
đường ống ở đây gọi thẳng `pdflatex` nên không cần Perl.

```bash
npm install
npm run doctor
```

## Chạy

```bash
npm run render
```

Đọc `fixtures/sample-exam.json` (4 câu Vật lý thật: 2 TN, 1 Đúng/Sai, 1 Trả lời ngắn,
có 1 hình TikZ) và xuất ra `out/`:

- `de.docx` — đề
- `dap-an.docx` — bảng đáp án
- `loi-giai.docx` — lời giải chi tiết
- kèm file `.md` trung gian để soi khi docx ra sai

Sau đó tự kiểm bằng cách mở `word/document.xml` trong file docx và **đếm thẻ
`<m:oMath>`**. Có thẻ này nghĩa là công thức là equation native của Word.
Không có nghĩa là công thức đã thành ảnh hoặc text thường — và cả app vô nghĩa.

### Kết quả lần chạy đầu

```
PASS  de.docx        19 equation, 1 ảnh, 3 bảng
PASS  dap-an.docx     0 equation
PASS  loi-giai.docx  18 equation, 1 ảnh
```

Phần tự động chỉ chứng minh được equation tồn tại. Bốn điều còn lại phải mở
Word thật để kiểm bằng mắt — CLI in ra checklist sau mỗi lần chạy.

## Trích xuất bằng AI

Chép `.env.example` thành `.env` rồi tự điền API key vào đó
(**đừng dán key vào chat hay commit lên git**).

```bash
npm run extract -- duong/dan/trang-de.pdf
npm run full    -- duong/dan/trang-de.jpg      # trích xuất rồi xuất luôn docx
```

Mỗi lần chạy in ra token vào/ra, thời gian, và **chi phí quy ra mỗi trang** —
đây là con số để định giá gói premium sau này, không phải đoán.

### So model

```bash
npm run extract -- trang.pdf --model claude-opus-5
npm run extract -- trang.pdf --model claude-sonnet-5
npm run extract -- trang.pdf --model claude-haiku-4-5
npm run extract -- trang.pdf --model claude-sonnet-5 --effort medium
```

Bảng giá trong `src/providers.ts` là số tham chiếu chốt ngày 2026-06-24 —
đối chiếu với hoá đơn thật trước khi dùng để định giá.

## Hình vẽ

```bash
npm run tikz
```

Biên dịch hình mẫu (vật trên mặt phẳng nghiêng) ra `out/assets/`.

Lưu ý về TikZ do AI sinh: hình mẫu trong `src/tikz.ts` ban đầu vẽ vector trọng
lực vuông góc với mặt nghiêng thay vì thẳng đứng, vì mũi tên được vẽ bên trong
một `scope` đã xoay. Đây đúng là kiểu lỗi mà mục 6 của `docs/ai-pipeline.md`
cảnh báo: TikZ compile sạch không có nghĩa là hình đúng vật lý. Luôn nhìn hình
trước khi tin nó.

## Cấu trúc

```
src/
  types.ts       schema zod + ràng buộc theo dạng câu (MC/TF/SHORT)
  prompt.ts      prompt trích xuất + prompt đối chiếu chéo
  providers.ts   interface VisionProvider + bản Anthropic + bảng giá
  extract        (trong cli.ts) ảnh/PDF -> JSON có schema
  tikz.ts        TikZ -> PDF -> PNG qua pdflatex + pdftoppm
  render.ts      JSON -> markdown -> pandoc -> docx, và bài kill test
  cli.ts         doctor | render | tikz | extract | full
```

`VisionProvider` là interface có chủ đích: bước 2 của pipeline cần một model
**khác vendor** để đối chiếu chéo, nên adapter thứ hai chỉ việc implement
đúng interface này.

## Còn thiếu (có chủ đích)

- `templates/reference.docx` — chưa có nên docx dùng style mặc định của pandoc.
  Bảng 4 phương án vì thế **vẫn còn viền**. Tạo file mẫu bằng:
  `pandoc -o templates/reference.docx --print-default-data-file reference.docx`
  rồi mở ra sửa style `Table` cho hết viền, chỉnh font và lề theo quy định trường.
- Bước đối chiếu chéo (Gemini) — đã có chỗ trong interface, chưa nối.
- Cắt hình gốc từ PDF — Phase 0 dùng chung một hình TikZ mẫu cho mọi câu.
