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
    error text, created_at text not null, finished_at text
  );
`);

const now = () => new Date().toISOString();
const emptyState = () => ({ bank: [], pending: [], sources: [], doc: [{ kind: "hdr" }], header: null, layout: null, subject: "physics" });
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

export function loadWorkspace(userId) {
  const row = db.prepare("select state_json from workspaces where user_id=?").get(userId);
  try { return row ? { ...emptyState(), ...JSON.parse(String(row.state_json)) } : emptyState(); }
  catch { return emptyState(); }
}

export function saveWorkspace(userId, state) {
  const clean = {
    bank: Array.isArray(state.bank) ? state.bank.slice(0, 10_000) : [],
    pending: Array.isArray(state.pending) ? state.pending.slice(0, 10_000) : [],
    sources: Array.isArray(state.sources) ? state.sources.slice(0, 2_000) : [],
    doc: Array.isArray(state.doc) ? state.doc : [{ kind: "hdr" }],
    header: state.header && typeof state.header === "object" ? state.header : null,
    layout: state.layout && typeof state.layout === "object" ? state.layout : null,
    subject: state.subject === "math" ? "math" : "physics",
  };
  const json = JSON.stringify(clean);
  if (Buffer.byteLength(json) > 12 * 1024 * 1024) throw Object.assign(new Error("Workspace vượt giới hạn pilot 12 MB"), { status: 413 });
  db.prepare(`insert into workspaces(user_id,state_json,updated_at) values(?,?,?)
    on conflict(user_id) do update set state_json=excluded.state_json,updated_at=excluded.updated_at`).run(userId, json, now());
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

export function sourceFile(userId, id) {
  return db.prepare("select * from source_files where id=? and user_id=?").get(id, userId) || null;
}

export function createJob(userId, sourceId, model) {
  const id = randomUUID();
  db.prepare("insert into ingest_jobs(id,user_id,source_id,status,model,created_at) values(?,?,?,'processing',?,?)")
    .run(id, userId, sourceId, model, now());
  return id;
}
export function finishJob(id, userId, result, error = null) {
  db.prepare("update ingest_jobs set status=?,page_count=?,question_count=?,error=?,finished_at=? where id=? and user_id=?")
    .run(error ? "failed" : "review", result?.pages ?? null, result?.questions?.length ?? 0, error, now(), id, userId);
}

export function ingestJob(userId, id) {
  return db.prepare("select * from ingest_jobs where id=? and user_id=?").get(id, userId) || null;
}

export function dataDir() { return DATA; }
export function closeDb() { db.close(); }
