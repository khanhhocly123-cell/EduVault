import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { dataDir, IMAGE_BATCH_MIME } from "./backend.mjs";
import { configuredModel, extractPage } from "./ocr-model.mjs";

export { configuredModel };

function run(executable, args, cwd, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, env: process.env });
    let output = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };
    const timer = timeoutMs > 0 ? setTimeout(() => {
      child.kill();
      finish(reject, new Error(`ETIMEDOUT: tiến trình không phản hồi sau ${Math.round(timeoutMs / 1000)} giây`));
    }, timeoutMs) : null;
    child.stdout.on("data", b => { output += b.toString(); });
    child.stderr.on("data", b => { output += b.toString(); });
    child.on("error", error => finish(reject, error));
    child.on("close", code => code === 0
      ? finish(resolve, output)
      : finish(reject, new Error(output.trim() || `Tiến trình dừng với mã ${code}`)));
  });
}

const colorHex = (r, g, b) => `#${[r,g,b].map(value => Math.max(0, Math.min(255, Math.round(value)))
  .toString(16).padStart(2,"0")).join("")}`;
const mixRgb = (rgb, whiteRatio) => rgb.map(value => value * (1 - whiteRatio) + 255 * whiteRatio);

/** Chọn màu có độ bão hoà đáng kể, bỏ nền trắng/chữ đen. Không dùng AI và chạy ổn định. */
export function stylePaletteFromPixels(data, channels = 3) {
  const buckets = new Map();
  for(let i = 0; i + 2 < data.length; i += channels){
    if(channels > 3 && data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(...rgb) / 255, min = Math.min(...rgb) / 255;
    const lum = rgb.reduce((sum, value) => sum + value, 0) / (3 * 255);
    const sat = max ? (max - min) / max : 0;
    if(lum > 0.94 || lum < 0.08 || sat < 0.16) continue;
    const quant = rgb.map(value => Math.min(255, Math.round(value / 32) * 32));
    const key = quant.join(",");
    const score = 1 + sat * 4 + (1 - Math.abs(lum - 0.5)) * 0.7;
    buckets.set(key, (buckets.get(key) || 0) + score);
  }
  const best = [...buckets.entries()].sort((a,b) => b[1] - a[1])[0]?.[0];
  const accent = best ? best.split(",").map(Number) : [40,127,175];
  return {
    accentColor:colorHex(...accent),
    accentSoft:colorHex(...mixRgb(accent, 0.9)),
    borderColor:colorHex(...mixRgb(accent, 0.55)),
  };
}

/** Import ảnh/PDF mẫu làm reference. Chỉ lấy trang đầu và palette; không biến đề thành ảnh nền. */
export async function createStyleReference(userId, file) {
  const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  if(!(file instanceof File) || !allowed.has(file.type))
    throw Object.assign(new Error("Format mẫu chỉ nhận PDF, PNG, JPG hoặc WebP"), { status:400 });
  if(!file.size || file.size > 15 * 1024 * 1024)
    throw Object.assign(new Error("Format mẫu phải nhỏ hơn 15 MB"), { status:400 });
  const id = randomUUID();
  const folder = path.join(dataDir(), "style-references", userId, id);
  await mkdir(folder, { recursive:true });
  const output = path.join(folder, "reference.png");
  const bytes = Buffer.from(await file.arrayBuffer());
  if(file.type === "application/pdf"){
    const original = path.join(folder, "reference.pdf");
    await writeFile(original, bytes);
    await run("pdftoppm", ["-f","1","-singlefile","-r","120","-png",original,path.join(folder,"reference")], folder, 60_000);
  } else {
    await sharp(bytes).rotate().resize({ width:1600, height:2200, fit:"inside", withoutEnlargement:true })
      .png({ compressionLevel:9 }).toFile(output);
  }
  const sampled = await sharp(output).resize({ width:240, height:240, fit:"inside", withoutEnlargement:true })
    .toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject:true });
  const palette = stylePaletteFromPixels(sampled.data, sampled.info.channels);
  return { id, assetUrl:`/api/style-references/${id}`, filename:path.basename(file.name), palette };
}

async function canonicalImage(input, output, tier = "nhanh") {
  const minWidth = { nhanh:1200, chuan:1600, ki:1900 }[tier] || 1200;
  const metadata = await sharp(input).metadata();
  let pipeline = sharp(input).rotate();
  if ((Number(metadata.width) || 0) < minWidth)
    pipeline = pipeline.resize({ width:minWidth, kernel:"lanczos3", withoutEnlargement:false }).sharpen();
  await pipeline.png({ compressionLevel:9 }).toFile(output);
}

async function pageFiles(source, jobDir, options = {}) {
  const mimeType = source.mimeType ?? source.mime_type;
  const storagePath = source.storagePath ?? source.storage_path;
  if (mimeType === IMAGE_BATCH_MIME) {
    const manifest = JSON.parse(await readFile(storagePath, "utf8"));
    const entries = Array.isArray(manifest.files) ? manifest.files : [];
    if (entries.length < 2) throw new Error("Lô ảnh không có đủ trang");
    const out = [];
    for (let i = 0; i < entries.length; i++) {
      const page = path.join(jobDir, `page-${i + 1}.png`);
      // Chuẩn hoá EXIF từng ảnh; đây là đúng file cả model, bảng đối chiếu và crop cùng dùng.
      await canonicalImage(String(entries[i].storagePath), page, options.tier);
      out.push(page);
    }
    return out;
  }
  if (mimeType !== "application/pdf") {
    const page = path.join(jobDir, "page-1.png");
    await canonicalImage(storagePath, page, options.tier);
    return [page];
  }
  const prefix = path.join(jobDir, "page");
  await run("pdftoppm", ["-r", "160", "-png", storagePath, prefix], jobDir, 180_000);
  const files = (await readdir(jobDir)).filter(n => /^page-\d+\.png$/i.test(n));
  files.sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  if (!files.length) throw new Error("Không tách được trang nào từ PDF");
  return files.map(name => path.join(jobDir, name));
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const answerIndex = letter => {
  const index = LETTERS.indexOf(String(letter || "").trim().toUpperCase());
  return index < 0 ? null : index;
};
const printedNo = value => String(value ?? "").trim().replace(/^c[âa]u\s*/i, "").replace(/[.:)]\s*$/, "").toLowerCase();
/** Chuẩn hoá số hiệu bài lớn: "Ж1", "Bài 1.", "PROBLEM 1" đều về "1" nếu có số. */
const problemNo = value => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const digits = /(\d+)/.exec(text);
  return (digits ? digits[1] : text).toLowerCase();
};
/**
 * Khoá ghép đáp án. Có cả số hiệu BÀI LỚN chứ không chỉ số câu.
 *
 * Đề HSG QG Yên Bái có năm bài Ж1–Ж5, mỗi bài đánh câu con lại từ 1. Khoá cũ chỉ
 * gồm (dạng, số câu) nên lời giải câu 1 của bài Ж5 nhảy vào câu 1 của bài Ж1.
 */
const answerKey = (problem, type, number) =>
  `${problemNo(problem)}#${String(type || "").toUpperCase()}|${printedNo(number)}`;

export function normalizedBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  let box = value.map(Number);
  if (!box.every(Number.isFinite)) return null;
  // Một số vision model vẫn trả hệ 0–100 hoặc 0–1000 dù prompt yêu cầu 0–1.
  const max = Math.max(...box);
  if (max >= 2 && max <= 100) box = box.map(n => n / 100);
  else if (max > 100 && max <= 1000) box = box.map(n => n / 1000);
  const [x0, y0, x1, y1] = box.map(n => Math.max(0, Math.min(1, n)));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

export function bboxToPixels(value, width, height, paddingRatio = 0.004) {
  const bbox = normalizedBbox(value);
  if (!bbox || !width || !height) return null;
  const padX = paddingRatio > 0 ? Math.max(4, Math.round(width * paddingRatio)) : 0;
  const padY = paddingRatio > 0 ? Math.max(4, Math.round(height * paddingRatio)) : 0;
  const left = Math.max(0, Math.floor(bbox[0] * width) - padX);
  const top = Math.max(0, Math.floor(bbox[1] * height) - padY);
  const right = Math.min(width, Math.ceil(bbox[2] * width) + padX);
  const bottom = Math.min(height, Math.ceil(bbox[3] * height) + padY);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top, bbox }
    : null;
}

/**
 * Cắt hình của câu.
 *
 * Đây là chỗ DUY NHẤT còn dùng toạ độ của model. Bbox câu đã bỏ cùng với lớp
 * highlight, nhưng hình thì vẫn phải cắt được tự động — và khi model cắt lệch,
 * giáo viên kéo lại vùng ngay trên trang ở màn Duyệt trước khi lưu vào kho.
 */
async function cropFigures(owners, pageFile, jobDir, jobId, page, kind = "q") {
  const assetsDir = path.join(jobDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const metadata = await sharp(pageFile).metadata();
  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;
  if (!width || !height) return owners;

  for (let qi = 0; qi < owners.length; qi++) {
    const q = owners[qi];
    const figures = [];
    for (const image of Array.isArray(q.images) ? q.images : []) {
      const box = normalizedBbox(image.bbox);
      // Bbox trùm gần hết trang gần như luôn là model đoán bừa. Thà báo "có hình,
      // chưa cắt được" còn hơn nhét cả trang vào làm hình minh hoạ.
      if (box && (box[2] - box[0]) * (box[3] - box[1]) > 0.72) {
        q.notes = [q.notes, "Vùng hình model khoanh gần trùm cả trang nên bỏ; crop lại khi duyệt."].filter(Boolean).join(" ");
        continue;
      }
      const crop = bboxToPixels(image.bbox, width, height);
      if (!crop) continue;
      const slot = Number(image.slot) || figures.length + 1;
      const filename = `p${page}-${kind}${qi + 1}-s${slot}.png`;
      await sharp(pageFile).extract({ left:crop.left, top:crop.top, width:crop.width, height:crop.height })
        .png({ compressionLevel: 9 }).toFile(path.join(assetsDir, filename));
      figures.push({
        slot, bbox:crop.bbox, caption: image.caption || null, note: image.note || null,
        src: `/api/jobs/${jobId}/assets/${filename}`,
        width: 45, place: "top", origin:"auto",
      });
    }
    q._figures = figures;
  }
  return owners;
}

/** Crop do người dùng kéo trực tiếp trên trang ở màn Duyệt. */
export async function createManualCrop(jobId, page, value, sourcePath = null) {
  const jobDir = path.join(dataDir(), "jobs", jobId);
  let pages = (await readdir(jobDir)).filter(n => /^page-\d+\.png$/i.test(n));
  pages.sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  if (!pages.length && sourcePath) {
    const canonical = path.join(jobDir, "page-1.png");
    await sharp(sourcePath).rotate().png({ compressionLevel: 9 }).toFile(canonical);
    pages = ["page-1.png"];
  }
  const pageFile = pages[page - 1] ? path.join(jobDir, pages[page - 1]) : null;
  if (!pageFile) throw Object.assign(new Error("Không tìm thấy ảnh trang để crop"), { status:404 });
  const metadata = await sharp(pageFile).metadata();
  const crop = bboxToPixels(value, Number(metadata.width), Number(metadata.height), 0);
  if (!crop) throw Object.assign(new Error("Vùng crop không hợp lệ"), { status:400 });
  // Chặn những cú click vô tình tạo ảnh vài pixel.
  if (crop.width < 12 || crop.height < 12)
    throw Object.assign(new Error("Vùng crop quá nhỏ"), { status:400 });
  const assetsDir = path.join(jobDir, "assets");
  await mkdir(assetsDir, { recursive:true });
  const filename = `p${page}-manual-${randomUUID().slice(0, 10)}.png`;
  await sharp(pageFile).extract({ left:crop.left, top:crop.top, width:crop.width, height:crop.height })
    .png({ compressionLevel:9 }).toFile(path.join(assetsDir, filename));
  return {
    slot:1, bbox:crop.bbox, caption:null, note:"Người dùng crop từ trang gốc",
    src:`/api/jobs/${jobId}/assets/${filename}`, width:45, place:"top", origin:"manual",
  };
}

export function cleanImageMarkers(value) {
  return String(value || "").replace(/\s*\[\[IMG:\d+\]\]\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
}

/** Dòng chữ thô để đối chiếu trong bảng: đúng thứ tự đọc trên trang. */
function rawLines(q, number) {
  const lines = [`Câu ${number}. ${cleanImageMarkers(q.stem_latex)}`];
  if (q.type === "MC" && Array.isArray(q.mc_choices) && q.mc_choices.length)
    lines.push(q.mc_choices.map(choice => `${choice.label}. ${choice.text_latex}`).join("    "));
  if (q.type === "TF" && Array.isArray(q.tf_statements))
    for (const s of q.tf_statements) lines.push(`${s.idx}) ${s.text_latex}`);
  return lines;
}

export function toAppQuestion(q, source, page, index, options) {
  const topic = q.topic_code || (options.subject === "math" ? "m12.derivative" : "p12.thermal");
  const stem = cleanImageMarkers(q.stem_latex);
  const item = {
    id: randomUUID(), src: source.filename, srcId: source.id, page,
    model: options.model || configuredModel(), type: q.type, diff: q.difficulty || "TH",
    pageIndex:index + 1, printedNumber:q.printed_number || null,
    problemRef:q.problem_ref || null,
    topic, grade: q.grade || options.grade || 12, stem, sol: q.solution_latex || "",
    answerSource: q.answer_source || "none", notes: q.notes || null,
    raw: rawLines(q, q.printed_number || index + 1),
  };
  if (options.srcLabel) item.srcLabel = options.srcLabel;
  if (q.type === "MC") {
    item.ch = (q.mc_choices || []).map(x => x.text_latex);
    item.chLabels = (q.mc_choices || []).map(x => x.label);
    item.ans = answerIndex(q.mc_correct);
    // Đề in "B" nhưng model xếp phương án theo thứ tự khác thì chỉ số theo vị trí sai.
    // Ưu tiên khớp theo nhãn thật in trên đề.
    const byLabel = item.chLabels.indexOf(String(q.mc_correct || "").trim().toUpperCase());
    if (byLabel >= 0) item.ans = byLabel;
  }
  if (q.type === "TF") item.tf = (q.tf_statements || []).map(x => [x.text_latex, typeof x.is_true === "boolean" ? x.is_true : null]);
  if (q.type === "SHORT" && q.short_answer) item.sa = { value: String(q.short_answer.value), unit: q.short_answer.unit || "", tol: String(q.short_answer.tolerance ?? 0) };
  if (Array.isArray(q.images) && q.images.length) item.figNote = q.images.map(x => x.note || x.caption || "Có hình trong đề gốc").join("; ");
  if (Array.isArray(q._figures) && q._figures.length) {
    item.figures = q._figures;
    item.fig = q._figures[0];
  }
  const group = options.group;
  if (group) {
    const ref = String(group.ref || `g${index + 1}`).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40);
    item.groupId = options.groupId || `${source.id}:p${options.groupPage || page}:${ref}`;
    item.groupPage = Number(options.groupPage) || page;
    item.groupLabel = group.label || null;
    item.groupStem = cleanImageMarkers(group.stem_latex);
    item.groupOrder = Number(options.groupOrder) || 1;
    item.groupSize = Number(options.groupSize) || 1;
    if (Array.isArray(group.images) && group.images.length) {
      item.groupFigNote = group.images.map(x => x.note || x.caption || "Có hình trong cụm dữ liệu").join("; ");
    }
    if (Array.isArray(group._figures) && group._figures.length) {
      item.groupFigures = group._figures;
      item.groupFig = group._figures[0];
    }
  }
  return item;
}

/**
 * Đọc lại kết quả một trang đã trích trước đó.
 *
 * Có file này thì "Thử lại" chỉ gọi model cho những trang CHƯA xong. Trước đây
 * một tài liệu 8 trang hỏng ở trang cuối là mất cả 8 lượt gọi khi thử lại.
 */
/* Đổi số khi schema trích xuất đổi. Cache của schema cũ bị bỏ và trang đó được
   đọc lại — thà tốn lượt còn hơn trộn dữ liệu thiếu trường vào bước ghép. */
const EXTRACTION_SCHEMA = 2;

async function cachedPage(jobDir, index) {
  try {
    const payload = JSON.parse(await readFile(path.join(jobDir, `extraction-${index + 1}.json`), "utf8"));
    if (Array.isArray(payload?.questions) && Number(payload?._schema) === EXTRACTION_SCHEMA) return payload;
  } catch { /* chưa có hoặc hỏng thì trích lại */ }
  return null;
}

export async function extractSource(source, jobId, options = {}) {
  const jobDir = path.join(dataDir(), "jobs", jobId);
  await mkdir(jobDir, { recursive: true });
  const model = options.model || configuredModel();
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const pages = await pageFiles(source, jobDir, options);
  onProgress({ phase: "pages", pages: pages.length, page: 0 });

  const questions = [];
  const groups = [];
  const extractedPages = [];
  const usage = { inputTokens: 0, outputTokens: 0, elapsedMs: 0, cachedPages: 0, emptyPages: 0 };

  /* Trạng thái tuần tự của TÀI LIỆU nằm ở đây chứ không ở model: model chỉ nhìn
     một trang mỗi lượt nên nó không thể biết trang 13 nằm sau chữ "ĐÁP ÁN" in ở
     trang 6, cũng không biết bài Ж3 mở từ trang trước. Pipeline thì biết. */
  let answersFromPage = null;
  let openProblem = null;
  let openProblemNumbers = [];

  for (let i = 0; i < pages.length; i++) {
    onProgress({ phase: "ocr", pages: pages.length, page: i + 1 });
    let payload = options.reuseCache === false ? null : await cachedPage(jobDir, i);
    if (payload) usage.cachedPages++;
    else {
      payload = await extractPage({
        imagePath: pages[i], subject: options.subject, pageNumber: i + 1, model,
        context: { answersFromPage, openProblem, seenNumbers: openProblemNumbers },
      });
      payload._schema = EXTRACTION_SCHEMA;
      await writeFile(path.join(jobDir, `extraction-${i + 1}.json`), JSON.stringify(payload, null, 2), "utf8");
    }
    /* Lật cả tài liệu sang chế độ lời giải CHỈ khi trang có in tiêu đề "ĐÁP ÁN".
       Tiêu đề là sự kiện nhìn thấy được; còn "trang này trông giống lời giải" là
       phán đoán, và một phán đoán sai ở trang 3 từng nuốt mất bốn câu ở trang 4–5. */
    if (!answersFromPage && payload.answers_heading === true) answersFromPage = i + 1;
    /* Bài lớn đang mở = thứ XUẤT HIỆN CUỐI trên trang, tính cả câu hỏi chứ không
       chỉ cụm. Bản trước chỉ nhìn `groups` nên khi bài Ж4 bắt đầu ở giữa trang 3
       mà không kèm cụm, gợi ý gửi sang trang 4 vẫn là "Ж3" — và model ngoan
       ngoãn gắn hai câu của Ж4 vào Ж3. */
    const lastGroup = Array.isArray(payload.groups) ? payload.groups.at(-1) : null;
    const lastQuestionRef = [...(Array.isArray(payload.questions) ? payload.questions : [])]
      .reverse().find(q => q.problem_ref)?.problem_ref || null;
    if (lastGroup && (!lastQuestionRef || problemNo(lastGroup.problem_ref) === problemNo(lastQuestionRef))) {
      openProblem = lastGroup.problem_ref
        ? `${lastGroup.problem_ref}${lastGroup.label ? ` — ${lastGroup.label}` : ""}` : lastGroup.label;
      openProblemNumbers = Array.isArray(lastGroup.question_numbers) ? lastGroup.question_numbers : [];
    } else if (lastQuestionRef) {
      openProblem = lastQuestionRef;
      openProblemNumbers = (payload.questions || [])
        .filter(q => problemNo(q.problem_ref) === problemNo(lastQuestionRef))
        .map(q => q.printed_number).filter(Boolean);
    }
    usage.inputTokens += payload._usage?.inputTokens || 0;
    usage.outputTokens += payload._usage?.outputTokens || 0;
    usage.elapsedMs += payload._usage?.elapsedMs || 0;

    const pageQuestions = Array.isArray(payload.questions) ? payload.questions : [];
    const pageGroups = Array.isArray(payload.groups) ? payload.groups : [];
    const printedAnswers = Array.isArray(payload.printed_answers) ? payload.printed_answers : [];
    if (!pageQuestions.length && !pageGroups.length && !printedAnswers.length) usage.emptyPages++;
    for (const q of pageQuestions) q._page = i + 1;
    for (const group of pageGroups) group._page = i + 1;
    await cropFigures(pageQuestions, pages[i], jobDir, jobId, i + 1);
    await cropFigures(pageGroups, pages[i], jobDir, jobId, i + 1, "g");
    extractedPages.push({ page:i + 1, pageQuestions, pageGroups, printedAnswers });
  }

  // Một vài trang rỗng là chuyện thường; RỖNG HẾT thì mới là hỏng thật.
  if (usage.emptyPages === pages.length)
    throw Object.assign(new Error(
      `Không đọc được câu hỏi nào trong ${pages.length} trang. Kiểm tra xem file có đúng là đề không, hoặc thử mức đọc cao hơn.`,
    ), { kind:"model" });

  onProgress({ phase: "reconcile", pages: pages.length, page: pages.length });

  /* Ghép đáp án in ở trang khác. Khoá gồm bài lớn + dạng + số câu; thiếu bài lớn
     thì lời giải của bài này nhảy sang bài khác vì câu con đánh số lại từ 1. */
  const printed = new Map();
  const printedLoose = new Map();   // dự phòng khi tài liệu không có số hiệu bài lớn
  const remember = (entry, problem, type, number) => {
    printed.set(answerKey(problem, type, number), entry);
    const loose = `${String(type || "").toUpperCase()}|${printedNo(number)}`;
    // Chỉ giữ bản dự phòng khi nó không mơ hồ: hai bài cùng có "câu 1" thì bỏ.
    printedLoose.set(loose, printedLoose.has(loose) ? null : entry);
  };
  for (const page of extractedPages) {
    for (const q of page.pageQuestions) {
      if (q.answer_source === "printed" && q.printed_number) {
        remember({
          type:q.type, question_number:q.printed_number, mc_correct:q.mc_correct ?? null,
          tf_correct:q.tf_statements?.map(s => s.is_true).every(v => typeof v === "boolean")
            ? q.tf_statements.map(s => s.is_true) : null,
          short_answer:q.short_answer ?? null, solution_latex:q.solution_latex ?? null,
        }, q.problem_ref, q.type, q.printed_number);
      }
    }
    for (const entry of page.printedAnswers) {
      if (entry?.question_number) remember(entry, entry.problem_ref, entry.type, entry.question_number);
    }
  }

  /* Một BÀI LỚN là một cụm, kể cả khi phần dẫn ở trang này còn câu con ở trang
     sau. Trước đây id cụm gắn với (trang, ref) nên mỗi trang đẻ một cụm mới và
     câu con trang sau thành câu mồ côi. */
  const allGroups = extractedPages.flatMap(page => page.pageGroups);

  /* Bài lớn có nhiều câu con nhưng model quên khai cụm thì dựng hộ ở đây.
     Hoàn toàn xác định, không tốn thêm lượt gọi. Không dựng cụm một câu — đó là
     câu độc lập, và bất biến "không tạo group chỉ có một câu" vẫn giữ. */
  const questionsByProblem = new Map();
  for (const page of extractedPages) {
    for (const q of page.pageQuestions) {
      const key = problemNo(q.problem_ref);
      if (!key) continue;
      const list = questionsByProblem.get(key) || [];
      list.push(q); questionsByProblem.set(key, list);
    }
  }
  for (const [key, list] of questionsByProblem) {
    if (list.length < 2) continue;
    if (allGroups.some(group => problemNo(group.problem_ref) === key)) continue;
    allGroups.push({
      ref: `auto-${key}`, problem_ref: list[0].problem_ref,
      label: `Bài ${list[0].problem_ref} — các câu con dùng chung đề dẫn`, stem_latex: "",
      images: [], _figures: [], _page: list[0]._page, _synthesized: true,
      question_numbers: list.map(q => q.printed_number).filter(Boolean),
    });
  }

  const groupIds = new Map();
  const byProblem = new Map();
  for (const group of allGroups) {
    const problem = problemNo(group.problem_ref);
    if (problem && byProblem.has(problem)) {
      const first = byProblem.get(problem);
      // Cùng một bài lớn xuất hiện lại ở trang sau: gộp vào cụm đã có.
      groupIds.set(group, groupIds.get(first));
      first.question_numbers = [...new Set([...(first.question_numbers || []), ...(group.question_numbers || [])])];
      if (!first.stem_latex && group.stem_latex) first.stem_latex = group.stem_latex;
      if (!first._figures?.length && group._figures?.length) first._figures = group._figures;
      group._mergedInto = first;
      continue;
    }
    const ref = String(group.ref || "g").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40);
    groupIds.set(group, problem ? `${source.id}:P${problem}` : `${source.id}:p${group._page}:${ref}`);
    if (problem) byProblem.set(problem, group);
  }
  const liveGroups = allGroups.filter(group => !group._mergedInto);
  const localGroups = new Map(allGroups.map(group => [`${group._page}|${String(group.ref)}`, group._mergedInto || group]));
  const numberGroups = new Map();
  for (const group of liveGroups) {
    for (const number of Array.isArray(group.question_numbers) ? group.question_numbers : []) {
      const key = printedNo(number);
      if (!key) continue;
      const list = numberGroups.get(key) || [];
      list.push(group); numberGroups.set(key, list);
    }
  }

  const matches = [];
  for (const page of extractedPages) {
    page.pageQuestions.forEach((q, index) => {
      const hit = q.printed_number
        ? (printed.get(answerKey(q.problem_ref, q.type, q.printed_number))
           ?? (q.problem_ref ? null : printedLoose.get(`${String(q.type).toUpperCase()}|${printedNo(q.printed_number)}`)))
        : null;
      const ownPrinted = q.answer_source === "printed";
      q.mc_correct = q.type === "MC" ? (hit?.mc_correct ?? (ownPrinted ? q.mc_correct : null)) : null;
      if (q.type === "TF" && Array.isArray(q.tf_statements)) {
        const values = Array.isArray(hit?.tf_correct) && hit.tf_correct.length === q.tf_statements.length
          ? hit.tf_correct : ownPrinted ? q.tf_statements.map(s => s.is_true) : [];
        q.tf_statements.forEach((s, i) => { s.is_true = typeof values[i] === "boolean" ? values[i] : null; });
      }
      q.short_answer = q.type === "SHORT" ? (hit?.short_answer ?? (ownPrinted ? q.short_answer : null)) : null;
      q.solution_latex = hit?.solution_latex ?? (ownPrinted ? q.solution_latex : null);
      const hasPrinted = Boolean(q.mc_correct || q.short_answer || q.solution_latex || q.tf_statements?.some(s => typeof s.is_true === "boolean"));
      q.answer_source = hasPrinted ? "printed" : "none";

      let group = q.group_ref == null ? null : localGroups.get(`${page.page}|${String(q.group_ref)}`);
      // Số hiệu bài lớn là mối nối chắc nhất giữa câu con và cụm ở trang trước.
      if (!group && q.problem_ref) group = byProblem.get(problemNo(q.problem_ref)) || null;
      if (!group && q.printed_number) {
        const candidates = numberGroups.get(printedNo(q.printed_number)) || [];
        // Ưu tiên cụm ở trang gần nhất phía trước; vẫn cho cùng trang.
        group = [...candidates].filter(g => g._page <= page.page)
          .sort((a, b) => b._page - a._page)[0] || candidates[0] || null;
      }
      matches.push({ q, page:page.page, index, group });
    });
  }

  const members = new Map();
  for (const match of matches) if (match.group) {
    const id = groupIds.get(match.group);
    const list = members.get(id) || []; list.push(match); members.set(id, list);
  }
  for (const match of matches) {
    const list = match.group ? members.get(groupIds.get(match.group)) || [] : [];
    const declaredNumbers = Array.isArray(match.group?.question_numbers) ? match.group.question_numbers.map(printedNo) : [];
    const declaredOrder = match.q.printed_number ? declaredNumbers.indexOf(printedNo(match.q.printed_number)) + 1 : 0;
    const item = toAppQuestion(match.q, source, match.page, match.index, {
      ...options, model, group:match.group, groupId:match.group ? groupIds.get(match.group) : null,
      groupPage:match.group?._page, groupOrder:match.group ? (declaredOrder || list.indexOf(match) + 1) : 0,
      groupSize:Math.max(list.length, declaredNumbers.length),
    });
    questions.push(item);
    match.item = item;
  }
  for (const group of liveGroups) {
    const id = groupIds.get(group);
    const list = members.get(id) || [];
    // Cụm không nhặt được câu con nào chỉ là một đoạn văn lạc — đừng đẩy vào kho.
    if (!list.length) continue;
    groups.push({
      id, sourceId:source.id, source:source.filename, page:group._page,
      problemRef:group.problem_ref || null,
      label:group.label || null, stem:group.stem_latex || "",
      figures:Array.isArray(group._figures) ? group._figures : [],
      figure:Array.isArray(group._figures) ? group._figures[0] || null : null,
      questionNumbers:Array.isArray(group.question_numbers) ? group.question_numbers : [],
      questionIds:list.map(match => match.item.id),
    });
  }
  usage.answersFromPage = answersFromPage;
  return { pages: pages.length, questions, groups, usage };
}
