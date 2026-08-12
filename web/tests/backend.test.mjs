import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.EDUVAULT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "eduvault-app-test-"));
const backend = await import("../backend.mjs");
const { toAppQuestion } = await import("../ocr.mjs");

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
    stem_latex:"Tính $v$", solution_latex:"$v=2$", answer_source:"printed", notes:null, images:[],
    mc_choices:[{label:"A",text_latex:"$1$"},{label:"B",text_latex:"$2$"}], mc_correct:"B" },
    { id:"s1", filename:"de.jpg" }, 2, 0, { subject:"physics", grade:12 });
  assert.equal(q.src, "de.jpg");
  assert.equal(q.page, 2);
  assert.deepEqual(q.ch, ["$1$", "$2$"]);
  assert.equal(q.ans, 1);
});

test.after(() => backend.closeDb());
