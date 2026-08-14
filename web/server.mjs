import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearCookie, createJob, currentUser, database, dataDir, finishJob, IMAGE_BATCH_MIME, ingestJob,
  ingestJobCount, ingestJobTotalCount, loadWorkspace, login, logout, parseJobOptions,
  publicIngestJob, register, resumableIngestJobs, saveWorkspace, sessionCookie, sourceFile,
  startJob, storeUpload, storeUploadBatch, updateJobProgress,
} from "./backend.mjs";
import { createRateLimiter, scheduleBackups } from "./guard.mjs";
import { createManualCrop, createStyleReference, extractSource } from "./ocr.mjs";
import { configuredModel, ocrConfig, pingModel } from "./ocr-model.mjs";
import { buildLatexDocument } from "./latex.mjs";

const ROOT = resolve(fileURLToPath(new URL("./", import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const PUBLIC_BETA = process.env.EDUVAULT_PUBLIC_BETA === "1";
const BETA_OCR_LIMIT = Math.max(1, Number(process.env.EDUVAULT_BETA_OCR_LIMIT) || 20);
const BETA_GLOBAL_OCR_LIMIT = Math.max(BETA_OCR_LIMIT, Number(process.env.EDUVAULT_BETA_GLOBAL_OCR_LIMIT) || 60);
const PUBLIC_FILES = new Set([
  "/index.html", "/login.html", "/styles.css", "/app.js", "/data.js",
  "/docx.js", "/omml.js", "/latex-core.js", "/format.js",
  "/fonts/latinmodern-roman.css", "/fonts/lmroman-regular-webfont.woff",
  "/fonts/lmroman-bold-webfont.woff", "/fonts/lmroman-italic-webfont.woff",
  "/fonts/lmroman-bolditalic-webfont.woff",
]);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2",
};

function json(res, status, value, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(value));
}
function requestObject(req, url) {
  const init = { method: req.method, headers: req.headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}
function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) json(res, 401, { error: "Chưa đăng nhập" });
  return user;
}
function requireOcrQuota(user){
  if(PUBLIC_BETA && ingestJobTotalCount() >= BETA_GLOBAL_OCR_LIMIT)
    throw Object.assign(new Error("Bản beta đã dùng hết quota OCR chung. Liên hệ chủ bản test để mở thêm."), { status:429 });
  if(PUBLIC_BETA && ingestJobCount(user.id) >= BETA_OCR_LIMIT)
    throw Object.assign(new Error(`Tài khoản beta đã dùng đủ ${BETA_OCR_LIMIT} lượt OCR. Liên hệ chủ bản test để mở thêm.`), { status:429 });
}
/* ── Tìm pdflatex ─────────────────────────────────────────────────────────
 *
 * Trước đây đường dẫn MiKTeX của một máy cụ thể bị hard-code làm mặc định, nên
 * mọi máy khác (và container Linux trên Render) đều chết với ENOENT. Nay thứ tự
 * là: PDFLATEX_PATH nếu nó thật sự tồn tại → `pdflatex` trong PATH → các vị trí
 * cài đặt quen thuộc trên Windows. Ứng viên nào ENOENT thì thử tiếp ứng viên
 * sau, và cái nào chạy được sẽ được nhớ lại cho những lần biên dịch sau.
 */
const LATEX_EXE = process.platform === "win32" ? "pdflatex.exe" : "pdflatex";
function windowsLatexCandidates(){
  const paths=[];
  const localApp=process.env.LOCALAPPDATA, programFiles=process.env.ProgramFiles, programFilesX86=process.env["ProgramFiles(x86)"];
  for(const base of [localApp&&join(localApp,"Programs","MiKTeX"),programFiles&&join(programFiles,"MiKTeX"),programFilesX86&&join(programFilesX86,"MiKTeX")]){
    if(!base)continue;
    paths.push(join(base,"miktex","bin","x64",LATEX_EXE),join(base,"miktex","bin",LATEX_EXE));
  }
  for(const year of ["2026","2025","2024","2023"])
    paths.push(join("C:\\texlive",year,"bin","windows",LATEX_EXE),join("C:\\texlive",year,"bin","win32",LATEX_EXE));
  return paths;
}
function pdfLatexCandidates(){
  const paths=[];
  // PDFLATEX_PATH được ưu tiên, nhưng chỉ khi nó còn tồn tại: một biến môi
  // trường cũ trỏ tới máy khác không được phép khoá cứng cả tính năng.
  const configured=(process.env.PDFLATEX_PATH||"").trim();
  if(configured&&(!/[\\/]/.test(configured)||existsSync(configured)))paths.push(configured);
  paths.push("pdflatex");
  if(process.platform==="win32")paths.push(...windowsLatexCandidates().filter(path=>existsSync(path)));
  else for(const path of ["/usr/bin/pdflatex","/usr/local/bin/pdflatex"])if(existsSync(path))paths.push(path);
  return paths;
}
const LATEX_MISSING="Không tìm thấy pdflatex trên máy chủ. Cài MiKTeX/TeX Live rồi mở lại app, hoặc đặt biến môi trường PDFLATEX_PATH trỏ tới pdflatex.";
const LATEX_MAX_MS=Math.max(60_000,Number(process.env.EDUVAULT_LATEX_TIMEOUT_MS)||180_000);
let latexQueue=Promise.resolve();
let resolvedPdfLatex=null;
function spawnPdfLatex(command,cwd){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,["-interaction=nonstopmode","-halt-on-error","-no-shell-escape","exam.tex"],{cwd,windowsHide:true});
    let output="",settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error("LaTeX quá thời gian biên dịch"));},LATEX_MAX_MS);
    child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);
    child.on("error",error=>finish(error));child.on("close",code=>code===0?finish(null,output):finish(new Error(output.slice(-1600)||`pdfLaTeX thoát mã ${code}`)));
  });
}
function runPdfLatex(cwd){
  const run=async()=>{
    const candidates=[...new Set([resolvedPdfLatex,...pdfLatexCandidates()].filter(Boolean))];
    let lastError=null;
    for(const command of candidates){
      try{
        const output=await spawnPdfLatex(command,cwd);
        if(resolvedPdfLatex!==command)console.log(`[latex] dùng ${command}`);
        resolvedPdfLatex=command;
        return output;
      }catch(error){
        if(error?.code!=="ENOENT")throw error;
        if(resolvedPdfLatex===command)resolvedPdfLatex=null;
        lastError=error;
      }
    }
    throw Object.assign(new Error(LATEX_MISSING),{cause:lastError});
  };
  const queued=latexQueue.then(run,run);
  latexQueue=queued.catch(()=>{});
  return queued;
}
function dataImage(value){
  const match=/^data:image\/(png|jpeg);base64,(.+)$/i.exec(String(value||""));
  if(!match)return null;
  const bytes=Buffer.from(match[2],"base64");
  if(bytes.length>20*1024*1024)return null;
  return {ext:match[1].toLowerCase()==="jpeg"?"jpg":"png",bytes};
}

/* ── OCR chạy nền ─────────────────────────────────────────────────────────
 *
 * Trước đây `/api/upload` GIỮ nguyên request HTTP suốt thời gian OCR. Một PDF
 * 8 trang là tám lượt gọi model nối đuôi nhau, tức là request treo 3–5 phút:
 * trình duyệt, cloudflared và mọi reverse proxy ở giữa đều cắt trước khi có
 * kết quả, và người dùng chỉ thấy "OCR lỗi" dù model đã đọc xong mấy trang.
 *
 * Nay upload chỉ tạo job rồi trả về ngay; client hỏi `/api/jobs/:id` để biết
 * tiến độ. Kết quả từng trang được ghi ra `extraction-N.json`, nên bấm "Thử
 * lại" chỉ tốn lượt gọi cho những trang còn thiếu.
 */
const SCAN_MULTIPLIER = { nhanh:1, chuan:2, ki:4 };
const runningJobs = new Map();

const sourceKind = (source) => {
  const mime = source.mimeType ?? source.mime_type;
  return mime === "application/pdf" ? "PDF" : mime === IMAGE_BATCH_MIME ? "Lô ảnh" : "Ảnh";
};

function putSourceRow(userId, row){
  const state = loadWorkspace(userId);
  state.sources = state.sources.filter(item => item.id !== row.id);
  state.sources.push(row);
  saveWorkspace(userId, state);
  return state;
}

function runningSourceRow(source, options, jobId){
  const pages = Number(options.expectedPages) || 0;
  return {
    id:source.id, name:source.filename, kind:sourceKind(source), vaultId:options.vaultId,
    tier:options.tier, pages, found:null, scans:pages * (SCAN_MULTIPLIER[options.tier] || 1),
    state:"run", label:"Đang đọc tài liệu", prog:4, jobId,
    fileUrl:`/api/sources/${source.id}/file`, pageUrl:`/api/jobs/${jobId}/pages/{page}`,
  };
}

/** Chạy một job đến khi xong. Không ném lỗi ra ngoài — mọi kết cục đều ghi vào DB. */
async function runIngestJob(userId, jobId, source, options){
  if (runningJobs.has(jobId)) return runningJobs.get(jobId);
  const task = (async () => {
    startJob(jobId, userId);
    try {
      const result = await extractSource(source, jobId, {
        ...options,
        onProgress: progress => updateJobProgress(jobId, userId, progress),
      });
      for (const question of result.questions ?? []) question.vaultId = options.vaultId;
      for (const group of result.groups ?? []) group.vaultId = options.vaultId;
      finishJob(jobId, userId, result);
      const row = {
        id:source.id, name:source.filename, kind:sourceKind(source), vaultId:options.vaultId,
        tier:options.tier, pages:result.pages, found:result.questions.length,
        scans:result.pages * (SCAN_MULTIPLIER[options.tier] || 1),
        state:"review", label:`Chờ duyệt ${result.questions.length} câu`, prog:100,
        emptyPages:result.usage?.emptyPages || 0,
        fileUrl:`/api/sources/${source.id}/file`, jobId,
        // Luôn dùng đúng ảnh canonical đã đưa cho model, kể cả JPG có EXIF rotation.
        pageUrl:`/api/jobs/${jobId}/pages/{page}`,
      };
      // Ghi ngay ở máy chủ: kể cả tab đóng giữa chừng, kết quả vẫn còn.
      const state = loadWorkspace(userId);
      state.sources = state.sources.filter(item => item.id !== source.id);
      state.sources.push(row);
      /* Đọc lại một tài liệu là THAY hàng chờ của nó, không phải cộng thêm.
         Bấm "Thử lại" khi đang còn câu chờ của chính tài liệu đó mà cộng dồn thì
         giáo viên phải ngồi xoá tay từng câu trùng. Câu đã duyệt vào kho không
         bị đụng tới — chúng không còn nằm trong hàng chờ nữa. */
      state.pending = state.pending.filter(item => item.srcId !== source.id);
      state.groups = state.groups.filter(group => group.sourceId !== source.id);
      state.pending.push(...result.questions);
      state.groups.push(...(result.groups ?? []));
      saveWorkspace(userId, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = error?.kind || null;
      finishJob(jobId, userId, null, `${kind ? `[${kind}] ` : ""}${message}`.slice(0, 4000));
      putSourceRow(userId, {
        id:source.id, name:source.filename, kind:sourceKind(source), vaultId:options.vaultId,
        tier:options.tier, pages:0, found:0, scans:0, state:"failed", label:"OCR lỗi", prog:0,
        error:message.slice(0, 1000), errorKind:kind,
        fileUrl:`/api/sources/${source.id}/file`, jobId,
      });
      console.error("[ocr]", jobId, kind || "", message);
    } finally {
      runningJobs.delete(jobId);
    }
  })();
  runningJobs.set(jobId, task);
  return task;
}

/** Sau khi server khởi động lại, job đang dở được chạy tiếp — trang đã xong không gọi model lần nữa. */
async function resumePendingJobs(){
  for (const job of resumableIngestJobs()) {
    const options = parseJobOptions(job);
    const source = sourceFile(String(job.user_id), String(job.source_id));
    if (!source) { finishJob(String(job.id), String(job.user_id), null, "Không còn file gốc để OCR tiếp"); continue; }
    if (Number(job.attempts || 0) >= 3) {
      finishJob(String(job.id), String(job.user_id), null, "Job đã thử lại 3 lần mà vẫn dở; bấm Thử lại để chạy tiếp.");
      continue;
    }
    console.log(`[ocr] chạy tiếp job ${job.id} (${job.status})`);
    void runIngestJob(String(job.user_id), String(job.id), source, options);
  }
}

/* Chặn dội request. Đặt ở CỬA của mọi route `/api/`, trước cả kiểm tra đăng nhập
   — nếu để sau thì việc dò mật khẩu vẫn được chạy qua hàm băm scrypt mỗi lần,
   tức là kẻ dò tốn một request còn máy chủ tốn cả trăm mili giây CPU. */
const rateLimit = createRateLimiter({
  trustProxy: process.env.EDUVAULT_TRUST_PROXY !== "0",
});

async function api(req, res, url) {
  const blocked = rateLimit(req, url.pathname);
  if(blocked) return json(res, blocked.status, { error:blocked.error },
    { "retry-after":String(blocked.retryAfter) });
  try {
    if (req.method === "GET" && url.pathname === "/api/session") {
      const user = currentUser(req);
      return user ? json(res, 200, { user }) : json(res, 401, { error: "Chưa đăng nhập" });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/register") {
      const result = await register(await requestObject(req, url).json());
      return json(res, 201, { user: result.user }, { "set-cookie": sessionCookie(result.token) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const result = await login(await requestObject(req, url).json());
      return json(res, 200, { user: result.user }, { "set-cookie": sessionCookie(result.token) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      logout(req);
      return json(res, 200, { ok: true }, { "set-cookie": clearCookie() });
    }

    if (req.method === "GET" && url.pathname === "/api/workspace") {
      const user = requireUser(req, res); if (!user) return;
      return json(res, 200, { user, ...loadWorkspace(user.id) });
    }
    if(req.method === "POST" && url.pathname === "/api/export/latex-pdf"){
      const user=requireUser(req,res);if(!user)return;
      const payload=await requestObject(req,url).json();
      const doc=payload.doc;
      if(!doc || !Array.isArray(doc.questions) || doc.questions.length>500)
        return json(res,400,{error:"Cấu trúc đề không hợp lệ"});
      const folder=await mkdtemp(join(tmpdir(),"eduvault-latex-"));
      try{
        const assetPaths={};
        for(const [key,value] of Object.entries(payload.assets||{})){
          const image=dataImage(value);if(!image)continue;
          const name=`asset-${key.replace(/[^a-z0-9-]/gi,"-")}.${image.ext}`;
          await writeFile(join(folder,name),image.bytes);assetPaths[key]=name;
        }
        const compiled=buildLatexDocument(doc,{mode:["de","dapan","loigiai"].includes(payload.mode)?payload.mode:"de",assets:assetPaths});
        await writeFile(join(folder,"exam.tex"),compiled,"utf8");
        await runPdfLatex(folder);
        const body=await readFile(join(folder,"exam.pdf"));
        res.writeHead(200,{"content-type":"application/pdf","content-disposition":`attachment; filename="${String(payload.filename||"de").replace(/[^a-z0-9_-]/gi,"-")}.pdf"`,"cache-control":"no-store"});
        return res.end(body);
      }finally{await rm(folder,{recursive:true,force:true}).catch(()=>{});}
    }
    if ((req.method === "PUT" || req.method === "POST") && url.pathname === "/api/workspace") {
      const user = requireUser(req, res); if (!user) return;
      const payload = await requestObject(req, url).json();
      try {
        /* Không gửi mốc = không chứng minh được là đã đọc bản mới nhất, nên coi
           như cũ. Tab đang mở bằng bản app.js đời trước từng lọt qua kẽ này và
           xoá đúng 13 câu vừa OCR xong. */
        const saved = saveWorkspace(user.id, payload, typeof payload.version === "string" ? payload.version : "");
        return json(res, 200, { ok: true, version: saved.version, counts: {
          bank: saved.bank.length, pending: saved.pending.length, sources: saved.sources.length,
        }});
      } catch (error) {
        if (error?.code !== "stale-workspace") throw error;
        // Trả kèm bản mới nhất để client trộn lại ngay, khỏi phải hỏi thêm một vòng.
        return json(res, 409, { error:error.message, code:"stale-workspace", workspace:loadWorkspace(user.id) });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/style-references") {
      const user = requireUser(req, res); if (!user) return;
      const form = await requestObject(req, url).formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json(res, 400, { error:"Chưa chọn ảnh hoặc PDF format mẫu" });
      return json(res, 201, await createStyleReference(user.id, file));
    }

    const styleReferenceMatch = /^\/api\/style-references\/([a-z0-9-]+)$/i.exec(url.pathname);
    if (req.method === "GET" && styleReferenceMatch) {
      const user = requireUser(req, res); if (!user) return;
      const body = await readFile(join(dataDir(), "style-references", user.id, styleReferenceMatch[1], "reference.png"));
      res.writeHead(200, { "content-type":"image/png", "cache-control":"private, max-age=86400" });
      return res.end(body);
    }

    if (req.method === "POST" && (url.pathname === "/api/upload" || url.pathname === "/api/upload-batch")) {
      const user = requireUser(req, res); if (!user) return;
      requireOcrQuota(user);
      const form = await requestObject(req, url).formData();
      const batch = url.pathname === "/api/upload-batch";
      const file = form.get("file");
      const files = form.getAll("files").filter(value => value instanceof File);
      if (batch ? files.length < 2 : !(file instanceof File))
        return json(res, 400, { error: batch ? "Cần chọn ít nhất 2 ảnh liên quan" : "Chưa chọn file" });
      const workspace = loadWorkspace(user.id);
      const requestedVaultId = String(form.get("vaultId") || workspace.activeVaultId || "");
      const vault = workspace.vaults.find(item => item.id === requestedVaultId);
      if (!vault) return json(res, 400, { error:"Kho không tồn tại hoặc đã bị xoá" });
      const vaultId = vault.id;
      const subject = form.get("subject") === "math" ? "math" : "physics";
      const grade = Math.max(1, Math.min(12, Number(form.get("grade")) || 12));
      const tier = ["nhanh", "chuan", "ki"].includes(String(form.get("tier"))) ? String(form.get("tier")) : "nhanh";
      const srcLabel = String(form.get("srcLabel") || "").trim().slice(0, 160);
      const source = batch
        ? await storeUploadBatch(user.id, files, srcLabel)
        : await storeUpload(user.id, file);
      const expectedPages = batch ? files.length
        : file.type === "application/pdf" ? Math.max(1, Number(form.get("pages")) || 1) : 1;
      const options = { subject, grade, srcLabel, tier, vaultId, expectedPages };
      const jobId = createJob(user.id, source.id, configuredModel(), options);
      const sourceRow = runningSourceRow(source, options, jobId);
      putSourceRow(user.id, sourceRow);
      void runIngestJob(user.id, jobId, source, options);
      return json(res, 202, { source: sourceRow, jobId, status:"processing" });
    }

    const sourceRetryMatch = /^\/api\/sources\/([^/]+)\/retry$/.exec(url.pathname);
    if (req.method === "POST" && sourceRetryMatch) {
      const user = requireUser(req, res); if (!user) return;
      requireOcrQuota(user);
      const source = sourceFile(user.id, sourceRetryMatch[1]);
      if (!source) return json(res, 404, { error:"Không tìm thấy file gốc để OCR lại" });
      const input = await requestObject(req, url).json();
      const workspace = loadWorkspace(user.id);
      const vaultId = String(input.vaultId || workspace.activeVaultId || "");
      const vault = workspace.vaults.find(item => item.id === vaultId);
      if (!vault) return json(res, 400, { error:"Kho không tồn tại hoặc đã bị xoá" });
      const subject = input.subject === "math" ? "math" : "physics";
      const grade = Math.max(1, Math.min(12, Number(input.grade) || 12));
      const tier = ["nhanh", "chuan", "ki"].includes(String(input.tier)) ? String(input.tier) : "nhanh";
      const srcLabel = String(input.srcLabel || "").trim().slice(0, 160);
      const previous = workspace.sources.find(item => item.id === source.id);
      const options = {
        subject, grade, srcLabel, tier, vaultId,
        expectedPages:Number(previous?.pages) || 1,
        // "Thử lại" dùng lại kết quả những trang đã đọc xong; chỉ trang thiếu mới tốn lượt.
        reuseCache:input.fresh !== true,
        resumeJobId:input.fresh === true ? null : previous?.jobId || null,
      };
      // Chạy tiếp trong đúng thư mục job cũ thì cache trang mới còn tác dụng.
      const jobId = options.resumeJobId && ingestJob(user.id, options.resumeJobId)
        ? options.resumeJobId : createJob(user.id, source.id, configuredModel(), options);
      const sourceRow = runningSourceRow(source, options, jobId);
      putSourceRow(user.id, sourceRow);
      void runIngestJob(user.id, jobId, source, options);
      return json(res, 202, { source:sourceRow, jobId, status:"processing" });
    }

    const jobStatusMatch = /^\/api\/jobs\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && jobStatusMatch) {
      const user = requireUser(req, res); if (!user) return;
      const job = ingestJob(user.id, jobStatusMatch[1]);
      if (!job) return json(res, 404, { error:"Không tìm thấy lượt OCR" });
      const done = job.status === "review" || job.status === "failed";
      const payload = publicIngestJob(job, { withResult:done });
      const workspace = done ? loadWorkspace(user.id) : null;
      return json(res, 200, {
        job:payload,
        source:workspace?.sources.find(item => item.id === String(job.source_id)) ?? null,
        questions:payload.result?.questions ?? [],
        groups:payload.result?.groups ?? [],
      });
    }

    if (req.method === "GET" && url.pathname === "/api/ocr/health") {
      const user = requireUser(req, res); if (!user) return;
      const config = ocrConfig();
      if (url.searchParams.get("ping") !== "1") return json(res, 200, { config });
      return json(res, 200, { config, ping:await pingModel(config.model) });
    }

    const sourceMatch = /^\/api\/sources\/([^/]+)\/file$/.exec(url.pathname);
    if (req.method === "GET" && sourceMatch) {
      const user = requireUser(req, res); if (!user) return;
      const source = sourceFile(user.id, sourceMatch[1]);
      if (!source) return json(res, 404, { error: "Không tìm thấy tài liệu" });
      let storagePath = String(source.storage_path);
      let mimeType = String(source.mime_type);
      let filename = String(source.filename);
      if (mimeType === IMAGE_BATCH_MIME) {
        const manifest = JSON.parse(await readFile(storagePath, "utf8"));
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const entry = manifest.files?.[page - 1];
        if (!entry) return json(res, 404, { error:"Không tìm thấy ảnh trong lô" });
        storagePath = String(entry.storagePath);
        mimeType = String(entry.mimeType);
        filename = String(entry.filename);
      }
      const body = await readFile(storagePath);
      res.writeHead(200, { "content-type": mimeType, "cache-control": "private, no-store",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}` });
      return res.end(body);
    }

    const jobPageMatch = /^\/api\/jobs\/([^/]+)\/pages\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && jobPageMatch) {
      const user = requireUser(req, res); if (!user) return;
      const job = ingestJob(user.id, jobPageMatch[1]);
      if (!job) return json(res, 404, { error: "Không tìm thấy lượt OCR" });
      const page = Number(jobPageMatch[2]);
      const jobDir = join(dataDir(), "jobs", String(job.id));
      const files = (await readdir(jobDir))
        .filter(name => /^page-\d+\.png$/i.test(name))
        .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
      const filename = files[page - 1];
      if (!filename) return json(res, 404, { error: "Không tìm thấy ảnh trang" });
      const body = await readFile(join(jobDir, filename));
      res.writeHead(200, { "content-type": "image/png", "cache-control": "private, max-age=3600" });
      return res.end(body);
    }

    const jobCropMatch = /^\/api\/jobs\/([^/]+)\/crops$/.exec(url.pathname);
    if (req.method === "POST" && jobCropMatch) {
      const user = requireUser(req, res); if (!user) return;
      const job = ingestJob(user.id, jobCropMatch[1]);
      if (!job) return json(res, 404, { error:"Không tìm thấy lượt OCR" });
      const payload = await requestObject(req, url).json();
      const page = Math.max(1, Number(payload.page) || 1);
      const source = sourceFile(user.id, String(job.source_id));
      const figure = await createManualCrop(String(job.id), page, payload.bbox, source?.storage_path);
      return json(res, 201, { figure });
    }

    const jobAssetMatch = /^\/api\/jobs\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && jobAssetMatch) {
      const user = requireUser(req, res); if (!user) return;
      const job = ingestJob(user.id, jobAssetMatch[1]);
      if (!job) return json(res, 404, { error: "Không tìm thấy lượt OCR" });
      const filename = basename(jobAssetMatch[2]);
      if (filename !== jobAssetMatch[2] || !/^[a-z0-9._-]+$/i.test(filename))
        return json(res, 400, { error: "Tên asset không hợp lệ" });
      const body = await readFile(join(dataDir(), "jobs", String(job.id), "assets", filename));
      res.writeHead(200, { "content-type": "image/png", "cache-control": "private, max-age=86400" });
      return res.end(body);
    }
    return json(res, 404, { error: "API không tồn tại" });
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error("[api]", error);
    return json(res, status, { error: error instanceof Error ? error.message : String(error) });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  try {
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel.endsWith("/")) rel += "index.html";
    if(PUBLIC_BETA && !PUBLIC_FILES.has(rel)) return res.writeHead(404, { "content-type":"text/plain; charset=utf-8" }).end("404 — không tìm thấy file");
    const file = resolve(join(ROOT, rel));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) return res.writeHead(403).end("403 — ngoài phạm vi");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 — không tìm thấy file");
    else res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(`500 — ${error.message}`);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const config = ocrConfig();
  console.log(`EduVault đang chạy tại http://localhost:${PORT}/index.html`);
  console.log(config.ready
    ? `[ocr] model ${config.model} qua ${config.vendor} (${config.baseUrl}), key ${config.keyHint}`
    : `[ocr] CHƯA CHẠY ĐƯỢC — ${config.error || `thiếu ${config.envKey} trong phase0/.env`}`);
  /* Chụp DB lúc khởi động rồi mỗi 6 giờ, giữ 14 bản gần nhất trong
     `<data>/backups/`. Mất dữ liệu của giáo viên là mất kho câu họ ngồi duyệt
     tay từng câu — không có cách nào dựng lại. */
  scheduleBackups(database(), dataDir(), {
    everyMs: Math.max(15, Number(process.env.EDUVAULT_BACKUP_MINUTES) || 360) * 60_000,
    keep: Math.max(2, Number(process.env.EDUVAULT_BACKUP_KEEP) || 14),
  });
  void resumePendingJobs();
});
