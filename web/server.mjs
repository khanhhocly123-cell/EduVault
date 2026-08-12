/* Máy chủ tĩnh tối giản — không phụ thuộc gói nào, chạy được ngay bằng Node.
   Chỉ phục vụ file trong thư mục web/. Dùng cho bản dựng thử tại máy. */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("./", import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml",
  ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
  ".webp":"image/webp", ".ico":"image/x-icon",
  ".woff2":"font/woff2"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel.endsWith("/")) rel += "index.html";

    // Chặn đi ngược ra ngoài thư mục web/.
    const file = resolve(join(ROOT, rel));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      res.writeHead(403).end("403 — ngoài phạm vi");
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
         .end("404 — không tìm thấy file");
    } else {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
         .end("500 — " + err.message);
    }
  }
});

server.listen(PORT, () => {
  console.log(`EduVault đang chạy tại http://localhost:${PORT}`);
  console.log(`Thư mục phục vụ: ${ROOT}`);
});
