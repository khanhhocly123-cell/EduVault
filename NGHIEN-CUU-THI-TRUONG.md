# Nghiên cứu thị trường — công cụ soạn tài liệu cho giáo viên & gia sư

*Thực hiện 13/08/2026. Mọi phát hiện đều kèm nguồn. Chỗ nào chưa kiểm được thì ghi
rõ là chưa kiểm — đừng đọc file này như số liệu đã xác nhận.*

---

## 0. Ba kết luận đáng chú ý nhất

1. **Azota đã có OCR số hóa đề từ PDF/ảnh.** Không phải "có thể họ sẽ làm" — đã
   có, đã tính giá (5 trang ảnh = 1 Point, VIP miễn phí 100 trang/tháng). Câu hỏi
   lớn nhất trong `GIOI-THIEU.md` mục 9.1 giờ đã có câu trả lời, và câu trả lời
   là **bất lợi**.
2. **Mathpix đã xuất Word có equation sửa được, và hỗ trợ tiếng Việt.** Điểm khác
   biệt kỹ thuật số một của EduVault (OMML editable) không còn là độc quyền.
3. **Đã có ít nhất một đối thủ Việt Nam làm gần đúng mô hình EduVault** — i-quiz.vn:
   OCR ảnh → đề, "chuyển ảnh đề thi sang Word", ngân hàng câu hỏi, bán theo lượt
   (points). **Nhưng sau nhiều năm họ mới có ~6.400 thành viên và ~3.300 đề.** Đây
   vừa là tin xấu (ý tưởng không mới) vừa là tin tốt (chưa ai thắng).

---

## 1. Azota — đối thủ nguy hiểm nhất, và họ đã đi trước

### Đã kiểm chứng

Trang hướng dẫn chính thức của Azota liệt kê các cách tạo đề:

> "Tải lên file Word (.docx), PDF hoặc Excel — **Số hóa đề từ PDF/ảnh bằng OCR
> (cần sử dụng Point)** — Tạo đề từ Ngân hàng câu hỏi cá nhân — Tạo đề từ Kho đề
> chung do Azota cung cấp."

Azota hỗ trợ định dạng đầu vào **docx, pdf, ảnh, excel, và latex**.

**Giá OCR:** "Dịch vụ số hoá 5 trang ảnh trừ 1 Point." Tài khoản VIP được **miễn
phí 100 trang số hoá OCR mỗi tháng**, vượt quá thì tính theo số trang.

Azota tự công bố **hơn 300.000 giáo viên** đang dùng.

### Azota còn có nguyên một mảng "Số hóa ngân hàng câu hỏi"

Đọc cây tài liệu của họ, có đủ các mục:

- Tạo cấu trúc ngân hàng (thủ công và tự động)
- Tạo yêu cầu cần đạt trong ngân hàng
- Bổ sung / chỉnh sửa câu hỏi trong ngân hàng
- **Tạo ma trận đề từ ngân hàng câu hỏi**
- Sử dụng lại ma trận đã tạo
- Tự chọn câu hỏi để tạo đề

Đây gần như trùng khít với mô tả "Kho câu hỏi + Ráp đề + Ma trận đặc tả" của
EduVault.

### Chỗ Azota vẫn còn yếu — cơ hội thật nhưng hẹp

- Trong FAQ của họ có mục **"Lỗi bị mất hình công thức sau khi xuất bản đề"** —
  gợi ý rằng công thức trong Azota được xử lý dưới dạng **hình ảnh**, không phải
  equation native. Đây có thể vẫn là khe hở của EduVault, **nhưng cần kiểm tay**.
- Toàn bộ kiến trúc của Azota xoay quanh **giao bài – thi online – chấm – giám sát
  thi – phân quyền tổ chức – xuất Excel điểm**. Đó là sản phẩm hình dạng *trường
  học*.
- **Chưa kiểm được:** giá gói VIP cụ thể. Trang `azota.vn/bao-gia` render bằng
  JavaScript nên không đọc được bằng công cụ hiện có. **Việc cần làm: mở bằng
  trình duyệt và ghi lại giá thật.**

> **Đánh giá:** giả định trong `PLAN.md` rằng "khâu soạn đề không phải trọng tâm
> của họ" **không còn đúng**. Họ đã làm, có OCR, có ngân hàng, có ma trận, và có
> 300k giáo viên. Khe hở còn lại hẹp hơn nhiều so với những gì `GIOI-THIEU.md`
> giả định.

---

## 2. i-quiz.vn — đối thủ trùng mô hình nhất, ít ai biết

Đây là phát hiện đáng chú ý nhất sau Azota. Sản phẩm của Công ty TNHH CTSOFT Việt
Nam (Hà Nội).

**Họ làm gần đúng thứ EduVault đang làm:**

| Tính năng | i-quiz | EduVault |
|---|---|---|
| OCR ảnh chụp đề → câu hỏi | ✅ 20–25 pts/ảnh | ✅ |
| Nhập từ Word/PDF | ✅ 25 pts/file | ✅ |
| **Chuyển ảnh đề thi sang Word** | ✅ có công cụ riêng | ✅ |
| Ngân hàng câu hỏi cá nhân | ✅ | ✅ |
| Bán theo lượt (points) | ✅ | ✅ (lượt quét) |
| Trợ lý AI sửa đề bằng tiếng Việt | ✅ | ❌ |
| Giáo viên rà từng câu sau OCR | ✅ | ✅ |

Thậm chí **thông điệp marketing của họ gần như trùng** với `GIOI-THIEU.md`:

> "Giáo viên đang mất nhiều giờ chỉ để nhập lại đề đã có sẵn… Đề có nhiều công
> thức, ký hiệu — sửa tay từng cái rất tốn thời gian."

Và họ cũng chọn đúng cách định vị mà tôi từng gợi ý:

> "Nhiều nền tảng hướng đến 'tự động sinh đề mới'; i-quiz ưu tiên nhu cầu phổ biến
> hơn — giáo viên **đã có đề sẵn** và muốn đưa lên online nhanh."

**Nhưng quy mô rất nhỏ:** trang chủ tự công bố **3.345 đề thi** và **6.428 thành
viên**. Nội dung trên site có từ 2020 — tức là sau khoảng 5–6 năm.

> **Đánh giá — đây là dữ liệu quan trọng nhất trong cả báo cáo:** một đội có công
> ty, có app iOS/Android, có SEO tốt, làm đúng mô hình này, và sau nhiều năm vẫn
> chỉ có ~6.400 người dùng. Điều đó nói lên một trong hai chuyện: (a) nhu cầu
> nhỏ hơn ta tưởng, hoặc (b) họ thực thi/phân phối kém. **Phải biết là (a) hay
> (b) trước khi đầu tư tiếp.** Cách rẻ nhất để biết: dùng thử i-quiz và xem sản
> phẩm dở đến mức nào.

---

## 3. Các đối thủ Việt Nam khác

### SHub Classroom

LMS, giao bài, thi online, ngân hàng câu hỏi theo môn/khối, có cơ chế **xuất bản
ngân hàng câu hỏi lên trường** để nhà trường duyệt và dùng cho kỳ thi cấp trường.

Hình dạng cũng là *trường học*, giống Azota. Nhấn mạnh quản lý lớp, giao bài, chấm.

### 789.vn

Ngân hàng trắc nghiệm quy mô lớn (tự công bố ~100.000 đề). Đáng chú ý: hệ thống
"giúp giáo viên tạo ngân hàng đề cá nhân nhanh chóng, truy xuất, in, **xuất đề ra
file Word theo ma trận mong muốn**, chấm tự động dù thi online hay trên giấy."

→ Xuất Word theo ma trận **không phải tính năng độc quyền**.

### Đề Thi Số (dethiso.vn)

**Miễn phí 100% cho giáo viên Việt Nam.** Có: upload Word tạo đề, AI tạo câu hỏi
tự đưa vào ngân hàng, AI phân loại NB/TH/VD/VDC, AI sinh giải thích đáp án, AI
review đề tìm câu sai/hai đáp án đúng, **chấm tự động chuẩn BGD 2025 có partial
credit cho Phần II (đúng/sai)**.

→ Đây là đối thủ "miễn phí" nguy hiểm cho gói Plus 99.000đ.

### McMIX — đối thủ bị đánh giá thấp nhất

Phần mềm trộn đề trắc nghiệm desktop, **miễn phí hoàn toàn, không giới hạn thời
gian, không giới hạn số môn / số đề / số câu hỏi**. Soạn tự nhiên trên Word rồi
copy-paste vào, làm việc với mọi font tiếng Việt, in ra file Word nhanh.

→ Đã ăn sâu trong các trường phổ thông VN nhiều năm. Đây chính là hiện thân của
"Nhóm 1 — Không làm gì cả" mà `GIOI-THIEU.md` nhận là đối thủ mạnh nhất.

### ex_test / ex_test_rd (LaTeX) — đối thủ của định vị "siêu tùy biến"

Gói LaTeX của tác giả Trần Anh Tuấn, miễn phí, cộng đồng giáo viên Toán/Lý VN dùng
nhiều. Làm được: đề chuẩn mẫu THPT Quốc Gia, **trộn câu và trộn phương án sinh
nhiều mã đề**, trộn từ thư viện đề có sẵn với câu rút ngẫu nhiên, **trộn theo nhóm
/ theo block**, xuất đáp án tóm tắt và chi tiết, **xuất đáp án ra Excel để chấm máy**.

> **Đây là điều Khánh cần đọc kỹ nhất.** Định vị "tùy biến siêu tự do" mà Khánh
> muốn theo đuổi — **ex_test đã làm rồi, miễn phí, và tự do hơn EduVault rất
> nhiều** (vì là LaTeX, muốn gì cũng được). Nhóm câu, block, rút ngẫu nhiên theo
> nhóm — những thứ `PLAN.md` liệt kê là điểm khác biệt — ex_test có đủ.
>
> Thứ ex_test **không** có: dễ dùng. Phải biết LaTeX. Đó mới là khe hở thật.

---

## 4. Quốc tế

### Mathpix — đe dọa trực tiếp điểm khác biệt số 1

- **Có sẵn:** Equation → Word (MathML), Image → Word, **PDF → DOCX**, PDF → LaTeX,
  PDF → Overleaf, table OCR, nhận diện chữ viết tay.
- **Hỗ trợ tiếng Việt** cho OCR (nằm trong danh sách ngôn ngữ chính thức).
- **Giá:** miễn phí 20 trang PDF/tháng; Snip Pro **$4.99/tháng**; Convert API từ
  **$0,002/ảnh**.

> **Đánh giá:** câu trong `GIOI-THIEU.md` — *"Phần lớn công cụ cùng loại trả về ảnh
> công thức hoặc LaTeX thô"* — **không còn chính xác với Mathpix**. Họ xuất DOCX
> có equation. Và $4,99/tháng rẻ hơn gói Plus 99.000đ (~$3,9 — thực ra ngang nhau).
>
> Khe hở còn lại vẫn đúng: Mathpix **không có khái niệm "câu hỏi"** — không có độ
> khó, chuyên đề, nhóm câu, ma trận đặc tả, cấu trúc đề thi VN. Nó là công cụ
> chuyển đổi tài liệu, không phải công cụ soạn đề. Cộng thêm rào cản thanh toán
> quốc tế.

### Công cụ AI cho giáo viên (Mỹ/EU)

MagicSchool (80+ công cụ, xuất Google Docs một chạm), Diffit (phân hóa theo 70+
ngôn ngữ), Eduaide, QuestionWell, ClassPoint AI.

**Mốc giá tham chiếu:** phần lớn công cụ cho giáo viên cá nhân nằm trong khoảng
**miễn phí → $5–15/tháng**. Đa số có free tier (MagicSchool ~3–5 output/ngày).

→ Giá 99.000đ (~$3,9) và 199.000đ (~$7,8) của EduVault **hợp lý theo chuẩn quốc
tế**, nhưng đó không phải chuẩn để so — chuẩn đúng là sức chi của giáo viên VN,
và ở đây họ đang so với **McMIX miễn phí và dethiso.vn miễn phí**.

---

## 5. Bối cảnh thị trường — điểm sáng thật sự

**Thông tư 29/2024/TT-BGDĐT**, hiệu lực từ **14/02/2025**, siết dạy thêm trong nhà
trường. Hệ quả đo được:

- Số trung tâm và hộ kinh doanh dạy thêm **tăng mạnh**, có thời điểm lên tới
  khoảng **15.000 cơ sở**; riêng Hà Nội khoảng 15.000 trung tâm và hộ kinh doanh.
- Học sinh dịch chuyển từ học thêm trong trường ra trung tâm ngoài trường.

> **Đây là lập luận mạnh nhất cho định vị "gia sư / trung tâm" thay vì "trường
> học".** Một lớp người dạy độc lập, chính danh, có đăng ký kinh doanh, đang hình
> thành nhanh từ 2025 — và họ **không** được Azota/SHub phục vụ tốt, vì hai nền
> tảng đó xây quanh mô hình lớp – trường – tổ bộ môn – phân quyền.
>
> Một hộ kinh doanh dạy thêm cần: kho đề riêng, in ra giấy, thương hiệu riêng
> (logo, watermark), nhiều nhóm học sinh nhỏ khác trình độ. Không cần giám sát
> thi, không cần xuất Excel điểm cho ban giám hiệu.

---

## 6. Bảng tổng hợp

| | OCR ảnh→câu hỏi | Kho câu hỏi cá nhân | Xuất Word | Equation sửa được | Ráp đề theo ma trận | Giá |
|---|---|---|---|---|---|---|
| **Azota** | ✅ (Point) | ✅ | ✅ | ❓ nghi là ảnh | ✅ | VIP + Point (chưa rõ) |
| **SHub** | ❓ | ✅ | ❓ | ❓ | ✅ | chưa rõ |
| **789.vn** | ❓ | ✅ | ✅ theo ma trận | ❓ | ✅ | chưa rõ |
| **Đề Thi Số** | ❓ | ✅ | ✅ (upload Word) | ❓ | ✅ | **miễn phí** |
| **i-quiz.vn** | ✅ 20–25pts | ✅ | ✅ | ❓ | ❌ | points |
| **McMIX** | ❌ | ✅ | ✅ | ✅ (Word gốc) | trộn đề | **miễn phí** |
| **ex_test (LaTeX)** | ❌ | ✅ | ❌ (ra PDF) | ✅ (LaTeX) | ✅ rất mạnh | **miễn phí** |
| **Mathpix** | ✅ | ❌ | ✅ | ✅ MathML | ❌ | $4,99/th |
| **EduVault** | ✅ | ✅ | ✅ | ✅ OMML | ✅ | 99k/199k |

Ô ❓ = chưa kiểm chứng được bằng nguồn công khai, **phải tự mở ra dùng thử**.

---

## 7. Điều này thay đổi gì cho EduVault

### Ba giả định trong tài liệu cũ đã sai

1. ~~"Azota chưa chắc có nhập đề bằng ảnh"~~ → **Có rồi**, có giá, có free tier VIP.
2. ~~"Phần lớn công cụ cùng loại trả về ảnh công thức hoặc LaTeX thô"~~ → **Mathpix
   xuất DOCX equation, hỗ trợ tiếng Việt, $4,99.**
3. ~~"Câu hỏi nhóm, rút ngẫu nhiên theo nhóm là điểm khác biệt"~~ → **ex_test làm
   được từ lâu, miễn phí.**

### Điều còn đứng vững

- **Không ai làm cho gia sư / trung tâm dạy thêm.** Azota, SHub, 789 đều hình dạng
  trường học. Mathpix không biết "câu hỏi" là gì. i-quiz hướng ra đề online, không
  ra giấy. ex_test đòi biết LaTeX.
- **Thị trường segment này vừa được Thông tư 29 tạo ra và đang phình.**
- **Trục "tự do như LaTeX, dễ như Canva" là khoảng trống thật.** ex_test chứng
  minh nhu cầu tùy biến sâu có tồn tại; việc nó chỉ dùng được bởi người biết LaTeX
  chứng minh cái giá của tự do hiện đang quá cao.

### Định vị tôi đề xuất sau khi nghiên cứu

> **"Công cụ soạn và in đề cho người dạy thêm — mạnh như LaTeX, dễ như điền form."**

Không phải "customization siêu tự do" (ex_test đã tự do hơn và miễn phí). Không
phải "OCR ảnh ra Word" (Azota, i-quiz, Mathpix đều có). Mà là **giao điểm**: sức
mạnh tùy biến của ex_test, độ dễ của một web app, cho một tệp khách hàng mà không
nền tảng lớn nào đang nhắm.

---

## 8. Việc phải làm tiếp, xếp theo giá trị trên mỗi giờ bỏ ra

| # | Việc | Thời gian | Trả lời câu hỏi gì |
|---|---|---|---|
| 1 | **Dùng thử i-quiz.vn** — nạp 30 pts miễn phí, OCR 3 trang đề Lý, tải Word về | 1 giờ | Đối thủ trùng mô hình dở đến mức nào? Vì sao họ chỉ có 6.4k user? |
| 2 | **Dùng thử OCR của Azota** (VIP có 100 trang/tháng free) | 1 giờ | Chất lượng OCR của họ? Công thức ra ảnh hay equation? |
| 3 | **Mở azota.vn/bao-gia bằng trình duyệt**, ghi giá VIP thật | 15 phút | Mốc giá thị trường thật |
| 4 | **Hỏi 5 người dạy thêm** — không hỏi "có muốn tùy biến không", hỏi "lần gần nhất soạn đề, chỗ nào bực nhất" | 1 tuần | Nhu cầu có thật không, và là nhu cầu gì |
| 5 | **Dùng thử Mathpix free tier** (20 trang/tháng) trên đề Lý tiếng Việt | 30 phút | Khoảng cách chất lượng OCR thật sự |
| 6 | Bộ eval 20 trang scan thật | 2 ngày | OCR có đủ tốt không |
| 7 | Sửa test đang fail (`tự bám các dòng Câu lặp lại`) | ? | Highlight sai vùng phá trải nghiệm |

**Ba việc đầu tốn chưa tới 3 giờ và có thể thay đổi hoàn toàn quyết định đầu tư.**

---

## 9. Đánh giá thẳng

Nghiên cứu này làm xấu đi bức tranh so với `GIOI-THIEU.md`, ở ba điểm:

1. Khe hở kỹ thuật **hẹp hơn** đã tưởng — Azota có OCR, Mathpix có equation Word.
2. Đã có người làm đúng mô hình này ở VN (i-quiz) và **họ không lớn được**.
3. Hai đối thủ mạnh nhất ở phân khúc "người soạn đề nghiêm túc" — McMIX và ex_test
   — đều **miễn phí**, và đã dùng nhiều năm.

Nhưng nó cũng làm rõ một cơ hội mà tài liệu cũ chưa nhìn thấy:

**Thông tư 29 vừa tạo ra ~15.000 cơ sở dạy thêm chính danh chỉ riêng Hà Nội, và
không có nền tảng nào được thiết kế cho họ.** Đó là một segment mới, đang phình,
và bị bỏ trống — mạnh hơn nhiều so với lý lẽ "app của tôi tùy biến hơn Azota".

Câu hỏi sống còn vẫn không đổi, chỉ sắc hơn: **không phải "làm được không" mà là
"vì sao i-quiz làm được mà vẫn chỉ có 6.400 người dùng, và mình khác gì họ".**

Trả lời được câu đó thì đáng làm tiếp. Chưa trả lời được thì mọi dòng code thêm
vào đều là đặt cược mù.

---

## Nguồn

- [TẠO ĐỀ THI — Hướng dẫn sử dụng Azota](https://docs.azota.vn/docs/huong-dan-su-dung/de-thi/)
- [Giới thiệu và hướng dẫn nạp Point — Azota](https://docs.azota.vn/docs/huong-dan-su-dung/goi-vip-point/gioi-thieu-va-huong-dan-nap-point/)
- [Tạo đề kiểm tra trắc nghiệm — Azota](https://docs.azota.vn/docs/huong-dan-su-dung/cau-hoi-thuong-gap/tao-de-kiem-tra-trac-nghiem/)
- [AZOTA.VN — trang chủ](https://azota.vn/)
- [i-quiz.vn — Tạo đề thi online từ Word, PDF, ảnh chụp](https://i-quiz.vn/)
- [Chuyển ảnh đề thi sang Word — i-quiz](https://i-quiz.vn/chuyen-anh-de-thi-sang-word)
- [Đề Thi Số — 5 cách ứng dụng AI trong soạn đề thi 2026](https://dethiso.vn/blog/5-cach-ung-dung-ai-trong-soan-de-thi)
- [SHub Classroom](https://shub.edu.vn/)
- [789.vn — Ngân hàng câu hỏi và đề thi trắc nghiệm online](https://www.789.vn/tin-tuc/tuyen-sinh-10/ngan-hang-cau-hoi-va-de-thi-trac-nghiem-online-tu-truong-hoc-thong-minh-789-vn-393)
- [McMIX — Phần mềm trộn đề thi trắc nghiệm](https://download.com.vn/mcmix-54298)
- [Hướng dẫn sử dụng gói ex_test và ex_test_rd](https://www.studocu.vn/vn/document/truong-dai-hoc-kinh-te-tai-chinh-thanh-pho-ho-chi-minh/sinh-hoat-cong-dan/ex-test-doc-abc/51786833)
- [Mathpix — Equation to Word](https://mathpix.com/equation-to-word)
- [Mathpix Snip Pricing](https://mathpix.com/pricing/snip)
- [Mathpix — Supported Languages](https://mathpix.com/language-support)
- [Best AI Worksheet Generators for Teachers 2026](https://blog.aieducator.tools/posts/best-ai-worksheet-generators-for-teachers-2026)
- [Trung tâm dạy thêm, học thêm nở rộ, học phí tăng vọt — VOV](https://vov.vn/xa-hoi/trung-tam-day-them-hoc-them-no-ro-hoc-phi-tang-vot-post1188174.vov)
- [Tổng hợp 10 điểm mới của Thông tư 29 — Giáo dục Việt Nam](https://giaoduc.net.vn/tong-hop-10-diem-moi-cua-thong-tu-29-quy-dinh-ve-day-them-hoc-them-post248291.gd)
