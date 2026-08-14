import { randomBytes, randomUUID, scrypt as scryptCb, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scrypt = promisify(scryptCb);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.EDUVAULT_DATA_DIR || path.join(ROOT, "data"));
await mkdir(path.join(DATA, "uploads"), { recursive: true });
await mkdir(path.join(DATA, "jobs"), { recursive: true });

const db = new DatabaseSync(path.join(DATA, "eduvault.sqlite"));
db.exec(`
  pragma journal_mode=WAL;
  pragma foreign_keys=ON;
  create table if not exists users(
    id text primary key, email text not null unique, display_name text not null,
    password_hash text not null, password_salt text not null, plan text not null default 'lite', created_at text not null
  );
  create table if not exists sessions(
    id text primary key, user_id text not null references users(id) on delete cascade,
    token_hash text not null unique, expires_at text not null, created_at text not null
  );
  create index if not exists sessions_token on sessions(token_hash);
  create table if not exists workspaces(
    user_id text primary key references users(id) on delete cascade,
    state_json text not null, updated_at text not null
  );
  create table if not exists source_files(
    id text primary key, user_id text not null references users(id) on delete cascade,
    filename text not null, storage_path text not null, mime_type text not null, size_bytes integer not null, created_at text not null
  );
  create table if not exists ingest_jobs(
    id text primary key, user_id text not null references users(id) on delete cascade,
    source_id text not null references source_files(id) on delete cascade,
    status text not null, model text not null, page_count integer, question_count integer not null default 0,
    error text, created_at text not null, finished_at text,
    options_json text, result_json text, started_at text, updated_at text
  );
`);

/* SQLite không có `add column if not exists`. Pilot từng tạo DB trước khi job OCR
 * chạy nền xuất hiện, vì vậy migrate từng cột và bỏ qua cột đã có. */
const ingestColumns = new Set(db.prepare("pragma table_info(ingest_jobs)").all().map(column => String(column.name)));
for (const [name, type] of [
  ["options_json", "text"], ["result_json", "text"],
  ["started_at", "text"], ["updated_at", "text"],
  ["progress_json", "text"], ["attempts", "integer"],
]) {
  if (!ingestColumns.has(name)) db.exec(`alter table ingest_jobs add column ${name} ${type}`);
}

const now = () => new Date().toISOString();

async function seedDefaultUsers() {
  try {
    const count = db.prepare("select count(*) as count from users").get()?.count || 0;
    if (count > 0) return;
    const password = "EduVault@Test-2026!";
    const createdAt = now();
    for (let i = 1; i <= 5; i++) {
      const email = `tester0${i}@eduvault.local`;
      const salt = randomBytes(16).toString("hex");
      const hash = (await scrypt(password, salt, 32)).toString("hex");
      db.prepare(`
        insert or ignore into users(id, email, display_name, password_hash, password_salt, plan, created_at)
        values(?, ?, ?, ?, ?, 'plus', ?)
      `).run(`user-tester-0${i}`, email, `EduVault Tester ${i}`, hash, salt, createdAt);
    }
    const adminSalt = randomBytes(16).toString("hex");
    const adminHash = (await scrypt(password, adminSalt, 32)).toString("hex");
    db.prepare(`
      insert or ignore into users(id, email, display_name, password_hash, password_salt, plan, created_at)
      values('user-admin', 'admin@eduvault.local', 'EduVault Admin', ?, ?, 'plus', ?)
    `).run(adminHash, adminSalt, createdAt);
  } catch (err) {
    console.error("[db] Seed default users failed:", err);
  }
}
await seedDefaultUsers();

export const IMAGE_BATCH_MIME = "application/vnd.eduvault.image-batch+json";
export const WORKSPACE_SCHEMA_VERSION = 2;
const DEFAULT_VAULTS = Object.freeze([
  { id:"vault-physics", name:"Kho Vật lí", subject:"physics" },
  { id:"vault-math", name:"Kho Toán", subject:"math" },
]);
const safeSubject = value => value === "math" ? "math" : "physics";
const defaultDraft = () => ({
  doc:[{ kind:"hdr" }], header:null, layout:null, presets:[], activePresetId:null,
});
const defaultVaults = () => DEFAULT_VAULTS.map(vault => ({ ...vault, createdAt:now() }));
const emptyState = () => ({
  schemaVersion:WORKSPACE_SCHEMA_VERSION,
  vaults:defaultVaults(), activeVaultId:"vault-physics", drafts:{
    "vault-physics":defaultDraft(), "vault-math":defaultDraft(),
  },
  bank:[], groups:[], pending:[], sources:[],
  // Alias v1 được giữ trong một chu kỳ chuyển tiếp để client cũ vẫn mở được.
  doc:[{ kind:"hdr" }], header:null, layout:null, subject:"physics",
});
const hashToken = token => createHash("sha256").update(token).digest("hex");
const normalizeEmail = email => String(email || "").trim().toLowerCase();
const publicUser = row => ({ id: String(row.id), email: String(row.email), name: String(row.display_name), plan: String(row.plan) });

async function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const key = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(key).toString("hex") };
}
async function passwordMatches(password, salt, expected) {
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
function cookieValue(request, name) {
  const found = String(request.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}
function issueSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 30 * 86400_000).toISOString();
  db.prepare("insert into sessions(id,user_id,token_hash,expires_at,created_at) values(?,?,?,?,?)")
    .run(randomUUID(), userId, hashToken(token), expires, now());
  return token;
}

export function currentUser(request) {
  const token = cookieValue(request, "eduvault_session");
  if (!token) return null;
  const row = db.prepare(`select u.* from sessions s join users u on u.id=s.user_id
    where s.token_hash=? and s.expires_at>?`).get(hashToken(token), now());
  return row ? publicUser(row) : null;
}

export async function register({ email, password, name, plan = "lite" }) {
  email = normalizeEmail(email);
  name = String(name || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error("Email không hợp lệ"), { status: 400 });
  if (String(password).length < 8) throw Object.assign(new Error("Mật khẩu cần ít nhất 8 ký tự"), { status: 400 });
  if (name.length < 2) throw Object.assign(new Error("Tên hiển thị cần ít nhất 2 ký tự"), { status: 400 });
  if (db.prepare("select 1 from users where email=?").get(email)) throw Object.assign(new Error("Email này đã có tài khoản"), { status: 409 });
  if(process.env.EDUVAULT_PUBLIC_BETA === "1") plan = "plus";
  const pass = await passwordHash(password);
  const id = randomUUID();
  db.prepare("insert into users(id,email,display_name,password_hash,password_salt,plan,created_at) values(?,?,?,?,?,?,?)")
    .run(id, email, name, pass.hash, pass.salt, ["lite", "plus", "pro"].includes(plan) ? plan : "lite", now());
  db.prepare("insert into workspaces(user_id,state_json,updated_at) values(?,?,?)").run(id, JSON.stringify(emptyState()), now());
  return { user: { id, email, name, plan }, token: issueSession(id) };
}

export async function login({ email, password }) {
  const row = db.prepare("select * from users where email=?").get(normalizeEmail(email));
  if (!row || !(await passwordMatches(String(password || ""), String(row.password_salt), String(row.password_hash))))
    throw Object.assign(new Error("Sai email hoặc mật khẩu"), { status: 401 });
  return { user: publicUser(row), token: issueSession(String(row.id)) };
}

export function logout(request) {
  const token = cookieValue(request, "eduvault_session");
  if (token) db.prepare("delete from sessions where token_hash=?").run(hashToken(token));
}

export function sessionCookie(token) {
  return `eduvault_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export const clearCookie = () => "eduvault_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";

function cleanVaults(input) {
  const seen = new Set();
  const vaults = [];
  for (const raw of Array.isArray(input) ? input.slice(0, 100) : []) {
    const id = String(raw?.id || "").trim();
    const name = String(raw?.name || "").trim().slice(0, 80);
    if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    const inferredSubject = raw.subject === "math" || raw.subject === "physics"
      ? raw.subject : (/toán/i.test(name) ? "math" : "physics");
    vaults.push({
      id, name, subject:inferredSubject,
      description:String(raw.description || "").trim().slice(0, 300),
      createdAt:String(raw.createdAt || now()),
    });
  }
  return vaults.length ? vaults : defaultVaults();
}

/** Nâng workspace Toán/Lý v1 thành Kho v2 mà không đổi id câu, nhóm, nguồn hay draft đang soạn. */
export function migrateWorkspace(input) {
  const raw = input && typeof input === "object" ? input : {};
  const legacySubject = safeSubject(raw.subject);
  const vaults = cleanVaults(raw.vaults);
  const vaultIds = new Set(vaults.map(vault => vault.id));
  const vaultForSubject = subject => {
    const normalized = safeSubject(subject);
    return vaults.find(vault => vault.id === `vault-${normalized}`)?.id
      || vaults.find(vault => vault.subject === normalized)?.id || vaults[0].id;
  };
  const requestedActive = String(raw.activeVaultId || "");
  const activeVaultId = vaultIds.has(requestedActive) ? requestedActive : vaultForSubject(legacySubject);

  const bank = (Array.isArray(raw.bank) ? raw.bank.slice(0, 10_000) : []).map(item => ({
    ...item, vaultId:vaultIds.has(item?.vaultId) ? item.vaultId : vaultForSubject(item?.subject ?? legacySubject),
  }));
  const pending = (Array.isArray(raw.pending) ? raw.pending.slice(0, 10_000) : []).map(item => ({
    ...item, vaultId:vaultIds.has(item?.vaultId) ? item.vaultId : vaultForSubject(item?.subject ?? legacySubject),
  }));
  const allQuestions = [...bank, ...pending];
  const groups = (Array.isArray(raw.groups) ? raw.groups.slice(0, 5_000) : []).map(group => {
    const peer = allQuestions.find(item => item.groupId === group?.id);
    return { ...group, vaultId:vaultIds.has(group?.vaultId) ? group.vaultId : (peer?.vaultId || activeVaultId) };
  });
  const sources = (Array.isArray(raw.sources) ? raw.sources.slice(0, 2_000) : []).map(source => {
    const peer = allQuestions.find(item => (source?.id && item.srcId === source.id) || item.src === source?.name);
    return { ...source, vaultId:vaultIds.has(source?.vaultId) ? source.vaultId : (peer?.vaultId || activeVaultId) };
  });

  const drafts = {};
  const rawDrafts = raw.drafts && typeof raw.drafts === "object" ? raw.drafts : {};
  for (const vault of vaults) {
    const draft = rawDrafts[vault.id];
    drafts[vault.id] = {
      doc:Array.isArray(draft?.doc) && draft.doc.length ? draft.doc : [{ kind:"hdr" }],
      header:draft?.header && typeof draft.header === "object" ? draft.header : null,
      layout:draft?.layout && typeof draft.layout === "object" ? draft.layout : null,
      presets:Array.isArray(draft?.presets) ? draft.presets.slice(0, 50) : [],
      activePresetId:typeof draft?.activePresetId === "string" ? draft.activePresetId : null,
    };
  }
  // State v1 chỉ có một draft: đặt nguyên vẹn vào Kho đang hoạt động lúc migrate.
  if (Number(raw.schemaVersion) < WORKSPACE_SCHEMA_VERSION || !raw.drafts?.[activeVaultId]) {
    drafts[activeVaultId] = {
      doc:Array.isArray(raw.doc) && raw.doc.length ? raw.doc : drafts[activeVaultId].doc,
      header:raw.header && typeof raw.header === "object" ? raw.header : drafts[activeVaultId].header,
      layout:raw.layout && typeof raw.layout === "object" ? raw.layout : drafts[activeVaultId].layout,
      presets:drafts[activeVaultId].presets,
      activePresetId:drafts[activeVaultId].activePresetId,
    };
  }
  const activeVault = vaults.find(vault => vault.id === activeVaultId) || vaults[0];
  const activeDraft = drafts[activeVault.id];
  return {
    schemaVersion:WORKSPACE_SCHEMA_VERSION, vaults, activeVaultId:activeVault.id, drafts,
    bank, groups, pending, sources,
    doc:activeDraft.doc, header:activeDraft.header, layout:activeDraft.layout, subject:activeVault.subject,
  };
}

export function workspaceVersion(userId) {
  return String(db.prepare("select updated_at from workspaces where user_id=?").get(userId)?.updated_at || "");
}

export function loadWorkspace(userId) {
  const row = db.prepare("select state_json,updated_at from workspaces where user_id=?").get(userId);
  try {
    const state = row ? migrateWorkspace(JSON.parse(String(row.state_json))) : emptyState();
    state.version = row ? String(row.updated_at) : "";
    return state;
  } catch { return { ...emptyState(), version:"" }; }
}

/**
 * Ghi workspace, có kiểm tra xung đột.
 *
 * Job OCR chạy nền ghi thẳng câu hỏi vào workspace ở phía máy chủ. Tab nào đang
 * mở mà KHÔNG theo dõi job đó vẫn tự lưu mỗi 1,2 giây bằng bản chụp cũ trong bộ
 * nhớ nó — và thế là 13 câu vừa đọc xong bị xoá sạch. Đã dựng lại được đúng
 * tình huống này, không phải giả định.
 *
 * `expectedVersion` là mốc client đã đọc. Lệch mốc thì từ chối bằng 409 kèm
 * trạng thái mới nhất để client trộn lại, thay vì ghi đè im lặng.
 */
export function saveWorkspace(userId, state, expectedVersion = null) {
  if (expectedVersion != null) {
    const current = workspaceVersion(userId);
    if (current && expectedVersion !== current)
      throw Object.assign(new Error("Workspace đã đổi ở nơi khác"), { status:409, code:"stale-workspace" });
  }
  const clean = migrateWorkspace(state);
  const json = JSON.stringify(clean);
  if (Buffer.byteLength(json) > 12 * 1024 * 1024) throw Object.assign(new Error("Workspace vượt giới hạn pilot 12 MB"), { status: 413 });
  const stamp = now();
  db.prepare(`insert into workspaces(user_id,state_json,updated_at) values(?,?,?)
    on conflict(user_id) do update set state_json=excluded.state_json,updated_at=excluded.updated_at`).run(userId, json, stamp);
  clean.version = stamp;
  return clean;
}

export async function storeUpload(userId, file) {
  const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(file.type)) throw Object.assign(new Error("Chỉ nhận PDF, PNG, JPG hoặc WebP"), { status: 400 });
  if (!file.size || file.size > 15 * 1024 * 1024) throw Object.assign(new Error("File phải nhỏ hơn 15 MB"), { status: 400 });
  const id = randomUUID();
  const ext = path.extname(file.name).toLowerCase() || (file.type === "application/pdf" ? ".pdf" : ".img");
  const folder = path.join(DATA, "uploads", userId);
  await mkdir(folder, { recursive: true });
  const storagePath = path.join(folder, `${id}${ext}`);
  await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));
  db.prepare("insert into source_files(id,user_id,filename,storage_path,mime_type,size_bytes,created_at) values(?,?,?,?,?,?,?)")
    .run(id, userId, path.basename(file.name), storagePath, file.type, file.size, now());
  return { id, filename: path.basename(file.name), storagePath, mimeType: file.type, sizeBytes: file.size };
}

/** Nhiều ảnh liên quan được lưu như MỘT tài liệu nhiều trang để OCR nối được
 * cụm dữ liệu, câu con và bảng đáp án nằm ở các ảnh khác nhau. */
export async function storeUploadBatch(userId, files, label = "") {
  files = Array.from(files || []);
  if (files.length < 2 || files.length > 50)
    throw Object.assign(new Error("Một lô cần từ 2 đến 50 ảnh"), { status:400 });
  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  let total = 0;
  for (const file of files) {
    if (!(file instanceof File) || !allowed.has(file.type))
      throw Object.assign(new Error("Lô ảnh chỉ nhận PNG, JPG hoặc WebP"), { status:400 });
    if (!file.size || file.size > 15 * 1024 * 1024)
      throw Object.assign(new Error(`Ảnh ${file.name || "không tên"} phải nhỏ hơn 15 MB`), { status:400 });
    total += file.size;
  }
  if (total > 120 * 1024 * 1024)
    throw Object.assign(new Error("Tổng lô ảnh phải nhỏ hơn 120 MB"), { status:400 });

  const id = randomUUID();
  const folder = path.join(DATA, "uploads", userId, id);
  await mkdir(folder, { recursive:true });
  const entries = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = path.extname(file.name).toLowerCase() || ({ "image/png":".png", "image/jpeg":".jpg", "image/webp":".webp" }[file.type]);
    const storagePath = path.join(folder, `${String(i + 1).padStart(3, "0")}${ext}`);
    await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));
    entries.push({ index:i + 1, filename:path.basename(file.name), storagePath, mimeType:file.type, sizeBytes:file.size });
  }
  const manifestPath = path.join(folder, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ version:1, files:entries }, null, 2), "utf8");
  const filename = (String(label || "").trim().slice(0, 160) || `${files.length} ảnh — ${path.basename(files[0].name)}`);
  db.prepare("insert into source_files(id,user_id,filename,storage_path,mime_type,size_bytes,created_at) values(?,?,?,?,?,?,?)")
    .run(id, userId, filename, manifestPath, IMAGE_BATCH_MIME, total, now());
  return { id, filename, storagePath:manifestPath, mimeType:IMAGE_BATCH_MIME, sizeBytes:total, entries };
}

export function sourceFile(userId, id) {
  return db.prepare("select * from source_files where id=? and user_id=?").get(id, userId) || null;
}

export function createJob(userId, sourceId, model, options = {}) {
  const id = randomUUID();
  const created = now();
  db.prepare(`insert into ingest_jobs(
      id,user_id,source_id,status,model,created_at,updated_at,options_json
    ) values(?,?,?,'queued',?,?,?,?)`)
    .run(id, userId, sourceId, model, created, created, JSON.stringify(options || {}));
  return id;
}
export function startJob(id, userId) {
  const stamp = now();
  db.prepare(`update ingest_jobs set status='processing',started_at=coalesce(started_at,?),
    updated_at=?,error=null,attempts=coalesce(attempts,0)+1 where id=? and user_id=?`)
    .run(stamp, stamp, id, userId);
}

/** Nhịp tiến độ để màn Tài liệu nói "đang đọc trang 3/8" thay vì một thanh chạy giả. */
export function updateJobProgress(id, userId, progress) {
  db.prepare("update ingest_jobs set progress_json=?,updated_at=? where id=? and user_id=?")
    .run(JSON.stringify(progress || {}), now(), id, userId);
}
export function finishJob(id, userId, result, error = null) {
  const stamp = now();
  db.prepare(`update ingest_jobs set status=?,page_count=?,question_count=?,error=?,
    result_json=?,finished_at=?,updated_at=? where id=? and user_id=?`)
    .run(error ? "failed" : "review", result?.pages ?? null,
      result?.questions?.length ?? 0, error, result ? JSON.stringify(result) : null,
      stamp, stamp, id, userId);
}

export function ingestJob(userId, id) {
  return db.prepare("select * from ingest_jobs where id=? and user_id=?").get(id, userId) || null;
}

export function resumableIngestJobs() {
  return db.prepare(`select * from ingest_jobs where status in ('queued','processing') order by created_at`).all();
}

export function parseJobOptions(job) {
  try { return JSON.parse(String(job?.options_json || "{}")); }
  catch { return {}; }
}

export function publicIngestJob(job, { withResult = true } = {}) {
  if (!job) return null;
  let result = null;
  try { result = withResult && job.result_json ? JSON.parse(String(job.result_json)) : null; }
  catch { result = null; }
  let progress = null;
  try { progress = job.progress_json ? JSON.parse(String(job.progress_json)) : null; }
  catch { progress = null; }
  return {
    id:String(job.id), sourceId:String(job.source_id), status:String(job.status),
    model:String(job.model), pages:job.page_count == null ? null : Number(job.page_count),
    questions:Number(job.question_count || 0), error:job.error ? String(job.error) : null,
    createdAt:String(job.created_at), startedAt:job.started_at ? String(job.started_at) : null,
    finishedAt:job.finished_at ? String(job.finished_at) : null,
    attempts:Number(job.attempts || 0), progress, result,
  };
}

export function ingestJobCount(userId) {
  return Number(db.prepare("select count(*) as n from ingest_jobs where user_id=?").get(userId)?.n || 0);
}

export function ingestJobTotalCount() {
  return Number(db.prepare("select count(*) as n from ingest_jobs").get()?.n || 0);
}

export function dataDir() { return DATA; }
export function closeDb() { db.close(); }
/** Cho `guard.mjs` chạy `VACUUM INTO` để chụp lại DB. Xem ghi chú ở đó. */
export function database() { return db; }
