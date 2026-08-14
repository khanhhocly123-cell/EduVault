/**
 * Gọi model OCR NGAY TRONG tiến trình server.
 *
 * Bản cũ spawn `tsx phase0/src/cli.ts` cho mỗi trang. Ba kiểu hỏng đã đo được
 * trong `data/eduvault.sqlite` (bảng ingest_jobs):
 *
 *   1. `spawn EPERM` — antivirus/quyền chặn việc đẻ tiến trình con.
 *   2. `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) … win\async.c:76`
 *      — tiến trình con chết lúc teardown SAU KHI đã trích xong; JSON nằm trên
 *      đĩa nhưng exit code khác 0 nên job bị đánh là hỏng.
 *   3. Lỗi lệch schema bị regex "lỗi tạm thời" nuốt mất, báo thành
 *      "Không kết nối được model OCR" — sai chỗ, người dùng đi kiểm tra mạng
 *      trong khi thật ra đề có 5 phương án A–E mà schema chỉ cho A–D.
 *
 * Ở đây không còn tiến trình con: một lời gọi HTTP, đọc streaming bằng fetch
 * có sẵn của Node. Lỗi được phân loại thật (mạng / hết quota / sai key / model
 * trả rác) để UI nói đúng việc cần làm.
 */
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.dirname(fileURLToPath(import.meta.url));
const PHASE0 = path.resolve(WEB, "..", "phase0");
const FALLBACK_MODEL = "gemini-3.5-flash";

/* ── cấu hình ────────────────────────────────────────────────────────────── */

let envCache = null;
/** Đọc phase0/.env một lần. Biến trong process.env luôn thắng file. */
function fileEnv() {
  if (envCache) return envCache;
  envCache = {};
  for (const file of [path.join(PHASE0, ".env"), path.join(WEB, ".env")]) {
    try {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
        if (!match || line.trim().startsWith("#")) continue;
        const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
        if (value && !(match[1] in envCache)) envCache[match[1]] = value;
      }
    } catch { /* không có file cũng được, miễn process.env có key */ }
  }
  return envCache;
}
export function envValue(name) {
  return process.env[name]?.trim() || fileEnv()[name] || "";
}

export function configuredModel() {
  return envValue("DE_MODEL") || FALLBACK_MODEL;
}

/**
 * Cổng nói giao thức OpenAI chat-completions. App chỉ đi đường này: một class,
 * đổi nhà bằng một dòng. Model của Anthropic/OpenAI vẫn gọi được nhưng phải đi
 * qua ví Stali (`stali:claude-sonnet-5`), không gọi thẳng API riêng của họ.
 */
const VENDORS = {
  gemini: {
    label: "Google Gemini", envKey: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    hint: "aistudio.google.com/apikey — có hạn mức miễn phí",
  },
  stali: {
    label: "Stali", envKey: "STALI_API_KEY", baseUrl: "https://api.stali.vn/v1",
    hint: "api.stali.vn — nạp ví bằng VietQR",
  },
  openrouter: {
    label: "OpenRouter", envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1", hint: "openrouter.ai/keys",
  },
};

export function splitModel(model) {
  const explicit = /^([a-z]+):(.+)$/i.exec(String(model || ""));
  if (explicit && VENDORS[explicit[1].toLowerCase()])
    return { vendor: explicit[1].toLowerCase(), id: explicit[2] };
  if (explicit && ["anthropic", "openai"].includes(explicit[1].toLowerCase()))
    throw Object.assign(new Error(
      `App chỉ gọi qua cổng chat-completions. Muốn dùng "${explicit[2]}" thì định tuyến qua ví: stali:${explicit[2]}`,
    ), { kind: "config" });
  const id = String(model || "");
  if (/^(gemini|gemma)-/.test(id)) return { vendor: "gemini", id };
  if (id.includes("/")) return { vendor: "openrouter", id };
  return { vendor: "stali", id };
}

/** Kiểm tra cấu hình mà KHÔNG tốn một lượt gọi model. */
export function ocrConfig() {
  const model = configuredModel();
  try {
    const { vendor, id } = splitModel(model);
    const config = VENDORS[vendor];
    const key = envValue(config.envKey);
    return {
      model, vendor, modelId: id, baseUrl: config.baseUrl,
      ready: Boolean(key), envKey: config.envKey, hint: config.hint,
      keyHint: key ? `${key.slice(0, 6)}…${key.slice(-4)}` : null,
    };
  } catch (error) {
    return { model, vendor: null, ready: false, error: error.message };
  }
}

/* ── schema ──────────────────────────────────────────────────────────────── */

const str = { type: "string" };
const nullableStr = { type: ["string", "null"] };
const nullableNum = { type: ["number", "null"] };

/**
 * Hình của câu. `bbox` GIỮ LẠI vì đây là thứ duy nhất cho phép cắt ảnh tự động;
 * cắt lệch thì giáo viên kéo lại trong màn Duyệt.
 *
 * Bbox của CÂU và của CỤM đã bỏ hẳn: highlight không còn, mà mỗi câu bắt model
 * đo thêm 4 số là thêm token ra và thêm một thứ để sai. Đối chiếu giờ làm bằng
 * bảng câu ↔ trang.
 */
const imageSchema = {
  type: "object", additionalProperties: false,
  required: ["slot", "bbox", "caption", "note"],
  properties: {
    slot: { type: "integer" },
    bbox: { type: "array", items: { type: "number" } },
    caption: nullableStr,
    note: nullableStr,
  },
};

const shortAnswerSchema = {
  type: ["object", "null"], additionalProperties: false,
  required: ["value", "unit", "tolerance"],
  properties: { value: str, unit: nullableStr, tolerance: nullableNum },
};

/* Phương án KHÔNG khoá cứng bốn cái A–D nữa.
   Đề đại học (Giải tích HCMUT, ĐGNL) hay có 5 phương án A–E, trong đó một
   phương án là "Các câu khác sai". Bản cũ khoá enum A–D nên cả trang hỏng và
   lỗi còn bị báo nhầm thành lỗi mạng. */
const mcChoiceSchema = {
  type: "object", additionalProperties: false, required: ["label", "text_latex"],
  properties: { label: str, text_latex: str },
};

const questionSchema = {
  type: "object", additionalProperties: false,
  required: ["type", "problem_ref", "printed_number", "stem_latex", "group_ref", "images",
    "mc_choices", "mc_correct", "answer_source", "tf_statements",
    "short_answer", "solution_latex", "grade", "topic_code", "difficulty", "notes"],
  properties: {
    type: { type: "string", enum: ["MC", "TF", "SHORT", "ESSAY"] },
    /* Số hiệu BÀI LỚN. Đề HSG/olympiad/đại học đánh số câu con lại từ 1 trong
       mỗi bài, nên thiếu trường này thì "câu 1" của bài Ж1 và "câu 1" của bài Ж4
       lẫn vào nhau lúc ghép đáp án — đã dính đúng lỗi đó với đề HSG QG Yên Bái. */
    problem_ref: nullableStr,
    printed_number: nullableStr,
    stem_latex: str,
    group_ref: nullableStr,
    images: { type: "array", items: imageSchema },
    mc_choices: { type: ["array", "null"], items: mcChoiceSchema },
    mc_correct: nullableStr,
    answer_source: { type: "string", enum: ["printed", "none"] },
    tf_statements: {
      type: ["array", "null"],
      items: {
        type: "object", additionalProperties: false,
        required: ["idx", "text_latex", "is_true"],
        properties: { idx: str, text_latex: str, is_true: { type: ["boolean", "null"] } },
      },
    },
    short_answer: shortAnswerSchema,
    solution_latex: nullableStr,
    grade: { type: ["integer", "null"] },
    topic_code: nullableStr,
    difficulty: { type: "string", enum: ["NB", "TH", "VD", "VDC"] },
    notes: nullableStr,
  },
};

const groupSchema = {
  type: "object", additionalProperties: false,
  required: ["ref", "problem_ref", "label", "stem_latex", "images", "question_numbers"],
  properties: {
    ref: str, problem_ref: nullableStr, label: nullableStr, stem_latex: str,
    images: { type: "array", items: imageSchema },
    question_numbers: { type: "array", items: str },
  },
};

const printedAnswerSchema = {
  type: "object", additionalProperties: false,
  required: ["type", "problem_ref", "question_number", "mc_correct", "tf_correct", "short_answer", "solution_latex"],
  properties: {
    type: { type: "string", enum: ["MC", "TF", "SHORT", "ESSAY"] },
    problem_ref: nullableStr,
    question_number: str,
    mc_correct: nullableStr,
    tf_correct: { type: ["array", "null"], items: { type: "boolean" } },
    short_answer: shortAnswerSchema,
    solution_latex: nullableStr,
  },
};

export const PAGE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["page", "page_role", "answers_heading", "groups", "questions", "printed_answers"],
  properties: {
    page: { type: "integer" },
    /* Phân loại trang TRƯỚC khi trích. Đề HSG/olympiad thường là "đề ở đầu,
       ĐÁP ÁN ở nửa sau"; không phân loại thì model biến từng đoạn lời giải
       thành một "câu hỏi" mới và kho đầy rác. */
    page_role: { type: "string", enum: ["de", "dap_an", "hon_hop", "khac"] },
    /* Sự kiện NHÌN THẤY được, không phải phán đoán: trang này có in tiêu đề mục
       "ĐÁP ÁN"/"LỜI GIẢI" hay không. Chỉ mốc này mới được lật cả tài liệu sang
       chế độ lời giải — đo thật trên đề HSG QG Yên Bái: model gọi nhầm trang 3
       (đề thuần) là "hon_hop", và nếu tin theo thì bốn câu ở trang 4–5 biến mất. */
    answers_heading: { type: "boolean" },
    groups: { type: "array", items: groupSchema },
    questions: { type: "array", items: questionSchema },
    printed_answers: { type: "array", items: printedAnswerSchema },
  },
};

/* ── prompt ──────────────────────────────────────────────────────────────── */

export const TOPICS = {
  physics: {
    "p10.kinematics": "Động học", "p10.dynamics": "Động lực học", "p10.energy": "Năng lượng",
    "p10.momentum": "Động lượng", "p10.circular": "Chuyển động tròn", "p10.solid": "Biến dạng vật rắn",
    "p11.oscillation": "Dao động", "p11.wave": "Sóng", "p11.efield": "Điện trường",
    "p11.current": "Dòng điện, mạch điện", "p12.thermal": "Vật lí nhiệt", "p12.gas": "Khí lí tưởng",
    "p12.magnetic": "Từ trường", "p12.nuclear": "Hạt nhân",
  },
  math: {
    "m10.vector": "Vectơ", "m10.set": "Mệnh đề, tập hợp", "m11.sequence": "Dãy số, cấp số",
    "m11.space": "Quan hệ vuông góc", "m11.limit": "Giới hạn, hàm số liên tục",
    "m12.derivative": "Khảo sát hàm số", "m12.integral": "Nguyên hàm, tích phân",
    "m12.oxyz": "Toạ độ Oxyz", "m12.stats": "Thống kê", "m12.prob": "Xác suất có điều kiện",
  },
};
const SUBJECT_NAMES = { physics: "Vật lí", math: "Toán" };
export const isKnownTopic = (code) =>
  Boolean(code) && (code in TOPICS.physics || code in TOPICS.math);

const SUBJECT_RULES = {
  physics: `QUY ƯỚC RIÊNG MÔN VẬT LÍ
- Vector viết $\\vec{v}$. Góc viết $30^\\circ$. Nhiệt độ Kelvin viết $300\\,\\mathrm{K}$, độ C viết $27\\,^\\circ\\mathrm{C}$.
- Hạt nhân viết $^{235}_{92}\\mathrm{U}$ — số khối trên, số hiệu dưới.
- Chỉ số dưới là chữ tiếng Việt thì bọc \\mathrm: $W_{\\mathrm{đ}}$, $A_{\\mathrm{ms}}$.`,
  math: `QUY ƯỚC RIÊNG MÔN TOÁN
- Vector viết $\\vec{u}$, đường thẳng và mặt phẳng viết $(P)$, $(ABCD)$.
- Tích phân viết $\\int_0^1 f(x)\\,\\mathrm{d}x$ — vi phân là \\mathrm{d}x, không phải dx nghiêng.
- Giới hạn viết $\\lim_{x \\to 2}$, vô cực viết $\\infty$.
- Xác suất có điều kiện viết $P(A \\mid B)$, vuông góc viết $\\perp$, song song viết $\\parallel$.
- Dãy số viết $(u_n)$, số hạng viết $u_1$, $u_n$.`,
};

const COMMON_RULES = `VIỆC ĐẦU TIÊN — TRANG NÀY LÀ ĐỀ HAY LÀ LỜI GIẢI?

Điền hai trường này trước khi trích bất cứ thứ gì:

"answers_heading" — CHỈ nhìn, KHÔNG suy đoán. Đặt true khi và chỉ khi trên trang
có in một dòng TIÊU ĐỀ MỤC như "ĐÁP ÁN", "LỜI GIẢI", "HƯỚNG DẪN CHẤM", "BAREM",
"ĐÁP ÁN VÀ THANG ĐIỂM", "ANSWER KEY" — chữ to, in đậm hoặc căn giữa, đánh dấu
bắt đầu một phần mới. Trang chỉ chứa lời giải mà KHÔNG có dòng tiêu đề đó thì
vẫn là false. Đây là mốc để hệ thống biết phần đáp án bắt đầu từ đâu, nên đoán
bừa ở đây sẽ xoá mất những câu hỏi thật ở các trang sau.

"page_role":
- "de": trang chứa đề bài để học sinh làm.
- "dap_an": trang nằm trong phần đáp án/lời giải — nội dung là bài giải đã có kết quả ("Gọi X là…", "Từ đó tìm được…", "Thay số ta có…", một chuỗi biến đổi dẫn tới đáp số).
- "hon_hop": nửa trên còn là đề, nửa dưới bắt đầu phần đáp án.
- "khac": bìa, mục lục, trang trắng, trang nội quy.

Lưu ý: đề HSG và olympiad có những bài mà PHẦN ĐỀ đã dài, nhiều công thức và
biến đổi sẵn (ví dụ cho trước phương trình rồi yêu cầu "Tìm biểu thức của…").
Dài và nhiều công thức KHÔNG có nghĩa là lời giải. Còn thấy câu lệnh cho học
sinh làm ("Tìm…", "Chứng minh…", "Hãy xây dựng…") thì vẫn là "de".

**Trang "dap_an": mảng "questions" PHẢI RỖNG.** Toàn bộ nội dung đọc được đi vào
"printed_answers", mỗi mục là lời giải của MỘT câu, với "problem_ref" +
"question_number" đúng như đánh số trong phần đáp án, và lời giải đặt vào
"solution_latex". Đừng biến một đoạn lời giải thành câu hỏi mới — đó là lỗi tốn
kém nhất: kho của giáo viên đầy "câu hỏi" thật ra là mảnh bài giải.

ĐÁNH SỐ — BÀI LỚN VÀ CÂU CON LÀ HAI THỨ KHÁC NHAU
- "problem_ref" là số hiệu BÀI LỚN in trên đề: "Ж1", "Bài 2", "Câu III", "Problem 4", "Phần A".
- "printed_number" là số của CÂU CON bên trong bài lớn đó: "1", "2", "3", "a", "b".
- Đề HSG, olympiad và đề đại học đánh số câu con **lại từ 1 trong mỗi bài lớn**.
  Thiếu "problem_ref" thì câu 1 của bài Ж1 và câu 1 của bài Ж4 lẫn vào nhau và
  đáp án bị ghép sai câu. Luôn điền "problem_ref" nếu trang có số hiệu bài lớn,
  kể cả khi số hiệu đó ở đầu trang trước và trang này chỉ có câu con.
- Đề trắc nghiệm đánh số liên tục 1..40 thì "problem_ref" = null.

NGUYÊN TẮC CỐT LÕI — CHÉP, KHÔNG SÁNG TÁC
- Không sửa số liệu, không đổi đơn vị, không "làm đẹp" câu chữ, không bổ sung dữ kiện còn thiếu.
- Chỗ nào mờ không đọc chắc chắn được thì để trống và ghi rõ vào "notes". Tuyệt đối không đoán số.
- "difficulty" và "topic_code" là phỏng đoán của bạn — cứ đoán, đừng bỏ trống, giáo viên sẽ sửa.

ĐÁP ÁN — CHỈ CHÉP PHẦN ĐƯỢC IN, TUYỆT ĐỐI KHÔNG TỰ GIẢI
- Tài liệu CÓ in đáp án (bảng đáp án cuối đề, chữ đậm, khoanh tròn, phần lời giải) thì chép đúng phần nhìn thấy và đặt "answer_source" = "printed".
- Tài liệu KHÔNG in đáp án của câu thì "answer_source" = "none", "mc_correct" = null, "short_answer" = null, "solution_latex" = null, mọi "is_true" = null.
- KHÔNG tính toán, KHÔNG suy luận, KHÔNG chọn phương án dù bạn biết cách giải. Đây là việc OCR, không phải làm bài.
- Trang không có đáp án in sẵn thì "printed_answers" là mảng rỗng.

QUY ƯỚC LATEX (bắt buộc, bộ render phía sau phụ thuộc vào đúng các quy ước này)
- Toán học bọc trong $...$, không dùng \\( \\).
- Xuống dòng thì xuống dòng thật trong chuỗi JSON. TUYỆT ĐỐI không gõ hai ký tự gạch chéo + n; nó hiện nguyên xi trên màn hình giáo viên.
- Dấu thập phân giữ kiểu Việt Nam: viết $0{,}5$, KHÔNG viết $0.5$. Đây là lỗi hay gặp nhất — kiểm lại từng con số.
- Đơn vị dùng \\mathrm: $5\\,\\mathrm{m/s}$, $100\\,\\mathrm{g}$.
- Phân số viết \\dfrac, không viết \\frac.
- Chỉ dùng lệnh LaTeX cơ bản. Không tự chế macro, không dùng package ngoài.

HÌNH VẼ — CHỖ DUY NHẤT CÒN PHẢI ĐO TOẠ ĐỘ
- Tính là hình: hình vẽ, sơ đồ mạch điện, đồ thị, bảng số liệu vẽ dạng hình, mặt phẳng nghiêng, con lắc, tia sáng, hình không gian, biểu đồ.
- KHÔNG tính là hình: công thức toán (dù dài), bảng chữ thuần, khung viền trang trí, logo trường, chữ ký, dấu mộc.
- Cách khai báo: chèn [[IMG:1]] đúng chỗ hình xuất hiện trong "stem_latex" (đánh số từ 1, đếm riêng trong từng câu), rồi thêm một phần tử vào "images" có "slot" trùng số đó.
- "bbox" của hình là [x0, y0, x1, y1] chuẩn hoá 0–1 đo trên TOÀN BỘ ảnh được gửi vào, tính cả tiêu đề, lề trắng và chân trang. y=0 là mép trên thật của ảnh, y=1 là mép dưới thật.
- Ước lượng khít hình; chừa lề rộng một chút còn hơn cắt mất nét. Không để bbox trùm sang chữ của câu khác.
- "note" tả hình bằng tiếng Việt, một câu, đủ để người chưa thấy ảnh vẽ lại được.
- "caption" chỉ điền khi tài liệu có in chú thích dưới hình (ví dụ "Hình 2"), không có thì null.
- Không thấy hình nào thì "images" là mảng rỗng. Đừng khai khống.
- KHÔNG phải đo toạ độ cho câu hay cho cụm dữ liệu. Chỉ hình mới có bbox.

CÂU HỎI NHÓM — MỘT CỤM DỮ LIỆU DÙNG CHUNG CHO NHIỀU CÂU
- Một đoạn văn/tình huống/bảng/biểu đồ/hình dùng chung cho từ 2 câu con trở lên thì tạo đúng MỘT phần tử trong "groups"; không chép lặp cụm dẫn vào từng câu.
- **Một bài lớn có nhiều câu con CHÍNH LÀ một group.** Ví dụ "Ж1. Va chạm hạt – hệ thanh" có phần dẫn chung rồi ba ý 1., 2., 3. thì: một group với "problem_ref" = "Ж1", "label" = "Ж1. Va chạm hạt – hệ thanh", "stem_latex" = toàn bộ phần dẫn chung kèm hình, "question_numbers" = ["1","2","3"]; và ba câu con, mỗi câu chỉ chứa phần riêng của nó.
- Mỗi group có "ref" ngắn duy nhất trong trang (g1, g2...), "problem_ref" là số hiệu bài lớn nếu có, "question_numbers" liệt kê số câu con mà cụm phục vụ.
- Mỗi câu con đặt "group_ref" bằng "ref" tương ứng **và** "problem_ref" bằng số hiệu bài lớn. Câu đứng độc lập đặt cả hai bằng null. Không tạo group chỉ có một câu con.
- Cụm ở trang trước còn câu con ở trang sau: trang sau **không chép lại cụm**, chỉ cần điền đúng "problem_ref" cho từng câu con — hệ thống tự nối. Nếu bối cảnh phía dưới cho biết bài lớn nào đang mở thì dùng đúng số hiệu đó.
- Trang không có câu hỏi nhóm thì "groups" là mảng rỗng.

PHÂN LOẠI DẠNG CÂU
- MC: trắc nghiệm chọn một phương án. Số phương án LẤY ĐÚNG NHƯ TRÊN ĐỀ — đề phổ thông thường 4 (A–D), đề đại học có thể 5 (A–E, hay có phương án "Các câu khác sai"). Chép đủ, "label" ghi đúng chữ cái in trên đề.
- TF: câu đúng/sai — một dẫn đề chung kèm các ý a/b/c/d, mỗi ý có đúng/sai riêng. Không nhầm với MC.
- SHORT: trả lời ngắn, đáp án là một con số. "value" ghi dạng chuỗi, giữ nguyên dấu phẩy thập phân.
- ESSAY: tự luận.

ĐỘ KHÓ: NB (nhận biết), TH (thông hiểu), VD (vận dụng), VDC (vận dụng cao).`;

export function extractionSystem(subject) {
  const codes = Object.entries(TOPICS[subject] ?? TOPICS.physics)
    .map(([code, name]) => `${code} (${name})`).join(", ");
  return `Bạn là bộ nhập liệu cho kho đề ${SUBJECT_NAMES[subject] ?? "Vật lí"} của giáo viên Việt Nam. Nhiệm vụ: đọc trang tài liệu được đưa vào và trích xuất các câu hỏi thành dữ liệu có cấu trúc.

${COMMON_RULES}

${SUBJECT_RULES[subject] ?? SUBJECT_RULES.physics}

CHUYÊN ĐỀ (topic_code) — chọn ĐÚNG MỘT mã trong danh sách sau, không tự chế mã mới:
${codes}

Một trang có nhiều câu thì trả về nhiều phần tử. Câu bị cắt ngang trang thì vẫn trích phần đọc được và ghi rõ vào "notes".`;
}

export const EXTRACTION_USER = "Trích xuất toàn bộ câu hỏi trong trang này.";

/**
 * Bối cảnh từ các trang trước, do BACKEND dựng chứ không phải model đoán.
 *
 * Model chỉ nhìn thấy đúng một trang mỗi lượt gọi, nên nó không thể biết trang 13
 * nằm sau chữ "ĐÁP ÁN" in ở trang 6, cũng không biết bài Ж3 mở từ trang trước.
 * Pipeline thì biết. Trạng thái tuần tự thuộc về backend; nhét vào prompt vài
 * dòng rẻ hơn nhiều so với gửi lại các trang trước.
 */
export function contextBlock({ answersFromPage = null, openProblem = null, seenNumbers = [] } = {}) {
  const lines = [];
  if (answersFromPage)
    lines.push(`- Tài liệu đã vào phần ĐÁP ÁN/LỜI GIẢI từ trang ${answersFromPage}. Trang này gần như chắc chắn là lời giải chứ không phải đề: đặt "page_role"="dap_an" và để "questions" rỗng, trừ khi trên trang có tiêu đề nói rõ đã quay lại phần đề.`);
  if (openProblem)
    lines.push(`- Bài lớn đang mở từ trang trước: ${openProblem}. Câu con trên trang này nhiều khả năng thuộc bài đó — điền "problem_ref" đúng số hiệu này và ĐỪNG chép lại phần dẫn chung.`);
  if (seenNumbers.length)
    lines.push(`- Các câu con đã đọc được của bài đó: ${seenNumbers.join(", ")}.`);
  if (!lines.length) return "";
  return `\n\nBỐI CẢNH TỪ CÁC TRANG TRƯỚC (hệ thống cung cấp, không có trên ảnh):\n${lines.join("\n")}`;
}

/* ── gọi model ───────────────────────────────────────────────────────────── */

const MEDIA = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** Lỗi có kèm `kind` để tầng trên biết nên thử lại, đổi key hay bảo người dùng sửa file. */
export class OcrError extends Error {
  constructor(message, kind, { retryable = false, status = null, detail = null } = {}) {
    super(message);
    this.name = "OcrError";
    this.kind = kind;           // network | quota | auth | model | schema | config
    this.retryable = retryable;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Cắt JSON bị dừng giữa chừng về phần tử cuối còn nguyên vẹn.
 *
 * Trang 20 câu chạm trần token là chuyện thường. Bản cũ ném lỗi và mất trắng
 * cả trang; ở đây giữ những câu đã đọc xong và báo rõ còn thiếu, giáo viên đọc
 * nốt phần cuối bằng mắt thay vì OCR lại từ đầu.
 */
/**
 * Vá escape sai trong chuỗi JSON chứa LaTeX.
 *
 * Model phải viết `\\dfrac` để chuỗi JSON mang đúng `\dfrac`, và nó làm đúng ở
 * đa số chỗ — nhưng chỉ cần trượt một lần thành `\dfrac` là `JSON.parse` ném
 * lỗi và **cả trang mất trắng**. Đo thật trên đề HSG QG Yên Bái: trang 7 có
 * `\\left` đúng nằm ngay cạnh `\dfrac` sai trong cùng một chuỗi.
 *
 * Ở đây chỉ đụng vào BÊN TRONG chuỗi: gặp `\` đi kèm ký tự không phải escape
 * hợp lệ của JSON thì nhân đôi dấu gạch chéo, tức là hiểu đúng ý model.
 */
/**
 * Lệnh LaTeX bắt đầu bằng đúng năm chữ cái mà JSON coi là escape hợp lệ:
 * b (backspace), f (formfeed), n (newline), r (CR), t (tab).
 *
 * Đây là ca nguy hiểm nhất vì nó KHÔNG ném lỗi: `"\right"` parse ngon lành
 * thành ký tự xuống dòng + "ight", công thức hỏng âm thầm và không ai biết.
 * Chỉ nhận diện khi cả cụm chữ cái khớp đúng một lệnh có thật — nhờ vậy
 * `"\nb)"` (model muốn xuống dòng rồi ghi "b)") vẫn được hiểu là xuống dòng.
 */
const CONTROL_LIKE_LATEX = new Set([
  "begin", "beta", "bar", "big", "bigg", "binom", "bmatrix", "boxed", "bullet", "bot", "bm",
  "frac", "forall", "fbox", "frown", "flat",
  "nabla", "ne", "neq", "neg", "ni", "notin", "not", "nu", "nonumber", "newline", "nolimits",
  "right", "rightarrow", "rho", "rangle", "rfloor", "rceil", "rm", "root",
  "text", "theta", "times", "tan", "tfrac", "tilde", "to", "top", "triangle", "tau", "tbinom",
]);

export function repairJsonEscapes(source) {
  const text = String(source);
  let out = "", inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    if (ch === '"') { out += ch; inString = false; continue; }
    if (ch !== "\\") { out += ch; continue; }
    const next = text[i + 1];
    if (next === undefined) { out += "\\\\"; continue; }
    const validSimple = '"\\/bfnrt'.includes(next);
    const validUnicode = next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6));
    if (validSimple || validUnicode) {
      if ("bfnrt".includes(next)) {
        const word = /^[a-zA-Z]+/.exec(text.slice(i + 1))?.[0] ?? "";
        if (word.length > 1 && CONTROL_LIKE_LATEX.has(word)) { out += "\\\\"; continue; }
      }
      out += ch + next; i++; continue;
    }
    // `\dfrac`, `\alpha`, `\(`… — model quên nhân đôi. Nhân hộ.
    out += "\\\\";
  }
  return out;
}

export function repairTruncatedJson(text) {
  const original = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  /* Vá escape TRƯỚC khi parse, không phải chỉ khi parse hỏng: `"\right"` là JSON
     hợp lệ (xuống dòng + "ight") nên nếu đợi lỗi thì công thức đã hỏng âm thầm. */
  const fixed = repairJsonEscapes(original);
  for (const [candidate, repaired] of [[fixed, fixed !== original], [original, false]]) {
    try { return { value: JSON.parse(candidate), truncated: false, repairedEscapes: repaired }; }
    catch { /* thử bản sau, rồi mới tới vá cắt cụt */ }
  }
  let source = fixed;

  // Cắt về sau dấu `}` cuối cùng đóng đúng một phần tử ở mức sâu nhất, rồi
  // đóng lại toàn bộ ngoặc còn mở theo đúng thứ tự.
  let inString = false, escaped = false;
  const stack = [];
  let lastSafe = -1, safeStack = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length >= 1) { lastSafe = i; safeStack = [...stack]; }
    }
  }
  if (lastSafe < 0) return { value: null, truncated: true };
  let patched = source.slice(0, lastSafe + 1);
  for (let i = safeStack.length - 1; i >= 0; i--) patched += safeStack[i] === "{" ? "}" : "]";
  try { return { value: JSON.parse(patched), truncated: true }; }
  catch { return { value: null, truncated: true }; }
}

function classifyHttp(status, body) {
  const text = String(body || "").slice(0, 600);
  if (status === 401 || status === 403)
    return new OcrError(`Cổng model từ chối key (HTTP ${status}). Kiểm tra API key trong phase0/.env.`, "auth", { status, detail: text });
  if (status === 402 || /insufficient|hết tiền|balance|credit/i.test(text))
    return new OcrError("Ví/hạn mức của cổng model đã hết. Nạp thêm rồi chạy lại.", "quota", { status, detail: text });
  if (status === 429)
    return new OcrError("Cổng model đang giới hạn tần suất (429). Hệ thống sẽ tự chờ rồi thử lại.", "quota", { status, retryable: true, detail: text });
  if (status >= 500)
    return new OcrError(`Cổng model lỗi phía họ (HTTP ${status}).`, "network", { status, retryable: true, detail: text });
  if (status === 400 && /response_format|json_schema|schema/i.test(text))
    return new OcrError("Cổng model không nhận json_schema.", "schema", { status, retryable: true, detail: text });
  return new OcrError(`Cổng model trả HTTP ${status}.`, "model", { status, detail: text });
}

/** Một lượt gọi. Ném OcrError; không tự thử lại — việc đó ở extractPage. */
async function callOnce({ imagePath, system, user, model, jsonMode, timeoutMs, stallMs, onProgress }) {
  const { vendor, id } = splitModel(model);
  const config = VENDORS[vendor];
  const key = envValue(config.envKey);
  if (!key)
    throw new OcrError(`Thiếu ${config.envKey} trong phase0/.env — lấy key tại ${config.hint}`, "config");

  const ext = path.extname(imagePath).toLowerCase();
  const mediaType = MEDIA[ext];
  if (!mediaType) throw new OcrError(`Định dạng ${ext} không gửi được cho model`, "config");
  const base64 = (await readFile(imagePath)).toString("base64");

  const body = {
    model: id,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: user },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
        ],
      },
    ],
    max_completion_tokens: 16000,
    stream: true,
    stream_options: { include_usage: true },
    response_format: jsonMode
      ? { type: "json_object" }
      : { type: "json_schema", json_schema: { name: "extraction", strict: true, schema: PAGE_SCHEMA } },
  };

  const controller = new AbortController();
  const started = Date.now();
  let lastChunkAt = Date.now();
  const hardTimer = setTimeout(() => controller.abort(new Error("hard-timeout")), timeoutMs);
  // Treo im lặng nguy hiểm hơn lỗi: gateway giữ socket mở mà không gửi byte nào.
  // Đo khoảng lặng giữa hai chunk thay vì chỉ đo tổng thời gian.
  const stallTimer = setInterval(() => {
    if (Date.now() - lastChunkAt > stallMs) controller.abort(new Error("stalled"));
  }, 5_000);

  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(hardTimer); clearInterval(stallTimer);
    throw new OcrError(`Không nối được tới ${config.label}: ${error?.cause?.code || error.message}`, "network", { retryable: true });
  }

  if (!response.ok) {
    clearTimeout(hardTimer); clearInterval(stallTimer);
    throw classifyHttp(response.status, await response.text().catch(() => ""));
  }

  let content = "", finishReason = null, usage = null, responseModel = id;
  try {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      lastChunkAt = Date.now();
      buffer += decoder.decode(chunk, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let event;
        try { event = JSON.parse(payload); } catch { continue; }
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) { content += delta; onProgress?.(content.length); }
        finishReason = event.choices?.[0]?.finish_reason ?? finishReason;
        usage = event.usage ?? usage;
        responseModel = event.model || responseModel;
      }
    }
  } catch (error) {
    const why = controller.signal.aborted ? String(controller.signal.reason?.message || "") : "";
    throw new OcrError(
      why === "stalled" ? `Cổng ${config.label} im lặng quá ${Math.round(stallMs / 1000)} giây giữa chừng.`
        : why === "hard-timeout" ? `Cổng ${config.label} không trả xong sau ${Math.round(timeoutMs / 1000)} giây.`
        : `Mất kết nối giữa chừng với ${config.label}: ${error?.cause?.code || error.message}`,
      "network", { retryable: true },
    );
  } finally {
    clearTimeout(hardTimer); clearInterval(stallTimer);
  }

  if (!content.trim())
    throw new OcrError(`Cổng ${config.label} trả về rỗng (finish_reason=${finishReason ?? "?"}).`, "model", { retryable: true });

  const { value, truncated } = repairTruncatedJson(content);
  if (!value)
    throw new OcrError(
      `Model trả về không phải JSON đọc được (finish_reason=${finishReason ?? "?"}).`,
      "model", { retryable: true, detail: content.slice(0, 500) },
    );

  return {
    data: value,
    truncated: truncated || finishReason === "length",
    usage: {
      model: responseModel,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      elapsedMs: Date.now() - started,
    },
  };
}

/* ── chuẩn hoá output ────────────────────────────────────────────────────── */

const LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const asArray = (value) => Array.isArray(value) ? value : [];

/**
 * Model hay trả về hai ký tự `\` + `n` thay cho một dấu xuống dòng thật — nó tự
 * escape thêm một lần khi viết JSON. Kết quả là giáo viên nhìn thấy nguyên chữ
 * "\n\nb)\n\n" giữa đề bài.
 *
 * Chỉ dọn ở phần CHỮ, không đụng vào trong `$…$`: `\ne`, `\nabla`, `\notin` là
 * lệnh LaTeX thật, thay bừa là hỏng công thức.
 */
export function cleanModelText(value) {
  return String(value ?? "")
    .split(/(\$[^$]*\$)/g)
    .map(part => part.startsWith("$")
      ? part
      : part.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\\t/g, " "))
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    // Giữ dòng trống ngăn đoạn — nhiều câu con có 2–3 đoạn, gộp hết thành một
    // khối chữ thì đọc để đối chiếu rất mệt.
    .replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const asText = (value) => value == null ? null : (cleanModelText(value) || null);

function normalizeImages(list) {
  return asArray(list).map((image, index) => ({
    slot: Number.isFinite(Number(image?.slot)) ? Number(image.slot) : index + 1,
    bbox: Array.isArray(image?.bbox) ? image.bbox.map(Number) : null,
    caption: asText(image?.caption), note: asText(image?.note),
  })).filter(image => image.bbox);
}

/**
 * Đưa output của model về đúng hình dạng pipeline mong đợi, và ghi lại mọi chỗ
 * phải sửa vào `notes` của câu. Không im lặng vứt dữ liệu: chỗ nào bị bỏ thì
 * giáo viên phải nhìn thấy lý do trong màn Duyệt.
 */
export function normalizePage(raw, pageNumber, { insideAnswerSection = false } = {}) {
  const declaredRole = ["de", "dap_an", "hon_hop", "khac"].includes(raw?.page_role) ? raw.page_role : "de";
  const role = insideAnswerSection && declaredRole !== "hon_hop" ? "dap_an" : declaredRole;
  /**
   * Chỉ chuyển "câu hỏi" thành lời giải khi tài liệu ĐÃ QUA tiêu đề ĐÁP ÁN.
   *
   * Trước khi qua mốc đó, model gọi nhầm một trang đề là "dap_an" là chuyện có
   * thật (đo trên đề HSG QG Yên Bái: trang 4 và 5 bị gọi nhầm) — nếu tin theo
   * thì bốn câu hỏi thật bị xoá không dấu vết. Nhãn sai chỉ được phép làm mất
   * dữ liệu khi có mốc khách quan xác nhận.
   */
  const dropQuestions = insideAnswerSection && role === "dap_an";

  const questions = asArray(raw?.questions).map(q => {
    const type = ["MC", "TF", "SHORT", "ESSAY"].includes(q?.type) ? q.type : "MC";
    const notes = [];
    let choices = null;
    if (type === "MC") {
      choices = asArray(q?.mc_choices).map((choice, index) => ({
        label: String(choice?.label || LABELS[index] || `${index + 1}`).trim().replace(/[.)]$/, "").toUpperCase(),
        text_latex: String(choice?.text_latex ?? ""),
      }));
      if (!choices.length) { choices = null; notes.push("Model không đọc được phương án nào; nhập tay khi duyệt."); }
      else if (choices.length > 8) choices = choices.slice(0, 8);
    }
    let statements = null;
    if (type === "TF") {
      statements = asArray(q?.tf_statements).map((s, index) => ({
        idx: String(s?.idx || "abcdefgh"[index] || index + 1).trim().replace(/[.)]$/, "").toLowerCase(),
        text_latex: String(s?.text_latex ?? ""),
        is_true: typeof s?.is_true === "boolean" ? s.is_true : null,
      }));
      if (!statements.length) { statements = null; notes.push("Model không đọc được ý đúng/sai nào; nhập tay khi duyệt."); }
    }
    const shortAnswer = type === "SHORT" && q?.short_answer && q.short_answer.value != null
      ? {
          value: String(q.short_answer.value),
          unit: asText(q.short_answer.unit) ?? "",
          tolerance: q.short_answer.tolerance == null ? null : String(q.short_answer.tolerance),
        }
      : null;
    const topic = isKnownTopic(q?.topic_code) ? q.topic_code : null;
    if (q?.topic_code && !topic) notes.push(`Mã chuyên đề "${q.topic_code}" không có trong bảng.`);
    const correctLabel = asText(q?.mc_correct)?.trim().replace(/[.)]$/, "").toUpperCase() || null;

    return {
      type,
      problem_ref: asText(q?.problem_ref),
      printed_number: asText(q?.printed_number),
      stem_latex: cleanModelText(q?.stem_latex),
      group_ref: asText(q?.group_ref),
      images: normalizeImages(q?.images),
      mc_choices: choices,
      mc_correct: type === "MC" ? correctLabel : null,
      answer_source: q?.answer_source === "printed" ? "printed" : "none",
      tf_statements: statements,
      short_answer: shortAnswer,
      solution_latex: asText(q?.solution_latex),
      grade: Number.isFinite(Number(q?.grade)) ? Number(q.grade) : null,
      topic_code: topic,
      difficulty: ["NB", "TH", "VD", "VDC"].includes(q?.difficulty) ? q.difficulty : "TH",
      notes: [asText(q?.notes), ...notes].filter(Boolean).join(" ") || null,
    };
  }).filter(q => q.stem_latex.trim() || q.mc_choices?.length);

  const groups = asArray(raw?.groups).map((group, index) => ({
    ref: String(group?.ref || `g${index + 1}`),
    problem_ref: asText(group?.problem_ref),
    label: asText(group?.label),
    stem_latex: cleanModelText(group?.stem_latex),
    images: normalizeImages(group?.images),
    question_numbers: asArray(group?.question_numbers).map(String),
  })).filter(group => group.stem_latex.trim() || group.images.length);

  const printed = asArray(raw?.printed_answers).map(entry => ({
    type: ["MC", "TF", "SHORT", "ESSAY"].includes(entry?.type) ? entry.type : "MC",
    problem_ref: asText(entry?.problem_ref),
    question_number: String(entry?.question_number ?? "").trim(),
    mc_correct: asText(entry?.mc_correct)?.trim().replace(/[.)]$/, "").toUpperCase() || null,
    tf_correct: Array.isArray(entry?.tf_correct) ? entry.tf_correct.map(Boolean) : null,
    short_answer: entry?.short_answer?.value != null
      ? { value: String(entry.short_answer.value), unit: asText(entry.short_answer.unit) ?? "", tolerance: null }
      : null,
    solution_latex: cleanModelText(entry?.solution_latex) || null,
  })).filter(entry => entry.question_number);

  /* Trang lời giải mà model vẫn trả "câu hỏi": đó là mảnh bài giải, không phải
     câu. Không vứt đi (mất dữ liệu người dùng đã trả tiền để đọc) mà chuyển
     thành lời giải in sẵn để bước reconcile ghép về đúng câu ở phần đề. */
  if (dropQuestions && questions.length) {
    for (const q of questions.splice(0)) {
      printed.push({
        type: q.type, problem_ref: q.problem_ref,
        question_number: q.printed_number || String(printed.length + 1),
        mc_correct: q.mc_correct, tf_correct: null, short_answer: q.short_answer,
        solution_latex: [q.stem_latex, q.solution_latex].filter(Boolean).join("\n") || null,
      });
    }
  }

  return {
    page: Number(raw?.page) || pageNumber, page_role: role,
    answers_heading: raw?.answers_heading === true,
    groups, questions, printed_answers: printed,
  };
}

/* ── API công khai ───────────────────────────────────────────────────────── */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Trích một trang. Tự thử lại các lỗi tạm thời và tự hạ xuống chế độ
 * `json_object` nếu cổng không nhận json_schema.
 */
export async function extractPage({
  imagePath, subject = "physics", pageNumber = 1, model = configuredModel(),
  attempts = 3, timeoutMs = 240_000, stallMs = 75_000, onProgress = null,
  context = null,
}) {
  const system = extractionSystem(subject === "math" ? "math" : "physics");
  const carry = contextBlock(context || {});
  let jsonMode = false;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await callOnce({
        imagePath, system, model, jsonMode, timeoutMs, stallMs, onProgress,
        user: jsonMode
          ? `${EXTRACTION_USER}${carry}\n\nTrả về DUY NHẤT một object JSON đúng schema sau, không kèm chữ nào khác:\n${JSON.stringify(PAGE_SCHEMA)}`
          : `${EXTRACTION_USER}${carry}`,
      });
      const page = normalizePage(result.data, pageNumber, {
        insideAnswerSection: Boolean(context?.answersFromPage),
      });
      if (result.truncated && page.questions.length) {
        const last = page.questions.at(-1);
        last.notes = [last.notes, "Output model bị cắt vì chạm trần token; những câu sau câu này chưa được đọc."].filter(Boolean).join(" ");
      }
      /* Trang rỗng KHÔNG phải lỗi. Đề thật có trang bìa, trang hướng dẫn, trang
         giấy nháp và trang chỉ chứa phần tiếp của một bài tự luận. Bản đầu coi
         đây là lỗi và giết cả tài liệu ở trang 9/15 — đúng kiểu giòn mà cả phiên
         này đang đi sửa. Ghi nhận rồi đi tiếp; bảng đối chiếu vẫn cho thấy
         khoảng trống vì số trang không liên tục. */
      const empty = !page.questions.length && !page.printed_answers.length && !page.groups.length;
      return { ...page, _usage: result.usage, _truncated: result.truncated, _empty: empty };
    } catch (error) {
      lastError = error instanceof OcrError ? error : new OcrError(String(error?.message || error), "model", { retryable: true });
      if (lastError.kind === "schema" && !jsonMode) { jsonMode = true; continue; }
      if (!lastError.retryable || attempt === attempts) break;
      await sleep(Math.min(8_000, 900 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

/** Gọi model bằng một ảnh 1×1 để kiểm tra key/đường mạng mà không tốn mấy token. */
export async function pingModel(model = configuredModel()) {
  const { vendor, id } = splitModel(model);
  const config = VENDORS[vendor];
  const key = envValue(config.envKey);
  if (!key) return { ok: false, kind: "config", message: `Thiếu ${config.envKey} trong phase0/.env` };
  const started = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: id, messages: [{ role: "user", content: "ping" }], max_completion_tokens: 4 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const error = classifyHttp(response.status, await response.text().catch(() => ""));
      return { ok: false, kind: error.kind, message: error.message, elapsedMs: Date.now() - started };
    }
    await response.json().catch(() => null);
    return { ok: true, model: id, vendor, elapsedMs: Date.now() - started };
  } catch (error) {
    return { ok: false, kind: "network", message: String(error?.cause?.code || error.message), elapsedMs: Date.now() - started };
  }
}
