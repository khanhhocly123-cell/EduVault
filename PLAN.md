# EduVault — Plan kỹ thuật v0.1

> **Cập nhật Phase 1 — 12/08/2026:** sản phẩm đã đổi ICP ban đầu từ “giáo viên/trường” sang
> **gia sư cá nhân có kho đề riêng**. Bản pilot chạy thật nằm tại `phase1/`; dùng Next.js 16,
> SQLite + filesystem, cookie auth và pipeline Gemini hiện có. Supabase/Inngest/billing được hoãn
> đến khi 3–5 gia sư hoàn thành ít nhất hai vòng `upload → duyệt → xuất Word`.
> Danh sách đã làm/chưa làm và cách chạy: `phase1/README.md`.

App soạn đề & quản lý kho đề cá nhân cho giáo viên phổ thông Việt Nam.
Môn khởi điểm: **Vật lý**. Stack: **Next.js + Supabase**.

---

## 0. Một câu định vị

> Giáo viên đưa vào tài liệu rời rạc (PDF scan, ảnh chụp, file Word của đồng nghiệp),
> nhận lại một **kho câu hỏi có metadata của riêng mình**, và ráp ra file Word đúng
> cấu trúc đề 2025 trong vài phút — công thức mở ra sửa được ngay.

Cạnh tranh: Azota / Shub / K12Online mạnh khâu **giao đề và chấm**, gần như bỏ trống
khâu **soạn đề**. Ta không đụng vào khâu của họ ở v1.

Moat không nằm ở AI (ai cũng gọi được API). Moat nằm ở:
1. Chất lượng file `.docx` xuất ra (khó làm đúng, dễ đo sai).
2. Kho đã số hoá của chính giáo viên — càng dùng lâu càng khó bỏ.

---

## 1. Luồng cốt lõi

```
Nguồn tài liệu → AI trích xuất → Giáo viên duyệt → Kho câu hỏi riêng
                                                        ↓
                        File Word (đề / đáp án riêng) ← Ráp đề theo ma trận
```

Nguyên tắc bất di bất dịch: **không có câu nào vào kho mà chưa qua mắt giáo viên.**
AI là bộ nhập liệu, không phải bộ quyết định.

---

## 2. Bối cảnh nghiệp vụ (phải code đúng cái này)

### Cấu trúc đề THPT từ 2025 — môn Vật lý

| Phần | Dạng | Số câu | Điểm | Ghi chú chấm |
|---|---|---|---|---|
| I | Trắc nghiệm 4 lựa chọn (`MC`) | 18 | 4,5 | 0,25 đ/câu |
| II | Đúng/Sai (`TF`) | 4 câu × 4 ý | 4,0 | 1 ý đúng: 0,1 — 2 ý: 0,25 — 3 ý: 0,5 — 4 ý: 1,0 |
| III | Trả lời ngắn (`SHORT`) | 6 | 1,5 | 0,25 đ/câu, đáp án là **số** |

Thời gian 50 phút. Ngoài ra vẫn cần hỗ trợ `ESSAY` (tự luận) cho đề kiểm tra thường
xuyên và đề đội tuyển.

Hệ quả kỹ thuật: `TF` không phải "câu hỏi có 4 đáp án" mà là **4 mệnh đề độc lập,
mỗi mệnh đề có đúng/sai riêng** → schema phải khác `MC`. `SHORT` có đáp án dạng số,
cần lưu `value + unit + tolerance` để sau này chấm tự động được.

### Thang độ khó

Dùng đúng ngôn ngữ giáo viên: **NB / TH / VD / VDC**
(Nhận biết, Thông hiểu, Vận dụng, Vận dụng cao). Không dùng thang 1–5 vô nghĩa.

### Taxonomy chuyên đề Vật lý (CT GDPT 2018)

- **Lớp 10**: Mở đầu · Động học · Động lực học · Công–Năng lượng–Công suất · Động lượng · Chuyển động tròn · Biến dạng vật rắn
- **Lớp 11**: Dao động · Sóng · Điện trường · Dòng điện, mạch điện
- **Lớp 12**: Vật lí nhiệt · Khí lí tưởng · Từ trường · Vật lí hạt nhân và phóng xạ

Seed sẵn cây này vào bảng `topics` (dữ liệu chung, không thuộc user nào).

---

## 3. Kiến trúc

| Lớp | Chọn | Ghi chú |
|---|---|---|
| Web | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui | Deploy Vercel |
| DB / Auth / Storage | Supabase Postgres, **RLS bật trên mọi bảng user** | Cách ly kho theo user ép ở tầng DB |
| Job nền | Inngest (hoặc pg-boss nếu muốn tự host) | OCR 200 trang không chạy trong 1 request |
| Trích xuất | Claude vision → JSON có schema | Đọc PDF/ảnh trực tiếp, không cần OCR engine riêng |
| Đối chiếu | Gemini vision, khác vendor | Sinh confidence + danh sách chỗ lệch |
| Render | Service Docker riêng: **pandoc + TeX Live + PyMuPDF** | Xuất docx/pdf, compile TikZ, cắt hình khỏi PDF |
| Thanh toán | SePay hoặc PayOS (QR chuyển khoản) | Stripe không hợp thị trường VN |

Service render **phải tách riêng** khỏi Vercel: TeX Live nặng vài GB, pandoc là binary,
serverless không nuốt nổi. Chạy trên Fly.io / Railway / một VPS, gọi qua HTTP có ký token.

### Cách lưu nội dung câu hỏi

Nguồn sự thật duy nhất là **LaTeX-subset**, không phải HTML, không phải Word XML.
Lý do: từ LaTeX xuất ra được `.docx` (qua pandoc, math thành OMML sửa được),
`.pdf`, `.tex`, và render preview trên web bằng KaTeX. Ba đầu ra, một nguồn.

Hình được nhúng bằng placeholder `[[IMG:1]]` trong thân câu, trỏ tới `question_assets`.

---

## 4. Xuất file Word — phần dễ làm hỏng nhất

Đây là chỗ app sống hay chết. Giáo viên đánh giá bằng đúng một câu:
*"mở ra sửa được ngay chưa?"*

**Đường đi:**

```
questions (LaTeX) → build markdown/tex → pandoc --reference-doc=<template>.docx → .docx
```

Pandoc chuyển math sang **OMML** = equation native của Word, click vào sửa được.
Nếu công thức ra dạng ảnh thì bỏ app đi làm lại — không tính năng nào cứu được.

**Ngoại hình đề (3 mẫu có sẵn):** phần đầu đề (`SỞ GD&ĐT… / TRƯỜNG THPT…` bên trái,
`ĐỀ KIỂM TRA…` bên phải) dựng bằng **bảng 2 cột không viền ngay đầu document**, logo
chèn dạng ảnh trong ô trái. Style (font, cỡ chữ, giãn dòng, lề) đến từ `reference.docx`.
→ "3 mẫu ngoại hình" = 3 cặp (header snippet + reference.docx).
→ Cho user upload `reference.docx` của chính họ để khớp quy định riêng của trường.

**Đáp án 4 lựa chọn** trình bày bằng bảng 2×2 không viền — đúng cách giáo viên vẫn làm.

**Bốn file xuất ra từ một đề:** đề · bảng đáp án · lời giải chi tiết · ma trận đặc tả.
Cái cuối nhiều trường bắt nộp kèm — tự sinh được là điểm bán hàng mạnh.

---

## 5. Mô hình dữ liệu

DDL đầy đủ: [docs/schema.sql](docs/schema.sql)

```
profiles ─┬─ subscriptions      gói, quota_pages_month, used_this_period
          ├─ usage_ledger       ghi từng trang đã xử lý, phục vụ tính quota + giá vốn
          ├─ sources            file gốc → ingest_jobs (status, cost, error)
          ├─ questions      ★   stem_latex, type, difficulty, topic_id, solution_latex,
          │                     mc_choices | tf_statements | short_answer, stem_hash
          │   └─ question_assets   ảnh crop | tikz_source | rendered_png
          ├─ blueprints         ma trận: 18 MC + 4 TF + 6 SHORT, phân bố độ khó/chuyên đề
          ├─ layouts            3 mẫu ngoại hình + reference.docx của user
          └─ exams
                ├─ exam_items      thứ tự câu, phần I/II/III
                ├─ exam_versions   mã đề 101/102/103/104 + shuffle seed
                ├─ exam_revisions  snapshot JSON  ← đây là phần "undo"
                └─ exports         docx/pdf: đề | đáp án | lời giải | ma trận

topics                          cây chuyên đề, dữ liệu chung, ai cũng đọc được
```

**Ba quyết định thiết kế đáng lưu ý:**

1. `exams` chỉ **tham chiếu** `questions`, không copy nội dung → sửa một câu không phá
   đề cũ đã xuất. Nhưng `exports` lưu snapshot nội dung tại thời điểm xuất, để mở lại
   đề năm ngoái vẫn đúng nguyên bản.
2. `exam_revisions` lưu snapshot JSON nguyên trạng chứ không lưu diff. Undo = restore
   snapshot. Đơn giản hơn diff cả chục lần, dung lượng không đáng kể.
3. `stem_hash` + `pg_trgm` để **phát hiện câu trùng** khi upload nhiều nguồn chồng
   chéo nhau. Giáo viên upload 5 bộ đề của 5 người, trùng 30% là chuyện thường —
   báo "câu này đã có trong kho" là tính năng nhỏ mà giá trị rất cao.

Tìm kiếm: `tsvector` với config `simple` + extension `unaccent` (Postgres không có
stemmer tiếng Việt) → tìm "con lắc lò xo" ra kết quả kể cả gõ không dấu.

---

## 6. Pipeline AI

Chi tiết prompt + JSON schema + guardrail: [docs/ai-pipeline.md](docs/ai-pipeline.md)

Tóm tắt 4 bước:

| Bước | Làm gì | Model | Guardrail |
|---|---|---|---|
| 0. Tiền xử lý | Deskew, denoise, tách trang | OpenCV/sharp — **không dùng model sinh ảnh** | Model sinh ảnh có thể đổi chữ số mà không ai biết |
| 1. Trích xuất | Ảnh/PDF → JSON có schema | Claude vision | Structured output, không cho trả text tự do |
| 2. Đối chiếu | Ảnh gốc + JSON bước 1 → danh sách chỗ lệch + confidence | Gemini vision (khác vendor) | Chỉ được **báo lệch**, không được viết lại |
| 3. Duyệt | Giáo viên xác nhận | Con người | Bắt buộc, không bỏ qua được |

Bước 2 là ý của mày, đã wire lại cho an toàn: đưa **kèm ảnh gốc** thay vì để model
chỉnh mù. Hai model khác nhà sai theo kiểu khác nhau → chỗ chúng bất đồng chính là
chỗ cần giáo viên nhìn. Đây cũng là nguồn `confidence` cho nút "duyệt hàng loạt".

### Hình vẽ — thứ tự ưu tiên

1. **Cắt hình gốc khỏi PDF** (PyMuPDF) hoặc cho giáo viên kéo-chọn vùng. 3 giây, đúng 100%. ← mặc định
2. **TikZ** cho hình đơn giản (mặt phẳng nghiêng, ròng rọc, mạch điện): sinh code → compile
   → đặt cạnh ảnh gốc cho giáo viên so sánh → luôn có nút "giữ ảnh gốc".
3. **Nano banana làm nét**: chỉ áp lên **crop hình vật lý** bị mờ. Không bao giờ áp lên
   vùng chứa chữ/số. Luôn lưu bản gốc và cho so sánh trước/sau.

---

## 7. Màn hình duyệt — nơi quyết định thắng thua

Nếu duyệt 1 câu mất 40 giây thì giáo viên tự gõ còn nhanh hơn → xoá app.
**Mục tiêu: dưới 15 giây/câu.**

Yêu cầu bắt buộc:
- Chia đôi màn hình: ảnh gốc bên trái (zoom/pan được) — LaTeX + preview KaTeX bên phải.
- Trường nào hai model bất đồng thì **highlight màu**, con trỏ nhảy thẳng vào đó.
- Phím tắt: `Enter` duyệt · `E` sửa · `X` bỏ · `←/→` chuyển câu. Không rời tay khỏi bàn phím.
- Nút "duyệt tất cả câu confidence cao" cho phần dễ (thường 60–70% số câu).
- Nhãn (chuyên đề, độ khó, dạng) là dropdown đã điền sẵn, sửa 1 click.
- Lưu lại mọi lần giáo viên sửa nhãn → sau này tinh chỉnh prompt theo thói quen từng người.

---

## 8. Freemium

**Quota tính theo số trang xử lý/tháng, KHÔNG theo số câu lưu.**

Câu hỏi toàn text — 10.000 câu chưa tới 50MB, storage gần như miễn phí. Cái tốn tiền
là inference lúc OCR. Bán theo "số câu được lưu" là tự bắn vào chân: user upload nguyên
cuốn 400 trang rồi vẫn ngồi gói free.

| | Free | Pro | Trường/Tổ bộ môn |
|---|---|---|---|
| Trang xử lý/tháng | ~30 | ~500 | dùng chung quota |
| Câu lưu trong kho | ~500 | không giới hạn | không giới hạn |
| Mẫu ngoại hình | 1 | 3 + upload reference.docx | có logo trường |
| Trộn mã đề | không | có | có |
| Xuất ma trận đặc tả | không | có | có |

Giá tham chiếu thị trường: **49–99k/tháng**. Chốt số sau khi đo giá vốn thật ở Phase 0.
`usage_ledger` ghi cả token thực tế để tính giá vốn/trang chứ không đoán.

Thanh toán: SePay/PayOS QR chuyển khoản. Không dùng Stripe.

---

## 9. Lộ trình

### Phase 0 — Spike kiểm chứng (3–5 ngày) ← LÀM TRƯỚC MỌI THỨ

Không auth, không UI, không DB. Một script duy nhất, chạy từ CLI.

Kill test — trả lời được hết mới đi tiếp:

- [ ] 1 trang đề Lý scan (có công thức + có hình) → JSON đúng ≥ 90% số câu
- [ ] JSON → `.docx` → **mở bằng Word thật, click vào công thức: có sửa được không?**
- [ ] Hình có nằm đúng chỗ, đúng tỉ lệ, không méo?
- [ ] Đề và đáp án tách được thành 2 file riêng?
- [ ] Đo: giây/trang và **đồng/trang** (log token thật)
- [ ] Kiểm tra `reference.docx` có mang được header/footer sang không (nếu không thì
      dùng phương án bảng-2-cột-đầu-document như mục 4)

Nếu câu 2 fail thì toàn bộ phần còn lại vô nghĩa — phải giải xong trước khi đầu tư 2 tháng.

### Phase 1 — MVP (3–4 tuần)

Auth + RLS → upload PDF/ảnh → job trích xuất → **màn hình duyệt** → kho có filter
(chuyên đề, độ khó, dạng, full-text) → chọn tay ráp đề → xuất docx đề + đáp án riêng.

Chưa cần: thanh toán, blueprint, trộn mã đề, TikZ.

### Phase 2 — Tự động hoá (2–3 tuần)

Blueprint lưu lại tái dùng · random thông minh theo ma trận · trộn mã đề 101–104 +
bảng đáp án từng mã · 3 mẫu ngoại hình · tự sinh ma trận đặc tả · `exam_revisions` + undo.

### Phase 3 — Freemium (1–2 tuần)

Quota theo trang · gói + QR thanh toán · dashboard usage · giới hạn mềm có cảnh báo trước.

### Phase 4 — Hình vẽ & nâng cao

Cắt hình từ PDF → TikZ hình đơn giản → nano banana làm nét crop.
"Upload ảnh đề mẫu để AI phân tích ra format" cũng nằm ở đây — nghe hay nhưng dùng
thật thì hiếm, đừng làm sớm.

**Tổng: 8–10 tuần cho bản thu được tiền**, nếu làm một mình full-time.

---

## 10. Rủi ro đã nhận diện

| Rủi ro | Mức | Cách xử lý |
|---|---|---|
| docx xuất ra công thức không sửa được | **Chí mạng** | Phase 0 kill test, pandoc + OMML |
| Duyệt quá chậm → user bỏ | **Chí mạng** | Thiết kế màn hình duyệt trước khi code, đo giây/câu |
| Model sinh ảnh đổi chữ số khi "làm nét" | Cao | Không bao giờ áp lên vùng text, chỉ áp lên crop hình |
| Chi phí inference vượt doanh thu | Cao | Quota theo trang, `usage_ledger` đo giá vốn thật |
| Bản quyền tài liệu nguồn | Trung bình | Kho **private tuyệt đối**, không share, không marketplace ở v1. ToS ghi rõ user chịu trách nhiệm nguồn |
| Độ khó AI gán không nhất quán | Trung bình | Dùng NB/TH/VD/VDC, sửa 1 click, học từ lịch sử sửa |
| Rò dữ liệu giữa các user | Cao | RLS ở tầng DB + test tự động cố đọc chéo user |

---

## 11. Chưa chốt

- [ ] Có làm chấm điểm/giao đề không, hay đứng ngoài để không đối đầu Azota? (đề xuất: đứng ngoài ở v1)
- [ ] Giá cuối — chờ số liệu giá vốn từ Phase 0
- [ ] 5 giáo viên đầu tiên dùng thử là ai? Cần có người thật trước khi code Phase 1
- [ ] Có cần bản offline/desktop cho trường mạng yếu không?
