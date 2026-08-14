/* Nguồn DUY NHẤT cho mọi quyết định trình bày.
 *
 * Trước đây ba đường ra tự quyết lấy: bản xem trước HTML đọc `layout` một kiểu,
 * `buildDocxBody` đọc kiểu khác, `latex.mjs` chỉ đọc 4 trường. Nên chọn "Bảng
 * card" cho Đúng–Sai mà form tổng là Tối giản thì màn hình vẽ bảng còn Word ra
 * danh sách; chọn màu ở bảng màu thì bản xem trước không đổi vì CSS ghi đè.
 *
 * Nay cả ba đọc chung `resolveFormat()`. Thêm một kiểu trình bày = sửa đúng một
 * chỗ ở đây rồi dạy ba bộ dựng vẽ nó, chứ không phải đoán xem bên kia hiểu sao.
 *
 * File này chạy được ở cả trình duyệt lẫn Node: không đụng DOM, không import gì.
 */

/** Bảng màu mặc định của từng form câu hỏi. Chọn form = nạp bảng màu này. */
export const STYLE_PALETTES = {
  classic:            { accentColor:"#1d2430", accentSoft:"#f4f6f8", borderColor:"#9aa4b0" },
  "exam-blue":        { accentColor:"#287faf", accentSoft:"#edf7fc", borderColor:"#88bad4" },
  "specialist-pink":  { accentColor:"#c20a5b", accentSoft:"#fff0f6", borderColor:"#df7ba8" },
  "logic-green":      { accentColor:"#287e70", accentSoft:"#eef9f5", borderColor:"#78b7ab" },
  custom:             { accentColor:"#287faf", accentSoft:"#edf7fc", borderColor:"#88bad4" },
};

export const QUESTION_STYLES = Object.keys(STYLE_PALETTES);
export const MC_STYLES = ["plain","circle","cards","tabular"];
export const TF_STYLES = ["list","table","tabular"];
export const SHORT_STYLES = ["boxes","line"];
export const ESSAY_STYLES = ["lines","blank"];
export const HEADING_STYLES = ["plain","bar","outline"];
export const FONT_FAMILIES = ["legacy","latex","sans"];

/** Tên dạng câu in trên đề khi bật "Hiện tên dạng câu". */
export const TYPE_NAME = {
  MC:"Trắc nghiệm nhiều lựa chọn", TF:"Đúng – Sai",
  SHORT:"Trả lời ngắn", ESSAY:"Tự luận",
};

/** Bảng màu mặc định của một form. Dùng khi người dùng đổi form câu hỏi. */
export const paletteFor = (questionStyle) =>
  ({ ...(STYLE_PALETTES[questionStyle] || STYLE_PALETTES.custom) });

const pick = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

const hex = (value, fallback) =>
  /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value) : fallback;

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const clampInt = (value, min, max, fallback) => Math.round(clamp(value, min, max, fallback));

const text = (value, fallback) => {
  const s = String(value ?? "").trim();
  return s || fallback;
};

/**
 * Chuẩn hoá `layout` thành bảng quyết định mà cả ba bộ dựng đọc được.
 *
 * `card` là chỗ duy nhất phân biệt "Tối giản" với ba form còn lại: Tối giản
 * không đóng khung câu. MỌI lựa chọn khác (kiểu phương án, kiểu Đúng–Sai, ô trả
 * lời ngắn, tiêu đề phần…) phải chạy được ở CẢ BỐN form — bản cũ khoá chúng sau
 * điều kiện "có form màu" nên chọn xong không thấy gì đổi.
 */
export function resolveFormat(layout = {}){
  const questionStyle = pick(layout.questionStyle, QUESTION_STYLES, "classic");
  const base = paletteFor(questionStyle);
  return {
    questionStyle,
    card: questionStyle !== "classic",

    ink:    hex(layout.accentColor, base.accentColor),
    soft:   hex(layout.accentSoft,  base.accentSoft),
    border: hex(layout.borderColor, base.borderColor),

    fontFamily: pick(layout.fontFamily, FONT_FAMILIES, "legacy"),
    fontSize:   clamp(layout.fontSize, 8, 20, 12),
    lineGap:    clamp(layout.lineGap, 1, 2.5, 1.15),
    columns:    Number(layout.columns) === 2 ? 2 : 1,

    margin: {
      top:    clamp(layout.marginTop, 0.3, 5, 1),
      right:  clamp(layout.marginRight, 0.3, 5, 1),
      bottom: clamp(layout.marginBottom, 0.3, 5, 1),
      left:   clamp(layout.marginLeft, 0.3, 5, 1),
    },

    sectionHeading: pick(layout.sectionHeading, HEADING_STYLES, "plain"),
    showTypeLabel:  layout.showTypeLabel !== false,

    mcStyle:   pick(layout.mcStyle, MC_STYLES, "plain"),
    mcColumns: [1,2,4].includes(Number(layout.mcColumns)) ? Number(layout.mcColumns) : 2,

    tfStyle: pick(layout.tfStyle, TF_STYLES, "list"),

    shortStyle:     pick(layout.shortStyle, SHORT_STYLES, "boxes"),
    shortBoxCount:  clampInt(layout.shortBoxCount, 1, 6, 1),
    shortWorkLines: clampInt(layout.shortWorkLines, 0, 30, 0),
    shortWorkLabel: text(layout.shortWorkLabel, "Phần trình bày / ghi chú"),

    essayStyle:     pick(layout.essayStyle, ESSAY_STYLES, "lines"),
    essayWorkLines: clampInt(layout.essayWorkLines, 0, 30, 0),
    essayWorkLabel: text(layout.essayWorkLabel, "Bài làm"),

    topNote:    String(layout.topNote ?? ""),
    bottomNote: String(layout.bottomNote ?? ""),

    watermark:        String(layout.watermark ?? "").trim(),
    watermarkOpacity: clamp(layout.watermarkOpacity, 1, 40, 8),
    watermarkAngle:   clamp(layout.watermarkAngle, -90, 90, -30),
  };
}

/**
 * Số cột phương án THẬT SỰ dùng.
 *
 * Phương án dài hoặc có phân số/tích phân mà nhét 4 cột thì chữ vỡ ra khỏi ô,
 * nên tự bớt cột. Ba bộ dựng phải bớt GIỐNG NHAU, không thì cùng một đề mà màn
 * hình 2 cột, Word 4 cột, PDF 1 cột.
 */
export function mcColumnsFor(choices, requested){
  const columns = [1,2,4].includes(Number(requested)) ? Number(requested) : 2;
  const texts = (Array.isArray(choices) ? choices : []).map(choice => String(choice ?? ""));
  const longest = Math.max(0, ...texts.map(value => value.length));
  const complex = texts.some(value => /\\(?:d?frac|int|sum|prod|begin)|\n/.test(value));
  if(columns === 4 && (complex || longest > 24)) return 2;
  if(columns > 1 && longest > 62) return 1;
  return columns;
}
