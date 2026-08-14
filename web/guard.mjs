/* Hai lưới an toàn phải có TRƯỚC khi mở app ra internet: chặn dội request và
 * chụp lại cơ sở dữ liệu theo lịch.
 *
 * Cố ý KHÔNG dùng thư viện ngoài và KHÔNG dùng Redis: một tiến trình server, một
 * máy. Thêm phụ thuộc chỉ để đếm số request là đổi một việc nhỏ lấy một thứ nữa
 * phải cài, phải chạy, phải vá.
 */

import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/* ══════════════════════════════════════════════════ IP thật của khách ══ */

/**
 * Lấy IP của người gọi.
 *
 * Sau Cloudflare Tunnel thì `req.socket.remoteAddress` LUÔN là 127.0.0.1 — chính
 * tiến trình cloudflared trên máy này gọi vào. Chặn theo địa chỉ đó là gộp cả
 * thiên hạ vào một xô: một người nghịch là cả lớp bị khoá.
 *
 * `cf-connecting-ip` do chính Cloudflare đặt và người ngoài không ghi đè được —
 * NHƯNG chỉ đúng khi origin không thể bị gọi thẳng. Với Cloudflare Tunnel thì
 * đúng: server nghe ở máy nhà, không mở cổng ra ngoài, đường duy nhất vào là qua
 * tunnel. Chạy kiểu khác (mở thẳng cổng ra internet) thì phải tắt cờ này, vì lúc
 * đó ai cũng tự khai được IP giả để thoát rate limit.
 */
export function clientIp(req, { trustProxy = true } = {}){
  if(trustProxy){
    const cf = req.headers["cf-connecting-ip"];
    if(typeof cf === "string" && cf.trim()) return cf.trim();
    const forwarded = req.headers["x-forwarded-for"];
    if(typeof forwarded === "string" && forwarded.trim())
      return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/* ═══════════════════════════════════════════════════════ rate limit ══ */

/**
 * Cửa sổ trượt đếm theo IP.
 *
 * Mỗi xô giữ danh sách mốc thời gian trong `windowMs` gần nhất. Chuẩn hơn kiểu
 * "cửa sổ cố định" ở chỗ nó không cho dồn hai lần hạn mức quanh mốc chuyển cửa sổ.
 */
class SlidingWindow {
  constructor({ limit, windowMs }){
    this.limit = limit; this.windowMs = windowMs;
    this.hits = new Map();          // ip → [mốc thời gian]
  }
  /** @returns {{ok:boolean, retryAfter:number, remaining:number}} */
  take(key, now = Date.now()){
    const from = now - this.windowMs;
    const list = (this.hits.get(key) || []).filter(time => time > from);
    if(list.length >= this.limit){
      this.hits.set(key, list);
      return { ok:false, retryAfter:Math.ceil((list[0] + this.windowMs - now) / 1000), remaining:0 };
    }
    list.push(now);
    this.hits.set(key, list);
    return { ok:true, retryAfter:0, remaining:this.limit - list.length };
  }
  /** Dọn xô rỗng — không dọn thì Map phình theo số IP từng ghé qua. */
  sweep(now = Date.now()){
    const from = now - this.windowMs;
    for(const [key, list] of this.hits){
      const alive = list.filter(time => time > from);
      if(alive.length) this.hits.set(key, alive); else this.hits.delete(key);
    }
  }
}

/* Ba mức, vì ba thứ đắt khác nhau:
   - `auth`  chặn dò mật khẩu. Chậm và ít là đúng.
   - `heavy` là những việc tốn tiền hoặc tốn CPU thật: gọi model OCR, chạy pdfLaTeX.
   - `api`   là phần còn lại. Phải rộng tay: client tự lưu workspace mỗi 1,2 giây
             và hỏi tiến độ job mỗi 2 giây, nên một người dùng bình thường đã
             ngốn ~80 request/phút mà không làm gì cả. */
export const RATE_RULES = {
  auth:  { limit:12,  windowMs:15 * 60_000, note:"đăng nhập / đăng ký" },
  heavy: { limit:30,  windowMs:5 * 60_000,  note:"OCR và xuất PDF" },
  api:   { limit:600, windowMs:60_000,      note:"API chung" },
};

const HEAVY_PATHS = ["/api/upload", "/api/export/latex-pdf", "/api/sources/"];
const AUTH_PATHS  = ["/api/auth/login", "/api/auth/register"];

export function bucketFor(pathname){
  if(AUTH_PATHS.some(prefix => pathname === prefix)) return "auth";
  if(HEAVY_PATHS.some(prefix => pathname.startsWith(prefix))) return "heavy";
  return "api";
}

export function createRateLimiter({ trustProxy = true, rules = RATE_RULES } = {}){
  const windows = Object.fromEntries(
    Object.entries(rules).map(([name, config]) => [name, new SlidingWindow(config)]));
  const timer = setInterval(() => {
    for(const window of Object.values(windows)) window.sweep();
  }, 60_000);
  timer.unref?.();

  /**
   * @returns {null} nếu cho qua, hoặc {status, error, retryAfter} nếu chặn.
   */
  return function check(req, pathname){
    const name = bucketFor(pathname);
    const result = windows[name].take(`${name}|${clientIp(req, { trustProxy })}`);
    if(result.ok) return null;
    return {
      status: 429,
      retryAfter: Math.max(1, result.retryAfter),
      error: `Bạn thao tác quá nhanh (${rules[name].note}). Chờ ${Math.max(1, result.retryAfter)} giây rồi thử lại.`,
    };
  };
}

/* ══════════════════════════════════════════════════════════ backup ══ */

/**
 * Chụp lại cơ sở dữ liệu bằng `VACUUM INTO`.
 *
 * KHÔNG copy file `.sqlite` bằng tay: chế độ WAL để một phần dữ liệu mới nằm
 * trong `-wal` chưa nhập vào file chính, nên bản copy thô có thể thiếu đúng
 * những gì vừa ghi. `VACUUM INTO` bắt SQLite tự viết ra một file hoàn chỉnh và
 * nhất quán, chạy được ngay cả khi đang có người dùng.
 */
export async function backupDatabase(db, dataDir, { keep = 14, now = new Date() } = {}){
  const folder = path.join(dataDir, "backups");
  await mkdir(folder, { recursive:true });
  const stamp = now.toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const file = path.join(folder, `eduvault-${stamp}.sqlite`);
  // Chuỗi đường dẫn đi thẳng vào câu SQL nên phải nhân đôi dấu nháy đơn.
  db.exec(`vacuum into '${file.replace(/'/g, "''")}'`);

  const files = (await readdir(folder))
    .filter(name => /^eduvault-.*\.sqlite$/.test(name)).sort();
  for(const old of files.slice(0, Math.max(0, files.length - keep)))
    await rm(path.join(folder, old), { force:true });

  return { file, bytes:(await stat(file)).size, kept:Math.min(files.length, keep) };
}

/**
 * Chạy backup lúc khởi động rồi lặp lại theo chu kỳ.
 * Backup hỏng KHÔNG được làm chết server — nó là lưới an toàn, không phải
 * đường chạy chính.
 */
export function scheduleBackups(db, dataDir, { everyMs = 6 * 60 * 60_000, keep = 14, log = console.log } = {}){
  const run = async () => {
    try {
      const result = await backupDatabase(db, dataDir, { keep });
      log(`[backup] ${path.basename(result.file)} — ${(result.bytes / 1024).toFixed(0)} KB, giữ ${result.kept} bản`);
    } catch(error){
      log(`[backup] HỎNG — ${error.message}`);
    }
  };
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
