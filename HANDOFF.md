# Bàn giao — EduVault

## 0. Phase 1 tích hợp trực tiếp vào app hiện tại (13/08/2026)

`web/` vẫn là app chính, chạy tại `http://localhost:5173/index.html`; Phase 1 được nâng cấp ngay
trên UI/engine ráp đề cũ, không có app song song. Đã có auth/session HttpOnly, workspace SQLite
riêng theo user, file storage, upload thật, OCR Gemini qua `phase0`, autosave, review/bulk approve,
tìm-lọc ngân hàng và DOCX equation-native. Xem phạm vi/backlog tại `web/README.md`.

Quyết định pilot: chưa chuyển Supabase/job queue/billing để không dựng hạ tầng trước khi có hành vi
người dùng. SQLite/filesystem phù hợp chạy local hoặc một VPS; không được hiểu là kiến trúc scale.
Không deploy nhiều instance với SQLite/snapshot hiện tại; pilot phù hợp local hoặc một VPS.

Đọc file này là đủ để tiếp tục, không cần lịch sử hội thoại cũ.
Cập nhật lần cuối: 12/08/2026 — **bỏ đối chiếu chéo + màn Duyệt chịu được
hàng trăm câu (mục 15)**. Trước đó: giao diện mới (mục 10), **model đã chạy thật**
(mục 11), đổi trục gói dịch vụ (mục 12), hình ảnh và trình bày trang in (mục 13),
**xuất .docx thẳng từ trình duyệt** + trang chính + ráp đề tự do (mục 14).

> **Tên**: dự án đổi từ *Đề Studio* sang **EduVault** ngày 12/08/2026.
> Bản thiết kế giao diện đề xuất tên tiếng Việt "Ngân Đề"; người dùng chốt
> EduVault. Session prototype trong localStorage đã bỏ; app hiện dùng cookie HttpOnly
> `eduvault_session` do server cấp.

---

## 1. Sản phẩm là gì

App web cho giáo viên phổ thông Việt Nam: nạp tài liệu rời rạc (PDF scan, ảnh chụp,
file Word) → AI trích xuất thành câu hỏi có công thức LaTeX và nhãn chuyên đề →
giáo viên duyệt → vào **kho riêng của từng người** → ráp đề bằng cách xếp khối →
xuất ra `.docx` mà **mở Word lên là sửa công thức được ngay**.

Môn khởi điểm: **Vật lí**, đã mở rộng thêm **Toán**.
Định vị: Azota/Shub mạnh khâu giao đề và chấm — ta không đụng, chỉ làm khâu **soạn đề**.

Chi tiết đầy đủ: [PLAN.md](PLAN.md) · [docs/ai-pipeline.md](docs/ai-pipeline.md) ·
[docs/schema.sql](docs/schema.sql)

---

## 2. Trạng thái hiện tại

### Phase 0 — spike kiểm chứng: **XONG, ĐÃ QUA KILL TEST**

Thư mục `phase0/`. Đường ống `JSON → markdown → pandoc → .docx` chạy được.

```
PASS  de.docx        19 thẻ <m:oMath> · 1 ảnh · 3 bảng
PASS  dap-an.docx     0 thẻ (đúng, đáp án không có công thức)
PASS  loi-giai.docx  18 thẻ <m:oMath> · 1 ảnh
```

`<m:oMath>` = equation native của Word, click vào sửa được. Đây là câu hỏi sinh tử
của cả dự án và câu trả lời là **có**. Kiểm tự động bằng cách giải nén `.docx` rồi
đếm thẻ trong `word/document.xml` — chạy lại được mỗi lần đổi code.

Đối chiếu chéo **ĐÃ BỎ khỏi sản phẩm** (mục 15). Code vẫn còn, chạy bằng
`npm run verify` hoặc `npm run full -- --verify`, nhưng chỉ dùng để **đo eval**
xem model đọc sai chỗ nào — không phải một bước khi soạn đề.

Bốn nhà: Anthropic · OpenAI · **Gemini** · **Stali**. `providerFor(model)` tự
chọn theo tên model, ghi rõ nhà bằng tiền tố khi cần:

```bash
npm run extract -- de.jpg --model gemini-3.5-flash --subject physics
npm run extract -- de.jpg --model stali:claude-sonnet-5
```

Ba lệnh chạy được ngay, không cần key, không gọi mạng:

```bash
npm run selftest         # 25 phép kiểm logic tính tiền + prompt
npm run prices           # bảng giá mỗi trang của từng model
node ../web/docx-test.mjs   # kill test file Word (chạy từ thư mục phase0)
```

**ĐÃ CHẠY THẬT** từ 12/08/2026 bằng key Gemini (hạn mức miễn phí) — xem mục 11.
`npm run extract` đọc đúng 4/4 câu trên một trang đề chụp điện thoại.
Nhánh Anthropic và OpenAI vẫn chưa gọi thật lần nào, mới chỉ typecheck.

### Bản dựng thử giao diện: **XONG, chạy tại localhost**

Thư mục `web/`. Web tĩnh, không build, không dependency.

```bash
node web/server.mjs      # http://localhost:5173
```

Bốn màn, dùng hệ thiết kế **Nocturne bản nền sáng** (mục 10):

| Màn | Có gì |
|---|---|
| Trang chủ `login.html` | hero ảnh-chụp-vào / Word-ra, ba gói giá, form đăng nhập giả |
| **Kho câu hỏi** | ba cột: lọc · danh sách tích chọn được · khung xem chi tiết câu |
| **Trang chính** | ô số liệu, ba bước hướng dẫn, kho theo chuyên đề, tài liệu gần đây |
| **Ráp đề** | dàn bài tự do (phần / trang bìa / khối chữ / ngắt trang) + xem trước 4 kiểu |
| **Duyệt** | ảnh gốc bên trái, AI đọc ra bên phải · lọc + duyệt hàng loạt, chịu được hàng trăm câu |
| **Tài liệu** | thả file, bảng tài liệu đã nạp, chọn mức đọc, ước tính **lượt quét** |

Chuyển được giữa **Vật lí** và **Toán**.

---

## 3. Bản đồ file

```
PLAN.md                  kế hoạch tổng, kiến trúc, lộ trình, rủi ro
docs/schema.sql          DDL Postgres/Supabase: 14 bảng + RLS đầy đủ
docs/ai-pipeline.md      pipeline 4 bước, JSON schema, quy ước LaTeX, guardrail

phase0/                  spike CLI (Node + TypeScript)
  src/topics.ts          BẢNG CHUYÊN ĐỀ DUY NHẤT — phải khớp web/data.js TOPICS
  src/types.ts           zod schema + ràng buộc theo dạng câu + schema VerifyReport
  src/prompt.ts          prompt trích xuất theo môn (+ prompt đối chiếu, chỉ dùng đo eval)
  src/providers.ts       VENDORS (4 nhà) + AnthropicProvider + OpenAIProvider
                         + ChatProvider (dùng chung cho Gemini/Stali) + bảng giá
  src/reference.ts       dựng templates/reference.docx từ bản mặc định pandoc
  src/selftest.ts        tự kiểm logic tính tiền và prompt, không cần key
  src/tikz.ts            TikZ → PDF → PNG qua pdflatex + pdftoppm
  src/render.ts          JSON → markdown → pandoc → docx + hàm kill test
  src/cli.ts             doctor | selftest | prices | reference | render | tikz
                         | extract | verify | full
  templates/             SINH RA, không commit — chạy `npm run reference`
  fixtures/              đề mẫu 4 câu Vật lí + de-anh-chup.jpg (ảnh test OCR)
  .env.example           chép thành .env rồi điền key (bốn nhà, cần một)

web/                     bản dựng thử giao diện
  login.html             trang chủ + bảng giá Lite/Plus/Pro + form đăng nhập
  index.html             vỏ app: trang chính / kho / ráp đề / duyệt / tài liệu
  styles.css             hệ thiết kế Nocturne nền sáng (token + class dùng chung)
  latex-core.js          bảng ký hiệu + bộ tách token, DÙNG CHUNG cho web và Word
  omml.js                LaTeX → OMML (equation gốc của Word)
  docx.js                dựng file .docx: ZIP thuần JS + đoạn văn + bảng + ảnh
  docx-test.mjs          kill test chạy bằng Node: `node web/docx-test.mjs`
  data.js                49 câu (Lý 28 + Toán 21), 4 câu chờ duyệt (PENDING),
                         PENDING_SEEDS (mẫu sinh hàng chờ lớn để thử tải),
                         PLANS + OCR_TIERS + UNIT (gói và lượt quét),
                         hình vẽ SVG, mẫu đầu đề, DEFAULT_LAYOUT
  app.js                 toàn bộ logic
  server.mjs             máy chủ tĩnh zero-dependency

.claude/launch.json      cấu hình preview_start (tên: eduvault, cổng 5173)
```

---

## 4. Quyết định đã chốt — đừng bàn lại

| Quyết định | Lý do |
|---|---|
| Lưu câu hỏi dưới dạng **LaTeX-subset**, không phải HTML | Từ một nguồn xuất ra được docx (OMML), pdf, tex, và render web bằng KaTeX |
| ~~Xuất docx bằng pandoc~~ → **ĐÃ ĐỔI 12/08/2026**: dựng `.docx` thẳng trong trình duyệt | Pandoc vẫn chạy được ở `phase0` (dùng cho CLI và eval), nhưng bắt giáo viên cài pandoc thì không ai dùng. `web/docx.js` + `web/omml.js` cho ra cùng thứ `<m:oMath>` — xem mục 14 |
| Dấu thập phân kiểu Việt Nam: `$0{,}5$` **không phải** `$0.5$` | Model quen tài liệu tiếng Anh sẽ tự đổi — lỗi hay gặp nhất |
| Độ khó dùng **NB / TH / VD / VDC** | Đúng ngôn ngữ giáo viên Việt Nam, không dùng thang 1–5 |
| ~~Hạn mức bán theo số trang xử lý~~ → **ĐÃ ĐẢO 12/08/2026**: bán theo **sức chứa kho + mức đọc** | Xem mục 12. Trang xử lý vẫn tính (bằng *lượt quét*) nhưng không còn là thứ phân biệt các gói |
| Kho **private tuyệt đối**, không marketplace ở v1 | Né rủi ro bản quyền tài liệu nguồn |
| ~~Bước 2 đối chiếu chéo bằng model thứ hai~~ → **ĐÃ BỎ 12/08/2026** | Nhân đôi chi phí mỗi trang để đổi lấy thứ màn Duyệt đã làm rồi — mà màn Duyệt miễn phí và chính xác hơn. Xem mục 15. Lệnh `verify` giữ lại làm công cụ đo eval, không còn là một bước của sản phẩm |
| **Không** dùng model sinh ảnh lên vùng có chữ và số | Nó vẽ lại pixel, có thể đổi `0,05` thành `0,06` mà không ai biết |
| `exports` lưu snapshot nội dung | Sửa câu trong kho không được làm đề năm ngoái mở ra khác đi |
| `exam_revisions` lưu snapshot JSON, không lưu diff | Undo = restore, đơn giản hơn diff cả chục lần |
| Gọi thẳng `pdflatex`, không dùng `latexmk` | latexmk của MiKTeX là script Perl, máy Windows thường không có Perl |

---

## 5. Số liệu đã xác minh — đừng tính lại

### Chi phí trích xuất — **đừng chép tay bảng này nữa**

```bash
cd phase0 && npm run prices
```

Nó tính từ `PRICING` trong `src/providers.ts` với mốc 5.700 token vào + 2.000
token ra mỗi trang. Bảng chép tay trong file này từng đúng, nhưng bảng chép tay
nào rồi cũng mốc — chạy lệnh trên là ra số hiện tại. Đầu ra ngày 10/08/2026:

| Model | $/trang | đ/trang | 300 trang/tháng |
|---|---|---|---|
| **GPT-5.6 Luna** (`gpt-5.6-luna`) | $0,0035 | 92đ | 27.612đ |
| Claude Haiku 4.5 | $0,0157 | 408đ | 122.460đ |
| Claude Sonnet 5 | $0,0314 | 816đ | 244.920đ |
| Claude Opus 5 | $0,0785 | 2.041đ | 612.300đ |

GPT-5.6 Luna ra 09/07/2026, giảm giá 80% từ 30/07/2026: **$0,20 vào / $1,20 ra**
mỗi triệu token, cache vào $0,02. Context 1,05 triệu token, output tối đa 128K.
Có vision, structured outputs, function calling, prompt caching.
**Chưa ai đo độ chính xác của nó với LaTeX vật lý tiếng Việt — phải benchmark.**

Bảng giá phần Anthropic chốt 24/06/2026, phần OpenAI chốt 30/07/2026 — đối chiếu
hoá đơn thật trước khi dùng để định giá. Lưu ý hai nhà đếm token khác nhau:
`input_tokens` của OpenAI **đã gồm** token cache, của Anthropic thì **không**.
`costOf` xử lý riêng từng nhà, `npm run selftest` canh chỗ này.

### Gói dịch vụ đang đề xuất

| | Lite | Plus | Pro |
|---|---|---|---|
| Giá | 0đ | 99.000đ/tháng | 199.000đ/tháng |
| Trang/tháng | 30 | 300 | 1.000 |
| Giá vốn nếu dùng Luna | 2.761đ | 27.612đ | 92.040đ |

### Môi trường máy đang dùng

Windows 11 · Node 24.12 · Python 3.10 · MiKTeX (`pdflatex`, `pdftoppm` — **không có Perl**)
· pandoc 3.10.1 (cài bằng `winget install --id JohnMacFarlane.Pandoc -e`)

---

## 6. Đang chờ người dùng — chặn việc tiếp theo

1. ~~**API key**~~ — **XONG 12/08/2026**, xem mục 11. Đang chạy bằng
   `GEMINI_API_KEY` (hạn mức miễn phí). Còn nợ: key thứ hai KHÁC NHÀ để đối
   chiếu chéo cho thật — Stali (`STALI_API_KEY`, nạp ví VNĐ, không cần thẻ) là
   đường ngắn nhất. `npm run doctor` liệt kê đủ bốn nhà và thiếu cái nào.
   **Vẫn giữ nguyên lời dặn: đừng dán key vào chat, nó nằm lại trong lịch sử.**
2. **Vài trang đề Vật lí thật** — PDF số và ảnh chụp điện thoại, mỗi loại vài trang.
   Đề THPT trên mạng **toàn là ảnh và PDF scan, không có bản text** — đã kiểm tra,
   không scrape được, bắt buộc phải OCR.
3. Bộ eval 20 trang có đáp án gõ tay để đo mỗi lần đổi prompt hay đổi model.

### Câu hỏi chưa trả lời

- Có làm chấm điểm/giao đề không, hay đứng ngoài để không đối đầu Azota? (đề xuất: đứng ngoài ở v1)
- Ráp đề: cần kéo-thả bằng chuột không, hay bấm-rồi-bấm như hiện tại là đủ?
- Giá 99k/199k có sát thị trường không?
- 5 giáo viên đầu tiên dùng thử là ai?

---

## 7. Việc tiếp theo, theo thứ tự

**A. Nối OCR thật** (chặn bởi mục 6.1 và 6.2)
`npm run full -- <file> --subject physics|math` đã viết xong, chỉ cần key là chạy;
nó tự chạy luôn bước đối chiếu chéo. Sau đó chạy bộ eval qua 3 model để chốt dùng
model nào. Cân nhắc kiến trúc: Luna chạy pass 1 cho toàn bộ, Claude chỉ chạy pass 2
đối chiếu trên số câu Luna không chắc.

**~~B. `templates/reference.docx`~~ — XONG.** Dựng bằng `npm run reference`
(code ở `src/reference.ts`, không phải file nhị phân nhét vào repo). Font Times
New Roman 12pt, khổ A4, lề trái 3cm còn lại 2cm, khoảng cách đoạn 4pt thay cho
9pt. Thiếu template thì `npm run render` cảnh báo chứ không im lặng xuất file
sai font.

> **Đính chính**: bản HANDOFF trước ghi "bảng 4 phương án vẫn còn viền" — **sai**.
> Đã kiểm trong `word/document.xml`: 0 thẻ `tblBorders`, 0 thẻ `tcBorders`, và
> `tblLook w:firstRow="0"` đã tắt viền có điều kiện. Chưa bao giờ có viền cả.
> Việc phải làm thật là font, lề và khoảng cách đoạn.

**~~C. Adapter OpenAI~~ — ĐÃ VIẾT, CHƯA CHẠY THỬ.** `OpenAIProvider` dùng
Responses API + `zodTextFormat`, nhận cả ảnh lẫn PDF. `providerFor(model)` tự
chọn nhà theo tên model nên `--model gpt-5.6-luna --verify-model claude-opus-5`
là chạy chéo nhà thật. Giá Luna đã vào `PRICING`. Cùng nhà ở cả hai bước thì CLI
cảnh báo.
**Chưa gọi được lần nào vì chưa có `OPENAI_API_KEY`** — lần chạy đầu tiên phải
soi kỹ, nhất là chỗ đếm token (nhà OpenAI tính `input_tokens` ĐÃ GỒM cache, nhà
Anthropic thì KHÔNG — hai công thức khác nhau, xem `costOf`).

**D. Trộn mã đề** 101/102/103/104 + bảng đáp án từng mã. Chưa có gì cả.
Schema đã có bảng `exam_versions` với `shuffle_seed`.

**E. Phase 1 thật** — Next.js + Supabase theo `PLAN.md` mục 9. Bản `web/` hiện tại
là dựng thử để chốt giao diện, không phải nền móng để xây tiếp.

---

## 8. Bất cập đã tìm và đã sửa — đừng làm lại

Chạy thử toàn bộ quy trình ngày 10/08 tìm ra 5 lỗi, đã sửa hết trong `web/app.js`:

1. "Dựng khung đề thi" chia độ khó theo tỉ lệ cố định → sinh ra khung không bao giờ
   ráp nổi. Nay tính phân bố từ số câu thực có trong kho (`feasibleMix`).
2. Bản xem trước toàn chỗ trống sau khi dựng khung → thêm `resolveRandom()` chốt
   khối ngẫu nhiên thành câu thật, có nút rút lại.
3. Không xem được đáp án → thêm nút gạt Đề / Đáp án.
4. Đổi môn xoá sạch đề đang soạn không hỏi → thêm xác nhận.
5. Câu chọn tay bị khối ngẫu nhiên rút trùng → rút có loại trừ.

Thêm: thanh tổng số câu đối chiếu cấu trúc thi thật (`paintTally`).

### Đợt soát toàn bộ code, 10/08 — 8 lỗi, đã sửa hết

1. **Bộ dựng công thức trong `web/app.js` chỉ biết 18 ký hiệu.** Nó là một dãy
   `.replace()` nên gặp `\int`, `\vec`, `\mid`, `\perp`, `\infty` là in nguyên mã
   LaTeX ra màn hình — môn Toán dính 8/21 câu ngay ở màn đầu tiên. Đã thay bằng
   bộ tách token + dựng cây: xử lý được lồng nhau, chỉ số trên dưới xếp chồng
   (`$^{235}_{92}U$`, `$\int_0^1$`), dấu mũi tên vector, căn có bậc, hàm đứng
   thẳng, dấu âm một ngôi không bị thêm lề. Lệnh lạ thì hiện chữ đứng và cảnh
   báo ra console, **không bao giờ hiện dấu gạch chéo cho giáo viên xem**.
   Kèm theo: chỉ chữ cái mới nghiêng, chữ số và đơn vị đứng thẳng.
2. **Lời giải đánh số lệch với đề.** `render.ts` đánh số đề theo từng phần nhưng
   đánh số lời giải toàn cục — đề "Câu 1 phần III" thì lời giải là "Câu 23".
   Nay lời giải đi theo đúng phần và đúng số của đề.
3. **Đối chiếu chéo là hàng trưng bày** — có prompt, không có schema, không có
   runner, CLI không gọi, trong khi giao diện bật sẵn checkbox. Nay có đủ.
4. **Tính chi phí bỏ sót token cache và tra bảng giá bị trượt.** `input_tokens`
   của Anthropic không bao gồm cache, mà prompt hệ thống lặp mỗi trang chính là
   thứ đáng cache nhất. Thêm nữa API trả id có hậu tố ngày nên tra `PRICING`
   trượt rồi trả 0 im lặng — nhìn tưởng rẻ. Nay tính cả 4 loại token, cắt hậu tố
   ngày, và model lạ thì báo thẳng "KHÔNG TÍNH ĐƯỢC" chứ không đưa số rác.
5. **Prompt trích xuất chỉ biết Vật lí** trong khi app đã có Toán. Nay
   `extractionSystem(subject)` đổi cả giọng lẫn quy ước ký hiệu lẫn bảng chuyên đề.
6. **Bảng chuyên đề hai bên lệch nhau** — prompt có `p10.momentum`,
   `p10.circular`, `p10.solid`, `p11.current` mà `web/data.js` không có mã nào
   trong bốn cái đó. Nay gom về `phase0/src/topics.ts`, `validateQuestion` bắt
   luôn mã lạ.
7. **Chữ vẫn nhỏ** sau lần chê trước: nhãn 12px, hint 12.5px. Đã bơm đều +1px
   cho 52 cỡ chữ (giữ nguyên mấy thứ cố tình bé như ảnh thu nhỏ mẫu đầu đề).
8. **Nút "Xuất Word" chỉ hiện toast giả.** Nay tên là "Xuất đề" và nó tải về
   ExamDoc JSON đúng schema mà `npm run render -- <file>` nhận. Đã chạy thử vòng
   khép kín: app xuất → pandoc → `.docx` 17 thẻ `<m:oMath>`, KILL TEST PASS.

Vặt kèm theo: bỏ `keepMarkdown` (code chết), `arg()` báo lỗi khi cờ thiếu giá trị
thay vì nuốt cờ sau, đổi môn không hỏi lại khi đề mẫu chưa bị đụng vào.

### Đợt tiếp theo, cùng ngày — dọn nốt hai việc treo

9. **`templates/reference.docx`** — xong, xem mục 7B. Kèm đính chính: chuyện
   "bảng còn viền" trong bản handoff cũ là **sai**, đã kiểm bằng cách đếm thẻ
   trong `word/document.xml`.
10. **Adapter OpenAI** — xong phần code, xem mục 7C. Chưa gọi thật được.
11. **`npm run selftest`** — 21 phép kiểm logic thuần, không cần key, không gọi
    mạng. Canh hai chỗ dễ sai mà sai xong không ai biết: công thức tính tiền của
    từng nhà, và chuyện prompt môn này lẫn mã chuyên đề môn kia.
12. **`npm run prices`** — bảng giá mỗi trang được TÍNH ra thay vì gõ tay vào
    markdown rồi để mốc.
13. **`adm-zip` 0.5.18 → 0.6.0** — bịt lỗ hổng cao: file ZIP dựng khéo làm nó
    ngốn 4GB bộ nhớ. Hiện chỉ giải nén file mình tự tạo nên chưa nguy, nhưng
    Phase 1 sẽ nhận `.docx` giáo viên tải lên thì thành nguy thật. `npm audit`
    giờ sạch. Kill test vẫn PASS sau khi nâng.

---

## 9. Giọng điệu và cách làm việc người dùng muốn

- Nói tiếng Việt, xưng hô suồng sã (mày/tao), thẳng thắn, không vòng vo.
- Không tô hồng: có vấn đề thì nói thẳng, kể cả khi đó là lỗi của chính mình.
- Ưu tiên chạy thử thật rồi báo cáo kết quả thật, không đoán.
- Giao diện: **chữ đủ to, nền sáng sạch, không dùng màu để trang trí** — chỉ dùng
  màu để mã hoá ý nghĩa. Bản đầu tiên bị chê "cùi và đau mắt" vì nền xám-xanh xỉn
  và chữ 14px với nhãn 11px.

---

## 10. Bộ giao diện mới — Nocturne nền sáng (12/08/2026)

Nguồn: gói thiết kế `Thiết kế lại UI ứng dụng.zip` (hệ **Nocturne**, kèm
`_ds/…/styles.css` và `readme.md`). Gói có hai lượt: lượt 1 nền tối, lượt 2 nền
sáng cùng hệ. **Đã lấy lượt 2 — nền sáng**, vì lượt 1 đi ngược đúng cái người
dùng từng chê ở mục 9 ("nền xỉn, đau mắt").

### Ba luật của hệ này, đừng phá

1. **Nút luôn là viền, không bao giờ tô đặc.** Nút chính = viền tím `--acc`
   (#9184d9) + chữ `--acc-ink` (#5d5294). Không có nút nền xanh trắng chữ nữa.
2. **Đường kẻ tự do nhoè hai đầu** (48px mỗi bên) — biến `--fade`. Viền hộp,
   vạch ngăn trong control thì vẫn kẻ thẳng.
3. **Màu chỉ mã hoá ý nghĩa**: tím = đang chọn, xanh lá `--ok` = xong,
   vàng `--warn` = cần mắt người, đỏ `--danger` = phá huỷ. Dạng câu có bốn màu
   riêng (`--t-mc/tf/short/essay`) dùng cho chấm vuông và nhãn.

Thang màu, khoảng cách, bo góc nằm hết ở `:root` trong `web/styles.css`.
Lấy màu bằng `var(--…)`, đừng gõ mã hex vào giữa file.

### Đã đổi những gì so với bản cũ

- **Kho câu hỏi** thành ba cột. Cột phải là khung xem chi tiết: đề bài, hình,
  bốn phương án có đánh dấu đáp án, lời giải, bảng nhãn, và câu đó đang được
  dùng mấy lần trong đề. Trước đây muốn xem đủ phải bấm "Sửa" mở modal.
  Danh sách tích chọn được nhiều câu rồi đẩy một lượt sang đề.
- **Ráp đề** bỏ khối kiểu Scratch, thành dàn bài: mỗi phần một tiêu đề có chấm
  màu, số câu, số điểm; mỗi câu một dòng. Bản xem trước thêm **Lời giải** và
  **Ma trận** (ma trận đặc tả chuyên đề × mức độ, tính thẳng từ đề đang soạn —
  trước nay giáo viên phải gõ tay).
- **Duyệt** là màn hoàn toàn mới. Trước đây AI đọc xong là câu vào thẳng kho,
  không ai soi. Nay: ảnh gốc bên trái, AI đọc ra bên phải, chỗ hai model đọc
  khác nhau bị tô vàng và **bắt chọn** mới duyệt được. Phím tắt Enter / E / X /
  ← →. Dữ liệu mẫu ở `PENDING` trong `web/data.js`.
- **Trang chủ** dựng lại theo màn 2i: hero "ảnh chụp vào — Word ra", ba gói giá,
  form đăng nhập nằm cùng trang.

### Chỗ cố tình làm khác bản thiết kế — có lý do

| Bản thiết kế | Ở đây | Vì sao |
|---|---|---|
| Tên "Ngân Đề" | **EduVault** | người dùng chốt |
| Nhãn nhỏ nhất 11px | 11,5–12,5px, chữ câu hỏi 15,5–16px | mục 9: đã bị chê chữ nhỏ hai lần |
| Đối chiếu chéo "+1.630đ" cho 8 trang | tính thật từ `PRICING`: **+16.328đ** | bước soát gửi lại cả ảnh cho Opus, không rẻ được như thế. Con số trong bản thiết kế là số trang trí |
| Nút "Trộn 4 mã đề" | có nút, bấm ra lời nhắn chưa làm | mục 7D vẫn là việc chưa làm — thà nói thẳng còn hơn nút chết |

### Bốn lỗi tìm được lúc chạy thử, đã sửa

1. Đề mở sẵn nhét một câu **trắc nghiệm** vào phần **Đúng/Sai** (lỗi có từ bản
   cũ: `BANK[2]` không phải câu TF). Nay lấy câu theo đúng dạng của phần.
2. Điểm hiện `1,50 điểm` thay vì `1,5`. Bộ định dạng viết sai.
3. **"Duyệt hết câu tin cậy cao" không gỡ được câu nào** khỏi hàng chờ: duyệt
   xong câu vừa vào kho khiến chính nó bị chấm là "câu trùng". Nay chốt danh
   sách trước rồi mới gỡ theo đối tượng.
4. Bốn câu chờ duyệt lấy nguyên từ bản thiết kế thì **cả bốn đều đã có sẵn
   trong kho** — màn duyệt lúc nào cũng đỏ chữ "câu trùng". Nay giữ đúng một
   câu trùng cố ý (để thấy bộ bắt trùng chạy thật), ba câu còn lại là câu mới.

Thêm một luật: **duyệt hàng loạt không bao giờ nuốt câu trùng**, phải người
quyết. Nếu không kho sẽ đầy bản sao mà không ai biết.

### Còn nợ

- Bộ bắt trùng đang so **nguyên văn đề bài** sau khi bỏ dấu và bỏ công thức.
  Đổi một chữ là nó không nhận ra nữa. Phase 1 nên so bằng embedding.
- 49 câu mẫu trong `data.js` đáp án đúng **toàn là A**. Không ảnh hưởng logic
  nhưng nhìn bản xem trước "Đáp án" thì lộ ngay là hàng dựng sẵn.
- Màn Duyệt chưa nối vào luồng nạp thật (`simulateUpload` chỉ chạy giả).

---

## 11. LẮP MODEL VÀO — đã chạy thật (12/08/2026)

**Việc bị chặn lâu nhất ở mục 6.1 đã thông.** Đường ống OCR chạy được, đọc đúng
4/4 câu trên một trang đề chụp điện thoại, không mất tiền.

### Cách lắp, ba bước

```bash
cd phase0
cp .env.example .env      # rồi mở ra điền key
npm run doctor            # nó nói thiếu gì, thiếu ở đâu
npm run extract -- fixtures/de-anh-chup.jpg --model gemini-3.5-flash --subject physics
```

`.env` chỉ cần **một** dòng là chạy:

```
GEMINI_API_KEY=AQ....
```

Lấy key tại **aistudio.google.com/apikey** — có hạn mức miễn phí, không cần thẻ,
mất 30 giây. Đây là con đường rẻ nhất để bắt đầu và để chạy bộ eval.

### Kiến trúc: một cửa cho mọi nhà

`src/providers.ts` có bảng `VENDORS`. Mỗi nhà = URL gốc + biến môi trường + kiểu API:

| Nhà | Biến env | URL gốc | Kiểu API |
|---|---|---|---|
| `gemini` | `GEMINI_API_KEY` | `generativelanguage.googleapis.com/v1beta/openai` | chat completions |
| `stali` | `STALI_API_KEY` | `api.stali.vn/v1` | chat completions |
| `anthropic` | `ANTHROPIC_API_KEY` | mặc định SDK | Messages |
| `openai` | `OPENAI_API_KEY` | mặc định SDK | Responses |

Gemini và Stali **dùng chung một class** `ChatProvider`, vì cả hai đều nói giao
thức OpenAI Chat Completions. Thêm nhà mới (OpenRouter, Groq, cổng nội bộ) chỉ
là thêm một dòng vào `VENDORS` — không phải viết provider mới.

Định tuyến suy từ tên model: `gemini-*` → Gemini, `claude-*` → Anthropic,
`gpt-*` → OpenAI. Muốn ép đi đường khác thì ghi rõ nhà ở đầu:

```bash
npm run extract -- de.jpg --model stali:claude-sonnet-5
```

> **Sửa một lỗi thiết kế cũ**: trước đây `providerFor()` tra bảng `PRICING` để
> biết model thuộc nhà nào, nên model nào chưa kịp điền giá là **không gọi được**.
> Giá và định tuyến là hai việc khác nhau — nay tách hẳn ra.

### Về Stali (tài liệu người dùng gửi 12/08)

Stali là cổng gộp 56 model, **trả bằng ví VNĐ qua VietQR** — không cần thẻ quốc tế.
Đã lắp sẵn nhưng **chưa chạy thử** vì chưa có key Stali.

- Key có dạng `sk-stali-...`. URL gốc **có `/v1`** cho giao thức OpenAI,
  **không có `/v1`** cho giao thức Anthropic — dán nhầm ra 404 chứ không phải 401.
- Cổng trả chi phí thật ở header `x-stali-cost-vnd`. `ChatProvider` đọc header
  này và **tin nó hơn bảng giá chép tay**, vì đó là số bị trừ khỏi ví.
- Giới hạn: yêu cầu tối đa 8MB, nên nén ảnh trước khi gửi.

> **Cảnh báo về key người dùng đưa**: key `AQ.Ab8RN6…` dán trong chat ngày 12/08
> là key **Google Gemini**, không phải Stali (thử vào Stali trả 401). Nó đã nằm
> trong lịch sử hội thoại nên coi như đã lộ — **thu hồi và tạo key mới** tại
> aistudio.google.com/apikey. Key đang để ở `phase0/.env`, file này bị
> `.gitignore` chặn.

### Kết quả đo thật — 1 trang, 4 câu, ảnh chụp điện thoại giả lập

Trang test: `phase0/fixtures/de-anh-chup.jpg` (dựng từ LaTeX rồi xoay 1,2°, hạ
tương phản, nén JPEG 72% cho giống ảnh chụp). Có 4 câu: 2 trắc nghiệm (1 câu
kèm hình mạch điện), 1 đúng/sai 4 ý, 1 trả lời ngắn.

| Model | Thời gian | Token vào/ra | Kết quả |
|---|---|---|---|
| `gemini-3.5-flash-lite` | 5,1s | 1.496 / 1.188 | 4/4 đúng |
| `gemini-3.5-flash` | 8,9s | 1.496 / 1.108 | 4/4 đúng |
| `gemini-3.6-flash` | 11,5s | 1.496 / 793 | 4/4 đúng |

Cả ba: bắt đúng câu 2 có hình và chỉ câu 2, dấu thập phân `$1{,}0$` đúng kiểu
Việt Nam, tự suy đúng/sai 4 ý đúng vật lí (đẳng nhiệt thì nội năng không đổi).

**Đây KHÔNG phải bộ eval.** Một trang, chữ in sạch, tự dựng. Đề scan thật của
giáo viên sẽ khó hơn nhiều. Mục 6.3 (bộ eval 20 trang) vẫn còn nguyên đó.

### Hai luật mới trong prompt

**1. Hình vẽ** — `src/prompt.ts` nay có mục riêng, dài, vì đây là chỗ hay sai:

- Tính là hình: sơ đồ mạch, đồ thị, mặt phẳng nghiêng, hình học không gian…
- **Không** tính là hình: công thức toán dù dài, bảng chữ, khung trang trí, logo trường.
- Model chèn `[[IMG:1]]` vào thân câu + khai `images[]` có `bbox` (toạ độ 0–1
  trên trang) và `note` (mô tả hình bằng tiếng Việt).
- Ba trường `width_pct`, `placement`, `src` model **phải để null** — đó là phần
  giáo viên chỉnh trong app. `validateQuestion` bắt lỗi nếu placeholder và
  khai báo không khớp nhau.

Model **không cắt được ảnh ra** — nó chỉ khoanh chỗ và tả lại. Nên app hiện nhãn
**"Có hình — chưa gắn ảnh"** kèm mô tả của AI, giáo viên vào gắn hình thật.

**2. Đáp án — trường mới `answer_source`.** Đề phát cho học sinh không in đáp án,
mà câu không đáp án thì lưu vào kho cũng vô dụng. Nay model được phép tự giải
nhưng **phải khai thật**:

| Giá trị | Nghĩa |
|---|---|
| `printed` | tài liệu có in đáp án, chỉ chép lại |
| `solved` | model tự giải ra — màn Duyệt tô vàng, bắt người xem lại |
| `none` | không in mà cũng không giải chắc được, để trống + ghi lý do vào `notes` |

Lần chạy đầu trước khi có luật này, model để trống hết đáp án và `validateQuestion`
kêu "thiếu đáp án đúng" — đúng luật cũ nhưng vô dụng với người dùng.

---

## 12. Gói dịch vụ và đơn vị tính — đổi trục (12/08/2026)

### Bỏ hiển thị tiền cho giáo viên

App cũ hiện thẳng `92đ mỗi trang`, `27.600đ nếu dùng hết gói`. Bỏ hết. Giáo viên
trả tiền gói theo tháng rồi, mỗi lần định nạp tài liệu lại thấy đồng hồ tiền nhảy
thì chỉ tổ ngại bấm — mà app sống được là nhờ người ta chịu nạp tài liệu vào.

Đơn vị mới: **lượt quét**. Số nguyên, không quy đổi ra tiền ở bất cứ màn nào.
Giá vốn thật (USD) vẫn tính ở `phase0` qua `npm run prices` — đó là số của người
bán, không phải số nên dí vào mặt người dùng.

### Khác biệt giữa các gói giờ là SỨC CHỨA KHO và MỨC ĐỌC

Định nghĩa ở `web/data.js` → `PLANS`. Trang chủ `login.html` đọc thẳng từ đó,
không còn bản chép tay riêng.

| | Lite | Plus | Pro |
|---|---|---|---|
| Giá | 0đ | 99.000đ/th | 199.000đ/th |
| Lượt quét/tháng | 40 | 400 | 1.500 |
| Kho: trắc nghiệm | 100 | 2.000 | ∞ |
| Kho: đúng/sai | 50 | 800 | ∞ |
| Kho: trả lời ngắn | 50 | 800 | ∞ |
| Kho: tự luận | 20 | 400 | ∞ |
| Mức đọc | Nhanh | Nhanh, Chuẩn | cả ba |
| Đối chiếu chéo | không | có | có |

Ba mức đọc, ánh xạ thẳng sang model thật:

| Mức | Model | Giá | Cho trang thế nào |
|---|---|---|---|
| Nhanh | `gemini-3.5-flash-lite` | 1 lượt/trang | PDF số, ảnh chụp rõ |
| Chuẩn | `gemini-3.5-flash` | 2 lượt/trang | ảnh nghiêng, scan mờ vừa |
| Kĩ | `gemini-3.1-pro-preview` | 4 lượt/trang | scan xấu, chữ viết tay |

Đối chiếu chéo +2 lượt/trang.

**Đặc quyền thêm cho gói Lite** (để bản miễn phí vẫn ra hồn): xuất Word công thức
sửa được, đủ 4 dạng câu, **ma trận đặc tả tự sinh**, **chèn logo trường**, kho
riêng tư tuyệt đối. Cái Lite không có: trộn mã đề, watermark, mức đọc cao.

Trần kho hiện thường trực ở cột trái màn Kho — chạm trần thì thanh đỏ. Duyệt câu
vượt trần bị chặn và **câu nằm lại hàng chờ**, không bốc hơi.

---

## 13. Hình ảnh và trình bày trang in (12/08/2026)

### Sửa hình trong từng câu

Nhãn **"Có hình"** trên thẻ câu. Vào Sửa thì chỉnh được ba thứ:

- **Cỡ hình** — thanh trượt 15–100% bề ngang cột chữ.
- **Thay hình** — chọn trong 7 hình dựng sẵn (xem bằng mắt, không chọn theo tên)
  hoặc tải ảnh lên (chặn trên 2MB, vì ảnh nhét thẳng vào JSON).
- **Vị trí** — trên phương án căn giữa · dưới phương án căn giữa · nổi bên phải
  chữ chạy vòng trái · nổi bên trái.

Dữ liệu: `fig` của câu từ chuỗi (`"spring"`) thành object
`{src, note, width, place}`. Chuỗi cũ vẫn đọc được — `normFig()` chuẩn hoá lúc
đọc nên 49 câu mẫu không phải sửa.

### Trình bày trang in — nút "Trình bày" ở màn Ráp đề

- **Lề** trên/dưới/trái/phải bằng **cm**, đúng đơn vị hộp Page Setup của Word.
  Mặc định trái 3cm (đóng gáy), ba lề còn lại 2cm.
- **Cỡ chữ** 11–14pt, **giãn dòng** đơn/1,15/1,5.
- **Logo trường** — tải ảnh lên, chỉnh cỡ. Mẫu đầu đề "Có logo" dùng đúng ảnh này.
- **Watermark** — chữ mờ in chìm, chỉnh độ đậm và độ nghiêng. Gói Lite khoá.

Tất cả đi vào `layout` trong ExamDoc JSON xuất ra, nên xuất lại sau nửa năm vẫn
ra đúng lề và đúng watermark như lần đầu.

---

---

## 14. Xuất Word thẳng từ trình duyệt + ráp đề tự do (12/08/2026)

### Bỏ hẳn pandoc khỏi đường đi của giáo viên

TRƯỚC: app xuất ra JSON rồi bảo giáo viên tự chạy `npm run render` ở phase0.
Không có giáo viên nào làm thế. NAY: bấm **Xuất Word** là tải về `.docx` luôn.

Ba file mới trong `web/`, không thư viện ngoài, không build:

| File | Việc |
|---|---|
| `latex-core.js` | bảng ký hiệu + bộ tách token, **dùng chung** cho bản HTML và bản Word |
| `omml.js` | LaTeX → `<m:oMath>`, equation gốc của Word |
| `docx.js` | ZIP thuần JS (phương thức store) + đoạn văn, bảng, ảnh, lề, watermark |

`latex-core.js` tách ra là có lý do: trước đây `app.js` giữ bảng ký hiệu riêng.
Nếu bản Word có bảng thứ hai thì sớm muộn cũng lệch, mà lệch kiểu tệ nhất —
**trên web nhìn đúng, mở Word ra mới sai**, lúc đó đề đã in rồi.

### Kill test — chạy lại được mọi lúc

```bash
node web/docx-test.mjs
```

Dựng file thật, ghi ra `out/kill-test.docx`, rồi **giải nén bằng .NET ZipFile**
và đếm thẻ. Kết quả 12/08: `PASS — 26 công thức là equation sửa được · ZIP hợp lệ`.
Sáu cấu trúc OMML đều có mặt: `m:f` (phân số), `m:rad` (căn), `m:sSup`,
`m:sPre` (chỉ số đứng trước), `m:nary` (tích phân), `m:acc` (vector).

Hai lỗi tìm được lúc chạy thử, đã sửa:

1. `$^{235}_{92}U$` dựng `sSubSup` với base RỖNG → Word vẽ một ô vuông trống
   cạnh chữ U, nhìn như lỗi font. Nay dùng đúng cấu trúc `<m:sPre>`.
2. Mỗi ký tự thành một `<m:r>` riêng → đề 28 câu phình 150KB toàn thẻ lặp.
   Thêm `compactRuns()` gộp run liền nhau cùng định dạng: còn ~93KB.
3. Hình đặt "trên phương án" bị đẩy lên **trước cả chữ "Câu 1."**. Nay đúng thứ
   tự: đề bài → hình → phương án.

Ba nút xuất: **Xuất Word** (bản đang xem) · **Xuất cả bộ** (đề + đáp án + lời
giải, ba file) · **JSON** (giữ lại cho ai muốn chạy tiếp bằng CLI).

### Ráp đề: bỏ hết ràng buộc

- **Thêm bao nhiêu phần cũng được, kể cả nhiều phần cùng dạng.** Bản trước chặn
  mỗi dạng một phần — sai với phiếu bài tập, thứ hay có "Trắc nghiệm chương 1"
  và "Trắc nghiệm chương 2" trên cùng một tờ.
- Bốn loại khối mới: **Đầu đề** (thêm nhiều lần được), **Trang bìa**,
  **Khối chữ tự do**, **Ngắt trang**.
- **Khối chữ tự do** là cái "Word mini": contenteditable + đậm/nghiêng/gạch
  chân, căn lề, tiêu đề, chèn `$…$`. Dùng `execCommand` — đã cũ nhưng chạy ở
  mọi trình duyệt và không cần thư viện. Đổi sang bộ soạn thảo thật để Phase 1,
  chỗ đã có bundler.
- Mọi khối **xê dịch lên xuống** được (↑↓), phần **đổi tên** được (bấm vào tên),
  **thu gọn** từng phần hoặc thu hết bằng nút "Thu gọn".
- Dòng câu **di chuột là nổi lên** kèm vạch tím bên trái — đề 28 câu rất dễ lạc dòng.
- `sheetHtml` và bộ dựng Word đều đi **đúng thứ tự khối trong DOC**, không còn
  vẽ đầu đề trước rồi mới tới các phần.

### Trình sửa câu: ba tab

Trước đây đề bài, phương án, lời giải, hình và nhãn xếp dọc một cột — sửa cỡ
hình phải lăn chuột xuống đáy rồi lăn ngược lên xem kết quả. Sửa 40 câu một
buổi là 80 lần lăn chuột vô ích.

Nay ba tab: **Nội dung** · **Hình vẽ** (có chấm báo nếu câu có hình) · **Nhãn**.

**Câu đúng/sai giờ mỗi ý một đáp án RIÊNG và một ô giải thích riêng.** Dạng này
chấm theo từng ý (1 ý 0,1đ — 4 ý 1,0đ) nên học sinh hỏi "vì sao ý c sai" là
chuyện thường; một ô lời giải chung không trả lời được. Phần giải thích từng ý
chảy đủ ba nơi: xem trước trong trình sửa, bản Lời giải trên tờ giấy, và file
Word xuất ra.

### Trang chính (Dashboard)

Vào app không còn đập cả kho đề vào mặt. Màn này trả lời bốn câu: kho có gì,
còn việc gì phải làm, dùng hết bao nhiêu, bấm vào đâu tiếp. Có ô số liệu bấm
được, ba bước hướng dẫn **tự đánh dấu xong**, kho theo chuyên đề (bấm là nhảy
sang kho đã lọc sẵn), tài liệu gần đây, và mẹo dùng nhanh.

### Cột lọc trong Kho: gọn lại

Kho 28 câu đã có 14 chuyên đề + 5 nguồn, đổ hết ra là một cột chữ dài chẳng ai
đọc. Nay mỗi mục **gấp/mở** được (Nguồn gấp sẵn), phần dài chỉ hiện 6 dòng đầu
kèm **ô tìm chuyên đề**, và mục đang bật luôn hiện kể cả khi bị cắt — không thì
giáo viên thấy kho bị lọc mà không biết lọc theo cái gì.

### Còn nợ ở phần Word

- Watermark dựng bằng VML trong header. Word mở được, nhưng **chưa ai mở bằng
  Word thật để xem** — máy này không có Word. Kiểm trước khi bán.
- Hình dựng sẵn là SVG, phải rasterise qua canvas thành PNG mới nhét vào Word
  được. Ảnh nét gấp đôi rồi mới thu nhỏ, in ra vẫn có thể hơi rỗ so với TikZ.
- Chưa có đánh số trang trong file Word (bản xem trước có dòng "Trang 1/4"
  nhưng chỉ là chữ).
- `htmlToParas` (khối chữ tự do → Word) mới hiểu đậm/nghiêng/tiêu đề/căn lề.
  Bảng và danh sách gõ trong khối chữ sẽ rơi về đoạn văn thường.

---

## 15. Bỏ đối chiếu chéo · màn Duyệt chịu tải (12/08/2026)

### Bỏ hẳn model thứ hai

Đối chiếu chéo **nhân đôi chi phí mỗi trang** để đổi lấy đúng một thứ: bắt chỗ
model đọc sai số liệu. Nhưng **màn Duyệt đã làm việc đó rồi**, bằng mắt người,
đặt cạnh ảnh gốc — miễn phí và chính xác hơn một model chạy lượt hai.

Thay vào đó, cờ "câu này cần xem kĩ" lấy từ ba tín hiệu **có sẵn trong đúng một
lượt đọc**, không tốn thêm đồng nào:

| Cờ | Ở đâu ra | Nặng? |
|---|---|---|
| Trùng câu đã có trong kho | so với `BANK` | **có** — phải người quyết |
| Model tự khai đọc không chắc | trường `notes` của chính nó | **có** |
| Đáp án do AI tự giải | `answerSource="solved"` | nhẹ — sửa sau được |
| Có hình, chưa gắn ảnh | `figNote` | nhẹ |

"Duyệt hàng loạt" chỉ nuốt câu **không có cờ nặng**. Hai cờ nhẹ vẫn cho qua vì
sửa lại lúc nào cũng được.

Đã bỏ khỏi: gói dịch vụ (`PLANS`), ước tính lượt quét, ô tích ở màn Tài liệu,
và `npm run full` (giờ mặc định KHÔNG chạy, bật bằng `--verify`).
Lệnh `npm run verify` **vẫn còn** vì nó hữu dụng cho việc khác — đo xem một
model đọc sai chỗ nào khi chạy eval. Nó không còn là một bước của sản phẩm.

### Màn Duyệt: nạp 30 trang ra 154 câu thì sao

Bản trước vẽ **mỗi câu một vạch** trên thanh tiến độ và dựng ảnh gốc của **cả
hàng chờ**. Nạp 30 trang là 154 vạch tràn màn hình và một tờ giấy giả dài vô tận.

Đã sửa, chạy thử thật với 154 câu:

- **Thanh tiến độ** + con số thay cho dãy vạch. Không bao giờ tràn.
- **Chọn tài liệu**: hàng chờ gộp nhiều tài liệu thì có ô chọn, kèm số câu từng cái.
  Còn một tài liệu thì chỉ hiện tên, không bày ô chọn thừa.
- **Bốn bộ lọc**: Tất cả · Cần xem kĩ · Tin cậy cao · Trùng kho, mỗi cái kèm số.
- **Duyệt hàng loạt** trong phạm vi đang lọc. Trên 20 câu thì hỏi lại.
  Đo thật: **135 câu vào kho trong 195ms**.
- **Bỏ N câu trùng** một nút.
- **"Để sau"** (phím `S`): không bỏ, không duyệt, đẩy xuống cuối hàng. Nạp 200
  câu thì kiểu gì cũng có câu phải tra sách mới quyết được — chặn ở đó là tắc cả hàng.
- **Sửa đáp án ngay tại chỗ**: bấm thẳng vào phương án khác, hoặc bấm ý đúng/sai
  để lật. Không phải mở trình soạn câu. Người đã tự chọn thì cờ "AI tự giải" biến mất.
- Ảnh gốc chỉ dựng các câu **cùng trang**, không dựng cả hàng chờ.

### Một lỗi nặng tìm được nhờ chạy 154 câu

Bộ bắt trùng so đề bài **sau khi bỏ hết công thức đi** (`plain()` cắt sạch mọi
cụm `$…$`). Hậu quả: "tốc độ $v = 20$" và "tốc độ $v = 60$" thành cùng một câu
— **76/154 câu bị vu là trùng**. Số liệu chính là thứ phân biệt hai câu vật lí,
không được bỏ. Nay so nguyên văn (`normStem`): còn đúng 1 câu trùng thật.

Lỗi này có từ đợt trước nhưng với 4 câu mẫu thì không lộ ra. Đây là lý do phải
thử ở đúng quy mô thật.

### Còn nợ

- Chưa có "hoàn tác" sau khi duyệt hàng loạt. Bấm nhầm 135 câu thì phải xoá tay.
- `rvSession.done` chỉ đếm trong phiên, tải lại trang là về 0.
- Bộ bắt trùng vẫn là so chuỗi. Đổi một chữ là không nhận ra. Phase 1 nên dùng embedding.
