/* Dữ liệu mẫu và hằng số. Tách riêng để sửa nội dung không phải đụng vào logic.
 *
 * Về bộ câu hỏi: soạn theo đúng cấu trúc và mức độ đề tốt nghiệp THPT 2025
 * (Lý: 18 TN + 4 ĐS + 6 TLN, 50 phút · Toán: 12 TN + 4 ĐS + 6 TLN, 90 phút).
 * Đây là câu PHỎNG THEO, không phải bản sao đề gốc — đề thật trên mạng chỉ có
 * dạng ảnh và PDF scan, muốn nạp phải chạy qua đường ống OCR ở phase0/.
 */

export const SUBJECTS = { physics:"Vật lí", math:"Toán" };

/* Khoá bắt đầu bằng p = Vật lí, m = Toán. Suy ra môn từ khoá, khỏi lặp dữ liệu.
 *
 * BẢNG NÀY PHẢI KHỚP TỪNG MÃ với `phase0/src/topics.ts` — đó là danh sách nhét
 * vào prompt cho model chọn. Hai bên từng lệch nhau: prompt có p10.momentum,
 * p10.circular, p10.solid, p11.current mà ở đây không có mã nào trong bốn cái
 * đó, nên câu model gán đúng mã lại rơi vào chuyên đề rỗng. Sửa bên nào thì
 * sửa cả bên kia.
 */
export const TOPICS = {
  "p10.kinematics":"Động học","p10.dynamics":"Động lực học","p10.energy":"Năng lượng",
  "p10.momentum":"Động lượng","p10.circular":"Chuyển động tròn",
  "p10.solid":"Biến dạng vật rắn",
  "p11.oscillation":"Dao động","p11.wave":"Sóng","p11.efield":"Điện trường",
  "p11.current":"Dòng điện, mạch điện",
  "p12.thermal":"Vật lí nhiệt","p12.gas":"Khí lí tưởng",
  "p12.magnetic":"Từ trường","p12.nuclear":"Hạt nhân",

  "m10.vector":"Vectơ","m10.set":"Mệnh đề, tập hợp",
  "m11.sequence":"Dãy số, cấp số","m11.space":"Quan hệ vuông góc",
  "m11.limit":"Giới hạn, hàm số liên tục",
  "m12.derivative":"Khảo sát hàm số","m12.integral":"Nguyên hàm, tích phân",
  "m12.oxyz":"Toạ độ Oxyz","m12.stats":"Thống kê","m12.prob":"Xác suất có điều kiện"
};

export const subjectOfTopic = (code) => code.startsWith("m") ? "math" : "physics";
export const topicsOf = (subject) =>
  Object.entries(TOPICS).filter(([k]) => subjectOfTopic(k) === subject);

export const TYPES  = { MC:"Trắc nghiệm", TF:"Đúng/Sai", SHORT:"Trả lời ngắn", ESSAY:"Tự luận" };

/* ═══════════════════════════ ĐƠN VỊ TÍNH ═══════════════════════════
 *
 * Trước đây app hiện thẳng tiền: "92đ mỗi trang", "27.600đ nếu dùng hết gói".
 * Bỏ. Giáo viên trả tiền gói theo tháng rồi, mỗi lần nạp tài liệu lại thấy
 * đồng hồ tiền nhảy thì chỉ tổ ngại bấm — mà app sống được là nhờ người ta
 * chịu nạp tài liệu vào.
 *
 * Đơn vị mới: LƯỢT QUÉT. Một trang tài liệu đọc ở mức thường = 1 lượt.
 * Số nguyên, không có dấu phẩy, không quy đổi ra tiền ở bất cứ màn nào.
 * Giá vốn thật vẫn tính ở phase0 (USD/VNĐ) — đó là việc của người bán,
 * không phải việc của giáo viên.
 */
export const UNIT = { one:"lượt quét", many:"lượt quét", short:"lượt" };

/* Mức đọc — đây mới là chỗ các gói khác nhau thật sự.
 * `cost` = số lượt trừ cho mỗi trang. `model` khớp tên trong phase0/src/providers.ts. */
export const OCR_TIERS = {
  nhanh: {
    name:"Nhanh", model:"gemini-3.5-flash-lite", cost:1,
    desc:"Đọc PDF số và ảnh chụp rõ nét. Nhanh nhất.",
    note:"Đo thật 12/08/2026: 5,1s mỗi trang."
  },
  chuan: {
    name:"Chuẩn", model:"gemini-3.5-flash", cost:2,
    desc:"Đọc được ảnh chụp hơi nghiêng, scan mờ vừa. Bắt hình vẽ tốt hơn.",
    note:"Đo thật 12/08/2026: 8,9s mỗi trang."
  },
  ki: {
    name:"Kĩ", model:"gemini-3.1-pro-preview", cost:4,
    desc:"Cho scan xấu, chữ viết tay, công thức chồng nhiều tầng.",
    note:"Chậm hơn nhưng chịu được trang khó."
  }
};

/* ĐÃ BỎ đối chiếu chéo bằng model thứ hai (12/08/2026).
 *
 * Nó nhân đôi chi phí mỗi trang để đổi lấy một thứ mà MÀN DUYỆT ĐÃ LÀM RỒI —
 * và màn duyệt thì miễn phí, lại còn chính xác hơn vì có mắt người nhìn ảnh gốc.
 *
 * Thay vào đó, cờ báo "câu này cần xem kĩ" lấy từ ba tín hiệu MIỄN PHÍ, có sẵn
 * trong đúng một lượt đọc:
 *   answerSource="solved"  model tự giải đáp án, đề gốc không in
 *   notes                  model tự khai chỗ nào nó đọc không chắc
 *   trùng kho              câu đã có sẵn, duyệt tiếp là kho có hai bản
 * Xem `flagsOf()` trong app.js.
 */

/* ═══════════════════════════ GÓI DỊCH VỤ ═══════════════════════════
 *
 * Khác biệt giữa các gói KHÔNG còn là "số trang xử lý" nữa mà là hai thứ:
 *   1. SỨC CHỨA CỦA KHO — bao nhiêu câu được lưu, tách theo từng dạng câu.
 *      Đây là thứ giáo viên cảm nhận được: kho đầy thì phải dọn.
 *   2. MỨC ĐỌC được phép dùng — gói thấp đọc bằng model nhanh, gói cao mới
 *      mở được mức Kĩ.
 *
 * `cap` là trần số câu lưu trong kho theo từng dạng. null = không giới hạn.
 */
export const PLANS = {
  lite: {
    id:"lite", name:"Lite", price:0, priceYear:0,
    who:"Thử cho biết, hoặc dạy một hai lớp.",
    scans:40,
    cap:{ MC:100, TF:50, SHORT:50, ESSAY:20 },
    tiers:["nhanh"],
    perks:[
      "Xuất Word · công thức mở lên sửa được ngay",
      "Đủ 4 dạng câu theo cấu trúc thi 2025",
      "Ma trận đặc tả tự sinh",
      "1 mẫu đầu đề · chèn được logo trường",
      "Kho riêng tư tuyệt đối, không ai xem được"
    ],
    off:["Trộn mã đề","Watermark chống lộ đề","Mức đọc Chuẩn và Kĩ","Duyệt hàng loạt theo bộ lọc"]
  },
  plus: {
    id:"plus", name:"Plus", price:99000, priceYear:79000,
    who:"Gia sư dạy đều nhiều lớp, ra đề mỗi tuần.",
    scans:400,
    cap:{ MC:2000, TF:800, SHORT:800, ESSAY:400 },
    tiers:["nhanh","chuan"],
    perks:[
      "Mọi thứ của gói Lite",
      "Mức đọc Chuẩn — chịu được ảnh chụp nghiêng, scan mờ",
      "Duyệt hàng loạt: lọc rồi duyệt cả nhóm một lượt",
      "Trộn 4 mã đề + bảng đáp án từng mã",
      "Watermark và chỉnh lề khi xuất",
      "3 mẫu đầu đề"
    ],
    off:["Mức đọc Kĩ","Chia sẻ kho trong tổ bộ môn"]
  },
  pro: {
    id:"pro", name:"Pro", price:199000, priceYear:159000,
    who:"Nhóm gia sư hoặc trung tâm luyện thi nhỏ.",
    scans:1500,
    cap:{ MC:null, TF:null, SHORT:null, ESSAY:null },
    tiers:["nhanh","chuan","ki"],
    perks:[
      "Mọi thứ của gói Plus",
      "Kho không giới hạn số câu",
      "Mức đọc Kĩ — scan xấu, chữ viết tay",
      "Vẽ lại hình mờ bằng TikZ",
      "Tải lên mẫu Word riêng của trường",
      "Chia sẻ kho trong tổ bộ môn",
      "Xuất kèm file .tex"
    ],
    off:[]
  }
};

export const planOf = (id) => PLANS[String(id || "").toLowerCase()] ?? PLANS.plus;
export const CLS    = { MC:"tn", TF:"ds", SHORT:"tln", ESSAY:"tl" };
export const DIFFS  = ["NB","TH","VD","VDC"];
export const DNAME  = { NB:"Nhận biết", TH:"Thông hiểu", VD:"Vận dụng", VDC:"Vận dụng cao" };

/* Ma trận dựng sẵn theo đúng cấu trúc thi thật của từng môn. */
export const BLUEPRINTS = {
  physics:{ name:"Tốt nghiệp THPT — Vật lí", duration:50,
            secs:[["MC",18],["TF",4],["SHORT",6]] },
  math:   { name:"Tốt nghiệp THPT — Toán",   duration:90,
            secs:[["MC",12],["TF",4],["SHORT",6]] }
};

/* Hình vẽ theo lối hình TikZ trong sách giáo khoa. Dùng currentColor nên tự đổi
   màu theo nền sáng/tối. */
export const FIGS = {
  incline:
    '<svg viewBox="0 0 200 110" role="img" aria-label="Vật trên mặt phẳng nghiêng">'+
    '<path d="M14 92 H182 L182 30 Z" fill="none" stroke="currentColor" stroke-width="2"/>'+
    '<path d="M14 92 H182" stroke="currentColor" stroke-width="2.6"/>'+
    '<g transform="translate(126,52) rotate(-20.3)">'+
    '<rect x="-15" y="-11" width="30" height="22" fill="none" stroke="currentColor" stroke-width="1.8"/>'+
    '<text x="0" y="5" text-anchor="middle" font-family="Cambria,serif" font-style="italic" font-size="12">m</text></g>'+
    '<line x1="126" y1="52" x2="126" y2="84" stroke="currentColor" stroke-width="1.6"/>'+
    '<path d="M122 78 l4 8 l4 -8" fill="currentColor"/>'+
    '<text x="132" y="82" font-family="Cambria,serif" font-style="italic" font-size="12">P</text>'+
    '<path d="M44 92 A30 30 0 0 0 34 71" fill="none" stroke="currentColor" stroke-width="1.3"/>'+
    '<text x="46" y="84" font-family="Cambria,serif" font-size="12">α</text></svg>',

  spring:
    '<svg viewBox="0 0 200 92" role="img" aria-label="Con lắc lò xo nằm ngang">'+
    '<path d="M16 20 V72" stroke="currentColor" stroke-width="2.6"/>'+
    '<path d="M16 26 l-6 6 M16 38 l-6 6 M16 50 l-6 6 M16 62 l-6 6" stroke="currentColor" stroke-width="1.4"/>'+
    '<path d="M16 46 h14 l6 -11 l11 22 l11 -22 l11 22 l11 -22 l11 22 l6 -11 h12" '+
    'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'+
    '<rect x="109" y="30" width="34" height="32" fill="none" stroke="currentColor" stroke-width="1.9"/>'+
    '<text x="126" y="51" text-anchor="middle" font-family="Cambria,serif" font-style="italic" font-size="13">m</text>'+
    '<path d="M16 78 H184" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 4"/>'+
    '<path d="M150 46 h26" stroke="currentColor" stroke-width="1.5"/>'+
    '<path d="M170 42 l8 4 l-8 4" fill="currentColor"/>'+
    '<text x="160" y="36" font-family="Cambria,serif" font-style="italic" font-size="12">x</text></svg>',

  wave:
    '<svg viewBox="0 0 200 92" role="img" aria-label="Sóng truyền trên sợi dây">'+
    '<path d="M12 50 H188" stroke="currentColor" stroke-width="1.1" stroke-dasharray="4 4"/>'+
    '<path d="M12 50 q22 -30 44 0 t44 0 t44 0 t44 0" fill="none" stroke="currentColor" stroke-width="2.2"/>'+
    '<line x1="56" y1="20" x2="56" y2="80" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3"/>'+
    '<line x1="144" y1="20" x2="144" y2="80" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3"/>'+
    '<path d="M56 74 H144" stroke="currentColor" stroke-width="1.5"/>'+
    '<path d="M62 70 l-6 4 l6 4 M138 70 l6 4 l-6 4" fill="none" stroke="currentColor" stroke-width="1.5"/>'+
    '<text x="100" y="88" text-anchor="middle" font-family="Cambria,serif" font-style="italic" font-size="12">λ</text>'+
    '<text x="18" y="34" font-family="Cambria,serif" font-style="italic" font-size="12">u</text></svg>',

  circuit:
    '<svg viewBox="0 0 200 104" role="img" aria-label="Mạch điện có nguồn và điện trở">'+
    '<path d="M30 26 H170 V78 H106 M94 78 H30 Z" fill="none" stroke="currentColor" stroke-width="1.8"/>'+
    '<rect x="78" y="18" width="44" height="16" fill="none" stroke="currentColor" stroke-width="1.8"/>'+
    '<text x="100" y="14" text-anchor="middle" font-family="Cambria,serif" font-style="italic" font-size="12">R</text>'+
    '<path d="M94 62 V94 M106 70 V86" stroke="currentColor" stroke-width="2"/>'+
    '<text x="118" y="98" font-family="Cambria,serif" font-style="italic" font-size="12">ξ, r</text>'+
    '<path d="M166 48 l6 4 l-6 4" fill="currentColor"/>'+
    '<text x="176" y="46" font-family="Cambria,serif" font-style="italic" font-size="12">I</text></svg>',

  lens:
    '<svg viewBox="0 0 200 96" role="img" aria-label="Thấu kính hội tụ và tia sáng">'+
    '<path d="M10 48 H190" stroke="currentColor" stroke-width="1.1" stroke-dasharray="4 4"/>'+
    '<ellipse cx="100" cy="48" rx="9" ry="34" fill="none" stroke="currentColor" stroke-width="2"/>'+
    '<path d="M28 26 H100 L166 62" fill="none" stroke="currentColor" stroke-width="1.6"/>'+
    '<circle cx="146" cy="48" r="2.4" fill="currentColor"/>'+
    '<text x="142" y="42" font-family="Cambria,serif" font-style="italic" font-size="11">F</text>'+
    '<path d="M28 26 V48" stroke="currentColor" stroke-width="2.4"/>'+
    '<path d="M24 32 l4 -7 l4 7" fill="currentColor"/>'+
    '<text x="10" y="26" font-family="Cambria,serif" font-style="italic" font-size="11">AB</text></svg>',

  /* --- hình cho môn Toán --- */
  parabol:
    '<svg viewBox="0 0 200 120" role="img" aria-label="Đồ thị hàm số bậc ba">'+
    '<path d="M20 104 H186" stroke="currentColor" stroke-width="1.4"/>'+
    '<path d="M32 12 V112" stroke="currentColor" stroke-width="1.4"/>'+
    '<path d="M180 100 l6 4 l-6 4 M28 18 l4 -6 l4 6" fill="currentColor"/>'+
    '<path d="M40 96 C70 20 96 118 128 40 S170 26 178 22" fill="none" '+
    'stroke="currentColor" stroke-width="2.2"/>'+
    '<circle cx="70" cy="43" r="2.6" fill="currentColor"/>'+
    '<circle cx="112" cy="82" r="2.6" fill="currentColor"/>'+
    '<text x="60" y="36" font-family="Cambria,serif" font-size="11">CĐ</text>'+
    '<text x="112" y="98" font-family="Cambria,serif" font-size="11">CT</text>'+
    '<text x="188" y="112" font-family="Cambria,serif" font-style="italic" font-size="12">x</text>'+
    '<text x="18" y="18" font-family="Cambria,serif" font-style="italic" font-size="12">y</text></svg>',

  pyramid:
    '<svg viewBox="0 0 200 130" role="img" aria-label="Hình chóp có đáy là hình vuông">'+
    '<path d="M34 100 L124 100 L166 78 L76 78 Z" fill="none" stroke="currentColor" '+
    'stroke-width="1.6" stroke-dasharray="0"/>'+
    '<path d="M76 78 L34 100" stroke="currentColor" stroke-width="1.6" stroke-dasharray="4 3"/>'+
    '<path d="M34 100 L100 18 L124 100 M100 18 L166 78" fill="none" stroke="currentColor" stroke-width="1.9"/>'+
    '<path d="M100 18 L76 78" stroke="currentColor" stroke-width="1.4" stroke-dasharray="4 3"/>'+
    '<path d="M100 18 V89" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 3"/>'+
    '<circle cx="100" cy="89" r="2.2" fill="currentColor"/>'+
    '<text x="98" y="12" font-family="Cambria,serif" font-size="12">S</text>'+
    '<text x="24" y="108" font-family="Cambria,serif" font-size="12">A</text>'+
    '<text x="126" y="110" font-family="Cambria,serif" font-size="12">B</text>'+
    '<text x="170" y="76" font-family="Cambria,serif" font-size="12">C</text>'+
    '<text x="66" y="74" font-family="Cambria,serif" font-size="12">D</text></svg>'
};

let uid = 0;
const Q = (o) => ({
  id:"q"+(++uid), fig:null, ai:false, sol:"", grade:12,
  subject: subjectOfTopic(o.topic), ...o
});

export const BANK = [
  /* ═══════════════════════════ VẬT LÍ ═══════════════════════════ */
  Q({type:"MC",diff:"TH",topic:"p11.oscillation",src:"Ninh Bình 2024",ai:true,fig:"spring",grade:11,
    stem:"Một con lắc lò xo gồm vật nhỏ khối lượng $m = 100\\,\\mathrm{g}$ gắn với lò xo nhẹ độ cứng $k = 40\\,\\mathrm{N/m}$. Tần số góc của dao động bằng",
    ch:["$20\\,\\mathrm{rad/s}$","$200\\,\\mathrm{rad/s}$","$4\\,\\mathrm{rad/s}$","$400\\,\\mathrm{rad/s}$"],ans:0,
    sol:"$\\omega = \\sqrt{\\dfrac{k}{m}} = \\sqrt{\\dfrac{40}{0{,}1}} = 20\\,\\mathrm{rad/s}$."}),
  Q({type:"MC",diff:"TH",topic:"p10.dynamics",src:"Ninh Bình 2024",ai:true,fig:"incline",grade:10,
    stem:"Vật khối lượng $m = 2\\,\\mathrm{kg}$ trượt không ma sát xuống mặt phẳng nghiêng góc $\\alpha = 30^\\circ$. Lấy $g = 10\\,\\mathrm{m/s^2}$. Gia tốc của vật bằng",
    ch:["$5\\,\\mathrm{m/s^2}$","$8{,}66\\,\\mathrm{m/s^2}$","$10\\,\\mathrm{m/s^2}$","$2{,}5\\,\\mathrm{m/s^2}$"],ans:0,
    sol:"$a = g\\sin\\alpha = 10 \\cdot 0{,}5 = 5\\,\\mathrm{m/s^2}$, không phụ thuộc khối lượng."}),
  Q({type:"MC",diff:"NB",topic:"p12.nuclear",src:"THPT 2025 — phỏng theo",ai:true,
    stem:"Hạt nhân $^{235}_{92}\\mathrm{U}$ có số nơtron bằng",
    ch:["$143$","$92$","$235$","$327$"],ans:0,
    sol:"$N = A - Z = 235 - 92 = 143$."}),
  Q({type:"MC",diff:"VD",topic:"p12.nuclear",src:"THPT 2025 — phỏng theo",
    stem:"Chất phóng xạ có chu kì bán rã $T = 8$ ngày. Sau $24$ ngày, tỉ số giữa số hạt nhân còn lại và ban đầu bằng",
    ch:["$\\dfrac{1}{8}$","$\\dfrac{1}{3}$","$\\dfrac{1}{16}$","$\\dfrac{1}{4}$"],ans:0,
    sol:"$24$ ngày $= 3T$, còn lại $2^{-3} = \\dfrac{1}{8}$."}),
  Q({type:"MC",diff:"TH",topic:"p11.wave",src:"Chuyên Vinh L2 2025",fig:"wave",grade:11,
    stem:"Sóng cơ truyền trên dây với tốc độ $v = 20\\,\\mathrm{m/s}$, tần số $f = 50\\,\\mathrm{Hz}$. Bước sóng bằng",
    ch:["$0{,}4\\,\\mathrm{m}$","$2{,}5\\,\\mathrm{m}$","$1000\\,\\mathrm{m}$","$4\\,\\mathrm{m}$"],ans:0,
    sol:"$\\lambda = \\dfrac{v}{f} = 0{,}4\\,\\mathrm{m}$."}),
  Q({type:"MC",diff:"NB",topic:"p12.magnetic",src:"SGK Cánh Diều",
    stem:"Bên ngoài một nam châm thẳng, đường sức từ đi ra từ",
    ch:["cực Bắc và đi vào cực Nam","cực Nam và đi vào cực Bắc","cả hai cực","tâm nam châm"],ans:0}),
  Q({type:"MC",diff:"TH",topic:"p12.magnetic",src:"Ninh Bình 2024",
    stem:"Đoạn dây dài $\\ell = 20\\,\\mathrm{cm}$ mang dòng $I = 5\\,\\mathrm{A}$ đặt vuông góc từ trường đều $B = 0{,}4\\,\\mathrm{T}$. Lực từ bằng",
    ch:["$0{,}4\\,\\mathrm{N}$","$4\\,\\mathrm{N}$","$0{,}04\\,\\mathrm{N}$","$40\\,\\mathrm{N}$"],ans:0,
    sol:"$F = BI\\ell = 0{,}4 \\cdot 5 \\cdot 0{,}2 = 0{,}4\\,\\mathrm{N}$."}),
  Q({type:"MC",diff:"VDC",topic:"p11.oscillation",src:"THPT 2025 — phỏng theo",grade:11,
    stem:"Hai dao động điều hoà cùng phương cùng tần số, lệch pha $\\dfrac{\\pi}{3}$, biên độ $3\\,\\mathrm{cm}$ và $4\\,\\mathrm{cm}$. Biên độ tổng hợp bằng",
    ch:["$\\sqrt{37}\\,\\mathrm{cm}$","$7\\,\\mathrm{cm}$","$5\\,\\mathrm{cm}$","$1\\,\\mathrm{cm}$"],ans:0,
    sol:"$A^2 = A_1^2 + A_2^2 + 2A_1A_2\\cos\\Delta\\varphi = 9 + 16 + 12 = 37$."}),
  Q({type:"MC",diff:"VD",topic:"p10.energy",src:"Ninh Bình 2024",grade:10,
    stem:"Vật $m = 500\\,\\mathrm{g}$ rơi tự do từ $h = 20\\,\\mathrm{m}$. Lấy $g = 10\\,\\mathrm{m/s^2}$. Động năng khi chạm đất bằng",
    ch:["$100\\,\\mathrm{J}$","$50\\,\\mathrm{J}$","$200\\,\\mathrm{J}$","$10\\,\\mathrm{J}$"],ans:0,
    sol:"Bảo toàn cơ năng: $W_{\\mathrm{đ}} = mgh = 100\\,\\mathrm{J}$."}),
  Q({type:"MC",diff:"TH",topic:"p11.efield",src:"Chuyên Vinh L2 2025",fig:"circuit",grade:11,
    stem:"Nguồn điện có suất điện động $\\xi = 12\\,\\mathrm{V}$, điện trở trong $r = 1\\,\\Omega$, mạch ngoài $R = 5\\,\\Omega$. Cường độ dòng điện trong mạch bằng",
    ch:["$2\\,\\mathrm{A}$","$2{,}4\\,\\mathrm{A}$","$12\\,\\mathrm{A}$","$6\\,\\mathrm{A}$"],ans:0,
    sol:"$I = \\dfrac{\\xi}{R+r} = \\dfrac{12}{6} = 2\\,\\mathrm{A}$."}),
  Q({type:"MC",diff:"TH",topic:"p12.thermal",src:"SGK Cánh Diều",
    stem:"Truyền cho khí nhiệt lượng $Q = 200\\,\\mathrm{J}$, khí sinh công $A' = 120\\,\\mathrm{J}$. Độ biến thiên nội năng bằng",
    ch:["$80\\,\\mathrm{J}$","$320\\,\\mathrm{J}$","$-80\\,\\mathrm{J}$","$120\\,\\mathrm{J}$"],ans:0,
    sol:"Nguyên lí I: $\\Delta U = Q - A' = 80\\,\\mathrm{J}$."}),
  Q({type:"MC",diff:"NB",topic:"p10.kinematics",src:"SGK Cánh Diều",grade:10,
    stem:"Trong chuyển động thẳng đều, đồ thị vận tốc theo thời gian có dạng",
    ch:["đường thẳng song song trục thời gian","đường thẳng qua gốc toạ độ","đường parabol","đường hypebol"],ans:0}),
  Q({type:"MC",diff:"NB",topic:"p12.gas",src:"THPT 2025 — phỏng theo",
    stem:"Trong quá trình đẳng nhiệt của một lượng khí xác định, đại lượng nào sau đây không đổi?",
    ch:["Tích $pV$","Thương $\\dfrac{V}{T}$","Thương $\\dfrac{p}{T}$","Hiệu $p - V$"],ans:0}),
  Q({type:"MC",diff:"NB",topic:"p12.thermal",src:"THPT 2025 — phỏng theo",
    stem:"Đơn vị của nhiệt dung riêng trong hệ SI là",
    ch:["$\\mathrm{J/(kg \\cdot K)}$","$\\mathrm{J/kg}$","$\\mathrm{J/K}$","$\\mathrm{W/(m \\cdot K)}$"],ans:0}),
  Q({type:"MC",diff:"VD",topic:"p12.magnetic",src:"THPT 2025 — phỏng theo",
    stem:"Từ thông qua khung dây phẳng $200$ vòng, diện tích $50\\,\\mathrm{cm^2}$, đặt vuông góc từ trường đều $B = 0{,}1\\,\\mathrm{T}$ bằng",
    ch:["$0{,}1\\,\\mathrm{Wb}$","$1\\,\\mathrm{Wb}$","$0{,}01\\,\\mathrm{Wb}$","$5\\,\\mathrm{Wb}$"],ans:0,
    sol:"$\\Phi = NBS = 200 \\cdot 0{,}1 \\cdot 50 \\cdot 10^{-4} = 0{,}1\\,\\mathrm{Wb}$."}),
  Q({type:"MC",diff:"VD",topic:"p12.nuclear",src:"THPT 2025 — phỏng theo",
    stem:"Năng lượng liên kết riêng của hạt nhân đặc trưng cho",
    ch:["mức độ bền vững của hạt nhân","khối lượng hạt nhân","số nuclôn trong hạt nhân","điện tích hạt nhân"],ans:0}),
  Q({type:"MC",diff:"TH",topic:"p12.gas",src:"THPT 2025 — phỏng theo",
    stem:"Nén đẳng nhiệt một lượng khí từ $6\\,\\mathrm{l}$ xuống $2\\,\\mathrm{l}$ thì áp suất",
    ch:["tăng gấp $3$ lần","giảm $3$ lần","không đổi","tăng gấp $9$ lần"],ans:0}),
  Q({type:"MC",diff:"VDC",topic:"p11.wave",src:"THPT 2025 — phỏng theo",grade:11,
    stem:"Hai nguồn kết hợp cùng pha cách nhau $12\\,\\mathrm{cm}$, bước sóng $2\\,\\mathrm{cm}$. Số điểm dao động cực đại trên đoạn nối hai nguồn (không kể hai nguồn) bằng",
    ch:["$11$","$12$","$13$","$6$"],ans:0,
    sol:"$-\\dfrac{12}{2} < k < \\dfrac{12}{2}$ nên $k$ nhận $11$ giá trị nguyên."}),

  Q({type:"TF",diff:"VD",topic:"p12.gas",src:"Chuyên Vinh L2 2025",
    stem:"Một lượng khí lí tưởng thực hiện quá trình đẳng áp, nhiệt độ tuyệt đối tăng từ $T_1 = 300\\,\\mathrm{K}$ lên $T_2 = 600\\,\\mathrm{K}$.",
    tf:[["Thể tích của khối khí tăng gấp đôi.",true],
        ["Áp suất của khối khí giảm đi một nửa.",false],
        ["Khối khí nhận nhiệt lượng từ bên ngoài.",true],
        ["Nội năng của khối khí không đổi.",false]]}),
  Q({type:"TF",diff:"TH",topic:"p12.thermal",src:"SGK Cánh Diều",
    stem:"Xét nội năng của một lượng khí lí tưởng xác định.",
    tf:[["Nội năng chỉ phụ thuộc vào nhiệt độ.",true],
        ["Nội năng tăng khi nhiệt độ tăng.",true],
        ["Nội năng phụ thuộc vào thể tích bình chứa.",false],
        ["Có thể làm tăng nội năng bằng cách thực hiện công.",true]]}),
  Q({type:"TF",diff:"VDC",topic:"p11.efield",src:"THPT 2025 — phỏng theo",fig:"lens",grade:11,
    stem:"Vật sáng $AB$ đặt vuông góc trục chính của thấu kính hội tụ, ngoài khoảng tiêu cự.",
    tf:[["Ảnh thu được là ảnh thật.",true],["Ảnh luôn nhỏ hơn vật.",false],
        ["Ảnh ngược chiều với vật.",true],["Ảnh hứng được trên màn.",true]]}),
  Q({type:"TF",diff:"VD",topic:"p12.nuclear",src:"THPT 2025 — phỏng theo",
    stem:"Xét phản ứng hạt nhân toả năng lượng.",
    tf:[["Tổng khối lượng các hạt sau nhỏ hơn trước.",true],
        ["Năng lượng toả ra tính bằng $\\Delta m \\cdot c^2$.",true],
        ["Số nuclôn được bảo toàn.",true],
        ["Động năng các hạt sau nhỏ hơn trước.",false]]}),

  Q({type:"SHORT",diff:"TH",topic:"p11.oscillation",src:"Tự soạn",grade:11,
    stem:"Vật dao động điều hoà biên độ $A = 5\\,\\mathrm{cm}$, tần số $f = 2\\,\\mathrm{Hz}$. Lấy $\\pi \\approx 3{,}14$. Tốc độ cực đại bằng bao nhiêu $\\mathrm{cm/s}$?",
    sa:{value:"62,8",unit:"cm/s",tol:"0,2"}}),
  Q({type:"SHORT",diff:"VD",topic:"p12.magnetic",src:"Chuyên Vinh L2 2025",
    stem:"Khung dây $200$ vòng, diện tích $50\\,\\mathrm{cm^2}$, từ trường biến thiên đều từ $0$ đến $0{,}2\\,\\mathrm{T}$ trong $0{,}1\\,\\mathrm{s}$. Suất điện động cảm ứng bằng bao nhiêu $\\mathrm{V}$?",
    sa:{value:"2",unit:"V",tol:"0,05"}}),
  Q({type:"SHORT",diff:"VDC",topic:"p12.gas",src:"Tự soạn",
    stem:"Khí lí tưởng ở $27\\,^\\circ\\mathrm{C}$, áp suất $2\\,\\mathrm{atm}$, thể tích $4\\,\\mathrm{l}$. Nén đẳng nhiệt còn $1\\,\\mathrm{l}$ thì áp suất bằng bao nhiêu $\\mathrm{atm}$?",
    sa:{value:"8",unit:"atm",tol:"0,1"}}),
  Q({type:"SHORT",diff:"VD",topic:"p12.thermal",src:"THPT 2025 — phỏng theo",
    stem:"Cần bao nhiêu $\\mathrm{kJ}$ nhiệt lượng để đun $2\\,\\mathrm{kg}$ nước từ $20\\,^\\circ\\mathrm{C}$ lên $70\\,^\\circ\\mathrm{C}$? Biết $c = 4200\\,\\mathrm{J/(kg \\cdot K)}$.",
    sa:{value:"420",unit:"kJ",tol:"1"}}),
  Q({type:"SHORT",diff:"TH",topic:"p12.nuclear",src:"THPT 2025 — phỏng theo",
    stem:"Một mẫu phóng xạ ban đầu có $8 \\cdot 10^{20}$ hạt. Sau $2$ chu kì bán rã còn lại bao nhiêu hạt (theo đơn vị $10^{20}$)?",
    sa:{value:"2",unit:"×10²⁰ hạt",tol:"0,05"}}),
  Q({type:"SHORT",diff:"VD",topic:"p10.energy",src:"THPT 2025 — phỏng theo",grade:10,
    stem:"Một máy có công suất $1500\\,\\mathrm{W}$ nâng vật $200\\,\\mathrm{kg}$ lên cao $6\\,\\mathrm{m}$. Lấy $g = 10\\,\\mathrm{m/s^2}$. Thời gian tối thiểu là bao nhiêu giây?",
    sa:{value:"8",unit:"s",tol:"0,1"}}),

  /* ═════════════════════════════ TOÁN ═════════════════════════════ */
  Q({type:"MC",diff:"NB",topic:"m12.derivative",src:"THPT 2025 — phỏng theo",fig:"parabol",
    stem:"Cho hàm số $y = f(x)$ có đồ thị như hình vẽ. Hàm số đồng biến trên khoảng nào sau đây?",
    ch:["$(-\\infty; 1)$","$(1; 3)$","$(0; 2)$","$(3; +\\infty)$"],ans:0}),
  Q({type:"MC",diff:"TH",topic:"m12.derivative",src:"THPT 2025 — phỏng theo",
    stem:"Tiệm cận ngang của đồ thị hàm số $y = \\dfrac{2x - 1}{x + 3}$ là đường thẳng",
    ch:["$y = 2$","$y = -3$","$x = -3$","$y = -\\dfrac{1}{3}$"],ans:0,
    sol:"$\\lim_{x \\to \\infty} \\dfrac{2x-1}{x+3} = 2$."}),
  Q({type:"MC",diff:"TH",topic:"m12.integral",src:"THPT 2025 — phỏng theo",
    stem:"Nguyên hàm của hàm số $f(x) = 3x^2 + 2$ là",
    ch:["$x^3 + 2x + C$","$6x + C$","$x^3 + 2 + C$","$3x^3 + 2x + C$"],ans:0}),
  Q({type:"MC",diff:"VD",topic:"m12.integral",src:"THPT 2025 — phỏng theo",
    stem:"Giá trị của tích phân $\\int_0^1 (2x + 1)\\,\\mathrm{d}x$ bằng",
    ch:["$2$","$1$","$3$","$\\dfrac{3}{2}$"],ans:0,
    sol:"$\\int_0^1 (2x+1)\\,\\mathrm{d}x = [x^2 + x]_0^1 = 2$."}),
  Q({type:"MC",diff:"NB",topic:"m12.oxyz",src:"THPT 2025 — phỏng theo",
    stem:"Trong không gian $Oxyz$, mặt phẳng $(P): 2x - y + 3z - 5 = 0$ có một vectơ pháp tuyến là",
    ch:["$(2; -1; 3)$","$(2; 1; 3)$","$(-5; 2; -1)$","$(2; -1; -5)$"],ans:0}),
  Q({type:"MC",diff:"TH",topic:"m12.oxyz",src:"THPT 2025 — phỏng theo",
    stem:"Trong không gian $Oxyz$, cho $A(1; 2; 3)$ và $B(3; 0; 1)$. Trung điểm của $AB$ có toạ độ là",
    ch:["$(2; 1; 2)$","$(4; 2; 4)$","$(1; -1; -1)$","$(2; 2; 2)$"],ans:0}),
  Q({type:"MC",diff:"NB",topic:"m12.stats",src:"THPT 2025 — phỏng theo",
    stem:"Mẫu số liệu $2; 4; 4; 6; 9$ có số trung bình bằng",
    ch:["$5$","$4$","$4{,}5$","$6$"],ans:0}),
  Q({type:"MC",diff:"VD",topic:"m12.prob",src:"THPT 2025 — phỏng theo",
    stem:"Cho hai biến cố $A$, $B$ với $P(A) = 0{,}5$; $P(B) = 0{,}4$ và $P(AB) = 0{,}2$. Khi đó $P(A \\mid B)$ bằng",
    ch:["$0{,}5$","$0{,}4$","$0{,}8$","$0{,}25$"],ans:0,
    sol:"$P(A \\mid B) = \\dfrac{P(AB)}{P(B)} = \\dfrac{0{,}2}{0{,}4} = 0{,}5$."}),
  Q({type:"MC",diff:"TH",topic:"m11.sequence",src:"THPT 2025 — phỏng theo",grade:11,
    stem:"Cấp số cộng $(u_n)$ có $u_1 = 3$ và công sai $d = 4$. Số hạng $u_5$ bằng",
    ch:["$19$","$15$","$23$","$7$"],ans:0}),
  Q({type:"MC",diff:"VDC",topic:"m11.space",src:"THPT 2025 — phỏng theo",fig:"pyramid",grade:11,
    stem:"Cho hình chóp $S.ABCD$ có đáy là hình vuông cạnh $a$, $SA \\perp (ABCD)$ và $SA = a\\sqrt{3}$. Góc giữa $SC$ và mặt phẳng đáy bằng",
    ch:["$50^\\circ 46'$","$30^\\circ$","$45^\\circ$","$60^\\circ$"],ans:0,
    sol:"$\\tan\\varphi = \\dfrac{SA}{AC} = \\dfrac{a\\sqrt{3}}{a\\sqrt{2}}$."}),
  Q({type:"MC",diff:"NB",topic:"m10.vector",src:"SGK Kết nối tri thức",grade:10,
    stem:"Trong mặt phẳng $Oxy$, cho $\\vec{u} = (2; -3)$ và $\\vec{v} = (1; 4)$. Toạ độ của $\\vec{u} + \\vec{v}$ là",
    ch:["$(3; 1)$","$(1; -7)$","$(2; -12)$","$(3; -7)$"],ans:0}),
  Q({type:"MC",diff:"TH",topic:"m12.stats",src:"THPT 2025 — phỏng theo",
    stem:"Mẫu số liệu ghép nhóm có khoảng biến thiên là hiệu giữa",
    ch:["đầu mút phải nhóm cuối và đầu mút trái nhóm đầu","hai giá trị lớn nhất",
        "trung vị và trung bình","tứ phân vị thứ ba và thứ nhất"],ans:0}),

  Q({type:"TF",diff:"VD",topic:"m12.derivative",src:"THPT 2025 — phỏng theo",
    stem:"Cho hàm số $y = x^3 - 3x + 1$.",
    tf:[["Hàm số có hai điểm cực trị.",true],
        ["Hàm số đạt cực đại tại $x = -1$.",true],
        ["Giá trị cực tiểu của hàm số bằng $-1$.",true],
        ["Hàm số đồng biến trên $(-1; 1)$.",false]]}),
  Q({type:"TF",diff:"VD",topic:"m12.oxyz",src:"THPT 2025 — phỏng theo",
    stem:"Trong không gian $Oxyz$, cho mặt cầu $(S): x^2 + y^2 + z^2 - 2x - 4y = 0$.",
    tf:[["Tâm mặt cầu là $I(1; 2; 0)$.",true],
        ["Bán kính mặt cầu bằng $\\sqrt{5}$.",true],
        ["Mặt cầu đi qua gốc toạ độ $O$.",true],
        ["Mặt cầu tiếp xúc mặt phẳng $Oxy$.",false]]}),
  Q({type:"TF",diff:"VDC",topic:"m12.prob",src:"THPT 2025 — phỏng theo",
    stem:"Một hộp có $5$ bi đỏ và $3$ bi xanh. Lấy ngẫu nhiên lần lượt $2$ bi, không hoàn lại.",
    tf:[["Xác suất bi đầu màu đỏ bằng $\\dfrac{5}{8}$.",true],
        ["Xác suất cả hai bi đỏ bằng $\\dfrac{5}{14}$.",true],
        ["Hai lần lấy là hai biến cố độc lập.",false],
        ["Xác suất bi thứ hai đỏ bằng $\\dfrac{5}{8}$.",true]]}),

  Q({type:"SHORT",diff:"TH",topic:"m12.integral",src:"THPT 2025 — phỏng theo",
    stem:"Tính $\\int_1^2 \\dfrac{1}{x^2}\\,\\mathrm{d}x$ (làm tròn đến hàng phần trăm).",
    sa:{value:"0,5",unit:"",tol:"0,01"}}),
  Q({type:"SHORT",diff:"VD",topic:"m12.oxyz",src:"THPT 2025 — phỏng theo",
    stem:"Trong không gian $Oxyz$, khoảng cách từ điểm $M(1; 2; 2)$ đến mặt phẳng $(P): x + 2y + 2z - 3 = 0$ bằng bao nhiêu?",
    sa:{value:"2",unit:"",tol:"0,01"}}),
  Q({type:"SHORT",diff:"VDC",topic:"m12.derivative",src:"THPT 2025 — phỏng theo",
    stem:"Một mảnh tôn hình vuông cạnh $12\\,\\mathrm{cm}$, cắt bốn góc bốn hình vuông cạnh $x$ rồi gấp thành hộp không nắp. Giá trị $x$ để thể tích lớn nhất bằng bao nhiêu $\\mathrm{cm}$?",
    sa:{value:"2",unit:"cm",tol:"0,05"}}),
  Q({type:"SHORT",diff:"VD",topic:"m12.stats",src:"THPT 2025 — phỏng theo",
    stem:"Mẫu số liệu $4; 6; 8; 10; 12$ có phương sai bằng bao nhiêu?",
    sa:{value:"8",unit:"",tol:"0,05"}}),
  Q({type:"SHORT",diff:"TH",topic:"m11.sequence",src:"THPT 2025 — phỏng theo",grade:11,
    stem:"Cấp số nhân có $u_1 = 2$, công bội $q = 3$. Tổng $5$ số hạng đầu bằng bao nhiêu?",
    sa:{value:"242",unit:"",tol:"0,5"}}),
  Q({type:"SHORT",diff:"VDC",topic:"m11.space",src:"THPT 2025 — phỏng theo",grade:11,
    stem:"Hình chóp có đáy là hình vuông cạnh $2\\,\\mathrm{cm}$, chiều cao $3\\,\\mathrm{cm}$. Thể tích khối chóp bằng bao nhiêu $\\mathrm{cm^3}$?",
    sa:{value:"4",unit:"cm³",tol:"0,05"}})
];

/* `scans` = số lượt quét đã trừ, không phải tiền. Xem ghi chú UNIT ở trên.
   Bằng pages × cost của mức đọc, cộng thêm nếu bật đối chiếu chéo. */
export const SOURCES = [
  {name:"de-giua-ki-1.pdf",kind:"PDF số",tier:"nhanh",pages:4,found:5,scans:4,state:"done",label:"Đã vào kho",prog:100},
  {name:"tai-lieu-thay-hung.pdf",kind:"PDF số",tier:"nhanh",pages:5,found:5,scans:5,state:"done",label:"Đã vào kho",prog:100},
  {name:"de-thu-so-2.jpg",kind:"Ảnh chụp",tier:"chuan",pages:1,found:4,scans:4,state:"review",label:"Chờ duyệt 4 câu",prog:100},
  {name:"on-tap-chuong-1.docx",kind:"Word",tier:"nhanh",pages:6,found:5,scans:6,state:"done",label:"Đã vào kho",prog:100}
];

export const HEADER_TEMPLATES = [
  { id:"so",   name:"Chuẩn Sở GD",  desc:"Hai cột, kiểu đề chính thức" },
  { id:"gon",  name:"Gọn một dòng", desc:"Cho bài kiểm tra 15 phút" },
  { id:"logo", name:"Có logo",      desc:"Trung tâm, trường tư" }
];

export const DEFAULT_HEADER = {
  tmpl:"so", org:"Sở GD&ĐT Hà Nội", school:"Trường THPT Nguyễn Trãi",
  title:"Đề kiểm tra giữa kì I", subject:"Vật lí 12", duration:50,
  code:"101", year:"2026 – 2027", showCode:true, showId:true, showPage:false
};

/* Trình bày trang in. Lề tính bằng cm — đúng đơn vị Word hiện trong hộp
   Page Setup, để giáo viên đối chiếu được với quy định của trường.
   Mặc định lấy theo `phase0/src/reference.ts`: trái 3cm, còn lại 2cm. */
export const DEFAULT_LAYOUT = {
  marginTop:2, marginRight:2, marginBottom:2, marginLeft:3,
  columns:1,            // 1 hoặc 2 cột
  fontSize:12,          // pt, cỡ chữ thân đề
  lineGap:1.15,         // giãn dòng
  logo:null,            // data URL ảnh logo trường
  logoSize:44,          // px trên bản xem trước, quy ra mm khi in
  watermark:"",         // để trống là tắt
  watermarkOpacity:8,   // %
  watermarkAngle:-30    // độ
};

/* ═══════════════════════════ CHỜ DUYỆT ═══════════════════════════
 *
 * Bốn câu AI vừa đọc ra từ `de-thu-so-2.jpg` — khớp với dòng "Chờ duyệt 4 câu"
 * trong SOURCES ở trên. Giáo viên phải nhìn ảnh gốc rồi mới cho vào kho.
 *
 *   raw       — mấy dòng chữ y như trên trang giấy, để dựng khung ảnh gốc bên
 *               trái. Bản thật là ảnh scan; ở đây thay bằng chữ cho thấy bố cục.
 *   mark      — đoạn trong đề bài hai model đọc khác nhau, sẽ tô vàng.
 *   conflicts — chỗ lệch giữa model đọc và model soát. RỖNG = tin cậy cao,
 *               "Duyệt hết câu tin cậy cao" chỉ nuốt những câu rỗng này.
 *
 * pd1 CỐ TÌNH trùng với một câu đã có sẵn trong BANK — tài liệu giáo viên nạp
 * lên hay chứa câu họ đã lưu từ trước, và màn duyệt phải bắt được chuyện đó.
 * Ba câu còn lại là câu mới.
 */
export const PENDING = [
  { id:"pd1", src:"de-thu-so-2.jpg", page:1, model:"gemini-3.5-flash",
    type:"MC", diff:"NB", topic:"p12.thermal", grade:12,
    stem:"Đơn vị của nhiệt dung riêng trong hệ SI là",
    ch:["$\\mathrm{J/(kg \\cdot K)}$","$\\mathrm{J/kg}$","$\\mathrm{J/K}$","$\\mathrm{W/(m \\cdot K)}$"],
    ans:0, sol:"Nhiệt dung riêng $c = \\dfrac{Q}{m\\Delta T}$ nên đơn vị là $\\mathrm{J/(kg \\cdot K)}$.",
    raw:["Câu 1. Đơn vị của nhiệt dung riêng trong hệ SI là",
         "A. J/(kg·K)     B. J/kg     C. J/K     D. W/(m·K)"],
    notes:null, answerSource:"solved" },

  { id:"pd2", src:"de-thu-so-2.jpg", page:1, model:"gemini-3.5-flash",
    type:"MC", diff:"TH", topic:"p12.thermal", grade:12,
    stem:"Trong suốt quá trình nóng chảy của một chất rắn kết tinh, nhiệt độ của vật",
    ch:["không đổi","tăng đều","giảm đều","tăng rồi giảm"],
    ans:0, sol:"Nhiệt lượng nhận vào dùng để phá vỡ mạng tinh thể chứ không làm tăng động năng phân tử, nên nhiệt độ giữ nguyên ở nhiệt độ nóng chảy.",
    raw:["Câu 2. Trong suốt quá trình nóng chảy của một chất rắn kết tinh, nhiệt độ của vật",
         "A. không đổi     B. tăng đều     C. giảm đều     D. tăng rồi giảm"],
    notes:null, answerSource:"solved" },

  /* Câu model TỰ KHAI là đọc không chắc. Đây là tín hiệu miễn phí thay cho
     việc chạy model thứ hai — nó biết chỗ nào nó mờ, chỉ cần bảo nó nói ra. */
  { id:"pd3", src:"de-thu-so-2.jpg", page:1, model:"gemini-3.5-flash",
    type:"MC", diff:"VD", topic:"p12.magnetic", grade:12,
    stem:"Một khung dây phẳng $100$ vòng, diện tích $40\\,\\mathrm{cm^2}$, đặt vuông góc từ trường đều $B = 0{,}2\\,\\mathrm{T}$. Từ thông qua khung bằng",
    ch:["$0{,}08\\,\\mathrm{Wb}$","$0{,}8\\,\\mathrm{Wb}$","$8\\,\\mathrm{Wb}$","$0{,}008\\,\\mathrm{Wb}$"],
    ans:0, sol:"$\\Phi = NBS = 100 \\cdot 0{,}2 \\cdot 40 \\cdot 10^{-4} = 0{,}08\\,\\mathrm{Wb}$.",
    mark:"40\\,\\mathrm{cm^2}",
    raw:["Câu 3. Một khung dây phẳng 100 vòng, diện tích 40 cm², đặt vuông góc từ trường đều B = 0,2 T. Từ thông qua khung bằng",
         "A. 0,08 Wb     B. 0,8 Wb     C. 8 Wb     D. 0,008 Wb"],
    notes:"Chỗ diện tích ảnh bị nhoè, đọc là 40 cm² nhưng cũng có thể là 4,0 cm². Nhìn ảnh gốc xác nhận giúp.",
    answerSource:"solved" },

  /* Câu CÓ HÌNH. Model chỉ khoanh được chỗ hình và tả lại bằng chữ. */
  { id:"pd4", src:"de-thu-so-2.jpg", page:1, model:"gemini-3.5-flash",
    type:"MC", diff:"TH", topic:"p11.current", grade:11,
    stem:"Cho mạch điện như hình vẽ. Biết $R_1 = 4\\,\\Omega$ và $R_2 = 6\\,\\Omega$ mắc nối tiếp, hiệu điện thế hai đầu đoạn mạch $U = 20\\,\\mathrm{V}$. Cường độ dòng điện qua mạch bằng",
    ch:["$2\\,\\mathrm{A}$","$5\\,\\mathrm{A}$","$3{,}3\\,\\mathrm{A}$","$0{,}5\\,\\mathrm{A}$"],
    ans:0, sol:"$I = \\dfrac{U}{R_1 + R_2} = \\dfrac{20}{10} = 2\\,\\mathrm{A}$.",
    figNote:"Sơ đồ mạch điện: hai điện trở R₁ và R₂ mắc nối tiếp, nguồn U mắc hai đầu đoạn mạch.",
    figBbox:[0.37, 0.33, 0.63, 0.41],
    raw:["Câu 4. Cho mạch điện như hình vẽ. Biết R₁ = 4 Ω, R₂ = 6 Ω mắc nối tiếp, U = 20 V.",
         "[ hình vẽ mạch điện ]",
         "A. 2 A     B. 5 A     C. 3,3 A     D. 0,5 A"],
    notes:null, answerSource:"solved" }
];

/* ═══════════════ MẪU SINH CÂU CHỜ DUYỆT KHI NẠP TÀI LIỆU ═══════════════
 *
 * Nạp một tài liệu 40 trang là ra khoảng 200 câu chờ duyệt — phải thử được
 * cảnh đó thì mới biết màn Duyệt có chịu nổi không. `simulateUpload` lấy mẫu
 * ở đây rồi thay số để sinh ra chừng ấy câu.
 */
export const PENDING_SEEDS = [
  { type:"MC", diff:"NB", topic:"p11.oscillation", grade:11,
    stem:"Chu kì dao động của con lắc đơn dài $\\ell = {A}\\,\\mathrm{m}$ tại nơi có $g = 9{,}8\\,\\mathrm{m/s^2}$ gần nhất với",
    ch:["${B}\\,\\mathrm{s}$","$1{,}0\\,\\mathrm{s}$","$6{,}3\\,\\mathrm{s}$","$0{,}5\\,\\mathrm{s}$"] },
  { type:"MC", diff:"TH", topic:"p11.wave", grade:11,
    stem:"Sóng cơ truyền trên dây với tốc độ $v = {A}\\,\\mathrm{m/s}$, tần số $f = 50\\,\\mathrm{Hz}$. Bước sóng bằng",
    ch:["${B}\\,\\mathrm{m}$","$2{,}5\\,\\mathrm{m}$","$1000\\,\\mathrm{m}$","$4\\,\\mathrm{m}$"] },
  { type:"MC", diff:"VD", topic:"p12.nuclear", grade:12,
    stem:"Hạt nhân $^{{A}}_{84}\\mathrm{Po}$ có bao nhiêu nơtron?",
    ch:["${B}$","$84$","$210$","$294$"] },
  { type:"TF", diff:"VD", topic:"p12.gas", grade:12,
    stem:"Một lượng khí lí tưởng thực hiện quá trình đẳng nhiệt, thể tích giảm từ ${A}\\,\\mathrm{l}$ xuống $2\\,\\mathrm{l}$.",
    tf:[["Áp suất của khí tăng lên.",true],["Tích $pV$ không đổi.",true],
        ["Nội năng của khí giảm.",false],["Mật độ phân tử khí tăng.",true]] },
  { type:"SHORT", diff:"TH", topic:"p12.thermal", grade:12,
    stem:"Cần bao nhiêu $\\mathrm{kJ}$ nhiệt lượng để đun ${A}\\,\\mathrm{kg}$ nước từ $20\\,^\\circ\\mathrm{C}$ lên $70\\,^\\circ\\mathrm{C}$? Biết $c = 4200\\,\\mathrm{J/(kg \\cdot K)}$.",
    sa:{ value:"{B}", unit:"kJ", tol:"1" } },
  { type:"MC", diff:"TH", topic:"p12.magnetic", grade:12,
    stem:"Đoạn dây dài $\\ell = {A}\\,\\mathrm{cm}$ mang dòng $I = 5\\,\\mathrm{A}$ đặt vuông góc từ trường đều $B = 0{,}4\\,\\mathrm{T}$. Lực từ bằng",
    ch:["${B}\\,\\mathrm{N}$","$4\\,\\mathrm{N}$","$0{,}04\\,\\mathrm{N}$","$40\\,\\mathrm{N}$"] }
];
