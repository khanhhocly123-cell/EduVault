import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "./backend.mjs";

const WEB = path.dirname(fileURLToPath(import.meta.url));
const PHASE0 = path.resolve(WEB, "..", "phase0");
const FALLBACK_MODEL = "gemini-3.5-flash";

export function configuredModel() {
  const processModel = process.env.DE_MODEL?.trim();
  if (processModel) return processModel;
  try {
    const env = readFileSync(path.join(PHASE0, ".env"), "utf8");
    const match = /^DE_MODEL\s*=\s*(.+?)\s*$/m.exec(env);
    const fileModel = match?.[1]?.trim().replace(/^(['"])(.*)\1$/, "$2");
    return fileModel || FALLBACK_MODEL;
  } catch {
    return FALLBACK_MODEL;
  }
}

function run(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, env: process.env });
    let output = "";
    child.stdout.on("data", b => { output += b.toString(); });
    child.stderr.on("data", b => { output += b.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(output.trim() || `Pipeline dừng với mã ${code}`)));
  });
}

async function pageFiles(source, jobDir) {
  if (source.mimeType !== "application/pdf") return [source.storagePath];
  const prefix = path.join(jobDir, "page");
  await run("pdftoppm", ["-r", "160", "-png", source.storagePath, prefix], jobDir);
  const files = (await readdir(jobDir)).filter(n => /^page-\d+\.png$/i.test(n));
  files.sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  if (!files.length) throw new Error("Không tách được trang nào từ PDF");
  return files.map(name => path.join(jobDir, name));
}

const answerIndex = letter => ({ A: 0, B: 1, C: 2, D: 3 })[letter] ?? 0;
export function toAppQuestion(q, source, page, index, options) {
  const topic = q.topic_code || (options.subject === "math" ? "m12.derivative" : "p12.thermal");
  const item = {
    id: randomUUID(), src: source.filename, srcId: source.id, page,
    model: configuredModel(), type: q.type, diff: q.difficulty || "TH",
    topic, grade: q.grade || options.grade || 12, stem: q.stem_latex || "", sol: q.solution_latex || "",
    answerSource: q.answer_source || "none", notes: q.notes || null,
    raw: [`Câu ${index + 1}. ${String(q.stem_latex || "").replace(/\$[^$]*\$/g, " ").trim()}`],
  };
  if (options.srcLabel) item.srcLabel = options.srcLabel;
  if (q.type === "MC") { item.ch = (q.mc_choices || []).map(x => x.text_latex); item.ans = answerIndex(q.mc_correct); }
  if (q.type === "TF") item.tf = (q.tf_statements || []).map(x => [x.text_latex, Boolean(x.is_true)]);
  if (q.type === "SHORT" && q.short_answer) item.sa = { value: String(q.short_answer.value), unit: q.short_answer.unit || "", tol: String(q.short_answer.tolerance ?? 0) };
  if (Array.isArray(q.images) && q.images.length) item.figNote = q.images.map(x => x.note || x.caption || "Có hình trong đề gốc").join("; ");
  return item;
}

export async function extractSource(source, jobId, options) {
  const jobDir = path.join(dataDir(), "jobs", jobId);
  await mkdir(jobDir, { recursive: true });
  const pages = await pageFiles(source, jobDir);
  const questions = [];
  if (process.env.EDUVAULT_OCR_MOCK === "1") {
    const fixture = JSON.parse(await readFile(path.join(PHASE0, "fixtures", "sample-exam.json"), "utf8"));
    (fixture.questions || []).forEach((q, index) => questions.push(toAppQuestion(q, source, 1, index, options)));
    return { pages: pages.length, questions };
  }
  for (let i = 0; i < pages.length; i++) {
    const output = path.join(jobDir, `extraction-${i + 1}.json`);
    const tsxCli = path.join(PHASE0, "node_modules", "tsx", "dist", "cli.mjs");
    const cli = path.join(PHASE0, "src", "cli.ts");
    const args = [tsxCli, cli, "extract", pages[i], "--subject", options.subject, "--output", output];
    args.push("--model", configuredModel());
    await run(process.execPath, args, PHASE0);
    const payload = JSON.parse(await readFile(output, "utf8"));
    const pageQuestions = Array.isArray(payload.questions) ? payload.questions : [];
    pageQuestions.forEach((q, index) => questions.push(toAppQuestion(q, source, i + 1, index, options)));
  }
  return { pages: pages.length, questions };
}
