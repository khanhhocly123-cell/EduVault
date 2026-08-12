import { z } from "zod";
import { isKnownTopic } from "./topics.js";

/**
 * Schema trích xuất — bản rút gọn của docs/ai-pipeline.md, đủ cho Phase 0.
 * Structured outputs không nhận min/max/recursive, nên mọi ràng buộc số lượng
 * (ví dụ TF phải đúng 4 ý) được kiểm ở validate() bên dưới thay vì trong schema.
 */

export const QuestionType = z.enum(["MC", "TF", "SHORT", "ESSAY"]);
export const Difficulty = z.enum(["NB", "TH", "VD", "VDC"]);

export const McChoice = z.object({
  label: z.enum(["A", "B", "C", "D"]),
  text_latex: z.string(),
});

export const TfStatement = z.object({
  idx: z.enum(["a", "b", "c", "d"]),
  text_latex: z.string(),
  is_true: z.boolean(),
});

export const ShortAnswer = z.object({
  value: z.number(),
  unit: z.string().nullable(),
  tolerance: z.number().nullable(),
});

/**
 * Hình đi kèm câu hỏi.
 *
 * Bốn trường đầu do MODEL điền khi đọc trang: nó thấy hình ở đâu, hình vẽ cái
 * gì. Ba trường sau do GIÁO VIÊN chỉnh trong app (cỡ, chỗ đặt, thay hình khác)
 * — model phải để null, đừng đoán hộ.
 *
 * Tách hai nhóm ra vì chúng có vòng đời khác nhau: nhóm đầu là dữ liệu đọc
 * được, nạp lại tài liệu là ra y hệt; nhóm sau là ý muốn của người dùng, nạp
 * lại không được đạp lên.
 */
export const FigurePlacement = z.enum([
  "top", // căn giữa, nằm trên phần phương án
  "below", // căn giữa, nằm dưới phương án
  "right", // nổi bên phải, chữ chạy vòng bên trái
  "left", // nổi bên trái
]);

export const ImageRef = z.object({
  slot: z.number().int(),
  /** Toạ độ chuẩn hoá 0-1 theo khổ trang: [x0, y0, x1, y1]. Dùng để cắt ảnh gốc. */
  bbox: z.array(z.number()),
  caption: z.string().nullable(),
  /** Model mô tả hình bằng tiếng Việt — để giáo viên biết cần vẽ/thay hình gì. */
  note: z.string().nullable(),

  /** ↓ giáo viên chỉnh, model để null ↓ */
  /** Bề rộng theo % chiều rộng cột chữ. null = 100% cho ảnh cắt, 45% cho hình dựng sẵn. */
  width_pct: z.number().nullable(),
  placement: FigurePlacement.nullable(),
  /** Khoá hình dựng sẵn ("spring", "incline"…) hoặc data URL của ảnh giáo viên tải lên. */
  src: z.string().nullable(),
});

/**
 * Đáp án ở đâu ra. Đề THPT phát cho học sinh thì KHÔNG in đáp án — mà giáo viên
 * lưu câu vào kho là để dùng lại, câu không đáp án gần như vô dụng.
 *
 * Nên cho model tự giải, nhưng phải khai báo thẳng là mình tự giải. Nhập nhèm
 * hai loại này lại là hỏng: đáp án chép từ đề thì tin được, đáp án model tự
 * giải thì phải có mắt người xem lại — nhất là câu vận dụng cao.
 */
export const AnswerSource = z.enum([
  "printed", // tài liệu có in đáp án, chỉ việc chép
  "solved", // model tự giải ra — PHẢI cho giáo viên duyệt
  "none", // không có đáp án và model cũng không chắc
]);

export const Question = z.object({
  type: QuestionType,
  stem_latex: z.string(),
  images: z.array(ImageRef),
  mc_choices: z.array(McChoice).nullable(),
  mc_correct: z.enum(["A", "B", "C", "D"]).nullable(),
  answer_source: AnswerSource,
  tf_statements: z.array(TfStatement).nullable(),
  short_answer: ShortAnswer.nullable(),
  solution_latex: z.string().nullable(),
  grade: z.number().int().nullable(),
  topic_code: z.string().nullable(),
  difficulty: Difficulty,
  notes: z.string().nullable(),
});

export const PageExtraction = z.object({
  page: z.number().int(),
  questions: z.array(Question),
});

export type TQuestion = z.infer<typeof Question>;
export type TPageExtraction = z.infer<typeof PageExtraction>;

/* ── Bước 2: đối chiếu chéo ────────────────────────────────────────────────
 * Model đối chiếu CHỈ được báo chỗ lệch, không được trả về câu hỏi viết lại.
 * Schema này chính là cái ràng buộc đó — không có trường nào chứa câu hỏi cả,
 * nên model có muốn "sửa hộ" cũng không có chỗ mà nhét.
 */
export const Discrepancy = z.object({
  /** Chỉ số câu trong bản trích xuất, đếm từ 0. */
  question_index: z.number().int(),
  /** Tên trường lệch: stem_latex, mc_choices[2].text_latex, short_answer.value, ... */
  field: z.string(),
  extracted: z.string(),
  from_image: z.string(),
  severity: z.enum(["high", "low"]),
  note: z.string().nullable(),
});

export const VerifyReport = z.object({
  discrepancies: z.array(Discrepancy),
});

export type TDiscrepancy = z.infer<typeof Discrepancy>;
export type TVerifyReport = z.infer<typeof VerifyReport>;

/** Metadata cho phần đầu đề — 1 trong 3 "ngoại hình" của bản đầy đủ. */
export interface ExamHeader {
  org: string;
  school: string;
  title: string;
  subject: string;
  durationMin: number;
  code?: string;
}

export interface ExamDoc {
  header: ExamHeader;
  questions: TQuestion[];
}

/**
 * Ràng buộc theo dạng câu. Trả về danh sách lỗi (rỗng = hợp lệ).
 * Đây là lưới an toàn cho output của model, không phải validation của người dùng.
 */
export function validateQuestion(q: TQuestion, index: number): string[] {
  const at = `câu ${index + 1} (${q.type})`;
  const errs: string[] = [];

  if (q.type === "MC") {
    if (!q.mc_choices || q.mc_choices.length !== 4)
      errs.push(`${at}: cần đúng 4 phương án, nhận được ${q.mc_choices?.length ?? 0}`);
    if (!q.mc_correct && q.answer_source !== "none") {
      errs.push(`${at}: khai answer_source="${q.answer_source}" mà không có đáp án`);
    }
  }

  if (q.type === "TF") {
    if (!q.tf_statements || q.tf_statements.length !== 4)
      errs.push(`${at}: cần đúng 4 ý đúng/sai, nhận được ${q.tf_statements?.length ?? 0}`);
  }

  if (q.type === "SHORT" && !q.short_answer && q.answer_source !== "none") {
    errs.push(`${at}: khai answer_source="${q.answer_source}" mà không có đáp án dạng số`);
  }

  // Mã chuyên đề model tự chế thì app không hiểu, câu sẽ rơi vào chuyên đề rỗng.
  if (q.topic_code && !isKnownTopic(q.topic_code)) {
    errs.push(`${at}: mã chuyên đề "${q.topic_code}" không có trong bảng — xem src/topics.ts`);
  }

  // Placeholder [[IMG:n]] trong thân câu phải khớp với danh sách images.
  const slotsInStem = [...q.stem_latex.matchAll(/\[\[IMG:(\d+)\]\]/g)].map((m) => Number(m[1]));
  const slotsDeclared = q.images.map((im) => im.slot);
  for (const s of slotsInStem) {
    if (!slotsDeclared.includes(s)) errs.push(`${at}: thân câu tham chiếu [[IMG:${s}]] nhưng không khai báo hình`);
  }
  for (const s of slotsDeclared) {
    if (!slotsInStem.includes(s)) errs.push(`${at}: khai báo hình slot ${s} nhưng thân câu không chèn [[IMG:${s}]]`);
  }

  return errs;
}
