import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

process.env.EDUVAULT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "eduvault-app-test-"));
const backend = await import("../backend.mjs");
const { bboxToPixels, cleanImageMarkers, createManualCrop, normalizedBbox,
  stylePaletteFromPixels, toAppQuestion } = await import("../ocr.mjs");
const { splitModel } = await import("../ocr-model.mjs");
const { buildDocx, p:docxP, t:docxT, table:docxTable } = await import("../docx.js");

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

test("migrate workspace Toán/Lý cũ thành hai Kho mà không mất dữ liệu hay draft", async () => {
  const migrated = backend.migrateWorkspace({
    subject:"math",
    bank:[
      { id:"q-ly", subject:"physics", stem:"Câu Lý" },
      { id:"q-toan", subject:"math", stem:"Câu Toán", groupId:"g-toan" },
    ],
    pending:[{ id:"q-pending", subject:"math", srcId:"src-toan" }],
    groups:[{ id:"g-toan", stem:"Dữ liệu chung" }],
    sources:[{ id:"src-toan", name:"toan.pdf" }],
    doc:[{ kind:"hdr" }, { kind:"sec", items:["q-toan"] }],
    header:{ title:"Đề Toán đang soạn" }, layout:{ questionStyle:"exam-blue" },
  });
  assert.equal(migrated.schemaVersion, backend.WORKSPACE_SCHEMA_VERSION);
  assert.deepEqual(migrated.vaults.map(vault => vault.id), ["vault-physics", "vault-math"]);
  assert.equal(migrated.activeVaultId, "vault-math");
  assert.equal(migrated.bank.find(q => q.id === "q-ly").vaultId, "vault-physics");
  assert.equal(migrated.bank.find(q => q.id === "q-toan").vaultId, "vault-math");
  assert.equal(migrated.groups[0].vaultId, "vault-math");
  assert.equal(migrated.sources[0].vaultId, "vault-math");
  assert.equal(migrated.drafts["vault-math"].doc[1].items[0], "q-toan");
  assert.equal(migrated.drafts["vault-math"].header.title, "Đề Toán đang soạn");
});

test("workspace Kho v2 lưu tách Kho và migration chạy lặp không làm đổi liên kết", async () => {
  const user = await backend.register({ email:"vaults@example.com", password:"password-vaults", name:"Vaults", plan:"plus" });
  const v2 = backend.migrateWorkspace({
    vaults:[
      { id:"vault-tsa", name:"Kho TSA", subject:"math" },
      { id:"vault-hsa", name:"Kho HSA", subject:"physics" },
    ],
    activeVaultId:"vault-tsa",
    bank:[{ id:"tsa-1", vaultId:"vault-tsa" }, { id:"hsa-1", vaultId:"vault-hsa" }],
    pending:[], groups:[], sources:[],
    drafts:{
      "vault-tsa":{ doc:[{kind:"hdr"},{kind:"sec",items:["tsa-1"]}], header:{title:"TSA"}, layout:null,
        presets:[{id:"preset-blue",name:"Mẫu xanh",layout:{questionStyle:"custom"}}], activePresetId:"preset-blue" },
      "vault-hsa":{ doc:[{kind:"hdr"}], header:{title:"HSA"}, layout:null },
    },
  });
  backend.saveWorkspace(user.user.id, v2);
  const loaded = backend.loadWorkspace(user.user.id);
  assert.equal(loaded.vaults.length, 2);
  assert.equal(loaded.bank.filter(q => q.vaultId === "vault-tsa").length, 1);
  assert.equal(loaded.bank.filter(q => q.vaultId === "vault-hsa").length, 1);
  assert.equal(loaded.drafts["vault-tsa"].header.title, "TSA");
  assert.equal(loaded.drafts["vault-hsa"].header.title, "HSA");
  assert.equal(loaded.drafts["vault-tsa"].presets[0].name, "Mẫu xanh");
  assert.equal(loaded.drafts["vault-tsa"].activePresetId, "preset-blue");
});

test("lấy palette format mẫu bỏ nền trắng và chữ đen", () => {
  const white = Buffer.alloc(600 * 3, 255);
  const blue = Buffer.alloc(120 * 3);
  for(let i=0;i<blue.length;i+=3){ blue[i]=30; blue[i+1]=100; blue[i+2]=200; }
  const palette = stylePaletteFromPixels(Buffer.concat([white, blue]), 3);
  assert.match(palette.accentColor, /^#[0-9a-f]{6}$/i);
  const [r,,b] = [1,3,5].map(index => parseInt(palette.accentColor.slice(index,index+2),16));
  assert.ok(b > r);
  assert.notEqual(palette.accentSoft, palette.accentColor);
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
  assert.equal(q.bbox, undefined, "bbox cau da bo cung voi lop highlight");
});

test("de dai hoc 5 phuong an A-E van vao du, dap an khop theo nhan in tren de", () => {
  const q = toAppQuestion({ type:"MC", difficulty:"VD", topic_code:"m11.limit", grade:12,
    printed_number:"1", stem_latex:"Gioi han bang", solution_latex:null, answer_source:"printed",
    notes:null, images:[],
    mc_choices:["A","B","C","D","E"].map((label,i) => ({ label, text_latex:`$${i}$` })),
    mc_correct:"E" },
    { id:"s-bk", filename:"giai-tich-2.pdf" }, 1, 0, { subject:"math", grade:12 });
  assert.equal(q.ch.length, 5);
  assert.deepEqual(q.chLabels, ["A","B","C","D","E"]);
  assert.equal(q.ans, 4);
});

test("không tự bịa đáp án khi tài liệu không in", () => {
  const mc = toAppQuestion({ type:"MC", difficulty:"TH", topic_code:"p12.thermal", grade:12,
    printed_number:"9", stem_latex:"Câu không in đáp án",
    solution_latex:null, answer_source:"none", notes:null, images:[],
    mc_choices:[{label:"A",text_latex:"1"},{label:"B",text_latex:"2"}], mc_correct:null },
    { id:"s-no-answer", filename:"de.jpg" }, 1, 0, { subject:"physics", grade:12 });
  assert.equal(mc.ans, null);
  assert.equal(mc.answerSource, "none");
  assert.equal(mc.printedNumber, "9");
  const tf = toAppQuestion({ type:"TF", difficulty:"TH", topic_code:"m12.derivative", grade:12,
    printed_number:"1", stem_latex:"Xét đúng sai", solution_latex:null,
    answer_source:"none", notes:null, images:[], tf_statements:[{ idx:"a", text_latex:"Mệnh đề", is_true:null }] },
    { id:"s-no-answer", filename:"de.jpg" }, 1, 1, { subject:"math", grade:12 });
  assert.equal(tf.tf[0][1], null);
});

test("lưu nhiều ảnh liên quan thành một manifest nhiều trang", async () => {
  const user = await backend.register({ email:"batch@example.com", password:"password-batch", name:"Batch", plan:"pro" });
  const a = new File([Buffer.from("anh-a")], "trang-1.png", { type:"image/png" });
  const b = new File([Buffer.from("anh-b")], "trang-2.jpg", { type:"image/jpeg" });
  const source = await backend.storeUploadBatch(user.user.id, [a,b], "Cụm TSA 60–63");
  assert.equal(source.mimeType, backend.IMAGE_BATCH_MIME);
  assert.equal(source.entries.length, 2);
  const manifest = JSON.parse(await readFile(source.storagePath, "utf8"));
  assert.deepEqual(manifest.files.map(file => file.index), [1,2]);
});

test("style Word vẫn là bảng và chữ native chỉnh sửa được", () => {
  const styled = docxTable([[{
    content:docxP(docxT("Đáp án B", { bold:true, color:"287E70" })),
    fill:"EEF9F5", border:"78B7AB",
  }]], [100], { borderColor:"78B7AB" });
  assert.match(styled, /<w:tbl>/);
  assert.match(styled, /w:fill="EEF9F5"/);
  assert.match(styled, /w:color w:val="287E70"/);
  const built = buildDocx({ body:[styled], title:"Style test" });
  assert.ok(built.bytes.length > 1000);
  assert.match(built.xml, /Đáp án B/);
});

test("chuẩn hoá bbox và giữ asset crop để màn duyệt/export dùng lại", () => {
  assert.deepEqual(normalizedBbox([-0.2,0.1,1.2,0.8]), [0,0.1,1,0.8]);
  assert.deepEqual(normalizedBbox([10,20,90,50]), [0.1,0.2,0.9,0.5]);
  assert.deepEqual(normalizedBbox([100,200,900,500]), [0.1,0.2,0.9,0.5]);
  assert.equal(normalizedBbox([0.8,0.2,0.3,0.4]), null);
  assert.deepEqual(bboxToPixels([0.1,0.2,0.9,0.5], 1000, 800, 0),
    { left:100, top:160, width:800, height:240, bbox:[0.1,0.2,0.9,0.5] });
  const cropped = { slot:1, bbox:[0.5,0.2,0.9,0.6], caption:null, note:"Đồ thị",
    src:"/api/jobs/j1/assets/p1-q1-s1.png", width:45, place:"top" };
  const q = toAppQuestion({ type:"SHORT", difficulty:"VD", topic_code:"p12.thermal", grade:12,
    stem_latex:"Đọc đồ thị [[IMG:1]]", solution_latex:null,
    answer_source:"none", notes:null, images:[cropped], _figures:[cropped], short_answer:null },
    { id:"s1", filename:"de.pdf" }, 1, 0, { subject:"physics", grade:12 });
  assert.equal(q.fig.src, cropped.src);
  assert.equal(q.figures.length, 1);
  assert.match(q.figNote, /Đồ thị/);
  assert.doesNotMatch(q.stem, /\[\[IMG:/);
  assert.equal(cleanImageMarkers("Đọc [[IMG:1]] rồi [[IMG:2]] trả lời"), "Đọc rồi trả lời");
});

test("giữ một cụm dữ liệu chung cho nhiều câu thay vì nhân bản vào từng câu", () => {
  const group = { ref:"g1", label:"Dùng dữ liệu sau", stem_latex:"Bảng số liệu $v-t$",
    images:[], _figures:[] };
  const base = { type:"MC", difficulty:"TH", topic_code:"p11.wave", grade:11,
    group_ref:"g1", stem_latex:"Vận tốc bằng bao nhiêu?",
    solution_latex:null, answer_source:"none", notes:null, images:[],
    mc_choices:[{label:"A",text_latex:"1"},{label:"B",text_latex:"2"}], mc_correct:null };
  const a = toAppQuestion(base, { id:"s1", filename:"tsa.pdf" }, 2, 0,
    { subject:"physics", grade:12, group, groupOrder:1, groupSize:2 });
  const b = toAppQuestion({ ...base, stem_latex:"Gia tốc bằng bao nhiêu?" },
    { id:"s1", filename:"tsa.pdf" }, 2, 1,
    { subject:"physics", grade:12, group, groupOrder:2, groupSize:2 });
  assert.equal(a.groupId, b.groupId);
  assert.equal(a.groupStem, "Bảng số liệu $v-t$");
  assert.equal(b.groupOrder, 2);
});

test("crop thủ công dùng đúng bbox trên ảnh trang canonical", async () => {
  const jobId = "manual-crop-test";
  const dir = path.join(backend.dataDir(), "jobs", jobId);
  await mkdir(dir, { recursive:true });
  await sharp({ create:{ width:200, height:100, channels:3, background:"white" } })
    .png().toFile(path.join(dir, "page-1.png"));
  const fig = await createManualCrop(jobId, 1, [0.25,0.2,0.75,0.8]);
  assert.match(fig.src, /manual-crop-test\/assets\/p1-manual-/);
  const file = path.join(backend.dataDir(), fig.src.replace(/^\/api\/jobs\//, "jobs/").replace(/\/assets\//, "/assets/"));
  const meta = await sharp(file).metadata();
  assert.deepEqual([meta.width, meta.height], [100,60]);
});

test("tab cu khong duoc ghi de ket qua OCR ma may chu vua ghi", async () => {
  const user = await backend.register({ email:"race@example.com", password:"password-race", name:"Race", plan:"plus" });
  const id = user.user.id;
  // Tab mo len va doc trang thai.
  const openedTab = backend.loadWorkspace(id);
  assert.ok(openedTab.version);

  // Job OCR chay nen ghi 13 cau thang vao workspace o phia may chu.
  backend.saveWorkspace(id, { ...openedTab, pending:Array.from({ length:13 }, (_, i) => ({ id:`q${i}` })) });
  assert.equal(backend.loadWorkspace(id).pending.length, 13);

  // Tab cu tu luu bang ban chup cu cua no: phai bi tu choi, khong duoc xoa 13 cau.
  assert.throws(
    () => backend.saveWorkspace(id, { ...openedTab, pending:[] }, openedTab.version),
    (error) => error.status === 409 && error.code === "stale-workspace",
  );
  assert.equal(backend.loadWorkspace(id).pending.length, 13, "13 cau phai con nguyen");

  // Doc lai moc moi thi luu duoc binh thuong.
  const fresh = backend.loadWorkspace(id);
  const saved = backend.saveWorkspace(id, { ...fresh, bank:[{ id:"da-duyet" }] }, fresh.version);
  assert.equal(saved.bank.length, 1);
  assert.notEqual(saved.version, fresh.version);
});

test.after(() => backend.closeDb());
