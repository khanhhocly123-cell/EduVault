import "dotenv/config";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PageExtraction,
  VerifyReport,
  validateQuestion,
  type ExamDoc,
  type TQuestion,
  type TVerifyReport,
} from "./types.js";
import { extractionSystem, EXTRACTION_USER, VERIFY_SYSTEM, verifyUser } from "./prompt.js";
import { SUBJECT_NAMES, type Subject } from "./topics.js";
import { providerFor, apiKeyEnvFor, vendorOf, formatUsage, costOf, PRICING, VENDORS } from "./providers.js";
import { compileTikz, SAMPLE_TIKZ } from "./tikz.js";
import { buildReferenceDocx, checkReferenceDocx } from "./reference.js";
import { selftest } from "./selftest.js";
import {
  buildExamMarkdown,
  buildAnswerKeyMarkdown,
  buildSolutionMarkdown,
  pandocToDocx,
  checkDocx,
  exists,
  type AssetMap,
} from "./render.js";

const OUT = resolve("out");
const DEFAULT_MODEL = process.env.DE_MODEL ?? "claude-opus-5";
/** Bước 2 phải là model KHÁC bước 1, nếu không nó chỉ gật đầu với chính mình. */
const DEFAULT_VERIFY_MODEL = process.env.DE_VERIFY_MODEL ?? "claude-sonnet-5";

/** `--model` đứng cuối dòng lệnh thì argv[i+1] là undefined, và `--model --effort x`
 *  thì nó nuốt luôn cờ sau. Cả hai trường hợp coi như không truyền. */
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`Cờ --${name} thiếu giá trị.`);
  }
  return v;
}

function subjectArg(): Subject {
  const v = arg("subject", "physics")!;
  if (v !== "physics" && v !== "math") {
    throw new Error(`--subject chỉ nhận "physics" hoặc "math", nhận được "${v}".`);
  }
  return v;
}

/**
 * Tìm executable trên PATH bằng cách quét thư mục, không chạy thử `--version`.
 * Chạy thử cho kết quả sai: latexmk của MiKTeX thoát với mã khác 0 khi gọi
 * `--version` dù nó vẫn hoạt động bình thường.
 */
async function which(cmd: string): Promise<boolean> {
  const dirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        await access(resolve(dir, cmd + ext));
        return true;
      } catch {
        /* thử tiếp */
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------- doctor

async function doctor() {
  console.log("Kiểm tra môi trường Phase 0\n");
  const checks: [string, boolean, string][] = [
    ["pandoc", await which("pandoc"), "winget install --id JohnMacFarlane.Pandoc -e"],
    ["pdflatex", await which("pdflatex"), "cài MiKTeX (chỉ cần cho phần TikZ)"],
    ["pdftoppm", await which("pdftoppm"), "đi kèm MiKTeX (chỉ cần cho phần TikZ)"],
  ];
  for (const [name, ok, hint] of checks) {
    console.log(`  ${ok ? "OK  " : "THIẾU"}  ${name}${ok ? "" : `   -> ${hint}`}`);
  }
  console.log("\n  Key theo từng nhà — chỉ cần MỘT cái là chạy được:\n");
  let anyKey = false;
  for (const [vendor, cfg] of Object.entries(VENDORS)) {
    const ok = Boolean(process.env[cfg.envKey]);
    anyKey ||= ok;
    const models = Object.entries(PRICING)
      .filter(([, p]) => p.vendor === vendor)
      .map(([m]) => m);
    console.log(`  ${ok ? "OK   " : "thiếu"}  ${cfg.envKey.padEnd(18)} ${cfg.label}`);
    if (!ok) console.log(`         ${cfg.hint}`);
    if (models.length) console.log(`         model: ${models.slice(0, 4).join(", ")}`);
  }
  if (!anyKey) {
    console.log("\n  Chép .env.example thành .env rồi điền ít nhất một key.");
    console.log("  Rẻ nhất: GEMINI_API_KEY — hạn mức miễn phí, lấy trong 30 giây.");
  }

  console.log(`\n  model đọc: ${DEFAULT_MODEL} (${vendorOf(DEFAULT_MODEL) ?? "không đoán được nhà"})`);
  console.log(`  model đối chiếu (chỉ dùng khi đo eval, bật bằng --verify):`);
  console.log(`    ${DEFAULT_VERIFY_MODEL} (${vendorOf(DEFAULT_VERIFY_MODEL) ?? "không đoán được nhà"})`);
  if (vendorOf(DEFAULT_MODEL) === vendorOf(DEFAULT_VERIFY_MODEL)) {
    console.log("    (!) Cùng nhà với bước 1 — lúc đo eval nên đổi sang nhà khác.");
  }
}

// ---------------------------------------------------------------- tikz

async function tikz() {
  const out = resolve(OUT, "assets", "sample-incline.png");
  console.log("Biên dịch hình TikZ mẫu...");
  await compileTikz(SAMPLE_TIKZ, out);
  console.log(`OK -> ${out}`);
}

// ---------------------------------------------------------------- prices

/**
 * Lượng token đo được của một trang đề đã scan, dùng làm mốc so giá giữa các
 * model. Đo lại khi đổi prompt — prompt dài ra là mọi con số dưới đây sai theo.
 */
const TOKENS_PER_PAGE = { input: 5700, output: 2000 };
const USD_VND = 26_000;

/** In bảng giá mỗi trang. Bảng trong HANDOFF.md phải khớp với đầu ra ở đây. */
function prices() {
  const pages = Number(arg("pages", "300"));
  console.log(`Chi phí trích xuất, ước tính ${TOKENS_PER_PAGE.input} token vào + ${TOKENS_PER_PAGE.output} token ra mỗi trang`);
  console.log(`(chưa tính cache; tỉ giá thô ${USD_VND.toLocaleString("vi-VN")} đ/USD)\n`);
  console.log(`  ${"model".padEnd(20)} ${"nhà".padEnd(10)} ${"$/trang".padStart(9)} ${"đ/trang".padStart(9)} ${`${pages} trang`.padStart(12)}`);
  console.log("  " + "-".repeat(64));

  const rows = Object.keys(PRICING).map((model) => {
    const { costUsd } = costOf(model, {
      freshInput: TOKENS_PER_PAGE.input,
      output: TOKENS_PER_PAGE.output,
      cacheRead: 0,
      cacheWrite: 0,
    });
    return { model, vendor: PRICING[model]!.vendor, costUsd };
  });

  for (const r of rows.sort((a, b) => a.costUsd - b.costUsd)) {
    const vnd = r.costUsd * USD_VND;
    console.log(
      `  ${r.model.padEnd(20)} ${r.vendor.padEnd(10)} ` +
        `${("$" + r.costUsd.toFixed(4)).padStart(9)} ` +
        `${(Math.round(vnd).toLocaleString("vi-VN") + "đ").padStart(9)} ` +
        `${(Math.round(vnd * pages).toLocaleString("vi-VN") + "đ").padStart(12)}`,
    );
  }

  // Số lượt quét của từng gói — phải khớp `scans` trong web/data.js PLANS.
  // Một lượt = một trang ở mức đọc nhẹ nhất.
  console.log("\n  Giá vốn của từng gói dịch vụ, nếu dùng model rẻ nhất:");
  const cheapest = rows.reduce((a, b) => (a.costUsd <= b.costUsd ? a : b));
  for (const [name, quota] of [["Lite", 40], ["Plus", 400], ["Pro", 1500]] as const) {
    const vnd = cheapest.costUsd * USD_VND * quota;
    console.log(`    ${name.padEnd(6)} ${String(quota).padStart(4)} trang -> ${Math.round(vnd).toLocaleString("vi-VN")}đ`);
  }
}

// ---------------------------------------------------------------- reference

async function reference() {
  const out = resolve("templates", "reference.docx");
  console.log("Dựng bộ style cho file Word xuất ra...\n");
  await buildReferenceDocx(out);

  let allOk = true;
  for (const c of checkReferenceDocx(out)) {
    if (!c.ok) allOk = false;
    console.log(`  ${c.ok ? "OK   " : "HỎNG "} ${c.label.padEnd(18)} ${c.detail}`);
  }
  console.log(`\n${allOk ? "OK" : "CÓ CHỖ HỎNG"} -> ${out}`);
  console.log("`npm run render` sẽ tự dùng file này, không cần khai báo thêm.");
}

// ---------------------------------------------------------------- render

async function loadAssets(doc: ExamDoc): Promise<AssetMap> {
  const assets: AssetMap = new Map();
  const needsFigure = doc.questions.some((q) => q.images.length > 0);
  if (!needsFigure) return assets;

  // Phase 0: mọi hình dùng chung một figure TikZ mẫu. Ở bản đầy đủ, hình
  // đến từ việc cắt PDF hoặc từ TikZ sinh riêng cho từng câu.
  const png = resolve(OUT, "assets", "sample-incline.png");
  try {
    await compileTikz(SAMPLE_TIKZ, png);
  } catch (e) {
    console.warn(`  (!) Không compile được TikZ, hình sẽ bị thiếu: ${(e as Error).message.split("\n")[0]}`);
    return assets;
  }
  doc.questions.forEach((q, i) => {
    for (const im of q.images) assets.set(`${i}:${im.slot}`, png);
  });
  return assets;
}

async function render(source: string) {
  const doc = JSON.parse(await readFile(resolve(source), "utf8")) as ExamDoc;

  const problems = doc.questions.flatMap((q, i) => validateQuestion(q, i));
  if (problems.length) {
    console.log("Cảnh báo về dữ liệu đầu vào:");
    for (const p of problems) console.log(`  - ${p}`);
    console.log("");
  }

  await mkdir(OUT, { recursive: true });
  const assets = await loadAssets(doc);
  const expectedImages = new Set(assets.values()).size;

  // Thiếu template thì pandoc vẫn chạy, chỉ là ra font Aptos và lề 1 inch —
  // sai lặng lẽ, mở file lên mới biết. Nói thẳng ra ngay từ đây.
  const ref = resolve("templates", "reference.docx");
  if (!(await exists(ref))) {
    console.log("(!) Chưa có templates/reference.docx — file xuất ra sẽ dùng font và lề mặc định");
    console.log("    của pandoc, không phải kiểu đề thi Việt Nam. Chạy `npm run reference` trước.\n");
  }

  const jobs: [string, string, boolean, number][] = [
    ["de.docx", buildExamMarkdown(doc, assets), true, expectedImages],
    ["dap-an.docx", buildAnswerKeyMarkdown(doc), false, 0],
    ["loi-giai.docx", buildSolutionMarkdown(doc, assets), true, expectedImages],
  ];

  console.log("Xuất file:\n");
  const results = [];
  for (const [name, md, expectMath, expectImages] of jobs) {
    const path = await pandocToDocx(md, resolve(OUT, name), { referenceDocx: ref });
    const check = checkDocx(path, expectMath, expectImages);
    results.push(check);
    console.log(`  ${check.verdict === "PASS" ? "PASS" : "FAIL"}  ${name}`);
    console.log(`        equation Word (<m:oMath>): ${check.omathCount}`);
    console.log(`        ảnh nhúng: ${check.imageCount}   bảng: ${check.tableCount}`);
    for (const r of check.reasons) console.log(`        ! ${r}`);
    console.log("");
  }

  const allPass = results.every((r) => r.verdict === "PASS");
  console.log(allPass ? "KILL TEST: PASS (tự động)" : "KILL TEST: FAIL");
  console.log(`\nFile nằm ở ${OUT}`);
  console.log("\nPhần tự động chỉ chứng minh công thức là equation của Word.");
  console.log("Còn phải mở de.docx bằng Word thật và tự kiểm bằng mắt:");
  console.log("  1. Click vào một công thức — có hiện khung equation sửa được không?");
  console.log("  2. Dấu thập phân có đúng kiểu Việt Nam ($0{,}5$ ra 0,5) không?");
  console.log("  3. Hình có đúng vị trí, đúng tỉ lệ, không méo không?");
  console.log("  4. Cụm 4 phương án có nằm 2 cột và KHÔNG có viền bảng không?");
  console.log("     (nếu còn viền: cần sửa style Table trong templates/reference.docx)");
}

// ---------------------------------------------------------------- extract

/** Mỗi model đòi key của nhà nó, báo thiếu đúng cái đang thiếu. */
function requireKey(model: string) {
  const env = apiKeyEnvFor(model);
  if (!process.env[env]) {
    throw new Error(`Chưa có ${env} (model "${model}"). Chép .env.example thành .env rồi điền key vào đó.`);
  }
}

async function extract(file: string): Promise<TQuestion[]> {
  const model = arg("model", DEFAULT_MODEL)!;
  requireKey(model);
  const effort = arg("effort") as "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  const subject = subjectArg();

  console.log(`Trích xuất ${file}`);
  console.log(
    `  môn: ${SUBJECT_NAMES[subject]}   model: ${model} (${vendorOf(model)})` +
      `${effort ? `   effort: ${effort}` : ""}\n`,
  );

  const provider = providerFor(model);
  const { data, usage } = await provider.extract({
    file: resolve(file),
    system: extractionSystem(subject),
    user: EXTRACTION_USER,
    schema: PageExtraction,
    model,
    effort,
  });

  console.log(formatUsage(usage));
  console.log(`\n  trích được ${data.questions.length} câu`);

  const problems = data.questions.flatMap((q, i) => validateQuestion(q, i));
  if (problems.length) {
    console.log("\n  Vấn đề cần giáo viên xem lại:");
    for (const p of problems) console.log(`    - ${p}`);
  }

  await mkdir(OUT, { recursive: true });
  // Phase 1 chạy nhiều job độc lập nên không thể để mọi lượt cùng ghi đè
  // `out/extraction.json`. CLI cũ vẫn giữ mặc định này, còn worker truyền
  // `--output <đường-dẫn-riêng>` cho từng job.
  const jsonPath = resolve(arg("output", resolve(OUT, "extraction.json"))!);
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(data, null, 2), "utf8");
  console.log(`\n  JSON -> ${jsonPath}`);

  return data.questions;
}

// ---------------------------------------------------------------- verify

/**
 * Bước 2 — đối chiếu chéo. Model thứ hai nhận lại ẢNH GỐC cùng bản trích xuất
 * và chỉ được báo chỗ lệch. Chạy mù trên text thì nó "sửa" cả số liệu vốn đã
 * đúng, nên ảnh phải đi kèm — đó là lý do nó dùng VisionProvider chứ không phải
 * một lần gọi text thường.
 *
 * Khác VENDOR mới là mục tiêu: hai lượt cùng một nhà thì lỗi hệ thống nào cả
 * nhà đó cùng mắc sẽ lọt qua cả hai lượt. Nay đã có cả adapter OpenAI nên chạy
 * chéo nhà được thật; chạy cùng nhà thì có cảnh báo, không im lặng cho qua.
 */
async function verify(file: string, extractionPath: string, model1?: string): Promise<TVerifyReport> {
  const model = arg("verify-model", DEFAULT_VERIFY_MODEL)!;
  requireKey(model);
  const extraction = await readFile(resolve(extractionPath), "utf8");

  console.log(`Đối chiếu chéo ${file}`);
  console.log(`  model đối chiếu: ${model} (${vendorOf(model)})`);
  if (model1 && vendorOf(model1) === vendorOf(model)) {
    console.log(`  (!) Cùng nhà "${vendorOf(model)}" với bước 1 — lỗi hệ thống chung của nhà này sẽ lọt.`);
    console.log(`      Chéo nhà thật thì dùng --verify-model gpt-5.6-luna hoặc ngược lại.`);
  }
  console.log("");

  const provider = providerFor(model);
  const { data, usage } = await provider.extract({
    file: resolve(file),
    system: VERIFY_SYSTEM,
    user: verifyUser(extraction),
    schema: VerifyReport,
    model,
  });

  console.log(formatUsage(usage));

  const high = data.discrepancies.filter((d) => d.severity === "high");
  const low = data.discrepancies.filter((d) => d.severity === "low");
  console.log(`\n  chỗ lệch: ${high.length} nghiêm trọng · ${low.length} nhẹ`);

  for (const d of [...high, ...low]) {
    const mark = d.severity === "high" ? "!!" : "  ";
    console.log(`\n  ${mark} câu ${d.question_index + 1} · ${d.field}`);
    console.log(`       bản trích xuất: ${d.extracted}`);
    console.log(`       đọc từ ảnh    : ${d.from_image}`);
    if (d.note) console.log(`       ghi chú       : ${d.note}`);
  }

  const reportPath = resolve(OUT, "verify.json");
  await mkdir(OUT, { recursive: true });
  await writeFile(reportPath, JSON.stringify(data, null, 2), "utf8");
  console.log(`\n  báo cáo -> ${reportPath}`);

  if (high.length) {
    console.log("\n  Có chỗ lệch nghiêm trọng — đừng tự duyệt, bắt buộc giáo viên xem lại.");
  }
  return data;
}

// ---------------------------------------------------------------- full

async function full(file: string) {
  const questions = await extract(file);

  /* Mặc định KHÔNG đối chiếu chéo nữa (12/08/2026).
   *
   * Bước này nhân đôi chi phí mỗi trang để đổi lấy thứ mà màn Duyệt trong app
   * đã làm rồi — và màn Duyệt thì miễn phí, lại chính xác hơn vì có mắt người
   * nhìn ảnh gốc. Sản phẩm đã bỏ hẳn tính năng này.
   *
   * Lệnh `verify` vẫn giữ lại vì nó hữu dụng cho việc KHÁC: chạy eval để đo
   * xem một model đọc sai chỗ nào. Bật bằng --verify khi cần đo, không phải
   * khi soạn đề. */
  if (process.argv.includes("--verify")) {
    console.log("");
    await verify(file, resolve(OUT, "extraction.json"), arg("model", DEFAULT_MODEL));
  }

  const subject = subjectArg();
  const doc: ExamDoc = {
    header: {
      org: "Sở GD&ĐT",
      school: "Trường THPT",
      title: "Đề kiểm tra",
      subject: SUBJECT_NAMES[subject],
      durationMin: subject === "math" ? 90 : 50,
      code: "101",
    },
    questions,
  };
  const docPath = resolve(OUT, "exam.json");
  await writeFile(docPath, JSON.stringify(doc, null, 2), "utf8");
  console.log("");
  await render(docPath);
}

// ---------------------------------------------------------------- main

const [, , command, positional] = process.argv;

const run = async () => {
  switch (command) {
    case "doctor":
      return doctor();
    case "tikz":
      return tikz();
    case "reference":
      return reference();
    case "prices":
      return prices();
    case "selftest":
      if (selftest() > 0) process.exit(1);
      return;
    case "render":
      return render(positional ?? "fixtures/sample-exam.json");
    case "extract":
      if (!positional) throw new Error("Cần đường dẫn file: npm run extract -- <ảnh hoặc pdf>");
      await extract(positional);
      return;
    case "verify": {
      if (!positional) throw new Error("Cần đường dẫn file: npm run verify -- <ảnh hoặc pdf>");
      const json = arg("json", resolve(OUT, "extraction.json"))!;
      await verify(positional, json, arg("model"));
      return;
    }
    case "full":
      if (!positional) throw new Error("Cần đường dẫn file: npm run full -- <ảnh hoặc pdf>");
      return full(positional);
    default:
      console.log(
        [
          "Phase 0 — spike kiểm chứng",
          "",
          "  npm run doctor                    kiểm tra pandoc / MiKTeX / API key",
          "  npm run reference                 dựng lại templates/reference.docx",
          "  npm run prices                    bảng giá mỗi trang của từng model",
          "  npm run selftest                  tự kiểm logic tính tiền + prompt (không cần key)",
          "  npm run render                    fixture JSON -> 3 file docx + kill test",
          "  npm run render -- <file.json>     dựng docx từ JSON của mày",
          "  npm run tikz                      thử biên dịch hình TikZ mẫu",
          "  npm run extract -- <file>         ảnh/PDF -> JSON (cần API key)",
          "  npm run verify -- <file>          đối chiếu chéo JSON với ảnh gốc (công cụ đo eval,",
          "                                    KHÔNG còn là một bước của sản phẩm)",
          "  npm run full -- <file>            ảnh/PDF -> JSON -> đối chiếu -> docx",
          "",
          "  Cờ thêm:",
          "    --subject physics|math          mặc định physics, đổi cả prompt lẫn bảng chuyên đề",
          "    --model gpt-5.6-luna            model bước 1, tự chọn nhà theo tên model",
          "    --verify-model claude-opus-5    model bước 2, nên khác NHÀ với bước 1",
          "    --effort medium",
          "    --json <file>                   bản trích xuất cần đối chiếu (lệnh verify)",
          "    --verify                        bật đối chiếu chéo trong `full` (chỉ dùng khi đo eval)",
        ].join("\n"),
      );
  }
};

run().catch((e: Error) => {
  console.error(`\nLỗi: ${e.message}`);
  process.exit(1);
});
