# Bàn giao kỹ thuật — EduVault

Cập nhật: 14/08/2026 (phiên "một bảng quyết định trình bày cho cả ba đường ra")

## 1. Đây là cái gì

App web giúp giáo viên/gia sư Việt Nam biến tài liệu rời rạc (PDF, ảnh chụp đề)
thành kho câu hỏi riêng, rồi ráp đề và xuất `.docx` / PDF LaTeX **sửa được**.

- Local: <http://127.0.0.1:5173/>
- Beta công khai: chạy bằng `npm run beta` (cổng 5174, dữ liệu `web/data-beta/`).
- Tài khoản quản trị local: `admin@eduvault.local` / `Admin@123456`.
- Tài khoản tester: xem `TAI-KHOAN-TESTER.md` (không commit).
- Dữ liệu runtime nằm trong `web/data/` và `web/data-beta/`, không commit.

## 2. Khởi động

```powershell
cd D:\NewApp\web
npm install
npm start
```

Kiểm tra nhanh — dòng log thứ hai phải nói rõ model và key:

```
EduVault đang chạy tại http://localhost:5173/index.html
[ocr] model stali:gpt-5.6-luna qua stali (https://api.stali.vn/v1), key sk-sta…diP0
```

Nếu dòng đó ghi "CHƯA CHẠY ĐƯỢC" thì thiếu key, xem mục 5.

## 3. Kiểm thử

```powershell
cd D:\NewApp\web
npm test
node --check app.js
node --check server.mjs

cd D:\NewApp\phase0
npm run typecheck
```

## 4. Bản đồ code

| Đường dẫn | Trách nhiệm |
|---|---|
| `web/server.mjs` | HTTP server, route API, **hàng đợi job OCR chạy nền** |
| `web/backend.mjs` | auth, SQLite, workspace, tài liệu, bảng `ingest_jobs` |
| `web/ocr-model.mjs` | **gọi model OCR trong tiến trình** — prompt, schema, retry, phân loại lỗi |
| `web/ocr.mjs` | tách trang, cắt hình, ghép đáp án/cụm câu, map sang shape của app |
| `web/app.js` | toàn bộ UI trình duyệt |
| `web/format.js` | **nguồn duy nhất cho mọi quyết định trình bày** — cả ba đường ra đọc chung |
| `web/docx.js`, `web/omml.js` | dựng DOCX native (công thức là equation thật) |
| `web/latex.mjs` | dựng nguồn LaTeX cho đường xuất PDF |
| `web/data.js` | hằng số, preset trình bày, dữ liệu mẫu |
| `phase0/` | spike offline để đo/eval, **không nằm trên đường chạy của app nữa** |

## 5. Cấu hình model

Key và model đọc từ `phase0/.env` (hoặc `web/.env`, hoặc biến môi trường —
biến môi trường thắng file):

```
DE_MODEL=stali:gpt-5.6-luna
STALI_API_KEY=...
GEMINI_API_KEY=...
```

- App **chỉ** gọi qua cổng nói giao thức OpenAI chat-completions: `stali`,
  `gemini`, `openrouter`. Muốn chạy Claude thì định tuyến qua ví:
  `DE_MODEL=stali:claude-sonnet-5`. Viết `anthropic:...` sẽ bị chặn kèm hướng dẫn.
- Kiểm tra key mà không tốn lượt OCR: `GET /api/ocr/health` (thêm `?ping=1` để
  gọi thật một lượt 4 token).

## 6. Luồng dữ liệu

1. Người dùng chọn Kho rồi tải một PDF hoặc tối đa 50 ảnh (một lần tải = một
   tài liệu nhiều trang).
2. `POST /api/upload` **trả về ngay** `202 { jobId }`; OCR chạy nền trên server.
3. Mỗi trang được chuẩn hoá xoay và lưu thành ảnh canonical `page-N.png`.
4. Model trả JSON: câu, phương án, đáp án **in sẵn**, cụm câu, và bbox **của
   hình** (chỉ hình).
5. Kết quả từng trang ghi ra `extraction-N.json` ngay khi xong.
6. Backend ghép đáp án/cụm câu giữa các trang bằng logic xác định, không tốn
   thêm lượt AI.
7. Client hỏi `GET /api/jobs/:id` mỗi 2 giây để lấy tiến độ và kết quả.
8. Màn Duyệt hiện **bảng đối chiếu** + ảnh trang gốc; câu/cụm được duyệt nguyên
   tử rồi vào kho.
9. Ráp đề → xuất DOCX native hoặc PDF biên dịch bằng pdfLaTeX.

## 7. Các bất biến không được phá

- **Một lựa chọn trình bày phải ra đúng một kết quả ở cả ba đường ra.** Thêm kiểu
  mới thì sửa `web/format.js` trước, rồi dạy đủ ba bộ dựng vẽ nó — đừng để bộ nào
  tự suy lại từ `layout`, xem mục 9quater.

- **Không tự giải.** Chỉ lưu đáp án/lời giải khi chúng được in trong nguồn; nếu
  không có thì `null` và `answer_source = "none"`.
- Nguồn đáp án phải là `printed`, không suy đoán.
- Một nhóm câu là entity cấp một: có stem/dữ liệu chung, ảnh chung, nguồn và
  danh sách câu con. Duyệt, lưu, sao chép, random và render phải giữ nhóm nguyên tử.
- Bbox **chỉ còn dùng cho hình**, dạng `[x1,y1,x2,y2]` chuẩn hoá theo ảnh
  canonical. Không tái sinh bbox cho câu (xem mục 8).
- Crop và ảnh hiển thị phải dùng đúng một ảnh canonical.
- DOCX phải giữ công thức ở dạng equation native, không raster hoá.
- Số phương án trắc nghiệm **lấy đúng như đề**, không ép về 4.
- **Mỗi lần lưu workspace phải kèm mốc phiên bản.** Máy chủ nắm hàng chờ, nguồn,
  nhóm và kho; client nắm đề đang soạn. Lưu mà không gửi mốc bị từ chối bằng 409
  — xem mục 8ter.
- **Đọc lại một tài liệu là THAY hàng chờ của nó, không cộng thêm.** Bấm "Thử
  lại" khi tài liệu đó còn câu chờ mà cộng dồn thì giáo viên phải ngồi xoá tay
  từng câu trùng.

## 8. Ba quyết định lớn của phiên này

### 8.1 OCR gọi thẳng trong tiến trình, bỏ hẳn `spawn tsx`

Bản cũ spawn `tsx phase0/src/cli.ts` cho từng trang. Bằng chứng hỏng lấy từ
bảng `ingest_jobs`:

| Lỗi ghi trong DB | Nguyên nhân thật |
|---|---|
| `spawn EPERM` | antivirus/quyền chặn việc đẻ tiến trình con |
| `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) … win\async.c:76` | tiến trình con chết lúc teardown **sau khi** đã trích xong; JSON có trên đĩa nhưng exit code ≠ 0 nên job bị đánh hỏng |
| `Không kết nối được model OCR sau 2 lần thử. {"page":1,…}` | **không phải lỗi mạng**: đề có 5 phương án A–E, zod enum chỉ cho A–D, thông báo lệch schema bị regex "lỗi tạm thời" nuốt và báo nhầm thành lỗi kết nối |

Nay `web/ocr-model.mjs` gọi `fetch` thẳng tới cổng chat-completions, đọc
streaming SSE bằng tay. Không còn tiến trình con, không còn assertion Windows,
và mỗi trang tiết kiệm ~2 giây khởi động tsx.

Ở đây còn có ba lưới an toàn mới:

- **Phát hiện treo im lặng**: đo khoảng lặng giữa hai chunk (75 giây) chứ không
  chỉ đo tổng thời gian (240 giây).
- **Vá JSON bị cắt**: chạm trần token thì cắt về phần tử cuối còn nguyên vẹn,
  giữ những câu đã đọc được và ghi chú vào câu cuối, thay vì mất trắng cả trang.
- **Hạ cấp response_format**: cổng nào không nhận `json_schema` thì tự chuyển
  sang `json_object` kèm schema trong prompt.

Lỗi được phân loại thành `network | quota | auth | model | schema | config`;
chỉ nhóm thật sự tạm thời mới thử lại (3 lần, backoff).

### 8.2 OCR chạy nền + tiếp tục được, thay cho request đồng bộ

`POST /api/upload` từng **giữ nguyên request HTTP** suốt thời gian OCR. PDF 15
trang = 15 lượt gọi model nối đuôi ≈ 9 phút; trình duyệt, cloudflared và mọi
proxy ở giữa đều cắt trước khi có kết quả — đó là phần lớn "OCR lỗi" ở bản beta.

Nay:

- upload tạo job rồi trả `202` ngay; client poll `GET /api/jobs/:id`;
- tiến độ là **số trang thật** (`Đang đọc trang 7/15`), không phải thanh chạy giả;
- đóng tab giữa chừng không mất gì — server vẫn ghi kết quả vào workspace, mở
  lại app là tự bám tiếp vào job đang chạy;
- server khởi động lại thì job dở được chạy tiếp (`resumePendingJobs`, tối đa 3 lần);
- **"Thử lại" chỉ tốn lượt cho những trang chưa xong**, nhờ `extraction-N.json`.
  Muốn đọc lại từ đầu thì gửi `{"fresh":true}` cho `/api/sources/:id/retry`.

### 8.3 Bỏ highlight, thay bằng bảng đối chiếu

Bắt model đo bbox cho **từng câu** vừa tốn token ra vừa hay lệch, mà lệch một
chút là giáo viên nghi luôn phần chữ dù chữ đọc đúng. Đã bỏ:

- bbox của câu và của cụm trong schema và prompt;
- lớp `.sourcehl` trên ảnh trang;
- bộ dò mốc "Câu n" bằng pixel (`detectQuestionRegions`) và endpoint
  `GET /api/jobs/:id/regions`;
- `remapFigureBbox`.

Thay bằng **bảng đối chiếu** ở đầu màn Duyệt: mỗi dòng là một câu AI đọc ra
(số câu in trên đề · trang · đề bài rút gọn · đáp án · dạng · lý do cần xem).
Bấm một dòng là nhảy sang đúng câu đó và mở đúng trang gốc bên trái — đây chính
là chỗ "truy ra trang mà OCR".

**Crop hình vẫn còn nguyên**: model vẫn khoanh `images[].bbox`, hệ thống vẫn cắt
tự động, và nút "Crop & thay hình câu này" vẫn cho kéo lại vùng trên trang gốc
trước khi câu vào kho. Bbox hình trùm quá 72% diện tích trang bị bỏ kèm ghi chú
thay vì nhét cả trang vào làm hình minh hoạ.

## 8bis. Đề nhiều bài lớn + phần ĐÁP ÁN ở nửa sau

Đo trên `ĐỀ-THI-TEST-HSG-QG-YB-NGÀY-1.pdf` (15 trang: 5 bài Ж1–Ж5 ở trang 1–6,
ĐÁP ÁN từ giữa trang 6). Lần chạy đầu ra **19 "câu hỏi", trong đó 9 câu là mảnh
lời giải**, cụm câu vỡ vụn, và đề bài hiện nguyên chữ `\n\n` giữa màn hình.
Năm nguyên nhân, đều đã sửa và đều có test:

### a. Trang lời giải bị biến thành câu hỏi

Model chỉ nhìn một trang mỗi lượt nên không biết trang 13 nằm sau chữ "ĐÁP ÁN"
in ở trang 6. **Trạng thái tuần tự của tài liệu thuộc về backend**, không phải
model: `contextBlock()` chèn vài dòng bối cảnh ("đã vào phần đáp án từ trang 6",
"bài lớn đang mở là Ж4") vào prompt của trang sau. Rẻ hơn nhiều so với gửi lại
các trang trước.

Cái chốt để lật cả tài liệu sang chế độ lời giải là `answers_heading` — **có
nhìn thấy dòng tiêu đề "ĐÁP ÁN" hay không**, một sự kiện quan sát được, chứ
không phải phán đoán "trang này trông giống lời giải". Lý do: bản đầu tin
`page_role` và model gọi nhầm trang 3 (đề thuần) là `hon_hop` → bốn câu hỏi thật
ở trang 4–5 bị xoá sạch. Nhãn sai chỉ được phép làm mất dữ liệu khi có mốc khách
quan xác nhận.

### b. Số câu con trùng nhau giữa các bài

Đề HSG/olympiad/đại học đánh số câu con **lại từ 1 trong mỗi bài lớn**. Khoá ghép
đáp án cũ chỉ gồm `(dạng, số câu)` nên lời giải câu 1 của bài Ж5 nhảy vào câu 1
của bài Ж1. Nay có `problem_ref` và khoá là `(bài lớn, dạng, số câu)`; bản dự
phòng bỏ qua bài lớn chỉ dùng khi nó **không mơ hồ**.

### c. Cụm câu chết ở ranh giới trang

Id cụm từng gắn với `(trang, ref)` nên mỗi trang đẻ một cụm mới. Nay id gắn với
`problem_ref`, cụm cùng bài ở nhiều trang được gộp, và **backend tự dựng cụm**
khi từ 2 câu trở lên cùng `problem_ref` mà model quên khai — xác định hoàn toàn,
không tốn thêm lượt gọi.

### d. JSON chứa LaTeX — hai kiểu hỏng khác nhau

- `\dfrac` thiếu một gạch chéo → `JSON.parse` ném lỗi → **mất cả trang**.
- `\right`, `\theta`, `\frac`, `\beta`, `\nabla` thiếu một gạch chéo → JSON
  **hợp lệ**, parse thành ký tự điều khiển (CR, TAB, formfeed…). Không lỗi nào
  được ném, chỉ có công thức sai âm thầm. Đây là kiểu nguy hiểm hơn.

`repairJsonEscapes()` chạy **trước** mỗi lần parse chứ không đợi ngoại lệ. Ca thứ
hai nhận diện theo **tên lệnh** (`CONTROL_LIKE_LATEX`), nhờ vậy `\nb)` — model
muốn xuống dòng rồi ghi "b)" — vẫn được hiểu là xuống dòng.

### e. Hai ký tự `\` + `n` hiện nguyên xi trên màn hình

Model tự escape thừa một lần. `cleanModelText()` dọn, nhưng **chỉ ở phần chữ**:
trong `$…$` thì `\ne`, `\nabla` là lệnh thật. Dòng trống ngăn đoạn được giữ và
render thành `<br>`.

### Kết quả đo lại trên đúng tài liệu đó

| | Trước | Sau |
|---|---|---|
| Câu vào hàng duyệt | 19 (9 là mảnh lời giải) | 14, đúng số câu của đề |
| Cụm câu | 3, sai liên kết | 4–5, khớp bài Ж1–Ж5 |
| Mốc ĐÁP ÁN | không nhận ra | trang 6, đúng |
| Lời giải ghép về đúng câu | không | có |
| Trang mất vì JSON hỏng | có | không |

## 8ter. Tab đang mở ghi đè kết quả OCR

Bug thật, dựng lại được, và mất đúng 13 câu vừa đọc xong.

Job OCR chạy nền ghi câu hỏi **thẳng vào workspace ở phía máy chủ**. Tab nào
đang mở mà không theo dõi job đó vẫn tự lưu mỗi 1,2 giây bằng bản chụp cũ trong
bộ nhớ của nó, và bản chụp cũ đó không có 13 câu kia. Bên nào ghi sau thì thắng
— nên kết quả biến mất không dấu vết.

Cách sửa là chia rõ quyền sở hữu rồi ép bằng mốc phiên bản:

- `workspaces.updated_at` là mốc. `GET /api/workspace` trả kèm `version`.
- Client gửi lại `version` trong mỗi lần lưu. Lệch mốc → **409** kèm trạng thái
  mới nhất.
- Client nhận 409 thì lấy phần của máy chủ (hàng chờ, nguồn, nhóm, kho), **giữ
  đề đang soạn của mình**, rồi lưu lại. Tự lành, không cần người dùng làm gì.
- Lưu mà **không gửi mốc** cũng bị coi là cũ. Đây là chỗ đã lọt lần đầu: tab
  chạy bản `app.js` đời trước không có trường `version`, server thấy `null` nên
  bỏ qua kiểm tra và cho ghi đè.

`navigator.sendBeacon` lúc đóng tab cũng đi qua đúng đường này, nên một tab cũ
đóng lại không thể xoá kết quả của job vừa xong.

## 9. Trình bày: mẫu BK/HCMUT

`BUILTIN_LAYOUT_PRESETS` → `builtin-bk` giờ mặc định `mcStyle:"circle"`:
chữ cái phương án nằm trong **ô tròn** để sinh viên khoanh thẳng lên đề.

Ba đường ra đều phải giữ đúng kiểu này:

| Đường ra | Cách vẽ ô tròn |
|---|---|
| Xem trước trong app | `.mc-circle b.mccircle` — vẽ bằng `border-radius:50%` |
| DOCX | ký tự Ⓐ–Ⓗ (U+24B6…) — vẫn là **chữ**, sửa/xoá/đổi phông được |
| PDF LaTeX | `\textcircled{\small A}` — lệnh LaTeX2e chuẩn, không cần package ngoài |

Không vẽ ô tròn bằng shape/ảnh: làm thế là phá cam kết "file xuất ra phải sửa được".

## 9bis. Bảng soát cả tài liệu — **nằm trong popup**

Đã qua ba đời, ghi lại để đừng lặp lại hai đời đầu:

1. Sáu cột, ghim thường trực trên màn Duyệt. Hai cột gần như lặp lại một chuỗi
   ("Tự luận", "model đọc không chắc"), các dòng gom theo TRANG → chỉ thấy nhiễu.
2. Ba cột, vẫn ghim thường trực. **Vẫn hỏng**: nó ăn một phần ba chiều cao, đúng
   phần đáng ra để nhìn ảnh gốc và sửa câu. Người dùng nói thẳng là "rối mắt,
   làm loạn hết UI".
3. Bản hiện tại: **popup**, mở bằng nút "Soát cả tài liệu" ở thanh tiến độ.

Vì sao popup mới đúng: soát cả tài liệu là việc **thỉnh thoảng** mới làm (xem có
sót câu nào không, xoá hàng loạt). Màn Duyệt là nơi làm việc từng câu. Thứ dùng
thỉnh thoảng mà chiếm chỗ thường trực thì lần nào cũng phải nhìn qua nó.

Trong popup:

- Gom theo **BÀI LỚN / cụm**, không theo trang — giáo viên nghĩ theo bài. Câu lẻ
  mới gom theo trang.
- Bốn cột: *ô tích* · *ai* (số câu + dạng) · *nội dung + chip trạng thái* · *trang*.
- Chip màu có nghĩa: xanh = đã có (đáp án, hình đã cắt), vàng = cần người xem.
- Bấm một dòng → **đóng bảng** rồi mở đúng câu và đúng trang gốc. Bấm vào một câu
  là để xem nó, không phải để tiếp tục nhìn bảng.
- `Esc` đóng, bấm ra nền cũng đóng. Lựa chọn được giữ khi đóng/mở lại.

Hai cái bẫy CSS đã dính, đừng dính lại:

- **Không đặt `display:flex` lên `<td>`.** Ô mất vai trò ô bảng, cột lệch khỏi
  hàng và giữa bảng hở một mảng trắng to. Xếp dọc bằng `<b>`/`<i>` dạng block.
- **Phải khai `<colgroup>`.** `table-layout:fixed` lấy bề rộng cột từ hàng đầu,
  mà hàng đầu là hàng tiêu đề khối có `colspan` — thiếu colgroup thì bốn cột chia
  đều nhau bất kể CSS đặt gì trên `td`.

Đừng thêm cột. Mỗi cột thêm vào là một thứ nữa phải đọc lướt qua trước khi thấy
được câu cần sửa.

### Phân số phải nằm đúng trục toán

Gạch ngang của phân số phải ngang tầm dấu trừ — khoảng nửa chiều cao chữ x phía
trên đường chân chữ. `.fr` dùng `vertical-align:middle`, vì gạch ngang nằm giữa
hộp hai dòng nên `middle` đặt nó đúng chỗ (đo lại: lệch 2–3px so với tâm dấu `=`).

Bản trước dùng `vertical-align:-.55em`, phân số bị dìm hẳn xuống dưới dòng chữ,
nhìn như rơi ra khỏi câu — thấy rõ nhất ở `$y=\dfrac{2x+1}{x+m}$` và ở các phương
án dạng `$[-3;\dfrac{1}{2})$`.

Riêng phân số **trong số mũ/chỉ số** thì viết dạng gạch chéo `a/b`: phân số xếp
chồng là `inline-flex` còn `sup`/`sub` đặt `line-height:0`, hai thứ gặp nhau thì
cả phân số co lại thành một chấm.

### Chọn nhiều câu và xoá hàng loạt

- Ô tích ở mỗi dòng và ở đầu mỗi khối; thanh xanh phía trên đếm số đã chọn.
- **Tích một câu của cụm là tích cả cụm.** Cụm đã là đơn vị nguyên tử lúc duyệt
  và lúc lưu; nếu lúc chọn lại tách lẻ thì người dùng phải tự đi tìm đủ các câu
  con nằm rải ở nhiều trang, và bỏ sót một câu là kho có nửa cụm mồ côi.
- Nút xoá luôn nói rõ số câu và số cụm, hỏi xác nhận trước khi xoá — xoá khỏi
  hàng chờ là không lùi được, muốn có lại phải OCR lại tài liệu.
- Bấm ô tích **không** kéo theo việc nhảy trang; đó là hai ý định khác nhau.

### Phóng to ảnh trang

- Nút `−` / `%` / `+` ở thanh "Ảnh gốc", hoặc `Ctrl` + lăn chuột. Bấm vào con số
  là về vừa khung. Sáu mức: 75% → 400%.
- Phóng bằng cách nới chính khung `.scan`, kèm `flex:0 0 auto` — thiếu dòng đó
  thì flex-shrink co khung về vừa chỗ và mức phóng chỉ đổi con số chứ ảnh không
  to thêm.
- `.rv-grid` phải là `minmax(0,1fr)`: để `1fr` thì cột trái phình theo ảnh và
  **đẩy cột bên phải đi** thay vì để khung ảnh tự cuộn.
- Vùng crop tính theo `getBoundingClientRect()` của chính thẻ `img`, nên kéo
  khung ở mức phóng nào cũng ra đúng toạ độ — đã đo ở 200%: kéo từ 25%,30% đến
  60%,55% ra đúng khung `left:25% top:30% width:35% height:25%`.

## 9ter. Xem trước phải bằng ĐÚNG file sẽ tải về

Người dùng chọn mẫu có phương án khoanh tròn, xuất PDF ra `A.` trơn. Hai nguyên
nhân, cả hai đều là **bản xem trước và bộ xuất nói hai thứ khác nhau**:

1. Màn xem trước có bốn kiểu phương án (`plain`, `circle`, `cards`, `tabular`)
   nhưng `latex.mjs` chỉ phân biệt `circle` với "còn lại". `cards` — kiểu đang
   bật, trông y hệt vòng tròn kèm khung — rơi xuống nhánh mặc định thành `A.`.
   Nay cả bốn kiểu có nhánh riêng: `cards` dùng `\fbox{\parbox{…}}`, `tabular`
   kẻ `\hline`, `circle`/`cards` đều `\textcircled`.
2. Allowlist lệnh toán trong `latex.mjs` là **danh sách chép tay** và đã lệch:
   `\setminus` hiện đẹp trên màn hình nhưng ra PDF thành chữ "setminus" nằm giữa
   phương án. Nay allowlist dựng **thẳng từ `latex-core.js`** (`SYM` + `FUNC` +
   `UPRIGHT` + `ACCENT` + `BIGOP`) cộng một danh sách lệnh cấu trúc. Màn hình vẽ
   được thì PDF nhận được — không còn hai bảng để lệch.

Có test khoá cả hai: bốn kiểu phải ra bốn kết quả khác nhau, và một loạt lệnh
phải đi qua `safeMath` nguyên vẹn.

## 9quater. Ba bộ dựng phải ăn chung một bảng quyết định — `web/format.js`

Hai lần vá ở trên chỉ chữa từng chỗ lệch. Gốc của bệnh là **ba bộ dựng tự đọc
`layout` rồi tự suy**, nên cứ thêm một lựa chọn là lệch thêm một chỗ:

| Người dùng chọn | Màn hình vẽ | Word xuất ra | PDF xuất ra |
|---|---|---|---|
| Form Tối giản + phương án "Card / ô" | chữ trơn | chữ trơn | ô khoanh tròn |
| Form Tối giản + Đúng–Sai "Bảng card" | bảng | danh sách | bảng |
| Form Tối giản + TLN "Ô trả lời" | ô vuông | `Đáp án: .....` | dòng kẻ |
| Form Tối giản + tiêu đề phần "Thanh màu" | thanh màu | chữ đen | không có tiêu đề phần |
| Bảng màu (ba hộp chọn màu) | không đổi gì | đổi | không có màu |
| Đề hai cột | hai cột | một cột | một cột |
| Cỡ chữ, giãn dòng, nhãn dạng câu, dòng làm bài | có | một phần | không |

Nay cả ba gọi `resolveFormat(layout)` trong `web/format.js` và chỉ vẽ theo bảng
nó trả về. Quy tắc:

- **`card` là khác biệt DUY NHẤT giữa bốn form câu hỏi.** Tối giản không đóng
  khung, ba form còn lại có. Mọi lựa chọn khác phải chạy được ở cả bốn form —
  bản cũ khoá chúng sau điều kiện "form có màu" nên chọn xong không thấy gì đổi.
- **Bảng màu chỉ đi qua ba biến `--preset-form/soft/border`.** CSS không được gán
  màu cứng cho `.qstyle-*` nữa; đúng ba dòng đó từng ghi đè và làm hộp chọn màu
  bấm xong không đổi gì. Đổi form thì `applyQuestionStyle()` nạp bảng màu mặc
  định của form đó vào `accentColor/accentSoft/borderColor`.
- **Số cột phương án bớt theo cùng một hàm** (`mcColumnsFor`). Trước đây màn hình
  tự bớt còn Word thì không, nên cùng một câu ra 2 cột trên màn và 4 cột trong file.

`buildExamDoc()` gửi kèm `section_title` cho từng câu — bộ LaTeX làm phẳng danh
sách câu nên không còn thấy khối, mà tờ đề nào cũng phải có "PHẦN I — TRẮC NGHIỆM".

**Không nạp `colortbl`.** Bản MiKTeX phổ biến trên máy Windows đang đi kèm
`tabularx 2020`; nạp `colortbl` vào là **mọi** bảng `X` chết ngay ở
`\end{tabularx}` với "Undefined control sequence … `\insert@pcolumn`" và cả lượt
biên dịch không ra file nào. Tô nền ô tiêu đề bằng `\colorbox` là đủ.

Lỗi biên dịch cũng phải sống được: `pdfPreview.error` giữ lại thông báo, vì bản
trước ghi lỗi vào ô chú thích rồi khối `finally` gọi `paintPreviewMode()` xoá sạch
— người dùng chỉ thấy "Bấm Làm mới", bấm lại vẫn hỏng, không đoán ra vì sao.

### Khung xem trước phải đủ chỗ cho tờ A4

Cột xem trước từng khoá cứng 520px, mà A4 cỡ thật rộng 794px — nên tờ giấy lúc
nào cũng phải thu về ~60% và thanh công cụ chen nhau đến mức trình duyệt ngắt chữ
trong nút ("Trình bày của bạn" tụt xuống bốn dòng chữ dọc).

- `#s-rap` giờ là lưới ba cột `1fr | 7px | var(--preview-w)`, mặc định
  `clamp(560px,46vw,1040px)` — màn 1920 ra 883px, tờ giấy lên đúng 100%.
- Thanh kéo `#rapSplit` chia lại chỗ, nhớ theo máy trong `localStorage`, bấm đúp
  về mặc định. Chế độ "Mở rộng" phải giấu **cả** cột trái **và** thanh kéo.
- `.preview>.bar` cho xuống hàng (`flex-wrap`) và cấm co từng nhóm nút
  (`flex:none`) — ép co là trình duyệt ngắt chữ chứ không xuống hàng.
- Màn Tùy chỉnh cũng vẽ **A4 thật rồi thu bằng `transform`**, không còn
  `width:100%;font-size:10.5pt!important` — bóp bề ngang là ngắt dòng khác bản in,
  tức là lại xem một đằng tải về một nẻo.

### Bản xem trước ở màn Ráp đề là PDF thật

Bản dựng bằng HTML không biết pdfLaTeX ngắt dòng ở đâu và không cùng phông, nên
nó chỉ *gần* giống tờ giấy. Nay mặc định là **PDF thật** do pdfLaTeX biên dịch,
xem trong `<iframe>` bằng bộ đọc PDF của trình duyệt. Vẫn giữ nút "Bản nhanh"
cho ai cần xem tức thì.

- **Không tự biên dịch lại sau mỗi lần gõ** — mỗi lượt tốn vài giây và server
  chạy tuần tự. Sửa đề thì ghi "Đề đã đổi — bấm Làm mới"; đổi tab Đề/Đáp án/Lời
  giải thì dựng lại luôn vì đó là đổi hẳn nội dung tờ giấy.
- Ma trận không có bản PDF, tự rơi về bản nhanh.
- `.pdfview` **không được** neo `position:absolute; inset:0`: ở bố cục hẹp
  (≤1080px) `.preview .body` chuyển sang `overflow:visible` và cao theo nội dung,
  mà nội dung lúc đó chỉ còn khung PDF — hai bên cùng co về 0 và người dùng thấy
  một khung trắng. Dùng `height:100%` kèm `min-height:min(78vh,900px)`.

## 10. Hệ thiết kế (Nocturne nền sáng)

- Chữ to, tương phản đủ. Nền xỉn + chữ nhỏ đã bị chê "đau mắt", đừng quay lại.
- Màu để **mã hoá ý nghĩa**, không để trang trí: xanh = ổn/đã có, vàng = cần
  người xem, đỏ = hỏng, tím nhạt = đang chạy.
- Token màu khai ở đầu `styles.css`; đừng gõ mã hex vào giữa file.
- Không tô đặc nút. Nút chính mới có nền màu, còn lại là viền hoặc chữ.

## 11. Chức năng đã có

- Auth session HttpOnly, SQLite, workspace tách theo người dùng.
- Tạo/đổi tên/chuyển Kho; câu, nhóm, tài liệu, hàng duyệt, draft cô lập theo Kho.
- Upload PDF, chọn nhiều ảnh, kéo thả, dán clipboard.
- OCR nhiều trang chạy nền, không tự giải, nối đáp án in riêng ở cuối tài liệu.
- Nhận diện và lưu nhóm câu xuyên trang.
- Bảng đối chiếu OCR ↔ trang gốc; crop/thay hình trực tiếp trên trang.
- Kho câu hỏi, ráp đề, xuất đề/đáp án/lời giải.
- Bốn style: `classic`, `exam-blue`, `specialist-pink`, `logic-green`.
- Preset editor theo Kho: đầu đề, palette, form MC/TF/TLN/tự luận, block
  trên/dưới, ảnh, logo, watermark.
- Import ảnh/PDF format tham chiếu (lấy palette bằng thuật toán, không gọi AI).
- Xuất PDF biên dịch trực tiếp bằng pdfLaTeX.

## 12. Giới hạn đã biết

- Chưa có worker/queue tách tiến trình: job chạy trong chính tiến trình server.
  Server chết giữa chừng thì job được chạy tiếp lúc khởi động, nhưng nhiều job
  nặng cùng lúc vẫn tranh CPU với việc phục vụ HTTP.
- Chưa giới hạn số job chạy song song mỗi người dùng.
- Câu con dạng a)/b)/c) bị **ngắt qua trang** thì vẫn tách thành câu riêng thay
  vì gộp vào câu cha. Đo trên đề HSG: 13 câu trích ra so với 12 câu thật, chênh
  đúng một câu vì phần c) của bài Ж5 nằm sang trang 6.
- Trong `$…$` bộ render hiện chỉ hỗ trợ tập lệnh ở `latex-core.js`; lệnh lạ hiện
  ra dạng chữ và ghi cảnh báo ở console.
- Cảnh báo trùng câu vẫn so theo chuẩn hoá chuỗi, chưa có fuzzy/embedding.
- Chưa có reset mật khẩu, xác thực email, rate limit, antivirus, backup, observability.
- PDF cần `pdftoppm` trong PATH; xuất PDF cần pdfLaTeX (`PDFLATEX_PATH`).
- `phase0/` đã rời đường chạy của app nhưng prompt/schema trong đó **chưa được
  đồng bộ** với `web/ocr-model.mjs`. Dùng nó để eval thì phải chép prompt sang,
  hoặc tốt hơn là viết bộ eval mới gọi thẳng `web/ocr-model.mjs`.
- Nên dùng Node 22.5+ (SQLite tích hợp). Đang chạy tốt trên Node 24.

## 13. Việc tiếp theo, theo thứ tự

1. **Bộ eval có ground truth**: 10–15 trang thật (THPT, ĐGNL, TSA, HSA, đề đại
   học 5 phương án), đo tỷ lệ câu đúng hoàn toàn, tỷ lệ gắn đúng đáp án in,
   precision/recall nhóm câu, giây/câu khi duyệt. Gọi thẳng `web/ocr-model.mjs`.
2. **Giới hạn job song song** + hàng đợi có ưu tiên, trước khi mở beta rộng hơn.
3. **Bảo mật/vận hành production**: rate limit, reset mật khẩu, backup DB, log
   có cấu trúc.
4. Chỉ tối ưu model/prompt **sau khi** số đo cho thấy nút thắt nằm ở OCR chứ
   không phải ở thao tác duyệt.

## 13bis. Hai lưới an toàn khi mở ra internet — `web/guard.mjs`

Bật sẵn ở mọi chế độ chạy, không riêng beta.

### Rate limit

Ba xô, vì ba thứ đắt khác nhau — cửa sổ trượt, đếm trong bộ nhớ, không thư viện,
không Redis (một tiến trình, một máy):

| Xô | Hạn mức | Chặn cái gì |
|---|---|---|
| `auth` | 12 lần / 15 phút | dò mật khẩu ở `/api/auth/login`, `/register` |
| `heavy` | 30 lần / 5 phút | `/api/upload`, `/api/export/latex-pdf`, `/api/sources/*` — tốn tiền model và tốn CPU pdfLaTeX |
| `api` | 600 lần / phút | phần còn lại |

Hai chỗ dễ làm sai, đã tránh:

- **Đặt trước cả kiểm tra đăng nhập.** Để sau thì mỗi lần dò mật khẩu vẫn chạy
  qua scrypt: kẻ dò tốn một request, máy chủ tốn cả trăm mili giây CPU.
- **Đếm theo `cf-connecting-ip`, không theo `remoteAddress`.** Sau Cloudflare
  Tunnel thì `remoteAddress` LUÔN là 127.0.0.1 (chính cloudflared gọi vào), chặn
  theo nó là gộp cả thiên hạ vào một xô — một người nghịch, cả lớp bị khoá.
  Header này chỉ đáng tin khi origin **không thể** bị gọi thẳng; đúng với tunnel.
  Chạy kiểu mở thẳng cổng ra internet thì phải đặt `EDUVAULT_TRUST_PROXY=0`, vì
  lúc đó ai cũng tự khai IP giả để thoát rate limit.

Hạn mức `api` phải rộng tay: client tự lưu workspace mỗi 1,2 giây và hỏi tiến độ
job mỗi 2 giây, nên một giáo viên ngồi yên đã ngốn ~80 request/phút. Có test khoá
con số này để đừng ai siết xuống rồi tự khoá người dùng thật.

### Backup

`VACUUM INTO` ra `<data>/backups/eduvault-<mốc>.sqlite`, chạy lúc khởi động rồi
mỗi 6 giờ, giữ 14 bản (`EDUVAULT_BACKUP_MINUTES`, `EDUVAULT_BACKUP_KEEP`).

**Không copy file `.sqlite` bằng tay.** Chế độ WAL để một phần dữ liệu mới nằm
trong `-wal` chưa nhập vào file chính, nên bản copy thô có thể thiếu đúng những
gì vừa ghi. Test không chỉ kiểm file có tồn tại — nó **mở lại bản chụp và đọc ra
bản ghi**, vì một file hỏng vẫn có kích thước lớn hơn 0.

Thư mục `uploads/` chưa được backup tự động (có thể tới vài GB) — vẫn phải chép
tay hoặc gắn vào lịch backup của máy.

## 14. Publish

Đường đang dùng: **Cloudflare Tunnel có tên** trỏ về máy chạy server.

App này **không chạy được trên Cloudflare Workers/Pages**: nó cần Node thật,
`node:sqlite` ghi ra đĩa, `sharp`, và spawn `pdflatex`/`pdftoppm`. Cloudflare ở
đây chỉ làm đường vào và lớp TLS.

```powershell
cd D:\NewApp\web
npm run publish:web        # server beta cổng 5174 + tunnel, sống chết cùng nhau
```

`tools/publish.mjs` hạ cả hai khi một bên chết. Nếu để tunnel sống mà server chết
thì tên miền vẫn phân giải được và khách nhận 502 của Cloudflare — trông như app
hỏng chứ không phải app đang tắt.

Dựng lại từ đầu trên máy khác:

1. `cloudflared tunnel login` — **người dùng tự bấm Authorize**, chọn tên miền.
2. `cloudflared tunnel create eduvault` → sinh file credentials `<UUID>.json`.
3. Viết `web/tools/tunnel-config.yml` (tunnel UUID, credentials-file, ingress trỏ
   `http://localhost:5174`).
4. `cloudflared tunnel route dns eduvault <tên-miền>` → tạo bản ghi CNAME.
5. `npm run publish:web`.

Giới hạn còn lại của cách này: **máy tắt là web tắt**. Muốn sống 24/7 thì chạy
`npm run beta` trên VPS Linux (đặt `EDUVAULT_DATA_DIR`, `PORT`, key qua biến môi
trường chứ không phải file `.env`; `NODE_ENV=production` để cookie có cờ `Secure`;
cài `poppler-utils` và TeX Live) rồi trỏ tunnel về đó.
