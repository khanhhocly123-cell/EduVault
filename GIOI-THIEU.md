# EduVault — giới thiệu và đánh giá ý tưởng

*Viết ngày 12/08/2026. Đây không phải tờ rơi quảng cáo — nó viết để trả lời câu
hỏi "có nên bỏ thêm thời gian vào cái này không". Chỗ nào là số đo thật thì ghi
rõ đo thế nào; chỗ nào là phỏng đoán thì ghi rõ là phỏng đoán.*

---

## 1. Một câu

Giáo viên phổ thông chụp ảnh trang đề, EduVault trả về file Word có công thức
**click vào sửa được** — không phải ảnh chụp dán vào.

---

## 2. Vấn đề, và bằng chứng nó có thật

Giáo viên Việt Nam ra đề bằng cách: mở mấy file Word cũ, mấy ảnh chụp trong
điện thoại, mấy bản PDF tải trên mạng — rồi **gõ lại** hoặc **chụp màn hình dán
vào**. Công thức gõ lại bằng MathType hoặc Equation mất vài phút một câu; ảnh
dán vào thì không sửa được, in ra mờ, và không tìm lại được bằng từ khoá.

**Đã kiểm:** đề THPT lưu hành trên mạng gần như **toàn ảnh và PDF scan, không
có bản text**. Không scrape được. Muốn số hoá bắt buộc phải OCR. Đây là lý do
kho câu hỏi cá nhân của giáo viên không tự lớn lên được.

**Chưa kiểm:** có bao nhiêu giáo viên thấy đây là vấn đề **đủ đau để trả tiền**.
Đây là câu hỏi lớn nhất còn bỏ ngỏ, xem mục 8.

---

## 3. Sản phẩm làm gì

```
Ảnh / PDF / Word  →  AI đọc  →  Giáo viên duyệt  →  Kho riêng  →  Ráp đề  →  .docx
```

Năm màn hình:

| Màn | Việc |
|---|---|
| **Trang chính** | kho có gì, còn việc gì phải làm, dùng hết bao nhiêu |
| **Kho câu hỏi** | lọc theo dạng câu / độ khó / chuyên đề / nguồn, xem và sửa từng câu |
| **Duyệt** | ảnh gốc bên trái, AI đọc ra bên phải — câu nào cũng qua mắt người |
| **Ráp đề** | xếp phần, trang bìa, khối chữ tự do, lề, logo, watermark |
| **Tài liệu** | thả file, chọn mức đọc, xem hết bao nhiêu lượt quét |

Xuất ra ba file Word: **đề · đáp án · lời giải**, cộng ma trận đặc tả.

**Định vị:** không đụng khâu giao đề và chấm điểm. Chỉ làm khâu **soạn đề**.

---

## 4. Thứ đã chạy thật, và thứ chưa

Đây là mục quan trọng nhất để đánh giá. Đừng nhìn ảnh chụp màn hình mà tưởng
sản phẩm xong.

### Đã chạy thật, đo được, chạy lại được

**OCR + phân loại** — `npm run extract`, đo ngày 12/08/2026 trên một trang đề
Vật lí giả lập ảnh chụp điện thoại (xoay 1,2°, hạ tương phản, nén JPEG). Trang
có 4 câu: 2 trắc nghiệm (1 câu kèm hình mạch điện), 1 đúng/sai 4 ý, 1 trả lời ngắn.

| Model | Thời gian | Token vào/ra | Kết quả |
|---|---|---|---|
| gemini-3.5-flash-lite | 5,1s | 1.496 / 1.188 | 4/4 đúng |
| gemini-3.5-flash | 8,9s | 1.496 / 1.108 | 4/4 đúng |
| gemini-3.6-flash | 11,5s | 1.496 / 793 | 4/4 đúng |

Cả ba: bắt đúng câu có hình *và chỉ câu đó*, dấu thập phân `$1{,}0$` đúng kiểu
Việt Nam, tự suy đúng/sai 4 ý đúng vật lí.

**Xuất Word có công thức sửa được** — `node web/docx-test.mjs`, kết quả
`PASS — 26 công thức là equation sửa được · ZIP hợp lệ`. Kiểm bằng cách dựng
file thật, giải nén bằng .NET ZipFile rồi đếm thẻ `<m:oMath>`. Đủ sáu cấu trúc:
phân số, căn, chỉ số trên, chỉ số đứng trước (`²³⁵₉₂U`), tích phân có cận, vector.

### Chưa có — vẫn là bản dựng thử

- **Không có máy chủ.** Toàn bộ `web/` chạy bằng dữ liệu giả trong `data.js`.
  Tải lại trang là mất sạch.
- **Không có tài khoản thật.** Màn đăng nhập gõ email nào cũng vào.
- **Không có thanh toán.**
- **Chưa nối OCR vào app.** Đường ống chạy được ở CLI; trong app là giả lập.
- **Chưa ai ngoài tác giả dùng thử.** Không có một giáo viên thật nào.

### Chưa đo

- Độ chính xác trên **scan thật** — mới thử đúng 1 trang tự dựng, chữ in sạch.
  Đề photo mờ, đề viết tay, đề có bảng biểu chưa thử lần nào.
- Bộ eval 20 trang có đáp án gõ tay: **chưa làm**.

---

## 5. Điểm khác biệt kỹ thuật — và tại sao nó chưa phải moat

**Khác biệt thật:** file Word xuất ra chứa `<m:oMath>` — equation gốc của Word.
Mở lên click vào là sửa được. Phần lớn công cụ cùng loại trả về ảnh công thức
hoặc LaTeX thô, hai thứ giáo viên không dùng được trực tiếp.

Cộng thêm vài thứ nhỏ nhưng đúng thói quen Việt Nam:

- Dấu thập phân `0,5` chứ không phải `0.5` (model quen tài liệu tiếng Anh sẽ tự đổi)
- Độ khó **NB / TH / VD / VDC**, không phải thang 1–5
- Đúng cấu trúc thi 2025: 18 trắc nghiệm + 4 đúng/sai + 6 trả lời ngắn
- Câu đúng/sai chấm theo từng ý, mỗi ý một lời giải riêng
- Lề tính bằng **cm** cho khớp hộp Page Setup của Word

**Nhưng đây là feature, không phải moat.** Nói thẳng:

- OMML là chuẩn mở, có tài liệu công khai. Ai cũng dựng được. Tao dựng xong
  trong một buổi.
- Prompt OCR sao chép được trong một giờ nếu nhìn thấy output.
- Model là của Google/OpenAI, ai cũng gọi được, giá như nhau.

Thứ **có thể** thành moat là **kho riêng tích luỹ theo năm** của từng giáo viên
— dùng càng lâu càng khó bỏ đi. Nhưng ngay cả nó cũng yếu: dữ liệu là text, xuất
ra được, không khoá chân ai lâu.

**Kết luận thẳng: đây là sản phẩm thắng bằng thực thi và phân phối, không thắng
bằng công nghệ.**

---

## 6. Cạnh tranh

> **Cảnh báo:** phần này tao viết từ thông tin trong `PLAN.md` và hiểu biết chung
> tính đến giữa 2026. **Chưa tự kiểm lại từng đối thủ.** Trước khi quyết định
> đầu tư, mày phải mở từng cái ra dùng thử và ghi lại giá thật. Đừng tin bảng
> dưới đây như số liệu.

### Nhóm 1 — Không làm gì cả (đối thủ mạnh nhất)

Giáo viên tiếp tục gõ tay bằng Word + MathType, hoặc chụp màn hình dán vào.
**Miễn phí, quen tay, không phải học gì.**

Đây gần như luôn là đối thủ khó nhất của mọi công cụ năng suất. Muốn thắng thì
sản phẩm không được "tốt hơn một chút" — phải tiết kiệm đủ nhiều thời gian để
người ta chịu đổi thói quen.

### Nhóm 2 — Nền tảng giao đề và chấm (Azota, Shub…)

Mạnh ở khâu **giao bài, thu bài, chấm, thống kê**. Đã có sẵn tệp người dùng lớn
và quan hệ với nhà trường.

- **Rủi ro:** họ **thừa sức** thêm khâu soạn đề. Có người dùng rồi, thêm tính
  năng dễ hơn nhiều so với việc mình đi kiếm người dùng từ đầu.
- **Cơ hội:** khâu soạn đề không phải trọng tâm của họ; kho câu hỏi cá nhân,
  xuất Word đúng chuẩn, ma trận đặc tả là việc tỉ mỉ và ít hào nhoáng.

**Phải kiểm ngay:** Azota/Shub hiện đã có nhập đề bằng ảnh chưa? Xuất Word có
công thức sửa được chưa? Nếu **có rồi** thì phần lớn lý do tồn tại của EduVault
biến mất.

### Nhóm 3 — Kho đề bán sẵn và trang tài liệu

Bán/phát "bộ đề" file Word, tài liệu ôn thi.

- Họ bán **nội dung**. EduVault bán **công cụ xử lý nội dung của chính giáo viên**.
- Người mua bộ đề sẵn thường không phải người muốn tự soạn — hai tệp khách khác nhau.
- Nhưng ranh giới mờ: giáo viên mua được bộ đề vừa ý thì khỏi cần soạn.

### Nhóm 4 — Công cụ AI đa dụng

ChatGPT/Gemini/Claude bản web. Giáo viên chụp ảnh, bảo "gõ lại đề này ra Word".

- **Được:** miễn phí hoặc rẻ, không phải đăng ký thêm dịch vụ nào.
- **Không được:** không ra file Word có equation sửa được, không có kho lưu, không
  tìm lại được câu cũ, không ráp đề đúng cấu trúc, không có ma trận đặc tả,
  và **không ai soát lỗi số liệu**.

Đây là đối thủ tăng nhanh nhất. Khoảng cách EduVault đang có sẽ hẹp lại theo
từng đợt model mới.

### Nhóm 5 — Công cụ OCR công thức chuyên dụng

Kiểu Mathpix và tương tự: ảnh → LaTeX, rất tốt.

- Họ dừng ở **một công thức / một trang**. Không có khái niệm "câu hỏi", "độ khó",
  "chuyên đề", "cấu trúc đề thi Việt Nam".
- Giá thường tính bằng USD, trả bằng thẻ quốc tế — rào cản thật với giáo viên VN.

---

## 7. Kinh tế đơn vị

### Giá vốn — đo thật

Một trang đề tốn **~2.600 token vào + ~1.600 token ra** (đo trên bản chạy thật,
đã tính cả prompt hệ thống).

Quy ra tiền, dùng **GPT-5.6 Luna làm mốc thận trọng** (giá công bố $0,20 vào /
$1,20 ra mỗi triệu token):

```
2.600 × $0,20/1M  +  1.600 × $1,20/1M  =  $0,0024  ≈  63đ / trang
```

> Hiện đang chạy trên **hạn mức miễn phí của Google** nên thực tế là 0đ. Giá trả
> phí của các model Gemini đời mới **tao không biết** — phải tự tra rồi điền vào
> `phase0/src/providers.ts`. Con số 63đ ở trên là mốc thay thế, gần như chắc chắn
> **cao hơn** giá thật của Gemini Flash.

### Gói dịch vụ

| | Lite | Plus | Pro |
|---|---|---|---|
| Giá | 0đ | 99.000đ/tháng | 199.000đ/tháng |
| Lượt quét/tháng | 40 | 400 | 1.500 |
| Kho lưu | 100 TN · 50 ĐS · 50 TLN | 2.000 · 800 · 800 | không giới hạn |
| Mức đọc | Nhanh | + Chuẩn | + Kĩ |

**Giá vốn tối đa** (giả định dùng cạn hạn mức, giá 63đ/trang):

| Gói | Doanh thu | Giá vốn tối đa | Biên |
|---|---|---|---|
| Lite | 0đ | ~2.500đ | lỗ, chấp nhận |
| Plus | 99.000đ | ~25.200đ | **~75%** |
| Pro | 199.000đ | ~94.500đ | ~53% |

**Điểm thiết kế đáng giá:** đơn vị bán là **lượt quét**, và mức đọc nặng trừ
nhiều lượt hơn (Nhanh 1 · Chuẩn 2 · Kĩ 4). Nghĩa là **giá vốn bị chặn trên bởi
số lượt**, không phụ thuộc người dùng chọn model nào. Không có cửa cho một
người dùng làm cháy biên lợi nhuận.

Thực tế phần lớn người dùng sẽ không dùng cạn, nên biên thật cao hơn bảng trên.

### Chỗ tiền đi mà chưa tính

Máy chủ, lưu trữ, tên miền, thanh toán (cổng VN ăn 1–3%), hỗ trợ khách hàng,
và **thời gian của mày**. Với vài trăm người dùng đầu, tiền hạ tầng là số nhỏ;
thời gian mới là chi phí thật.

---

## 8. Rủi ro thật, xếp theo mức nguy

1. **Không ai chịu trả tiền.** 99.000đ/tháng là con số thật với giáo viên phổ
   thông Việt Nam. Nhiều người sẽ dùng gói Lite mãi mãi. Chưa kiểm chứng gì.
2. **Azota hoặc Shub làm luôn khâu này.** Họ có người dùng, mình có code. Người
   dùng khó kiếm hơn code.
3. **Model đa dụng ăn dần khoảng cách.** Mỗi đợt ChatGPT/Gemini mạnh lên là lý
   do tồn tại của mình hẹp lại một chút.
4. **Sai số liệu.** Một câu OCR nhầm `0,05` thành `0,5` mà lọt qua vòng duyệt là
   cả lớp làm sai. Một lần như thế đủ mất một giáo viên vĩnh viễn. Màn Duyệt
   sinh ra để chặn, nhưng nó phụ thuộc người dùng chịu đọc.
5. **Bản quyền tài liệu nguồn.** Giáo viên nạp đề của người khác vào. Kho để
   riêng tư tuyệt đối là để né chuyện này — đừng bao giờ mở marketplace mà chưa
   giải quyết xong.
6. **Phân phối.** Không có kênh sẵn. Nhóm Facebook giáo viên, tổ bộ môn, truyền
   miệng — đều chậm và khó đo.

---

## 9. Việc phải làm trước khi bỏ thêm tiền vào

Xếp theo thứ tự. **Đừng viết thêm dòng code nào cho tới khi xong mục 1 và 2.**

1. **Mở Azota và Shub ra dùng thử.** Ghi lại: có nhập đề bằng ảnh không, xuất
   Word thế nào, giá bao nhiêu. *Nửa ngày.* Nếu họ đã làm rồi thì dừng lại nghĩ lại.

2. **Đưa cho 5 giáo viên thật.** Không cần app hoàn chỉnh — cầm điện thoại chụp
   3 trang đề của họ, chạy `npm run extract`, đưa file Word ra và hỏi:
   *"Cái này có tiết kiệm cho thầy cô bao nhiêu thời gian?"* và
   *"99.000đ một tháng thì thầy cô có trả không?"*
   *Một tuần.* Đây là thứ rẻ nhất và trả lời được nhiều nhất.

3. **Bộ eval 20 trang scan thật.** Đo tỉ lệ đọc đúng trên đề photo mờ, không
   phải trên trang tự dựng. *Hai ngày.* Nếu tỉ lệ đúng dưới ~90% thì màn Duyệt
   trở thành gánh nặng chứ không phải lưới an toàn.

4. **Tra giá Gemini trả phí thật**, điền vào `providers.ts`. *Một giờ.* Không có
   số này thì mọi tính toán biên lợi nhuận ở mục 7 đều là phỏng đoán.

5. Chỉ khi cả bốn mục trên cho tín hiệu tốt — mới bắt đầu Phase 1
   (máy chủ, tài khoản, thanh toán).

---

## 10. Đánh giá thẳng

**Điểm mạnh thật:** khâu khó nhất về kỹ thuật đã xong và đo được — OCR đọc đúng,
file Word có equation sửa được. Đây không phải slide, chạy được thật. Kinh tế
đơn vị lành mạnh nhờ thiết kế lượt quét chặn trần giá vốn. Sản phẩm hiểu đúng
thói quen Việt Nam ở mức chi tiết mà đối thủ nước ngoài không có.

**Điểm yếu thật:** không có moat công nghệ. Không có người dùng. Không có kênh
phân phối. Chưa có một đồng doanh thu nào được kiểm chứng. Và đối thủ nguy hiểm
nhất — Azota/Shub — có sẵn thứ mình thiếu nhất.

**Nói gọn:** ý tưởng đúng, thực thi kỹ thuật tốt, nhưng **chưa có bằng chứng nào
về nhu cầu trả tiền**. Rủi ro lớn nhất không nằm ở chỗ làm được hay không —
làm được rồi. Nó nằm ở chỗ **có ai cần đủ để trả tiền không**.

Chi phí để trả lời câu hỏi đó là **một tuần và năm cuộc nói chuyện**. Rẻ hơn
nhiều so với xây tiếp Phase 1 rồi mới hỏi.

---

*Chi tiết kỹ thuật: [HANDOFF.md](HANDOFF.md) · Kiến trúc: [PLAN.md](PLAN.md) ·
Pipeline AI: [docs/ai-pipeline.md](docs/ai-pipeline.md)*
