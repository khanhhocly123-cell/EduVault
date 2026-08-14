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
  /** null khi tài liệu không in đáp án; model tuyệt đối không tự suy luận. */
  is_true: z.boolean().nullable(),
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
 * Cụm dữ liệu dùng chung cho nhiều câu độc lập (đọc hiểu, bảng số liệu, biểu đồ...).
 * `ref` chỉ cần duy nhất trong một trang; pipeline sẽ gắn thêm source/page để thành id
 * bền vững trong kho. Tách cụm khỏi Question để không nhân bản một đoạn dẫn dài 2–3 lần.
 */
export const QuestionGroup = z.object({
  ref: z.string(),
  label: z.string().nullable(),
  stem_latex: z.string(),
  bbox: z.array(z.number()),
  images: z.array(ImageRef),
  /** Số câu in trên đề, dùng để nối cụm dữ liệu với câu con ở trang kế tiếp. */
  question_numbers: z.array(z.string()),
});

/** Nguồn đáp án. Pipeline OCR chỉ được trả "printed" hoặc "none"; "manual"
 * được app gắn sau khi giáo viên chủ động nhập/chỉnh. Không có nhánh AI tự giải. */
export const AnswerSource = z.enum([
  "printed", // tài liệu có in đáp án, chỉ việc chép
  "manual", // giáo viên nhập/chỉnh trong app sau OCR
  "none", // tài liệu không in đáp án; model không được tự giải
]);

/** Một đáp án được IN SẴN trên trang, kể cả bảng đáp án đứng riêng cuối tài liệu. */
export const PrintedAnswer = z.object({
  type: QuestionType,
  question_number: z.string(),
  mc_correct: z.enum(["A", "B", "C", "D"]).nullable(),
  tf_correct: z.array(z.boolean()).nullable(),
  short_answer: ShortAnswer.nullable(),
  solution_latex: z.string().nullable(),
});

export const Question = z.object({
  type: QuestionType,
  /** Số/ký hiệu câu đúng như bản in, ví dụ "60", "1" hoặc "2.3". */
  printed_number: z.string().nullable(),
  stem_latex: z.string(),
  /** Vùng bao trọn câu trên trang gốc, chuẩn hoá 0-1: [x0, y0, x1, y1]. */
  bbox: z.array(z.number()),
  /** null nếu đứng độc lập; nếu có phải khớp `groups[].ref` trên cùng trang. */
  group_ref: z.string().nullable(),
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
  groups: z.array(QuestionGroup),
  questions: z.array(Question),
  /** Chỉ chứa đáp án/lời giải nhìn thấy trên trang; không chứa kết quả tự giải. */
  printed_answers: z.array(PrintedAnswer),
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

  const validBox = (box: unknown) => Array.isArray(box) && box.length === 4 && box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    && box[2]! > box[0]! && box[3]! > box[1]!;
  if (!validBox(q.bbox)) errs.push(`${at}: bbox câu phải là [x0,y0,x1,y1] chuẩn hoá 0-1 và có diện tích dương`);
  q.images.forEach((image) => {
    if (!validBox(image.bbox)) errs.push(`${at}: bbox hình slot ${image.slot} không hợp lệ`);
  });

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
    if (q.answer_source === "none" && q.tf_statements?.some((s) => s.is_true !== null))
      errs.push(`${at}: tài liệu không in đáp án nhưng vẫn gán đúng/sai`);
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

/** Ràng buộc liên kết giữa group và các câu con, không biểu diễn hết được bằng JSON Schema. */
export function validateQuestionGroups(page: TPageExtraction): string[] {
  const errs: string[] = [];
  const validBox = (box: unknown) => Array.isArray(box) && box.length === 4 && box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    && box[2]! > box[0]! && box[3]! > box[1]!;
  const refs = new Set<string>();
  for (const group of page.groups ?? []) {
    if (!group.ref.trim()) errs.push("group có ref rỗng");
    if (refs.has(group.ref)) errs.push(`group_ref "${group.ref}" bị lặp trong trang`);
    refs.add(group.ref);
    if (!validBox(group.bbox)) errs.push(`group "${group.ref}": bbox không hợp lệ`);
    group.images.forEach((image) => {
      if (!validBox(image.bbox)) errs.push(`group "${group.ref}": bbox hình slot ${image.slot} không hợp lệ`);
    });
  }
  const counts = new Map<string, number>();
  page.questions.forEach((q, i) => {
    if (q.group_ref == null) return;
    if (!refs.has(q.group_ref)) errs.push(`câu ${i + 1}: group_ref "${q.group_ref}" không tồn tại`);
    counts.set(q.group_ref, (counts.get(q.group_ref) ?? 0) + 1);
  });
  for (const ref of refs) {
    const count = counts.get(ref) ?? 0;
    const declared = page.groups.find((group) => group.ref === ref)?.question_numbers.length ?? 0;
    if (Math.max(count, declared) < 2)
      errs.push(`group "${ref}" chỉ có ${Math.max(count, declared)} câu con/số câu; cần ít nhất 2`);
  }
  return errs;
}
