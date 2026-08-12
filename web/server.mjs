import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearCookie, createJob, currentUser, dataDir, finishJob, ingestJob, loadWorkspace, login, logout, register,
  saveWorkspace, sessionCookie, sourceFile, storeUpload,
} from "./backend.mjs";
import { configuredModel, extractSource } from "./ocr.mjs";

const ROOT = resolve(fileURLToPath(new URL("./", import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2",
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

async function api(req, res, url) {
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
    if ((req.method === "PUT" || req.method === "POST") && url.pathname === "/api/workspace") {
      const user = requireUser(req, res); if (!user) return;
      const saved = saveWorkspace(user.id, await requestObject(req, url).json());
      return json(res, 200, { ok: true, updatedAt: new Date().toISOString(), counts: {
        bank: saved.bank.length, pending: saved.pending.length, sources: saved.sources.length,
      }});
    }

    if (req.method === "POST" && url.pathname === "/api/upload") {
      const user = requireUser(req, res); if (!user) return;
      const form = await requestObject(req, url).formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json(res, 400, { error: "Chưa chọn file" });
      const subject = form.get("subject") === "math" ? "math" : "physics";
      const grade = Math.max(1, Math.min(12, Number(form.get("grade")) || 12));
      const tier = ["nhanh", "chuan", "ki"].includes(String(form.get("tier"))) ? String(form.get("tier")) : "nhanh";
      const srcLabel = String(form.get("srcLabel") || "").trim().slice(0, 160);
      const source = await storeUpload(user.id, file);
      const model = configuredModel();
      const jobId = createJob(user.id, source.id, model);
      try {
        const result = await extractSource(source, jobId, { subject, grade, srcLabel });
        finishJob(jobId, user.id, result);
        const sourceRow = {
          id: source.id, name: source.filename, kind: source.mimeType === "application/pdf" ? "PDF" : "Ảnh",
          tier, pages: result.pages, found: result.questions.length, scans: result.pages,
          state: "review", label: `Chờ duyệt ${result.questions.length} câu`, prog: 100,
          fileUrl: `/api/sources/${source.id}/file`,
          pageUrl: source.mimeType === "application/pdf"
            ? `/api/jobs/${jobId}/pages/{page}`
            : `/api/sources/${source.id}/file`,
        };
        // Ghi ngay ở máy chủ: kể cả tab đóng sau khi OCR xong, kết quả vẫn còn.
        const state = loadWorkspace(user.id);
        state.sources.push(sourceRow);
        state.pending.push(...result.questions);
        saveWorkspace(user.id, state);
        return json(res, 201, { source: sourceRow, questions: result.questions, jobId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finishJob(jobId, user.id, null, message.slice(0, 4000));
        const sourceRow = {
          id: source.id, name: source.filename, kind: source.mimeType === "application/pdf" ? "PDF" : "Ảnh",
          tier, pages: 0, found: 0, scans: 0, state: "failed", label: "OCR lỗi", prog: 0,
          error: message.slice(0, 1000), fileUrl: `/api/sources/${source.id}/file`,
        };
        const state = loadWorkspace(user.id); state.sources.push(sourceRow); saveWorkspace(user.id, state);
        return json(res, 500, { error: message, source: sourceRow });
      }
    }

    const sourceMatch = /^\/api\/sources\/([^/]+)\/file$/.exec(url.pathname);
    if (req.method === "GET" && sourceMatch) {
      const user = requireUser(req, res); if (!user) return;
      const source = sourceFile(user.id, sourceMatch[1]);
      if (!source) return json(res, 404, { error: "Không tìm thấy tài liệu" });
      const body = await readFile(String(source.storage_path));
      res.writeHead(200, { "content-type": String(source.mime_type), "cache-control": "private, no-store",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(source.filename))}` });
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

server.listen(PORT, "0.0.0.0", () => console.log(`EduVault đang chạy tại http://localhost:${PORT}/index.html`));
