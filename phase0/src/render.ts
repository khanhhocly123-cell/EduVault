import { spawn } from "node:child_process";
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import AdmZip from "adm-zip";
import type { ExamDoc, TQuestion } from "./types.js";

/** slot ảnh -> đường dẫn file, khoá theo `${chỉ số câu}:${slot}` */
export type AssetMap = Map<string, string>;

const SECTIONS = [
  { types: ["MC"], roman: "I", title: "TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN", note: "Mỗi câu chọn một phương án." },
  { types: ["TF"], roman: "II", title: "TRẮC NGHIỆM ĐÚNG SAI", note: "Mỗi câu có 4 ý, ở mỗi ý chọn đúng hoặc sai." },
  { types: ["SHORT"], roman: "III", title: "TRẮC NGHIỆM TRẢ LỜI NGẮN", note: "Điền đáp án là một con số." },
  { types: ["ESSAY"], roman: "IV", title: "TỰ LUẬN", note: "" },
] as const;

// ---------------------------------------------------------------- markdown

/** Bảng lưới pandoc không có dòng tiêu đề — dùng cho phần đầu đề và cụm 4 phương án. */
function gridTable(rows: string[][], widths: number[]): string {
  const rule = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const out: string[] = [rule];

  for (const row of rows) {
    const cells = row.map((c, i) => c.split("\n").map((l) => l.trimEnd()));
    const height = Math.max(...cells.map((c) => c.length));
    for (let line = 0; line < height; line++) {
      const parts = cells.map((cell, i) => {
        const text = cell[line] ?? "";
        return " " + text.padEnd(widths[i] ?? 0) + " ";
      });
      out.push("|" + parts.join("|") + "|");
    }
    out.push(rule);
  }
  return out.join("\n");
}

function headerBlock(doc: ExamDoc): string {
  const h = doc.header;
  const left = [h.org.toUpperCase(), `**${h.school.toUpperCase()}**`].join("\n");
  const right = [
    `**${h.title.toUpperCase()}**`,
    `Môn: ${h.subject}`,
    `Thời gian làm bài: ${h.durationMin} phút`,
    h.code ? `Mã đề: ${h.code}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return gridTable([[left, right]], [34, 40]);
}

/** Thay [[IMG:n]] bằng cú pháp ảnh của pandoc. */
function withImages(latex: string, qIndex: number, assets: AssetMap): string {
  return latex.replace(/\[\[IMG:(\d+)\]\]/g, (_m, slot: string) => {
    const path = assets.get(`${qIndex}:${slot}`);
    if (!path) return `\n\n*[thiếu hình slot ${slot}]*\n\n`;
    return `\n\n![](${resolve(path).replace(/\\/g, "/")}){width=7cm}\n\n`;
  });
}

function renderQuestion(q: TQuestion, qIndex: number, numberInSection: number, assets: AssetMap): string {
  const parts: string[] = [];
  parts.push(`**Câu ${numberInSection}.** ` + withImages(q.stem_latex, qIndex, assets));

  if (q.type === "MC" && q.mc_choices) {
    const c = Object.fromEntries(q.mc_choices.map((x) => [x.label, x.text_latex]));
    // Bố cục 2x2 không viền — đúng cách giáo viên vẫn trình bày đề trắc nghiệm.
    parts.push(
      gridTable(
        [
          [`**A.** ${c["A"] ?? ""}`, `**B.** ${c["B"] ?? ""}`],
          [`**C.** ${c["C"] ?? ""}`, `**D.** ${c["D"] ?? ""}`],
        ],
        [36, 36],
      ),
    );
  }

  if (q.type === "TF" && q.tf_statements) {
    for (const s of q.tf_statements) {
      parts.push(`${s.idx}) ${withImages(s.text_latex, qIndex, assets)}`);
    }
  }

  if (q.type === "SHORT") {
    parts.push("*Đáp án: ................*");
  }

  return parts.join("\n\n");
}

export function buildExamMarkdown(doc: ExamDoc, assets: AssetMap): string {
  const out: string[] = [headerBlock(doc), ""];

  for (const section of SECTIONS) {
    const items = doc.questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => (section.types as readonly string[]).includes(q.type));
    if (items.length === 0) continue;

    out.push(`**PHẦN ${section.roman}. ${section.title}**`, "");
    if (section.note) out.push(`*${section.note}*`, "");
    items.forEach(({ q, i }, n) => {
      out.push(renderQuestion(q, i, n + 1, assets), "");
    });
  }

  out.push("---", "", "*HẾT*");
  return out.join("\n");
}

export function buildAnswerKeyMarkdown(doc: ExamDoc): string {
  const out: string[] = [`**ĐÁP ÁN — ${doc.header.title.toUpperCase()}**`, ""];

  for (const section of SECTIONS) {
    const items = doc.questions.filter((q) => (section.types as readonly string[]).includes(q.type));
    if (items.length === 0) continue;
    out.push(`**Phần ${section.roman}.**`, "");

    items.forEach((q, n) => {
      if (q.type === "MC") {
        out.push(`Câu ${n + 1}: **${q.mc_correct ?? "?"}**`, "");
      } else if (q.type === "TF" && q.tf_statements) {
        const line = q.tf_statements.map((s) => `${s.idx}) ${s.is_true ? "Đ" : "S"}`).join("   ");
        out.push(`Câu ${n + 1}: ${line}`, "");
      } else if (q.type === "SHORT" && q.short_answer) {
        const unit = q.short_answer.unit ? ` ${q.short_answer.unit}` : "";
        out.push(`Câu ${n + 1}: **${String(q.short_answer.value).replace(".", ",")}${unit}**`, "");
      } else {
        out.push(`Câu ${n + 1}: (tự luận — xem lời giải)`, "");
      }
    });
  }
  return out.join("\n");
}

/**
 * Lời giải phải đi theo ĐÚNG thứ tự và ĐÚNG số câu của đề, nghĩa là cũng đánh số
 * lại từ 1 trong từng phần. Đánh số toàn cục thì đề ghi "Câu 1" phần III mà lời
 * giải ghi "Câu 23" — giáo viên dò đáp án là loạn.
 */
export function buildSolutionMarkdown(doc: ExamDoc, assets: AssetMap): string {
  const out: string[] = [`**LỜI GIẢI CHI TIẾT — ${doc.header.title.toUpperCase()}**`, ""];

  for (const section of SECTIONS) {
    const items = doc.questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => (section.types as readonly string[]).includes(q.type));
    if (items.length === 0) continue;

    out.push(`**PHẦN ${section.roman}. ${section.title}**`, "");
    items.forEach(({ q, i }, n) => {
      out.push(`**Câu ${n + 1}.** ` + withImages(q.stem_latex, i, assets), "");
      out.push(q.solution_latex ? withImages(q.solution_latex, i, assets) : "*(chưa có lời giải)*", "");
    });
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- pandoc

export interface PandocOptions {
  referenceDocx?: string;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function pandocToDocx(markdown: string, outDocx: string, opts: PandocOptions = {}): Promise<string> {
  const outAbs = resolve(outDocx);
  await mkdir(dirname(outAbs), { recursive: true });

  // File .md trung gian luôn được giữ lại — ở Phase 0 nó là công cụ soi lỗi chính
  // khi docx ra sai: xem markdown trước rồi mới đổ tội cho pandoc.
  const mdPath = outAbs.replace(/\.docx$/i, ".md");
  await writeFile(mdPath, markdown, "utf8");

  const args = [mdPath, "-f", "markdown", "-o", outAbs, "--standalone"];
  if (opts.referenceDocx && (await exists(opts.referenceDocx))) {
    args.push(`--reference-doc=${resolve(opts.referenceDocx)}`);
  }

  const result = await new Promise<{ code: number; out: string }>((res) => {
    const p = spawn("pandoc", args);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => res({ code: 127, out: String(e) }));
    p.on("close", (code) => res({ code: code ?? 1, out }));
  });

  if (result.code === 127) {
    throw new Error(
      "Không tìm thấy pandoc. Cài bằng:  winget install --id JohnMacFarlane.Pandoc -e\n" +
        "Rồi mở lại terminal cho PATH cập nhật.",
    );
  }
  if (result.code !== 0) {
    throw new Error(`pandoc lỗi (mã ${result.code}):\n${result.out}`);
  }

  return outAbs;
}

// ---------------------------------------------------------------- kill test

export interface DocxCheck {
  file: string;
  omathCount: number;
  imageCount: number;
  tableCount: number;
  hasEmbeddedFont: boolean;
  verdict: "PASS" | "FAIL";
  reasons: string[];
}

/**
 * Đây là bài kiểm tra sinh tử của Phase 0.
 * Mở file .docx (thực chất là zip), đọc word/document.xml và đếm thẻ <m:oMath>.
 * Có <m:oMath> = công thức là equation native của Word, click vào sửa được.
 * Không có = công thức đã bị biến thành ảnh hoặc text thường -> cả app vô nghĩa.
 */
export function checkDocx(docxPath: string, expectMath: boolean, expectImages: number): DocxCheck {
  const zip = new AdmZip(resolve(docxPath));
  const entries = zip.getEntries();

  const docEntry = entries.find((e) => e.entryName === "word/document.xml");
  if (!docEntry) throw new Error(`${docxPath} không phải file .docx hợp lệ (thiếu word/document.xml).`);
  const xml = docEntry.getData().toString("utf8");

  const omathCount = (xml.match(/<m:oMath[\s>]/g) ?? []).length;
  const tableCount = (xml.match(/<w:tbl>/g) ?? []).length;
  const imageCount = entries.filter((e) => e.entryName.startsWith("word/media/")).length;
  const hasEmbeddedFont = entries.some((e) => e.entryName.startsWith("word/fonts/"));

  const reasons: string[] = [];
  if (expectMath && omathCount === 0) {
    reasons.push("KHÔNG có thẻ <m:oMath> — công thức không phải equation của Word, không sửa được.");
  }
  if (imageCount < expectImages) {
    reasons.push(`Thiếu ảnh: cần ${expectImages}, tìm thấy ${imageCount}.`);
  }

  return {
    file: resolve(docxPath),
    omathCount,
    imageCount,
    tableCount,
    hasEmbeddedFont,
    verdict: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
  };
}
