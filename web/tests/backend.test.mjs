import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.EDUVAULT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "eduvault-app-test-"));
const backend = await import("../backend.mjs");
const { normalizedBbox, toAppQuestion } = await import("../ocr.mjs");

test("tài khoản, session và workspace được lưu riêng", async () => {
  const a = await backend.register({ email:"a@example.com", password:"password-a", name:"Gia sư A", plan:"lite" });
  const b = await backend.register({ email:"b@example.com", password:"password-b", name:"Gia sư B", plan:"plus" });
  backend.saveWorkspace(a.user.id, { bank:[{ id:"qa", stem:"Câu A" }], pending:[], sources:[], doc:[{kind:"hdr"}], subject:"physics" });
  assert.equal(backend.loadWorkspace(a.user.id).bank[0].id, "qa");
  assert.equal(backend.loadWorkspace(b.user.id).bank.length, 0);
  const logged = await backend.login({ email:"A@EXAMPLE.COM", password:"password-a" });
  assert.equal(logged.user.id, a.user.id);
  assert.ok(logged.token.length > 30);
});

test("map output OCR sang đúng shape của app hiện tại", () => {
  const q = toAppQuestion({ type:"MC", difficulty:"TH", topic_code:"p11.oscillation", grade:11,
    bbox:[0.1,0.2,0.9,0.5],
    stem_latex:"Tính $v$", solution_latex:"$v=2$", answer_source:"printed", notes:null, images:[],
    mc_choices:[{label:"A",text_latex:"$1$"},{label:"B",text_latex:"$2$"}], mc_correct:"B" },
    { id:"s1", filename:"de.jpg" }, 2, 0, { subject:"physics", grade:12 });
  assert.equal(q.src, "de.jpg");
  assert.equal(q.page, 2);
  assert.deepEqual(q.ch, ["$1$", "$2$"]);
  assert.equal(q.ans, 1);
  assert.deepEqual(q.bbox, [0.1,0.2,0.9,0.5]);
});

test("chuẩn hoá bbox và giữ asset crop để màn duyệt/export dùng lại", () => {
  assert.deepEqual(normalizedBbox([-0.2,0.1,1.2,0.8]), [0,0.1,1,0.8]);
  assert.equal(normalizedBbox([0.8,0.2,0.3,0.4]), null);
  const cropped = { slot:1, bbox:[0.5,0.2,0.9,0.6], caption:null, note:"Đồ thị",
    src:"/api/jobs/j1/assets/p1-q1-s1.png", width:45, place:"top" };
  const q = toAppQuestion({ type:"SHORT", difficulty:"VD", topic_code:"p12.thermal", grade:12,
    bbox:[0.1,0.1,0.95,0.7], stem_latex:"Đọc đồ thị [[IMG:1]]", solution_latex:null,
    answer_source:"none", notes:null, images:[cropped], _figures:[cropped], short_answer:null },
    { id:"s1", filename:"de.pdf" }, 1, 0, { subject:"physics", grade:12 });
  assert.equal(q.fig.src, cropped.src);
  assert.equal(q.figures.length, 1);
  assert.match(q.figNote, /Đồ thị/);
});

test.after(() => backend.closeDb());
