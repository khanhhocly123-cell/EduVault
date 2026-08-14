import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupDatabase, bucketFor, clientIp, createRateLimiter } from "../guard.mjs";

const fakeReq = (headers = {}, remoteAddress = "127.0.0.1") =>
  ({ headers, socket:{ remoteAddress } });

test("IP thật lấy từ cf-connecting-ip khi ở sau Cloudflare", () => {
  // Sau tunnel thì remoteAddress luôn là 127.0.0.1 — chặn theo nó là gộp cả
  // thiên hạ vào một xô, một người nghịch là mọi người cùng bị khoá.
  assert.equal(clientIp(fakeReq({ "cf-connecting-ip":"203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIp(fakeReq({ "x-forwarded-for":"203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIp(fakeReq({}, "198.51.100.4")), "198.51.100.4");
  // Chạy không qua proxy thì header do khách tự khai, không được tin.
  assert.equal(clientIp(fakeReq({ "cf-connecting-ip":"1.2.3.4" }, "198.51.100.4"),
    { trustProxy:false }), "198.51.100.4");
});

test("mỗi loại đường dẫn vào đúng xô của nó", () => {
  assert.equal(bucketFor("/api/auth/login"), "auth");
  assert.equal(bucketFor("/api/auth/register"), "auth");
  assert.equal(bucketFor("/api/upload"), "heavy");
  assert.equal(bucketFor("/api/export/latex-pdf"), "heavy");
  assert.equal(bucketFor("/api/sources/abc/retry"), "heavy");
  assert.equal(bucketFor("/api/workspace"), "api");
});

test("dò mật khẩu bị chặn, và chặn theo từng IP một", () => {
  const check = createRateLimiter({ rules:{
    auth:{ limit:3, windowMs:60_000, note:"đăng nhập" },
    heavy:{ limit:99, windowMs:60_000, note:"nặng" },
    api:{ limit:99, windowMs:60_000, note:"chung" },
  }});
  const attacker = fakeReq({ "cf-connecting-ip":"203.0.113.7" });
  const teacher  = fakeReq({ "cf-connecting-ip":"203.0.113.8" });

  for(let i = 0; i < 3; i++) assert.equal(check(attacker, "/api/auth/login"), null, `lần ${i+1}`);
  const blocked = check(attacker, "/api/auth/login");
  assert.equal(blocked.status, 429);
  assert.ok(blocked.retryAfter >= 1);
  assert.match(blocked.error, /Chờ \d+ giây/);

  // Người khác không được dính đòn thay.
  assert.equal(check(teacher, "/api/auth/login"), null);
  // Xô khác cũng không bị lây.
  assert.equal(check(attacker, "/api/workspace"), null);
});

test("hạn mức API chung phải đủ rộng cho nhịp tự lưu của client", () => {
  // Client lưu workspace mỗi 1,2 giây và hỏi tiến độ job mỗi 2 giây: một người
  // dùng ngồi yên đã ~80 request/phút. Đặt hạn mức thấp hơn là tự khoá người thật.
  const check = createRateLimiter();
  const teacher = fakeReq({ "cf-connecting-ip":"203.0.113.20" });
  for(let i = 0; i < 200; i++)
    assert.equal(check(teacher, "/api/workspace"), null, `request thứ ${i+1} bị chặn oan`);
});

test("backup dùng VACUUM INTO và chỉ giữ lại số bản đã hẹn", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "eduvault-backup-"));
  const db = new DatabaseSync(path.join(folder, "test.sqlite"));
  try {
    db.exec("pragma journal_mode=WAL; create table t(x text); insert into t values ('câu 1');");

    const first = await backupDatabase(db, folder, { keep:2 });
    assert.ok(first.bytes > 0);

    // Bản chụp phải đọc lại được và có đúng dữ liệu — đây mới là điều kiện đủ:
    // copy thô file WAL có thể ra một file mở được nhưng thiếu bản ghi vừa thêm.
    const restored = new DatabaseSync(first.file, { readOnly:true });
    assert.deepEqual(restored.prepare("select x from t").all().map(row => ({ x:row.x })),
      [{ x:"câu 1" }]);
    restored.close();

    // Tên file chụp tính theo phút, nên trong một lượt test mọi bản trùng tên và
    // ghi đè nhau. Gọi thẳng với tên khác nhau để kiểm đúng phần dọn bản cũ.
    for(let i = 0; i < 4; i++) await backupDatabase(db, folder, { keep:2, now:new Date(2026, 0, 1, 0, i) });
    const kept = (await readdir(path.join(folder, "backups"))).filter(n => n.endsWith(".sqlite"));
    assert.ok(kept.length <= 2, `giữ lại ${kept.length} bản, đáng lẽ tối đa 2`);
  } finally {
    // Windows khoá file `-shm` khi DB còn mở, nên phải đóng TRƯỚC khi xoá thư mục,
    // không thì lỗi EBUSY của bước dọn dẹp che mất lỗi thật của bài test.
    db.close();
    await rm(folder, { recursive:true, force:true });
  }
});
