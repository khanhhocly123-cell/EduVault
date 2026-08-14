import { SUBJECTS, TOPICS, topicsOf, TYPES, CLS, DIFFS, DNAME, FIGS, BANK, GROUPS, SOURCES,
         BLUEPRINTS, HEADER_TEMPLATES, DEFAULT_HEADER, DEFAULT_LAYOUT, BUILTIN_LAYOUT_PRESETS, PENDING,
         PLANS, planOf, OCR_TIERS, UNIT } from "./data.js";
import { resolveFormat, mcColumnsFor, paletteFor, TYPE_NAME } from "./format.js";

/* ══════════════════════════════════════════════════════ phiên đăng nhập ══ */
/* Bản thật dùng Supabase Auth. Ở đây chỉ giữ chỗ để luồng màn hình chạy đủ. */

let session, BOOT;
/* Mốc phiên bản của workspace trên máy chủ. Gửi kèm mỗi lần lưu để máy chủ từ
   chối nếu bản trong tab này đã cũ — xem ghi chú ở `adoptServerWorkspace`. */
let workspaceVersion = "";
try {
  const auth = await fetch("/api/session", { cache:"no-store" });
  if(!auth.ok) throw new Error("unauthorized");
  const { user } = await auth.json();
  session = { email:user.email, name:user.name, plan:user.plan };
  const state = await fetch("/api/workspace", { cache:"no-store" });
  if(!state.ok) throw new Error("Không tải được workspace");
  BOOT = await state.json();
  workspaceVersion = BOOT.version ?? "";
  BANK.splice(0, BANK.length, ...(BOOT.bank ?? []));
  GROUPS.splice(0, GROUPS.length, ...(BOOT.groups ?? []));
  PENDING.splice(0, PENDING.length, ...(BOOT.pending ?? []));
  // Dữ liệu cũ từng cho AI tự giải. Không mang các đáp án không có chứng cứ
  // đó sang chính sách mới; giáo viên vẫn có thể nhập tay khi duyệt.
  for(const q of PENDING) if(q.answerSource === "solved" || q.answerSource === "none"){
    q.answerSource = "none"; q.sol = "";
    if(q.type === "MC") q.ans = null;
    if(q.type === "TF") q.tf = (q.tf || []).map(([text,,why]) => [text,null,why]);
    if(q.type === "SHORT") q.sa = null;
  }
  SOURCES.splice(0, SOURCES.length, ...(BOOT.sources ?? []));
  for(const q of [...BANK, ...PENDING]) if(q.groupId && !GROUPS.some(group => group.vaultId === q.vaultId && group.id === q.groupId)){
    const peers = [...BANK, ...PENDING].filter(item => item.vaultId === q.vaultId && item.groupId === q.groupId);
     GROUPS.push({
       id:q.groupId, sourceId:q.srcId ?? null, source:q.src, page:q.groupPage ?? q.page ?? null,
       vaultId:q.vaultId,
       label:q.groupLabel ?? null, stem:q.groupStem ?? "", bbox:q.groupBbox ?? null,
      figure:q.groupFig ?? null, figures:q.groupFigures ?? [], questionNumbers:peers.map(item => item.printedNumber).filter(Boolean),
      questionIds:peers.map(item => item.id),
    });
  }
} catch {
  location.replace("./login.html");
  throw new Error("Chưa đăng nhập");
}

/* ══════════════════════════════════════════════════ hiển thị LaTeX ══ */
/* Bộ dựng công thức tại chỗ. Không phải KaTeX đầy đủ, nhưng nó TÁCH TOKEN rồi
   dựng cây, nên xử lý được lồng nhau và lệnh có tham số.
   Bản trước chỉ chạy một dãy .replace() với đúng 18 ký hiệu, nên gặp \int,
   \vec, \perp, \mid, \infty là in nguyên mã LaTeX ra cho giáo viên đọc —
   môn Toán dính 8/21 câu ngay ở màn hình đầu tiên. */

const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;");

/* Bảng ký hiệu và bộ tách token dùng chung với omml.js — xem latex-core.js.
   Trước đây mỗi bên một bảng, sửa một chỗ là hai bên lệch nhau ngay. */
import { tokenize, SYM, SPACE, FUNC, UPRIGHT, ACCENT, BIGOP } from "./latex-core.js";
/* Bộ dựng .docx. Đổi tên khi nhập vào cho khỏi đụng: app.js đã có `tex` (bản
   HTML) và dùng `p`, `t` làm biến cục bộ ở nhiều chỗ. */
import { buildDocx, killTest, table as wTable, hr as wHr, imageRun,
         p as para, t as txt, tex as wtex } from "./docx.js";

const REL = new Set(["=","<",">","≤","≥","≠","≈","≡","∼","≃","≅","∝","≪","≫",
  "→","⇒","←","⇐","↔","⇔","↦","⟶","∈","∉","∋","⊂","⊆","⊃","⊇","⊥","∥","∣","∤"]);
const BIN = new Set(["+","−","×","÷","·","±","∓","∗","⋆","∙","∪","∩","∖","∧","∨"]);
const OPEN = new Set(["(","[","{","⟨","|","‖"]);

/* Lệnh không biết thì báo ra console một lần cho người sửa code thấy, còn trên
   màn hình vẫn hiện chữ đứng chứ tuyệt đối không hiện dấu gạch chéo. */
const unknownCmds = new Set();

function kindOf(ch){
  if(REL.has(ch)) return "rel";
  if(BIN.has(ch)) return "bin";
  if(OPEN.has(ch)) return "open";
  return "atom";
}

/* prev cho biết trước dấu +/- có toán hạng nào không — có thì là phép hai ngôi
   (cần lề hai bên), không thì là dấu âm dính liền số. */
function emitChar(ch, st, prev){
  if(ch === "-") ch = "−";
  if(ch === "'") return { html:"<span class=\"pr\">′</span>", kind:"atom" };
  const kind = kindOf(ch);
  if(kind === "rel") return { html:`<span class="rel">${esc(ch)}</span>`, kind };
  if(kind === "bin"){
    const unary = prev !== "atom";
    return { html:`<span class="${unary ? "una" : "bin"}">${esc(ch)}</span>`,
             kind: unary ? "open" : "bin" };
  }
  if(!st.roman && /[a-zA-Z]/.test(ch)) return { html:`<i>${ch}</i>`, kind:"atom" };
  return { html: esc(ch), kind };
}

/** Đọc đúng một tham số: nhóm {…} hoặc một token đơn. */
function readArg(toks, st){
  const t = toks[st.i];
  if(!t) return "";
  if(t.k === "{"){
    st.i++;
    const h = buildList(toks, st);
    if(toks[st.i]?.k === "}") st.i++;
    return h;
  }
  return step(toks, st, "open").html;
}

function cmd(name, toks, st, prev){
  if(name in SPACE) return { html: SPACE[name], kind:"open" };
  if(name === "\\") return { html:"<br>", kind:"open" };

  if(name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac"){
    const a = readArg(toks, st), b = readArg(toks, st);
    return { html:`<span class="fr"><span>${a}</span><span>${b}</span></span>`, kind:"atom" };
  }

  if(name === "sqrt"){
    let idx = "";
    if(toks[st.i]?.k === "ch" && toks[st.i].v === "["){
      st.i++;
      let d = "";
      while(toks[st.i] && !(toks[st.i].k === "ch" && toks[st.i].v === "]")) d += toks[st.i++].v ?? "";
      if(toks[st.i]) st.i++;
      idx = `<span class="idx">${esc(d)}</span>`;
    }
    return { html:`<span class="rd">${idx}√<span>${readArg(toks, st)}</span></span>`, kind:"atom" };
  }

  if(UPRIGHT.has(name)){
    const was = st.roman;
    st.roman = true;
    let inner = readArg(toks, st);
    st.roman = was;
    if(name === "mathbb"){
      const bb={C:"ℂ",H:"ℍ",N:"ℕ",P:"ℙ",Q:"ℚ",R:"ℝ",Z:"ℤ"};
      inner=inner.replace(/[CHNPQRZ]/g,ch=>bb[ch]||ch);
    }
    return { html:`<span class="up${name === "mathbb" ? " bb" : ""}">${inner}</span>`, kind:"atom" };
  }

  if(name in ACCENT)
    return { html:`<span class="${ACCENT[name]}">${readArg(toks, st)}</span>`, kind:"atom" };

  if(name in BIGOP)
    return { html:`<span class="bigop">${BIGOP[name]}</span>`, kind:"open" };

  if(FUNC.has(name))
    return { html:`<span class="fn">${name}</span>`, kind:"atom" };

  // \left( \right) — chỉ cần vẽ đúng dấu ngoặc, không cần co giãn theo chiều cao.
  if(name === "left" || name === "right"){
    const t = toks[st.i];
    if(!t) return { html:"", kind:"open" };
    st.i++;
    let ch = t.k === "cmd" ? (SYM[t.v] ?? "") : (t.v ?? "");
    if(ch === ".") ch = "";
    return { html: esc(ch), kind: name === "left" ? "open" : "atom" };
  }

  if(name in SYM){
    const ch = SYM[name];
    return emitChar(ch, st, prev);
  }

  unknownCmds.add(name);
  return { html:`<span class="fn">${esc(name)}</span>`, kind:"atom" };
}

/** Ăn đúng một nguyên tử. */
function step(toks, st, prev){
  const t = toks[st.i++];
  if(!t) return { html:"", kind:"open" };
  if(t.k === "{"){
    const h = buildList(toks, st);
    if(toks[st.i]?.k === "}") st.i++;
    return { html:h, kind:"atom" };
  }
  if(t.k === "ch")  return emitChar(t.v, st, prev);
  if(t.k === "cmd") return cmd(t.v, toks, st, prev);
  return { html:"", kind:"open" };
}

/* Có cả trên lẫn dưới thì xếp chồng — đúng cách TeX dựng $^{235}_{92}U$ và
   $\int_0^1$. Chỉ có một bên thì để bình thường. */
function script(sup, sub){
  if(sup && sub)
    return `<span class="stk"><span>${sup}</span><span>${sub}</span></span>`;
  if(sup) return `<sup>${sup}</sup>`;
  if(sub) return `<sub>${sub}</sub>`;
  return "";
}

function buildList(toks, st){
  const out = [];
  let prev = "open";
  while(st.i < toks.length){
    const t = toks[st.i];
    if(t.k === "}") break;

    if(t.k === "^" || t.k === "_"){
      st.i++;
      const base = out.length ? out.pop() : { html:"", kind:"open" };
      let sup = "", sub = "";
      if(t.k === "^") sup = readArg(toks, st); else sub = readArg(toks, st);
      const n = toks[st.i];
      if(n && (n.k === "^" || n.k === "_") && n.k !== t.k){
        st.i++;
        if(n.k === "^") sup = readArg(toks, st); else sub = readArg(toks, st);
      }
      out.push({ html: base.html + script(sup, sub), kind:"atom" });
      prev = "atom";
      continue;
    }

    const a = step(toks, st, prev);
    out.push(a);
    prev = a.kind;
  }
  return out.map(a => a.html).join("");
}

function math(src){
  const render = value => {
    const st = { i:0, roman:false };
    return buildList(tokenize(String(value)), st);
  };
  const source = String(src);
  let html = "", last = 0;
  const cases = /\\begin\s*\{cases\}([\s\S]*?)\\end\s*\{cases\}/g;
  let match;
  while((match = cases.exec(source))){
    html += render(source.slice(last, match.index));
    const rows = match[1].split(/\\\\/).filter(row=>row.trim()).map(row=>`<span>${render(row.trim())}</span>`).join("");
    html += `<span class="cases">${rows}</span>`;
    last = match.index + match[0].length;
  }
  html += render(source.slice(last));
  if(unknownCmds.size){
    console.warn("[công thức] lệnh LaTeX chưa hỗ trợ:", [...unknownCmds].join(", "));
    unknownCmds.clear();
  }
  return `<span class="mth">${html}</span>`;
}

/* Chỉ escape phần chữ thường. Phần trong $…$ do math() tự escape lúc phát ra —
   escape trước thì "<" đã thành "&lt;" và bộ tách token đọc nhầm thành 4 ký tự. */
/* Dòng trống trong đề là ngắt đoạn thật (câu con hay có 2–3 đoạn), nên giữ nó
   thành <br>. Xuống dòng đơn thì gộp lại — đó chỉ là chỗ ngắt dòng của bản in. */
const texPara = (source) => esc(source).replace(/\n{2,}/g, "<br>").replace(/\n/g, " ");
const tex = (src) => cleanImageMarkers(src).split("$").map((p,i) => i%2 ? math(p) : texPara(p)).join("");
const cleanImageMarkers = (src) => String(src ?? "")
  .replace(/\s*\[\[IMG:\d+\]\]\s*/gi, " ").replace(/[ \t]{2,}/g, " ")
  .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const plain = (s) => String(s).replace(/\$[^$]*\$/g," ");
const fold  = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g,"")
                      .replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase();
/* ── hình của câu hỏi ───────────────────────────────────────────────────────
 *
 * Kho cũ để `fig:"spring"` — chỉ một chuỗi, không chỉnh được gì. Nay hình là
 * một object có cỡ và chỗ đặt, vì giáo viên cần đúng ba việc: đổi cỡ, thay
 * hình khác, và đẩy hình sang phải cho đỡ tốn giấy.
 *
 * Vẫn nhận chuỗi cũ để 49 câu mẫu trong data.js không phải sửa — chuẩn hoá
 * ngay lúc đọc.
 */
const PLACES = {
  top:   "Trên phương án, căn giữa",
  below: "Dưới phương án, căn giữa",
  right: "Bên phải, chữ chạy vòng trái",
  left:  "Bên trái, chữ chạy vòng phải"
};

function normFig(f){
  if(!f) return null;
  if(typeof f === "string") return { src:f, note:null, width:45, place:"top" };
  return { ...f, src:f.src ?? null, note:f.note ?? null,
           width:f.width ?? 45, place:f.place ?? "top" };
}

/** Nội dung hình: khoá dựng sẵn lấy SVG; ảnh crop/tải lên dùng thẻ img. */
function figInner(src){
  if(!src) return "";
  if(FIGS[src]) return FIGS[src];
  if(String(src).startsWith("data:") || String(src).startsWith("/api/"))
    return `<img src="${esc(src)}" alt="">`;
  return `<div class="figmissing">Không tìm thấy hình “${esc(src)}”</div>`;
}

/** cls: figbox = khung xám trong app · fg = trên tờ giấy xem trước. */
function figHtml(f, cls="figbox"){
  const g = normFig(f);
  if(!g || !g.src) return "";
  const wrap = g.place === "right" || g.place === "left" ? ` float-${g.place}` : "";
  const mid  = g.place === "top" || g.place === "below" ? " figmid" : "";
  return `<div class="${cls}${wrap}${mid}" style="width:${g.width}%">${figInner(g.src)}</div>`;
}

/** Hình đặt dưới phương án thì phải phát riêng, không dính vào thân câu. */
const figAt = (f, where, cls="figbox") =>
  normFig(f)?.place === where ? figHtml(f, cls) : "";
const hasFig = (x) => !!normFig(x.fig)?.src;
/* Tám chữ cái chứ không phải bốn: đề đại học (Giải tích HCMUT, ĐGNL) hay có 5
   phương án A–E, trong đó một phương án là "Các câu khác sai". Bản cũ khoá đúng
   bốn nên phương án thứ năm rơi mất và cả trang bị coi là OCR hỏng. */
const LETTER = ["A","B","C","D","E","F","G","H"];
/** Nhãn thật in trên đề nếu có, không thì đánh theo vị trí. */
const chLabel = (x, i) => x?.chLabels?.[i] ?? LETTER[i] ?? String(i + 1);
const TFIDX  = ["a","b","c","d","e","f"];
const vn = (n) => n.toLocaleString("vi-VN");
/* Điểm viết kiểu Việt Nam và bỏ số 0 thừa: 4,5 — 4,0 — 0,25 (không phải 4,50). */
const diem = (n) => n.toFixed(2).replace(/0$/, "").replace(".", ",");

const TICK = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#f3f5fe" '+
  'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
  '<path d="M3 8.5l3.2 3.2L13 5"/></svg>';

function toast(msg){
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; t.setAttribute("role","status");
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}
const $ = (sel,root=document) => root.querySelector(sel);
const $$ = (sel,root=document) => [...root.querySelectorAll(sel)];

/* ══════════════════════════════════════════════════════════ trạng thái ══ */

const filters = { type:new Set(), diff:new Set(), topic:new Set(), src:new Set() };
let search = "";
let sortMode = "moi";           // "moi" | "cu" | "chuyende"
const VAULTS = structuredClone(Array.isArray(BOOT.vaults) && BOOT.vaults.length ? BOOT.vaults : [
  { id:"vault-physics", name:"Kho Vật lí", subject:"physics" },
  { id:"vault-math", name:"Kho Toán", subject:"math" },
]);
let activeVaultId = VAULTS.some(vault => vault.id === BOOT.activeVaultId)
  ? BOOT.activeVaultId : VAULTS[0].id;
const DRAFTS = structuredClone(BOOT.drafts && typeof BOOT.drafts === "object" ? BOOT.drafts : {});
const activeVault = () => VAULTS.find(vault => vault.id === activeVaultId) || VAULTS[0];
const defaultHeaderFor = vault => ({ ...DEFAULT_HEADER,
  subject:vault?.subject === "math" ? "Toán 12" : "Vật lí 12" });
function ensureDraft(vaultId){
  const vault = VAULTS.find(item => item.id === vaultId) || VAULTS[0];
  const draft = DRAFTS[vaultId] ?? {};
  const storedLayout = draft.layout && typeof draft.layout === "object" ? structuredClone(draft.layout) : { ...DEFAULT_LAYOUT };
  if(!storedLayout.marginVersion && storedLayout.marginTop === 2 && storedLayout.marginRight === 2 &&
      storedLayout.marginBottom === 2 && storedLayout.marginLeft === 3){
    Object.assign(storedLayout,{ marginVersion:2, marginTop:1, marginRight:1, marginBottom:1, marginLeft:1 });
  }
  DRAFTS[vaultId] = {
    doc:Array.isArray(draft.doc) && draft.doc.length ? draft.doc : [{ kind:"hdr" }],
    header:draft.header && typeof draft.header === "object" ? draft.header : defaultHeaderFor(vault),
    layout:storedLayout,
    presets:Array.isArray(draft.presets) ? draft.presets : [],
    activePresetId:typeof draft.activePresetId === "string" ? draft.activePresetId : null,
  };
  return DRAFTS[vaultId];
}
let subject = activeVault().subject === "math" ? "math" : "physics";
let currentDraft = ensureDraft(activeVaultId);
let header = structuredClone(currentDraft.header);
let layout = { ...DEFAULT_LAYOUT, ...structuredClone(currentDraft.layout) };
let PRESETS = structuredClone(currentDraft.presets);
let activePresetId = currentDraft.activePresetId;
const plan = planOf(session?.plan);
/* Lượt quét còn lại trong tháng. Bản thật lấy từ máy chủ; ở đây trừ dần theo
   số trang đã nạp để thấy đúng hành vi. */
let scansLeft = plan.scans - SOURCES.reduce((a,r) => a + (r.scans ?? r.pages), 0);
let sheetMode = "de";           // "de" | "dapan" | "loigiai" | "matran"
let selectedId = null;          // câu đang xem ở cột phải màn Kho
const checked = new Set();      // câu đã tích để thêm hàng loạt vào đề
let finderFor = null;           // chỉ số phần đang mở thanh tìm câu

/* Đề mở sẵn cho có cái mà nhìn. Câu phải lấy ĐÚNG DẠNG của từng phần — bản
   trước nhét thẳng BANK[2] (một câu trắc nghiệm) vào phần Đúng/Sai. */
let DOC = structuredClone(currentDraft.doc);

let saveBusy = false, saveAgain = false, syncPaused = false;
let lastSnapshot = "";
function saveCurrentDraft(){
  DRAFTS[activeVaultId] = {
    doc:structuredClone(DOC), header:structuredClone(header), layout:structuredClone(layout),
    presets:structuredClone(PRESETS), activePresetId,
  };
}
const workspaceSnapshot = () => {
  saveCurrentDraft();
  return ({
  schemaVersion:2, version:workspaceVersion, vaults:VAULTS, activeVaultId, drafts:DRAFTS,
  bank:BANK, groups:GROUPS, pending:PENDING, sources:SOURCES.filter(x => !x._temp),
  doc:DOC, header, layout, subject
  });
};

/**
 * Nhận lại phần dữ liệu do MÁY CHỦ sở hữu sau khi bị từ chối vì trạng thái cũ.
 *
 * Job OCR chạy nền ghi câu hỏi thẳng vào workspace ở máy chủ. Tab đang mở mà
 * không theo dõi job đó vẫn tự lưu bằng bản chụp cũ trong bộ nhớ nó — và xoá
 * sạch kết quả vừa đọc. Dựng lại được đúng tình huống này với 13 câu.
 *
 * Chia quyền sở hữu cho rõ: máy chủ nắm hàng chờ/nguồn/nhóm/kho, client nắm đề
 * đang soạn. Trộn theo đúng ranh giới đó thay vì bên nào ghi sau thì thắng.
 */
function adoptServerWorkspace(state){
  if(!state) return;
  workspaceVersion = state.version ?? workspaceVersion;
  const keep = (list) => Array.isArray(list) ? list : [];
  PENDING.splice(0, PENDING.length, ...keep(state.pending));
  SOURCES.splice(0, SOURCES.length, ...keep(state.sources));
  GROUPS.splice(0, GROUPS.length, ...keep(state.groups));
  BANK.splice(0, BANK.length, ...keep(state.bank));
  paintSources(); paintReview(); paintFacets(); paintKho(); paintHome();
}

async function saveWorkspace(force=false){
  if(syncPaused) return;
  const body = JSON.stringify(workspaceSnapshot());
  if(!force && body === lastSnapshot) return;
  if(saveBusy){ saveAgain = true; return; }
  saveBusy = true;
  try {
    const r = await fetch("/api/workspace", {
      method:"PUT", headers:{ "content-type":"application/json" }, body
    });
    const result = await r.json().catch(() => ({}));
    if(r.status === 409 && result.code === "stale-workspace"){
      // Máy chủ có bản mới hơn: lấy phần của máy chủ, giữ đề đang soạn, lưu lại.
      adoptServerWorkspace(result.workspace);
      lastSnapshot = "";
      saveBusy = false;
      return void saveWorkspace(true);
    }
    if(!r.ok) throw new Error(result.error || "Không lưu được workspace");
    workspaceVersion = result.version ?? workspaceVersion;
    lastSnapshot = body;
  } catch(err){ console.error("[autosave]", err); }
  finally {
    saveBusy = false;
    if(saveAgain){ saveAgain = false; void saveWorkspace(true); }
  }
}
lastSnapshot = JSON.stringify(workspaceSnapshot());

/* Đề mở sẵn ở trên là hàng dựng sẵn để nhìn cho có. Hỏi "có xoá không?" khi
   giáo viên chưa đụng vào nó thì chỉ tổ phiền. Cờ này bật ở lần sửa đầu tiên. */
let docTouched = false;
const touchDoc = () => { docTouched = true; };

const qById = (id) => BANK.find(b => b.id === id);
const inActiveVault = item => item?.vaultId === activeVaultId;
const ofSubject = () => BANK.filter(inActiveVault);
const activePending = () => PENDING.filter(inActiveVault);
const activeSources = () => SOURCES.filter(inActiveVault);
const srcList = () => [...new Set(ofSubject().map(x=>x.src))];

/* Điểm theo cấu trúc thi thật 2025: trắc nghiệm và trả lời ngắn 0,25 đ mỗi câu,
   đúng/sai 1,0 đ mỗi câu (4 ý). Tự luận chấm tay nên không quy ra điểm. */
const POINTS = { MC:0.25, TF:1, SHORT:0.25, ESSAY:0 };
const SECNOTE = { MC:"4 phương án", TF:"1 ý 0,1 — 4 ý 1,0",
                  SHORT:"đáp án là số", ESSAY:"chấm tay" };

/* ═══════════════════════════════════════════════════════════════ kho ══ */

function match(x){
  if(!inActiveVault(x)) return false;
  if(filters.type.size && !filters.type.has(x.type)) return false;
  if(filters.diff.size && !filters.diff.has(x.diff)) return false;
  if(filters.topic.size && !filters.topic.has(x.topic)) return false;
  if(filters.src.size && !filters.src.has(x.src)) return false;
  if(search && !fold(`${plain(x.stem)} ${TOPICS[x.topic]} ${x.src}`).includes(fold(search))) return false;
  return true;
}

function hits(){
  const list = BANK.filter(match);
  if(sortMode === "cu") return list;
  if(sortMode === "chuyende")
    return [...list].sort((a,b) => (TOPICS[a.topic]||"").localeCompare(TOPICS[b.topic]||"","vi"));
  return [...list].reverse();       // "mới nhất" — cuối kho là câu nạp sau cùng
}

/* Cột lọc: mỗi mục là một nút bật/tắt, kèm số câu đang có. Mục 0 câu thì ẩn
   luôn — bấm vào chỉ ra danh sách rỗng, chẳng để làm gì. */
/* Cột lọc: mặc định GẤP LẠI phần dài.
   Kho 28 câu Vật lí đã có 14 chuyên đề + 5 nguồn, đổ hết ra là một cột chữ dài
   ngoằng chẳng ai đọc. Nay mỗi mục gấp/mở được, phần dài chỉ hiện 6 dòng đầu
   kèm ô tìm — gõ vài chữ là ra, không phải rà mắt. */
const facetOpen = { type:true, diff:true, topic:true, src:false };
const facetQ = { topic:"", src:"" };
const facetMore = { topic:false, src:false };
const FACET_SHOW = 6;

const CLS2 = { MC:"mc", TF:"tf", SHORT:"short", ESSAY:"essay" };

function facetRows(el, kind, items, withDot){
  const box = el;
  box.innerHTML = "";
  if(!facetOpen[kind]) return;

  const searchable = kind === "topic" || kind === "src";
  let list = items
    .map(([val,label]) => [val, label, ofSubject().filter(x => x[kind] === val).length])
    .filter(([,,n]) => n > 0);

  if(searchable && facetQ[kind]){
    const kw = fold(facetQ[kind]);
    list = list.filter(([,label]) => fold(label).includes(kw));
  }
  // Mục đang bật luôn hiện, kể cả khi bị cắt hoặc lọc ra ngoài — không thì
  // giáo viên thấy kho lọc mà không biết đang lọc theo cái gì.
  const chosen = list.filter(([v]) => filters[kind].has(v));
  const rest   = list.filter(([v]) => !filters[kind].has(v));
  const cut    = searchable && !facetMore[kind] && !facetQ[kind];
  const shown  = cut ? [...chosen, ...rest.slice(0, Math.max(0, FACET_SHOW - chosen.length))]
                     : [...chosen, ...rest];

  if(searchable && (list.length > FACET_SHOW || facetQ[kind])){
    const s = document.createElement("input");
    s.type = "search"; s.className = "facet-search"; s.value = facetQ[kind];
    s.placeholder = kind === "topic" ? "Tìm chuyên đề…" : "Tìm nguồn…";
    s.setAttribute("aria-label", s.placeholder);
    s.addEventListener("input", e => {
      facetQ[kind] = e.target.value;
      paintFacets();
      // Vẽ lại là mất con trỏ — trả nó về đúng ô vừa gõ.
      const again = $(".facet-search", el);
      if(again){ again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
    box.appendChild(s);
  }

  for(const [val,label,n] of shown){
    const b = document.createElement("button");
    b.type = "button"; b.className = "frow";
    b.setAttribute("aria-pressed", filters[kind].has(val) ? "true" : "false");
    b.innerHTML = (withDot ? `<span class="dot ${CLS2[val]}"></span>` : "") +
      `<span class="lbl-t">${esc(label)}</span><span class="n">${n}</span>`;
    b.addEventListener("click", () => toggleFilter(kind, val));
    box.appendChild(b);
  }

  if(!shown.length){
    const e = document.createElement("div");
    e.className = "facet-none";
    e.textContent = "Không có mục nào khớp.";
    box.appendChild(e);
  }

  const hidden = list.length - shown.length;
  if(hidden > 0 || (facetMore[kind] && !facetQ[kind] && list.length > FACET_SHOW)){
    const m = document.createElement("button");
    m.type = "button"; m.className = "facet-more";
    m.textContent = hidden > 0 ? `Xem thêm ${hidden} mục` : "Thu lại";
    m.addEventListener("click", () => { facetMore[kind] = hidden > 0; paintFacets(); });
    box.appendChild(m);
  }
}

/** Độ khó chỉ có 4 mức nên xếp lưới 2×2, không cần tìm kiếm hay gấp bớt. */
function facetChips(el, kind, items){
  el.innerHTML = "";
  for(const [val,label] of items){
    const n = ofSubject().filter(x => x[kind] === val).length;
    const b = document.createElement("button");
    b.type = "button"; b.className = "fchip";
    b.setAttribute("aria-pressed", filters[kind].has(val) ? "true" : "false");
    b.title = DNAME[val] ?? label;
    b.innerHTML = `${esc(label)}<b>${n}</b>`;
    b.disabled = !n;
    b.addEventListener("click", () => toggleFilter(kind, val));
    el.appendChild(b);
  }
}

function toggleFilter(kind, val){
  filters[kind].has(val) ? filters[kind].delete(val) : filters[kind].add(val);
  paintFacets(); paintKho();
}

function paintFacets(){
  facetRows($("#fType"),"type", Object.entries(TYPES), true);
  if(facetOpen.diff) facetChips($("#fDiff"),"diff", DIFFS.map(d=>[d,d]));
  else $("#fDiff").innerHTML = "";
  // Kho có thể chứa nhiều môn; môn chỉ còn là metadata mặc định cho OCR/preset.
  facetRows($("#fTopic"),"topic", topicsOf("physics").concat(topicsOf("math")));
  facetRows($("#fSrc"),"src", srcList().map(s=>[s,s]));

  $$("[data-clear]").forEach(b => { b.hidden = !filters[b.dataset.clear].size; });
  // Mũi tên gấp/mở + con số cho biết đang lọc mấy mục dù đã gấp lại.
  $$("[data-facet]").forEach(b => {
    const k = b.dataset.facet;
    b.setAttribute("aria-expanded", facetOpen[k]);
    b.textContent = facetOpen[k] ? "▾" : "▸";
    const badge = $(`[data-fcount="${k}"]`);
    if(badge){
      badge.textContent = filters[k].size ? String(filters[k].size) : "";
      badge.hidden = !filters[k].size;
    }
  });
}

$$("[data-facet]").forEach(b => b.addEventListener("click", () => {
  facetOpen[b.dataset.facet] = !facetOpen[b.dataset.facet];
  paintFacets();
}));

$$("[data-clear]").forEach(b => b.addEventListener("click", () => {
  filters[b.dataset.clear].clear(); paintFacets(); paintKho();
}));

function qmetaHtml(x){
  return `<span class="chip ${CLS2[x.type]}">${TYPES[x.type]}</span>
    <span class="chip diff">${x.diff}</span>
    <span>${esc(TOPICS[x.topic] ?? "—")} · Lớp ${x.grade} · ${esc(x.src)}</span>
    ${hasFig(x) ? '<span class="chip fig">Có hình</span>'
      : x.figNote ? '<span class="chip warn">Có hình — chưa gắn ảnh</span>' : ""}
    ${x.groupId ? `<span class="chip acc">Cụm ${x.groupOrder || ""}/${x.groupSize || ""}</span>` : ""}
    ${x.ai ? '<span class="chip ai">nguồn AI đoán</span>' : ""}`;
}

function paintKho(){
  const list = hits();
  const box = $("#list");
  $("#count").textContent = `${list.length} / ${ofSubject().length} câu`;

  if(selectedId && !list.some(x => x.id === selectedId)) selectedId = null;
  if(!selectedId && list.length) selectedId = list[0].id;

  box.innerHTML = "";
  if(!list.length){
    box.innerHTML = `<div class="empty">Không có câu nào khớp. Bỏ bớt bộ lọc nhé.</div>`;
    paintDetail(); paintAddBtn(); paintCapacity();
    return;
  }
  for(const x of list){
    const d = document.createElement("div");
    d.className = "qrow" + (x.id === selectedId ? " on" : "");
    d.dataset.pick = x.id;
    d.innerHTML = `
      <span class="ck${checked.has(x.id) ? " on" : ""}" role="checkbox" tabindex="0"
            aria-checked="${checked.has(x.id)}" data-ck="${x.id}"
            aria-label="Chọn câu này để thêm vào đề hoặc xoá hàng loạt">${TICK}</span>
      <div>
        <div class="qtext">${tex(x.stem)}</div>
        <div class="qmeta">${qmetaHtml(x)}</div>
      </div>`;
    box.appendChild(d);
  }
  paintDetail(); paintAddBtn(); paintCapacity();
}

function paintAddBtn(){
  const n = checked.size;
  const b = $("#btnAddSel");
  b.textContent = n ? `+ Thêm ${n} câu vào đề` : "+ Thêm vào đề";
  b.disabled = !n;

  const del = $("#btnDelSelMany");
  del.hidden = !n;
  del.textContent = `Xoá ${n} câu đã chọn`;
  const visible = hits();
  const all = $("#btnCheckAll");
  const allOn = visible.length > 0 && visible.every(x => checked.has(x.id));
  all.textContent = allOn ? "Bỏ chọn hết" : `Chọn hết${visible.length ? ` (${visible.length})` : ""}`;
  all.disabled = !visible.length;
}

function paintDetail(){
  const el = $("#detail");
  const x = selectedId ? qById(selectedId) : null;
  $("#btnEditSel").disabled = $("#btnDelSel").disabled = $("#btnAddOne").disabled = !x;
  if(!x){
    el.innerHTML = `<div class="empty">Chọn một câu bên trái để xem đầy đủ.</div>`;
    return;
  }

  let body = x.groupId ? `<div class="group-context">
      <div class="group-title">${esc(x.groupLabel || "Dữ liệu dùng chung cho nhóm câu hỏi")}</div>
      <div>${tex(x.groupStem || "")}</div>${figHtml(x.groupFig)}
    </div>` : "";
  body += `<div class="dtext">${tex(x.stem)}</div>` +
    (normFig(x.fig)?.place === "below" ? "" : figHtml(x.fig));
  if(!hasFig(x) && x.figNote){
    body += `<div class="conflict"><span class="t">
      <b>Câu này có hình</b> mà chưa gắn ảnh. AI mô tả: “${esc(x.figNote)}”.
      Bấm Sửa để tải hình lên.</span></div>`;
  }

  if(x.type === "MC" && x.ch){
    body += `<div class="choices">${x.ch.map((c,i) =>
      `<div class="choice${i===x.ans?" ans":""}"><b>${chLabel(x,i)}.</b> ${tex(c)}
       ${i===x.ans?'<span class="tagright">đáp án</span>':""}</div>`).join("")}</div>`;
  }
  if(x.type === "TF" && x.tf){
    body += `<div class="choices">${x.tf.map(([t,v],i) =>
      `<div class="choice"><b>${TFIDX[i]})</b> ${tex(t)}
       <span class="tagright" style="color:var(--${v?"ok":"danger"})">${v?"Đúng":"Sai"}</span></div>`).join("")}</div>`;
  }
  if(x.type === "SHORT" && x.sa){
    body += `<div class="choices"><div class="choice ans"><b>=</b>
      ${esc(x.sa.value)} ${esc(x.sa.unit)}
      <span class="tagright">±${esc(x.sa.tol)}</span></div></div>`;
  }

  body += figAt(x.fig,"below");

  if(x.sol){
    body += `<div class="rule"></div>
      <div><div class="cap" style="margin-bottom:6px">Lời giải</div>
      <div style="font-family:var(--serif);font-size:15px;line-height:1.7;color:var(--ink-2)">
        ${tex(x.sol)}</div></div>`;
  }

  const used = DOC.filter(b => b.kind === "sec")
    .flatMap(b => b.items)
    .filter(it => it.mode === "q" ? it.qid === x.id : (it.picked ?? []).includes(x.id)).length;

  body += `<div class="rule"></div>
    <div class="kv">
      <span>Chuyên đề</span><span>${esc(TOPICS[x.topic] ?? "—")} · Lớp ${x.grade}</span>
      <span>Độ khó</span><span>${x.diff} — ${DNAME[x.diff]}</span>
      <span>Nguồn</span><span>${esc(x.src)}${
        x.ai ? ' <span class="chip ai" style="margin-left:4px">AI đoán</span>' : ""}</span>
      <span>Trong đề này</span><span>${used ? `đang dùng ${used} lần` : "chưa dùng"}</span>
    </div>`;

  el.innerHTML = body;
}

$("#list").addEventListener("click", e => {
  const ck = e.target.closest("[data-ck]");
  if(ck){
    const id = ck.dataset.ck;
    checked.has(id) ? checked.delete(id) : checked.add(id);
    ck.classList.toggle("on", checked.has(id));
    ck.setAttribute("aria-checked", checked.has(id) ? "true" : "false");
    paintAddBtn();
    return;
  }
  const row = e.target.closest("[data-pick]");
  if(row){ selectedId = row.dataset.pick; paintKho(); }
});
$("#list").addEventListener("keydown", e => {
  const ck = e.target.closest("[data-ck]");
  if(ck && (e.key === " " || e.key === "Enter")){ e.preventDefault(); ck.click(); }
});
$("#list").addEventListener("dblclick", e => {
  const row = e.target.closest("[data-pick]");
  if(row) openEditor(row.dataset.pick);
});

$("#q").addEventListener("input", e => { search = e.target.value; paintKho(); });

const SORTS = [["moi","mới nhất"],["cu","cũ nhất"],["chuyende","theo chuyên đề"]];
$("#btnSort").addEventListener("click", () => {
  const i = SORTS.findIndex(s => s[0] === sortMode);
  sortMode = SORTS[(i+1) % SORTS.length][0];
  $("#btnSort").textContent = "Sắp xếp: " + SORTS.find(s => s[0] === sortMode)[1];
  paintKho();
});

$("#btnEditSel").addEventListener("click", () => selectedId && openEditor(selectedId));
$("#btnDelSel").addEventListener("click", () => {
  const x = selectedId && qById(selectedId);
  if(x && confirm(`Xoá hẳn câu này khỏi kho?\n\n${plain(x.stem).slice(0,90)}…`)) removeQuestion(x);
});

/** Gỡ một câu khỏi kho. `quiet` để bản xoá hàng loạt tự lo vẽ lại và báo tin. */
function removeQuestion(x, quiet = false){
  BANK.splice(BANK.indexOf(x),1);
  if(x.groupId){
    const entity = GROUPS.find(group => group.vaultId === x.vaultId && group.id === x.groupId);
    if(entity) entity.questionIds = (entity.questionIds || []).filter(id => id !== x.id);
    if(entity && !BANK.some(q => q.vaultId === x.vaultId && q.groupId === x.groupId)
      && !PENDING.some(q => q.vaultId === x.vaultId && q.groupId === x.groupId))
      GROUPS.splice(GROUPS.indexOf(entity), 1);
  }
  checked.delete(x.id);
  if(selectedId === x.id) selectedId = null;
  for(const s of DOC) if(s.items){
    s.items = s.items.filter(it => it.qid !== x.id);
    for(const it of s.items) if(it.picked) it.picked = it.picked.filter(id => id !== x.id);
  }
  if(quiet) return;
  paintFacets(); paintKho(); paintCanvas(); renderSheet();
  toast("Đã xoá 1 câu khỏi kho");
}

/**
 * Xoá hàng loạt trong kho.
 *
 * Cùng luật với hàng chờ duyệt: tích một câu của cụm là xoá cả cụm, vì một cụm
 * bị xẻ đôi thì phần còn lại mất phần dẫn chung và không dùng được nữa.
 */
function bankUnitOf(x){
  return x?.groupId
    ? BANK.filter(item => item.vaultId === x.vaultId && item.groupId === x.groupId)
    : (x ? [x] : []);
}

async function removeCheckedFromBank(){
  const picked = [...checked].map(qById).filter(Boolean);
  if(!picked.length) return;
  const unit = new Map();
  for(const x of picked) for(const item of bankUnitOf(x)) unit.set(item.id, item);
  const list = [...unit.values()];
  const groups = new Set(list.filter(x => x.groupId).map(x => x.groupId));
  const extra = list.length - picked.length;
  const inDoc = list.filter(x => DOC.some(s => s.items?.some(it => it.qid === x.id))).length;

  if(!confirm([
    `Xoá hẳn ${list.length} câu khỏi kho?`,
    extra > 0 ? `Trong đó ${extra} câu bị kéo theo vì cùng cụm với câu bạn chọn (${groups.size} cụm).` : "",
    inDoc > 0 ? `${inDoc} câu đang nằm trong đề đang soạn và sẽ bị gỡ khỏi đề.` : "",
    "", "Không hoàn tác được.",
  ].filter(Boolean).join("\n"))) return;

  for(const x of list) removeQuestion(x, true);
  checked.clear();
  paintFacets(); paintKho(); paintCanvas(); renderSheet();
  toast(`Đã xoá ${list.length} câu khỏi kho`);
  await saveWorkspace(true);
}

/* Thêm câu từ kho vào đề đang soạn: tìm phần cùng dạng câu, chưa có thì mở
   thêm một phần mới — chứ không im lặng bỏ qua. */
function expandQuestionGroupIds(ids){
  const out = [];
  for(const id of ids){
    const x = qById(id);
    const members = x?.groupId
      ? BANK.filter(q => q.vaultId === x.vaultId && q.groupId === x.groupId).sort((a,b) => (a.groupOrder || 0) - (b.groupOrder || 0))
      : x ? [x] : [];
    for(const member of members) if(!out.includes(member.id)) out.push(member.id);
  }
  return out;
}
function addToDoc(ids){
  ids = expandQuestionGroupIds(ids);
  let added = 0, dup = 0;
  for(const id of ids){
    const x = qById(id);
    if(!x) continue;
    let sec = DOC.find(b => b.kind === "sec" && b.type === x.type);
    if(!sec){ sec = { kind:"sec", type:x.type, items:[] }; DOC.push(sec); }
    if(sec.items.some(it => it.mode === "q" && it.qid === id)){ dup++; continue; }
    sec.items.push({ mode:"q", qid:id });
    added++;
  }
  if(added){ touchDoc(); paintCanvas(); renderSheet(); }
  toast(added
    ? `Đã thêm ${added} câu vào đề${dup ? ` · bỏ qua ${dup} câu đã có` : ""}`
    : "Mấy câu này đã có trong đề rồi");
}

$("#btnAddSel").addEventListener("click", () => {
  if(!checked.size) return;
  addToDoc([...checked]);
  checked.clear(); paintKho();
});
$("#btnDelSelMany").addEventListener("click", () => void removeCheckedFromBank());
$("#btnCheckAll").addEventListener("click", () => {
  // "Chọn hết" chỉ tính những câu ĐANG HIỆN sau bộ lọc — chọn nhầm cả kho rồi
  // bấm xoá thì hối không kịp.
  const visible = hits();
  const allOn = visible.length > 0 && visible.every(x => checked.has(x.id));
  for(const x of visible) allOn ? checked.delete(x.id) : checked.add(x.id);
  paintKho();
});
$("#btnAddOne").addEventListener("click", () => selectedId && addToDoc([selectedId]));

/* ═════════════════════════════════════════════ trình sửa câu đầy đủ ══ */

/* ── khối sửa hình trong trình soạn câu ────────────────────────────────────
 *
 * Ba việc giáo viên cần làm với hình mà bản trước không cho làm:
 *   cỡ hình · thay bằng hình khác · đặt hình chỗ nào so với phương án.
 *
 * Câu AI đọc ra có nhãn "Có hình" nhưng thường CHƯA CÓ ẢNH THẬT — model chỉ
 * khoanh được chỗ hình nằm trên trang gốc và mô tả nó bằng chữ (`note`).
 * Nên khối này luôn hiện phần mô tả đó: giáo viên đọc rồi tải hình vào,
 * hoặc chọn một hình dựng sẵn cho giống.
 */
function figEditorHtml(x){
  const g = normFig(x.fig);
  if(!g || !g.src){
    return `<div class="figedit empty">
      <div class="figedit-head"><span class="lbl" style="margin:0">Hình vẽ</span>
        <div class="grow"></div>
        ${x.figNote ? '<span class="chip warn">Có hình — chưa gắn ảnh</span>' : ""}
      </div>
      ${x.figNote ? `<p class="hint" style="margin:0 0 8px">AI mô tả hình này:
        “${esc(x.figNote)}”</p>` : ""}
      <div class="figedit-acts">
        <button class="btn btn-sm" type="button" data-figadd>Chọn hình dựng sẵn</button>
        <label class="btn btn-sm" style="cursor:pointer">Tải ảnh lên
          <input type="file" accept="image/*" data-figfile hidden></label>
      </div>
      <p class="hint">Câu không có hình thì để trống, không ảnh hưởng gì.</p>
    </div>`;
  }

  return `<div class="figedit">
    <div class="figedit-head"><span class="lbl" style="margin:0">Hình vẽ</span>
      <div class="grow"></div>
      <button class="btn btn-sm btn-danger" type="button" data-figdel>Bỏ hình</button>
    </div>

    <div class="figedit-body">
      <div class="figprev" style="width:${g.width}%">${figInner(g.src)}</div>
      <div class="figctl">
        <label><span class="lbl">Cỡ hình — ${g.width}% bề ngang cột chữ</span>
          <input type="range" min="15" max="100" step="5" value="${g.width}" data-figw></label>

        <label><span class="lbl">Vị trí</span>
          <select data-figp>${Object.entries(PLACES).map(([k,v]) =>
            `<option value="${k}" ${k===g.place?"selected":""}>${v}</option>`).join("")}</select></label>

        <div class="figedit-acts">
          <button class="btn btn-sm" type="button" data-figadd>Thay hình dựng sẵn</button>
          <label class="btn btn-sm" style="cursor:pointer">Thay bằng ảnh
            <input type="file" accept="image/*" data-figfile hidden></label>
        </div>
        ${x.figNote ? `<p class="hint">AI mô tả: “${esc(x.figNote)}”</p>` : ""}
      </div>
    </div>
  </div>`;
}

/** Bảng chọn hình dựng sẵn — hiện SVG thật để chọn bằng mắt, không chọn theo tên. */
function pickBuiltinFig(onPick){
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal narrow" role="dialog" aria-modal="true" aria-label="Chọn hình dựng sẵn">
    <div class="modal-head"><h3>Hình dựng sẵn</h3><div class="grow"></div>
      <button class="btn btn-ghost" type="button" data-x>Đóng</button></div>
    <div class="modal-body one"><div class="ed-left" style="border-right:0">
      <div class="figgrid">${Object.keys(FIGS).map(k =>
        `<button class="figpick" type="button" data-k="${k}">
          <div class="figpick-img">${FIGS[k]}</div><span>${k}</span></button>`).join("")}</div>
    </div></div></div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  $$("[data-x]", scrim).forEach(b => b.addEventListener("click", close));
  scrim.addEventListener("click", e => { if(e.target === scrim) close(); });
  $$("[data-k]", scrim).forEach(b => b.addEventListener("click", () => {
    onPick(b.dataset.k); close();
  }));
}

function blankFor(type, x){
  if(type === "MC" && !x.ch)  { x.ch = ["","","",""]; x.ans = null; }
  if(type === "TF" && !x.tf)  { x.tf = TFIDX.map(()=>["",null]); }
  if(type === "SHORT" && !x.sa){ x.sa = {value:"",unit:"",tol:"0"}; }
}

function openEditor(id){
  const orig = qById(id);
  if(!orig) return;
  const x = structuredClone(orig);
  const groupEntity = x.groupId ? GROUPS.find(group => group.vaultId === x.vaultId && group.id === x.groupId) : null;
  if(groupEntity){
    x.groupLabel = groupEntity.label ?? x.groupLabel;
    x.groupStem = groupEntity.stem ?? x.groupStem;
    x.groupBbox = groupEntity.bbox ?? x.groupBbox;
    x.groupFig = groupEntity.figure ?? x.groupFig;
    x.groupFigures = groupEntity.figures ?? x.groupFigures;
  }

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Sửa câu hỏi">
    <div class="modal-head">
      <h3>${x.groupId ? `Sửa nhóm câu · câu ${x.groupOrder || ""}/${x.groupSize || ""}` : "Sửa câu hỏi"}</h3>
      <span class="chip ${CLS2[x.type]}" id="edKind">${TYPES[x.type]}</span>
      <div class="grow"></div>
      <span class="muted" style="font-size:12.5px">Esc đóng</span>
      <button class="btn btn-ghost" type="button" data-x>Đóng</button>
    </div>
    <div class="modal-body">
      <div class="ed-left" id="edLeft"></div>
      <div class="ed-right">
        <span class="cap">Xem trước — đúng như khi in ra</span>
        <div class="sheet" id="edLive"></div>
        <p class="hint" style="margin-top:auto">
          Đúng công thức hiển thị ở đây thì đúng công thức trong file Word xuất ra.</p>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-danger" type="button" id="edDel">Xoá câu này</button>
      <div class="grow"></div>
      <button class="btn" type="button" data-x>Huỷ</button>
      <button class="btn btn-primary" type="button" id="edSave">Lưu</button>
    </div></div>`;
  document.body.appendChild(scrim);

  const left = $("#edLeft", scrim);

  function live(){
    const g = normFig(x.fig);
    let h = x.groupId ? `<div class="group-context"><div class="group-title">${esc(x.groupLabel || "Dữ liệu dùng chung")}</div>
      <div>${tex(x.groupStem || "")}</div>${figHtml(x.groupFig,"fg")}</div>` : "";
    h += (g?.place === "right" || g?.place === "left" ? figHtml(x.fig,"fg") : "") +
      `<b style="display:inline">Câu 1.</b> ${tex(x.stem)}` + figAt(x.fig,"top","fg");
    if(x.type === "MC" && x.ch){
      h += `<div class="ch">${x.ch.map((c,i)=>
        `<div ${i===x.ans?'style="color:#1B7350;font-weight:700"':""}>
          <b style="display:inline">${chLabel(x,i)}.</b> ${tex(c)}</div>`).join("")}</div>`;
    }
    if(x.type === "TF" && x.tf){
      h += x.tf.map(([t,v,why],i)=>
        `<div style="margin-left:14px">${TFIDX[i]}) ${tex(t)}
         <b style="display:inline;color:${v===true?"#1B7350":v===false?"#8c3a30":"#78818d"}">${v===true?"Đ":v===false?"S":"—"}</b>
         ${why ? `<div style="margin-left:14px;font-size:.92em;color:#5a6672">${tex(why)}</div>` : ""}</div>`).join("");
    }
    if(x.type === "SHORT" && x.sa){
      h += `<div style="margin-top:6px">Đáp án: <b style="display:inline">${
        esc(x.sa.value)} ${esc(x.sa.unit)}</b> <span class="ph">±${esc(x.sa.tol)}</span></div>`;
    }
    h += figAt(x.fig,"below","fg");
    if(x.sol) h += `<div class="sol"><b style="display:inline">Lời giải.</b> ${tex(x.sol)}</div>`;
    $("#edLive", scrim).innerHTML = h;
    $("#edKind", scrim).className = "chip " + CLS2[x.type];
    $("#edKind", scrim).textContent = TYPES[x.type];
  }

  /* Ba TAB thay vì một cột dài.
     Trước đây đề bài, phương án, lời giải, hình và nhãn xếp dọc một cột — sửa
     cỡ hình phải lăn chuột xuống tận đáy rồi lăn ngược lên xem kết quả. Giáo
     viên sửa 40 câu một buổi thì đó là 80 lần lăn chuột vô ích. */
  let tab = "noidung";

  function build(){
    blankFor(x.type, x);

    const TABS = [["noidung","Nội dung"], ["hinh","Hình vẽ"], ["nhan","Nhãn"]];
    let h = `<div class="edtabs" role="tablist">${TABS.map(([k,v]) => {
      const mark = k === "hinh" && (hasFig(x) || x.figNote) ? ' <span class="tabdot"></span>' : "";
      return `<button type="button" role="tab" data-tab="${k}"
        aria-selected="${tab===k}">${v}${mark}</button>`;
    }).join("")}</div>`;

    if(tab === "noidung"){
      h += `<div>
        <span class="lbl">Dạng câu</span>
        <div class="seg" role="group" aria-label="Dạng câu">${
          Object.entries(TYPES).map(([k,v]) =>
            `<button type="button" data-type="${k}" aria-pressed="${x.type===k}">${v}</button>`).join("")
        }</div>
        <p class="hint">Đổi dạng giữ nguyên đề bài, chỉ đổi phần đáp án bên dưới.</p>
      </div>

      ${x.groupId ? `<div class="group-context">
        <div class="group-title">Biên tập cụm câu hỏi như một khối</div>
        <label><span class="lbl">Nhãn cụm câu hỏi</span>
          <input type="text" id="eGroupLabel" value="${esc(x.groupLabel || "")}" placeholder="Dựa vào dữ liệu sau để trả lời các câu..."></label>
        <label><span class="lbl">Dữ liệu dùng chung</span>
          <textarea id="eGroupStem" rows="4">${esc(x.groupStem || "")}</textarea></label>
        <div class="group-members">${BANK.filter(q => q.vaultId === x.vaultId && q.groupId === x.groupId)
          .sort((a,b) => (a.groupOrder || 0) - (b.groupOrder || 0))
          .map(q => `<span class="chip ${q.id === x.id ? "acc" : ""}">Câu ${q.groupOrder || "?"}: ${esc(plain(q.stem).trim().slice(0,42))}</span>`).join("")}</div>
        <span class="hint">Nguồn chung: ${esc(groupEntity?.source || x.src)} · sửa dữ liệu ở đây cập nhật toàn bộ ${x.groupSize || ""} câu trong nhóm.</span>
      </div>` : ""}

      <label>
        <span class="lbl">Đề bài</span>
        <textarea id="eStem" rows="4">${esc(x.stem)}</textarea>
        <span class="hint">Công thức bọc trong <code>$…$</code> ·
          dấu thập phân viết <code>$0{,}5$</code></span>
      </label>`;

      if(x.type === "MC"){
        h += `<div>
          <span class="lbl">Bốn phương án — chấm tròn là đáp án đúng</span>
          ${x.ch.map((c,i)=>`
            <div class="optline">
              <button class="pick" type="button" data-ans="${i}" aria-pressed="${x.ans===i}"
                      aria-label="Đáp án đúng là ${chLabel(x,i)}"></button>
              <b>${chLabel(x,i)}.</b>
              <input type="text" data-ch="${i}" value="${esc(c)}" style="font-family:var(--mono);font-size:13.5px">
            </div>`).join("")}
        </div>`;
      }

      if(x.type === "TF"){
        /* Mỗi ý một đáp án RIÊNG, và một ô giải thích riêng. Câu đúng/sai chấm
           theo từng ý (1 ý 0,1đ — 4 ý 1,0đ) nên học sinh hỏi "vì sao ý c sai"
           là chuyện thường; một ô lời giải chung không trả lời được. */
        h += `<div>
          <span class="lbl">Bốn ý — mỗi ý một đáp án và một lời giải riêng</span>
          ${x.tf.map(([txt,v,why],i)=>`
            <div class="tfcard${v === true ? " isT" : v === false ? " isF" : ""}">
              <div class="tfhead">
                <b>${TFIDX[i]})</b>
                <textarea data-tf="${i}" rows="1" placeholder="Nội dung ý ${TFIDX[i]}">${esc(txt)}</textarea>
                <div class="seg" role="group" aria-label="Đáp án ý ${TFIDX[i]}">
                  <button type="button" data-tfv="${i}.1" aria-pressed="${v}">Đúng</button>
                  <button type="button" data-tfv="${i}.0" aria-pressed="${v === false}">Sai</button>
                  <button type="button" data-tfv="${i}.x" aria-pressed="${v == null}">Chưa có</button>
                </div>
              </div>
              <input type="text" class="tfwhy" data-tfw="${i}" value="${esc(why ?? "")}"
                     placeholder="Lời giải in sẵn hoặc ghi chú của giáo viên">
            </div>`).join("")}
        </div>`;
      }

      if(x.type === "SHORT"){
        h += `<div class="grid3">
          <label><span class="lbl">Giá trị</span>
            <input type="text" id="saV" value="${esc(x.sa.value)}" placeholder="62,8"></label>
          <label><span class="lbl">Đơn vị</span>
            <input type="text" id="saU" value="${esc(x.sa.unit)}" placeholder="cm/s"></label>
          <label><span class="lbl">Sai số ±</span>
            <input type="text" id="saT" value="${esc(x.sa.tol)}" placeholder="0,2"></label>
        </div>`;
      }

      h += `<label>
        <span class="lbl">Lời giải${x.type === "TF" ? " chung (ngoài phần giải thích từng ý)" : ""}</span>
        <textarea id="eSol" rows="3" placeholder="Để trống nếu chưa có">${esc(x.sol||"")}</textarea>
      </label>`;
    }

    if(tab === "hinh") h += figEditorHtml(x);

    if(tab === "nhan"){
      h += `<div class="grid2">
        <label><span class="lbl">Độ khó</span><select id="eDiff">${
          DIFFS.map(d=>`<option value="${d}" ${d===x.diff?"selected":""}>${d} — ${DNAME[d]}</option>`).join("")
        }</select></label>
        <label><span class="lbl">Lớp</span><select id="eGrade">${
          [10,11,12].map(g=>`<option value="${g}" ${g===x.grade?"selected":""}>Lớp ${g}</option>`).join("")
        }</select></label>
      </div>
      <div class="grid2">
        <label><span class="lbl">Chuyên đề</span><select id="eTopic">${
          topicsOf(x.subject).map(([k,v])=>
            `<option value="${k}" ${k===x.topic?"selected":""}>${v}</option>`).join("")
        }</select></label>
        <label><span class="lbl">Nguồn</span>
          <input type="text" id="eSrc" value="${esc(x.src)}" placeholder="ví dụ: Ninh Bình 2024"></label>
      </div>

      ${x.ai ? '<p class="hint">Nguồn này do AI đoán. Sửa tay một lần là nhãn đó biến mất.</p>' : ""}
      ${x.answerSource === "none"
        ? '<div class="sourcehint">Tài liệu không in đáp án. Hệ thống giữ trống, không dùng AI tự giải.</div>'
        : ""}`;
    }

    left.innerHTML = h;

    /* Mỗi tab chỉ dựng phần của nó, nên phải nối dây kiểu "có thì nối" —
       gọi thẳng $("#eStem") ở tab Hình là ném lỗi ngay. */
    const on = (sel, ev, fn) => { const el = $(sel, left); if(el) el.addEventListener(ev, fn); };

    $$("[data-tab]", left).forEach(b => b.addEventListener("click", () => {
      tab = b.dataset.tab; build();
    }));

    on("#eStem","input", e => { x.stem = e.target.value; live(); });
    on("#eGroupStem","input", e => { x.groupStem = e.target.value; live(); });
    on("#eGroupLabel","input", e => { x.groupLabel = e.target.value; live(); });
    on("#eSol","input",  e => { x.sol  = e.target.value; live(); });
    on("#eDiff","change",e => { x.diff = e.target.value; });
    on("#eGrade","change",e=> { x.grade = +e.target.value; });
    on("#eTopic","change",e=> { x.topic = e.target.value; });
    on("#eSrc","input",  e => { x.src  = e.target.value; });

    /* ── hình: cỡ, vị trí, thay, bỏ ── */
    const setFig = (patch) => {
      x.fig = { ...(normFig(x.fig) ?? { src:null, width:45, place:"top" }), ...patch };
      build(); live();
    };
    $$("[data-figw]",left).forEach(el => el.addEventListener("input", e => {
      // Kéo thanh trượt thì cập nhật tại chỗ, KHÔNG dựng lại cả khối —
      // dựng lại là con trỏ chuột rời khỏi thanh trượt, kéo được đúng một nấc.
      const w = +e.target.value;
      x.fig = { ...normFig(x.fig), width:w };
      const p = $(".figprev", left);
      if(p) p.style.width = w + "%";
      const lab = e.target.previousElementSibling;
      if(lab) lab.textContent = `Cỡ hình — ${w}% bề ngang cột chữ`;
      live();
    }));
    $$("[data-figp]",left).forEach(el =>
      el.addEventListener("change", e => setFig({ place:e.target.value })));
    $$("[data-figdel]",left).forEach(b =>
      b.addEventListener("click", () => { x.fig = null; build(); live(); }));
    $$("[data-figadd]",left).forEach(b =>
      b.addEventListener("click", () => pickBuiltinFig(k => setFig({ src:k }))));
    $$("[data-figfile]",left).forEach(inp =>
      inp.addEventListener("change", e => {
        const f = e.target.files?.[0];
        if(!f) return;
        // Ảnh nhét thẳng vào localStorage/JSON nên phải chặn file to, không thì
        // một ảnh 8MB làm treo cả kho.
        if(f.size > 2_000_000){
          toast("Ảnh nặng quá 2MB — nén lại rồi tải lên nhé");
          return;
        }
        const fr = new FileReader();
        fr.onload = () => setFig({ src:String(fr.result) });
        fr.readAsDataURL(f);
      }));

    $$("[data-ch]",left).forEach(t =>
      t.addEventListener("input", e => { x.ch[+e.target.dataset.ch] = e.target.value; live(); }));
    $$("[data-ans]",left).forEach(r =>
      r.addEventListener("click", e => {
        x.ans = +e.currentTarget.dataset.ans;
        $$("[data-ans]",left).forEach(o =>
          o.setAttribute("aria-pressed", +o.dataset.ans === x.ans ? "true" : "false"));
        live();
      }));
    $$("[data-tf]",left).forEach(t =>
      t.addEventListener("input", e => { x.tf[+e.target.dataset.tf][0] = e.target.value; live(); }));
    $$("[data-tfv]",left).forEach(b =>
      b.addEventListener("click", e => {
        const [i,v] = e.currentTarget.dataset.tfv.split(".");
        x.tf[+i][1] = v === "x" ? null : v === "1";
        build(); live();
      }));
    $$("[data-tfw]",left).forEach(el =>
      el.addEventListener("input", e => { x.tf[+e.target.dataset.tfw][2] = e.target.value; live(); }));
    ["saV","saU","saT"].forEach((id,k) => {
      const el = $("#"+id,left);
      if(el) el.addEventListener("input", e => {
        x.sa[["value","unit","tol"][k]] = e.target.value; live();
      });
    });
    $$("[data-type]",left).forEach(b =>
      b.addEventListener("click", e => {
        x.type = e.currentTarget.dataset.type;
        build(); live();
      }));
  }

  const onKey = (e) => { if(e.key === "Escape") close(); };
  function close(){ scrim.remove(); document.removeEventListener("keydown", onKey); }
  $$("[data-x]", scrim).forEach(b => b.addEventListener("click", close));
  scrim.addEventListener("click", e => { if(e.target === scrim) close(); });
  document.addEventListener("keydown", onKey);

  $("#edSave", scrim).addEventListener("click", () => {
    if(x.src.trim() && x.src.trim() !== orig.src){ x.ai = false; }
    if(x.groupId){
      for(const peer of BANK.filter(q => q.vaultId === x.vaultId && q.groupId === x.groupId && q.id !== orig.id)){
        peer.groupLabel = x.groupLabel;
        peer.groupStem = x.groupStem;
        peer.groupBbox = x.groupBbox ? structuredClone(x.groupBbox) : null;
        peer.groupFig = x.groupFig ? structuredClone(x.groupFig) : null;
        peer.groupFigures = Array.isArray(x.groupFigures) ? structuredClone(x.groupFigures) : [];
        peer.groupFigNote = x.groupFigNote ?? null;
      }
      const entity = GROUPS.find(group => group.vaultId === x.vaultId && group.id === x.groupId);
      if(entity) Object.assign(entity, {
        label:x.groupLabel || null, stem:x.groupStem || "",
        bbox:x.groupBbox ? structuredClone(x.groupBbox) : null,
        figure:x.groupFig ? structuredClone(x.groupFig) : null,
        figures:Array.isArray(x.groupFigures) ? structuredClone(x.groupFigures) : [],
        questionIds:BANK.filter(q => q.vaultId === x.vaultId && q.groupId === x.groupId).map(q => q.id),
      });
    }
    Object.assign(orig, x);
    close(); paintFacets(); paintKho(); paintCanvas(); renderSheet();
    toast("Đã lưu câu hỏi");
  });
  $("#edDel", scrim).addEventListener("click", () => { close(); removeQuestion(orig); });

  build(); live();
}

/* ══════════════════════════════════════════════════ sửa đầu đề ══ */

function miniSheet(t, h){
  if(t === "gon")
    return `<div style="border-bottom:1px solid;padding-bottom:2px"><b>${esc(h.school)}</b> —
            ${esc(h.title)} · ${esc(h.subject)} · ${h.duration}′</div><div>Câu 1. …</div>`;
  if(t === "logo")
    return `<div style="display:flex;gap:4px;align-items:center;border-bottom:1px solid;padding-bottom:3px">
            <span style="width:14px;height:14px;border:1px solid;border-radius:50%"></span>
            <span><b>${esc(h.school)}</b><br>${esc(h.title)}</span></div><div>Câu 1. …</div>`;
  return `<div style="display:flex;justify-content:space-between;border-bottom:1px solid;padding-bottom:3px">
          <span>${esc(h.org)}<br><b>${esc(h.school)}</b></span>
          <span style="text-align:right"><b>${esc(h.title)}</b><br>${esc(h.subject)}</span></div>
          <div>Câu 1. …</div>`;
}

function openHeaderEditor(){
  const h = { ...header };
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal narrow" role="dialog" aria-modal="true" aria-label="Sửa đầu đề">
    <div class="modal-head"><h3>Đầu đề</h3><div class="grow"></div>
      <button class="btn btn-ghost" type="button" data-x>Đóng</button></div>
    <div class="modal-body one"><div class="ed-left" id="hdBody" style="border-right:0"></div></div>
    <div class="modal-foot"><div class="grow"></div>
      <button class="btn" type="button" data-x>Huỷ</button>
      <button class="btn btn-primary" type="button" id="hdSave">Lưu đầu đề</button></div></div>`;
  document.body.appendChild(scrim);

  function build(){
    $("#hdBody", scrim).innerHTML = `
      <div>
        <span class="lbl">Chọn mẫu</span>
        <div class="tmpl-grid">${HEADER_TEMPLATES.map(t=>`
          <button class="tmpl" type="button" data-t="${t.id}" aria-pressed="${h.tmpl===t.id}">
            <div class="mini-sheet">${miniSheet(t.id,h)}</div>
            <div class="nm">${t.name}</div>
            <div class="muted" style="font-size:12px">${t.desc}</div>
          </button>`).join("")}</div>
      </div>

      <div class="grid2">
        <label><span class="lbl">Cơ quan chủ quản</span>
          <input type="text" data-h="org" value="${esc(h.org)}"></label>
        <label><span class="lbl">Trường / trung tâm</span>
          <input type="text" data-h="school" value="${esc(h.school)}"></label>
      </div>
      <div class="grid2">
        <label><span class="lbl">Tên bài kiểm tra</span>
          <input type="text" data-h="title" value="${esc(h.title)}"></label>
        <label><span class="lbl">Môn và lớp</span>
          <input type="text" data-h="subject" value="${esc(h.subject)}"></label>
      </div>
      <div class="grid3">
        <label><span class="lbl">Thời gian (phút)</span>
          <input type="number" data-h="duration" value="${h.duration}"></label>
        <label><span class="lbl">Mã đề</span>
          <input type="text" data-h="code" value="${esc(h.code)}"></label>
        <label><span class="lbl">Năm học</span>
          <input type="text" data-h="year" value="${esc(h.year)}"></label>
      </div>

      <label class="checkrow"><input type="checkbox" data-hb="showCode" ${h.showCode?"checked":""} class="sr-only">
        <span class="ck" aria-hidden="true">${TICK}</span>
        <span><b>Hiện mã đề</b><span>Tắt khi đề chỉ có một phiên bản</span></span></label>
      <label class="checkrow"><input type="checkbox" data-hb="showId" ${h.showId?"checked":""} class="sr-only">
        <span class="ck" aria-hidden="true">${TICK}</span>
        <span><b>Dòng họ tên — lớp — số báo danh</b><span>In sẵn để học sinh điền</span></span></label>
      <label class="checkrow"><input type="checkbox" data-hb="showPage" ${h.showPage?"checked":""} class="sr-only">
        <span class="ck" aria-hidden="true">${TICK}</span>
        <span><b>Đánh số trang “Trang 1/4”</b><span>Cần khi đề dài nhiều tờ</span></span></label>`;

    $$("[data-t]", scrim).forEach(b => b.addEventListener("click", () => {
      h.tmpl = b.dataset.t; build();
    }));
    $$("[data-h]", scrim).forEach(i => i.addEventListener("input", e => {
      h[e.target.dataset.h] = e.target.type === "number" ? +e.target.value : e.target.value;
      $$(".mini-sheet", scrim).forEach((m,k) => {
        m.innerHTML = miniSheet(HEADER_TEMPLATES[k].id, h);
      });
    }));
    $$("[data-hb]", scrim).forEach(i => i.addEventListener("change", e => {
      h[e.target.dataset.hb] = e.target.checked;
    }));
  }

  const onKey = (e) => { if(e.key === "Escape") close(); };
  function close(){ scrim.remove(); document.removeEventListener("keydown", onKey); }
  $$("[data-x]", scrim).forEach(b => b.addEventListener("click", close));
  scrim.addEventListener("click", e => { if(e.target === scrim) close(); });
  document.addEventListener("keydown", onKey);
  $("#hdSave", scrim).addEventListener("click", () => {
    header = h; close(); paintCanvas(); renderSheet(); toast("Đã cập nhật đầu đề");
  });

  build();
}

/* ══════════════════════════════════════════════ trình bày trang in ══ */
/* Logo trường, watermark chống lộ đề, lề và cỡ chữ. Toàn thứ giáo viên phải
   chỉnh tay trong Word sau khi xuất — chỉnh sẵn ở đây thì file tải về là dùng
   được luôn. Lề tính bằng cm cho khớp hộp Page Setup của Word. */

function openLayoutEditorLegacy(){
  const L = { ...layout };
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Trình bày trang in">
    <div class="modal-head"><h3>Trình bày trang in</h3>
      <div class="grow"></div>
      <button class="btn btn-ghost" type="button" data-x>Đóng</button></div>
    <div class="modal-body">
      <div class="ed-left" id="lyBody"></div>
      <div class="ed-right">
        <span class="cap">Xem trước</span>
        <div id="lyPrev"></div>
        <p class="hint" style="margin-top:auto">Lề và cỡ chữ đi thẳng vào file Word xuất ra.
          Watermark chỉ in mờ phía sau chữ, không che nội dung.</p>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-danger" type="button" id="lyReset">Về mặc định</button>
      <div class="grow"></div>
      <button class="btn" type="button" data-x>Huỷ</button>
      <button class="btn btn-primary" type="button" id="lySave">Lưu</button>
    </div></div>`;
  document.body.appendChild(scrim);

  const locked = plan.id === "lite";   // gói Lite: mở logo, khoá watermark

  function prev(){
    const sheet = document.createElement("div");
    sheet.className = `sheet qstyle-${L.questionStyle || "classic"}`;
    sheet.style.cssText = paperStyle(L);
    const sample = L.questionStyle === "classic"
      ? `<div class="q"><b style="display:inline">Câu 1.</b> Một con lắc lò xo có độ cứng
         ${tex("$k = 40\\,\\mathrm{N/m}$")}. Tần số góc bằng
         <div class="ch"><div><b style="display:inline">A.</b> 20 rad/s</div>
         <div><b style="display:inline">B.</b> 200 rad/s</div></div></div>`
      : `<div class="q qcard"><div class="qcard-head"><b>Câu 1.</b><em>Trắc nghiệm nhiều lựa chọn</em></div>
         <div class="qcard-stem">Một con lắc lò xo có độ cứng ${tex("$k = 40\\,\\mathrm{N/m}$")}. Tần số góc bằng</div>
         <div class="answer-options"><div class="answer-option"><span>A</span><div>20 rad/s</div></div>
         <div class="answer-option correct"><span>B</span><div>200 rad/s</div><b>✓</b></div></div></div>`;
    sheet.innerHTML = watermarkHtml(L) + headerHtml(L) + `<h5>PHẦN I. TRẮC NGHIỆM</h5>${sample}`;
    const box = $("#lyPrev", scrim);
    box.innerHTML = "";
    box.appendChild(sheet);
  }

  function build(){
    $("#lyBody", scrim).innerHTML = `
      <div>
        <span class="lbl">Lề trang (cm)</span>
        <div class="grid2" style="gap:8px">
          ${[["marginTop","Trên"],["marginBottom","Dưới"],
             ["marginLeft","Trái"],["marginRight","Phải"]].map(([k,n]) =>
            `<label style="display:flex;align-items:center;gap:8px">
              <span style="width:36px;font-size:13px;color:var(--ink-3)">${n}</span>
              <input type="number" min="0.5" max="5" step="0.25" value="${L[k]}" data-ly="${k}">
            </label>`).join("")}
        </div>
        <p class="hint">Quy định phổ biến: trái 3cm để đóng gáy, ba lề còn lại 2cm.</p>
      </div>

      <div class="grid2">
        <label><span class="lbl">Cỡ chữ (pt)</span>
          <select data-ly="fontSize">${[11,12,13,14].map(v =>
            `<option value="${v}" ${v===L.fontSize?"selected":""}>${v} pt</option>`).join("")}</select></label>
        <label><span class="lbl">Giãn dòng</span>
          <select data-ly="lineGap">${[["1","Đơn"],["1.15","1,15"],["1.5","1,5"]].map(([v,n]) =>
            `<option value="${v}" ${+v===+L.lineGap?"selected":""}>${n}</option>`).join("")}</select></label>
      </div>

      <label><span class="lbl">Style form câu hỏi</span>
        <select data-ly="questionStyle">
          ${[["classic","Tối giản — đề thi chuẩn"],["exam-blue","Exam Blue — form đáp án xanh"],
             ["specialist-pink","Chuyên Toán — khung hồng"],["logic-green","ĐGNL Logic — cụm dữ liệu xanh"]]
            .map(([v,n]) => `<option value="${v}" ${L.questionStyle===v?"selected":""}>${n}</option>`).join("")}
        </select>
        <span class="hint">Đổi cấu trúc ô trả lời, bảng Đúng/Sai và khung cụm dữ liệu trong preview lẫn Word.</span>
      </label>

      <div>
        <span class="lbl">Logo trường</span>
        <div class="figedit-acts">
          ${L.logo ? `<span class="logoprev"><img src="${esc(L.logo)}" alt=""></span>` : ""}
          <label class="btn btn-sm" style="cursor:pointer">${L.logo ? "Thay logo" : "Tải logo lên"}
            <input type="file" accept="image/*" data-lylogo hidden></label>
          ${L.logo ? '<button class="btn btn-sm btn-danger" type="button" data-lylogodel>Bỏ logo</button>' : ""}
        </div>
        ${L.logo ? `<label style="margin-top:8px"><span class="lbl">Cỡ logo — ${L.logoSize}px</span>
          <input type="range" min="28" max="80" step="2" value="${L.logoSize}" data-ly="logoSize"></label>` : ""}
        <p class="hint">Logo hiện ở góc trái đầu đề. Mẫu “Có logo” dùng đúng ảnh này.</p>
      </div>

      <div${locked ? ' class="lockedbox"' : ""}>
        <span class="lbl">Watermark ${locked ? `<span style="color:var(--warn)">· gói ${plan.name} chưa mở</span>` : ""}</span>
        <input type="text" value="${esc(L.watermark)}" data-ly="watermark"
          placeholder="ví dụ: LƯU HÀNH NỘI BỘ" ${locked ? "disabled" : ""}>
        <div class="grid2" style="margin-top:8px">
          <label><span class="lbl">Độ đậm — ${L.watermarkOpacity}%</span>
            <input type="range" min="3" max="25" step="1" value="${L.watermarkOpacity}"
              data-ly="watermarkOpacity" ${locked ? "disabled" : ""}></label>
          <label><span class="lbl">Nghiêng — ${L.watermarkAngle}°</span>
            <input type="range" min="-60" max="60" step="5" value="${L.watermarkAngle}"
              data-ly="watermarkAngle" ${locked ? "disabled" : ""}></label>
        </div>
        <p class="hint">Chữ mờ in chìm sau nội dung. Để trống là tắt.</p>
      </div>`;

    $$("[data-ly]", scrim).forEach(el => {
      const k = el.dataset.ly;
      const ev = el.type === "range" ? "input" : "change";
      el.addEventListener(ev, e => {
        L[k] = el.type === "number" || el.type === "range" || k === "fontSize" || k === "lineGap"
          ? +e.target.value : e.target.value;
        if(el.type === "range"){
          const lab = el.previousElementSibling;
          if(lab && k === "watermarkOpacity") lab.textContent = `Độ đậm — ${L[k]}%`;
          if(lab && k === "watermarkAngle") lab.textContent = `Nghiêng — ${L[k]}°`;
          if(lab && k === "logoSize") lab.textContent = `Cỡ logo — ${L[k]}px`;
          prev();
        } else { build(); prev(); }
      });
    });
    $$("[data-lylogo]", scrim).forEach(inp => inp.addEventListener("change", e => {
      const f = e.target.files?.[0];
      if(!f) return;
      if(f.size > 1_000_000){ toast("Logo nên dưới 1MB"); return; }
      const fr = new FileReader();
      fr.onload = () => { L.logo = String(fr.result); build(); prev(); };
      fr.readAsDataURL(f);
    }));
    $$("[data-lylogodel]", scrim).forEach(b =>
      b.addEventListener("click", () => { L.logo = null; build(); prev(); }));
  }

  const onKey = (e) => { if(e.key === "Escape") close(); };
  function close(){ scrim.remove(); document.removeEventListener("keydown", onKey); }
  $$("[data-x]", scrim).forEach(b => b.addEventListener("click", close));
  scrim.addEventListener("click", e => { if(e.target === scrim) close(); });
  document.addEventListener("keydown", onKey);
  $("#lyReset", scrim).addEventListener("click", () => {
    Object.assign(L, DEFAULT_LAYOUT); build(); prev();
  });
  $("#lySave", scrim).addEventListener("click", () => {
    layout = L; close(); renderSheet(); toast("Đã cập nhật trình bày trang in");
  });

  build(); prev();
}

/** Preset editor v1: import reference, chỉnh một lần và áp cho đủ bốn dạng câu. */
function openLayoutEditor(){
  const L = { ...DEFAULT_LAYOUT, ...structuredClone(layout) };
  const H = { ...header };
  let selectedPresetId = activePresetId;
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = '<div class="modal preset-modal" role="dialog" aria-modal="true" aria-label="Preset trình bày">' +
    '<div class="modal-head"><h3>Preset trình bày</h3><div class="grow"></div><button class="btn btn-ghost" type="button" data-x>Đóng</button></div>' +
    '<div class="modal-body"><div class="ed-left" id="lyBody"></div><div class="ed-right">' +
    '<span class="cap">Preview đủ 4 dạng</span><div id="lyPrev"></div>' +
    '<p class="hint" style="margin-top:auto">Ảnh/PDF mẫu là reference để lấy palette và đối chiếu. Nội dung Word vẫn sửa được.</p></div></div>' +
    '<div class="modal-foot"><button class="btn btn-danger" type="button" id="lyReset">Về mặc định</button>' +
    '<button class="btn" type="button" id="lySavePreset">Lưu preset</button><div class="grow"></div>' +
    '<button class="btn" type="button" data-x>Huỷ</button><button class="btn btn-primary" type="button" id="lySave">Áp dụng</button></div></div>';
  document.body.appendChild(scrim);
  const locked = plan.id === "lite";
  const optionHtml = (items,current) => items.map(item => {
    const value = Array.isArray(item) ? item[0] : item;
    const name = Array.isArray(item) ? item[1] : item;
    return '<option value="' + esc(value) + '" ' + (String(current)===String(value)?"selected":"") + '>' + esc(name) + '</option>';
  }).join("");
  const samples = [
    {type:"MC",stem:"Một con lắc có độ cứng $k=40\\,\\mathrm{N/m}$. Tần số góc bằng",ch:["20 rad/s","200 rad/s","2 rad/s","40 rad/s"],ans:1},
    {type:"TF",stem:"Xét tính đúng sai của các phát biểu sau.",tf:[["Hàm số xác định trên $\\mathbb R$",true],["Hàm số đồng biến trên toàn bộ $\\mathbb R$",false]]},
    {type:"SHORT",stem:"Ghi số 2026 vào ô trả lời.",sa:{value:"2026",unit:""}},
    {type:"ESSAY",stem:"Trình bày lời giải chi tiết cho bài toán.",sol:""}
  ];
  function preview(){
    const sheet = document.createElement("div");
    sheet.className = "sheet qstyle-" + (L.questionStyle || "classic");
    sheet.style.cssText = paperStyle(L);
    const sample = samples.map((q,i)=>questionHtmlForLayout(q,i+1,false,L)).join("");
    sheet.innerHTML = watermarkHtml(L) + headerHtml(L,H) + extraLayoutHtml("top",L) +
      sectionHeadingHtml("MẪU CÁC DẠNG CÂU",L) + sample + extraLayoutHtml("bottom",L);
    const box = $("#lyPrev",scrim); box.innerHTML = ""; box.appendChild(sheet);
  }
  const imageControl = (key,label) => '<div><span class="lbl">'+label+'</span>' +
    (L[key] ? '<span class="logoprev wide"><img src="'+esc(L[key])+'" alt=""></span><button class="btn btn-sm btn-danger" type="button" data-clear-image="'+key+'">Bỏ ảnh</button>' : '') +
    '<label class="btn btn-sm" style="cursor:pointer">'+(L[key]?"Thay ảnh":"Thêm ảnh")+'<input type="file" accept="image/*" data-layout-image="'+key+'" hidden></label></div>';
  function build(){
    const systemOptions = BUILTIN_LAYOUT_PRESETS.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===selectedPresetId?"selected":"")+'>Hệ thống · '+esc(p.name)+'</option>').join("");
    const presetOptions = PRESETS.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===selectedPresetId?"selected":"")+'>'+esc(p.name)+'</option>').join("");
    const reference = L.referenceAsset
      ? '<img src="'+esc(L.referenceAsset)+'" alt="Format tham chiếu"><div><b>'+esc(L.referenceName||"Format mẫu")+'</b><p class="hint">Đã lấy palette; ảnh chỉ dùng đối chiếu.</p>' +
        '<button class="btn btn-sm" type="button" data-use-ref="top">Đặt phía trên</button> <button class="btn btn-sm" type="button" data-use-ref="bottom">Đặt phía dưới</button></div>'
      : '<div class="reference-empty">Chưa có mẫu tham chiếu</div>';
    $("#lyBody",scrim).innerHTML =
      '<div class="preset-panel"><div class="grid2"><label><span class="lbl">Preset trong Kho</span><select id="lyPresetSelect"><option value="">Bản đang chỉnh</option>'+systemOptions+presetOptions+'</select></label>' +
      '<label><span class="lbl">Tên preset</span><input type="text" data-ly="presetName" value="'+esc(L.presetName||"Mẫu riêng")+'" maxlength="80"></label></div>' +
      '<span class="lbl">Format tham chiếu</span><div class="reference-row">'+reference+'<label class="btn btn-sm" style="cursor:pointer">'+(L.referenceAsset?"Đổi mẫu":"Tải ảnh/PDF mẫu") +
      '<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" data-lyreference hidden></label></div></div>' +
      '<div><span class="lbl">Đầu đề</span><div class="grid2">' +
      '<label>Đơn vị<input type="text" data-hlayout="org" value="'+esc(H.org||"")+'"></label>' +
      '<label>Trường / tổ chức<input type="text" data-hlayout="school" value="'+esc(H.school||"")+'"></label>' +
      '<label>Tên đề<input type="text" data-hlayout="title" value="'+esc(H.title||"")+'"></label>' +
      '<label>Môn / bài thi<input type="text" data-hlayout="subject" value="'+esc(H.subject||"")+'"></label>' +
      '<label>Thời gian (phút)<input type="number" min="1" max="600" data-hlayout="duration" value="'+Number(H.duration||90)+'"></label>' +
      '<label>Mã đề<input type="text" data-hlayout="code" value="'+esc(H.code||"")+'"></label></div>' +
      '<div class="grid2"><label>In mã đề<select data-hbool="showCode">'+optionHtml([[true,"Có"],[false,"Không"]],H.showCode)+'</select></label>' +
      '<label>Dòng họ tên / SBD<select data-hbool="showId">'+optionHtml([[true,"Có"],[false,"Không"]],H.showId)+'</select></label></div></div>' +
      '<div><span class="lbl">Lề trang (cm)</span><div class="grid2">' +
      [["marginTop","Trên"],["marginBottom","Dưới"],["marginLeft","Trái"],["marginRight","Phải"]].map(row =>
        '<label class="compact-field"><span>'+row[1]+'</span><input type="number" min=".5" max="5" step=".25" data-ly="'+row[0]+'" value="'+L[row[0]]+'"></label>').join("") + '</div></div>' +
      '<div class="grid2"><label><span class="lbl">Font chữ</span><select data-ly="fontFamily">'+optionHtml([["legacy","Times / Legacy"],["latex","Latin Modern / LaTeX"],["sans","Sans hiện đại"]],L.fontFamily)+'</select></label>' +
      '<label><span class="lbl">Cỡ chữ</span><select data-ly="fontSize">'+optionHtml([11,12,13,14],L.fontSize)+'</select></label>' +
      '<label><span class="lbl">Giãn dòng</span><select data-ly="lineGap">'+optionHtml([1,1.15,1.32,1.5],L.lineGap)+'</select></label>' +
      '<label><span class="lbl">Cột trang</span><select data-ly="columns">'+optionHtml([[1,"1 cột"],[2,"2 cột"]],L.columns)+'</select></label></div>' +
      '<label><span class="lbl">Form câu hỏi</span><select data-ly="questionStyle">'+optionHtml([["classic","Tối giản"],["exam-blue","Exam Blue"],["specialist-pink","Chuyên Toán"],["logic-green","ĐGNL Logic"],["custom","Mẫu riêng"]],L.questionStyle)+'</select></label>' +
      '<div><span class="lbl">Bảng màu dùng chung mọi dạng</span><div class="grid3 color-grid">' +
      '<label>Màu chính<input type="color" data-ly="accentColor" value="'+esc(L.accentColor)+'"></label>' +
      '<label>Nền nhạt<input type="color" data-ly="accentSoft" value="'+esc(L.accentSoft)+'"></label>' +
      '<label>Viền<input type="color" data-ly="borderColor" value="'+esc(L.borderColor)+'"></label></div>' +
      '<label><span class="lbl">Tiêu đề phần</span><select data-ly="sectionHeading">'+optionHtml([["plain","Chữ thường"],["bar","Thanh màu"],["outline","Khung viền"]],L.sectionHeading)+'</select></label></div>' +
      '<div><span class="lbl">Form trả lời</span><div class="grid2">' +
      '<label>Hiện tên dạng câu<select data-lybool="showTypeLabel">'+optionHtml([[true,"Có"],[false,"Không"]],L.showTypeLabel)+'</select></label>' +
      '<label>Kiểu phương án TN<select data-ly="mcStyle">'+optionHtml([["plain","Chữ thường"],["circle","Ô tròn quanh chữ cái (BK)"],["cards","Card / ô"],["tabular","Bảng tabular LaTeX"]],L.mcStyle)+'</select></label>' +
      '<label>Số cột trắc nghiệm<select data-ly="mcColumns">'+optionHtml([1,2,4],L.mcColumns)+'</select></label>' +
      '<label>Kiểu Đúng–Sai<select data-ly="tfStyle">'+optionHtml([["list","Danh sách"],["table","Bảng card"],["tabular","Bảng tabular LaTeX"]],L.tfStyle)+'</select></label>' +
      '<label>Kiểu TLN<select data-ly="shortStyle">'+optionHtml([["boxes","Ô trả lời"],["line","Dòng trống"]],L.shortStyle)+'</select></label>' +
      '<label>Số ô TLN<select data-ly="shortBoxCount">'+optionHtml([1,2,3,4,5,6],L.shortBoxCount)+'</select></label>' +
      '<label>Dòng trình bày TLN<input type="number" min="0" max="20" data-ly="shortWorkLines" value="'+L.shortWorkLines+'"></label>' +
      '<label>Dòng tự luận<input type="number" min="2" max="30" data-ly="essayWorkLines" value="'+L.essayWorkLines+'"></label>' +
      '<label>Kiểu tự luận<select data-ly="essayStyle">'+optionHtml([["lines","Dòng chấm"],["blank","Khoảng trắng"]],L.essayStyle)+'</select></label>' +
      '<label>Nhãn vùng TLN<input type="text" data-ly="shortWorkLabel" value="'+esc(L.shortWorkLabel)+'"></label>' +
      '<label>Nhãn vùng tự luận<input type="text" data-ly="essayWorkLabel" value="'+esc(L.essayWorkLabel)+'"></label></div></div>' +
      '<div><span class="lbl">Khối phía trên / phía dưới</span><label>Chú thích phía trên<textarea data-ly="topNote" rows="2" placeholder="Hướng dẫn làm bài…">'+esc(L.topNote)+'</textarea></label>' +
      '<label>Chú thích phía dưới<textarea data-ly="bottomNote" rows="2" placeholder="— HẾT —">'+esc(L.bottomNote)+'</textarea></label>' +
      '<div class="grid2">'+imageControl("topImage","Ảnh phía trên")+imageControl("bottomImage","Ảnh phía dưới")+'</div></div>' +
      '<div><span class="lbl">Logo đầu đề</span><div class="figedit-acts">'+(L.logo?'<span class="logoprev"><img src="'+esc(L.logo)+'" alt=""></span>':'') +
      '<label class="btn btn-sm" style="cursor:pointer">'+(L.logo?"Thay logo":"Tải logo")+'<input type="file" accept="image/*" data-lylogo hidden></label>' +
      (L.logo?'<button class="btn btn-sm btn-danger" type="button" data-lylogodel>Bỏ logo</button>':'')+'</div></div>' +
      '<div '+(locked?'class="lockedbox"':'')+'><span class="lbl">Watermark</span><input type="text" data-ly="watermark" value="'+esc(L.watermark)+'" placeholder="LƯU HÀNH NỘI BỘ" '+(locked?"disabled":"")+'>' +
      '<div class="grid2"><label>Độ đậm<input type="range" min="3" max="25" data-ly="watermarkOpacity" value="'+L.watermarkOpacity+'" '+(locked?"disabled":"")+'></label>' +
      '<label>Góc nghiêng<input type="range" min="-60" max="60" step="5" data-ly="watermarkAngle" value="'+L.watermarkAngle+'" '+(locked?"disabled":"")+'></label></div></div>';
    $$("[data-ly]",scrim).forEach(input => {
      const key=input.dataset.ly;
      const numeric=["marginTop","marginBottom","marginLeft","marginRight","fontSize","lineGap","columns","mcColumns","shortBoxCount","shortWorkLines","essayWorkLines","watermarkOpacity","watermarkAngle"].includes(key);
      const event=input.matches("select,input[type=number]")?"change":"input";
      input.addEventListener(event,e=>{
        // Đổi form kéo theo bảng màu, nên phải dựng lại cả bảng điều khiển để ba
        // hộp màu hiện đúng màu mới chứ không đứng lại ở màu cũ.
        if(key === "questionStyle"){ applyQuestionStyle(L, e.target.value); build(); preview(); return; }
        L[key]=numeric?+e.target.value:e.target.value;preview();
      });
    });
    $$('[data-lybool]',scrim).forEach(input=>input.addEventListener('change',e=>{L[input.dataset.lybool]=e.target.value==='true';preview();}));
    $$('[data-hlayout]',scrim).forEach(input=>input.addEventListener('input',e=>{H[input.dataset.hlayout]=input.type==='number'?+e.target.value:e.target.value;preview();}));
    $$('[data-hbool]',scrim).forEach(input=>input.addEventListener('change',e=>{H[input.dataset.hbool]=e.target.value==='true';preview();}));
    $("#lyPresetSelect",scrim).addEventListener("change",e=>{
      const preset=[...BUILTIN_LAYOUT_PRESETS,...PRESETS].find(item=>item.id===e.target.value);selectedPresetId=preset?.id||null;if(!preset)return;
      for(const key of Object.keys(L))delete L[key];
      Object.assign(L,structuredClone(DEFAULT_LAYOUT),structuredClone(preset.layout||{}));
      Object.assign(H,structuredClone(preset.header||{}));build();preview();toast("Đã áp dụng preset "+preset.name);
    });
    $$("[data-use-ref]",scrim).forEach(button=>button.addEventListener("click",()=>{
      L[button.dataset.useRef==="top"?"topImage":"bottomImage"]=L.referenceAsset;build();preview();
    }));
    $$("[data-layout-image]",scrim).forEach(input=>input.addEventListener("change",async e=>{
      const file=e.target.files?.[0];if(!file)return;if(file.size>15*1024*1024){toast("Ảnh block phải dưới 15 MB");return;}
      const form=new FormData();form.set("file",file);toast("Đang lưu ảnh block…");
      try{const response=await fetch("/api/style-references",{method:"POST",body:form});const result=await response.json();if(!response.ok)throw new Error(result.error||"Không lưu được ảnh");L[input.dataset.layoutImage]=result.assetUrl;build();preview();}
      catch(error){toast("Không lưu được ảnh: "+error.message);}
    }));
    $$("[data-clear-image]",scrim).forEach(button=>button.addEventListener("click",()=>{L[button.dataset.clearImage]=null;build();preview();}));
    $$("[data-lyreference]",scrim).forEach(input=>input.addEventListener("change",async e=>{
      const file=e.target.files?.[0];if(!file)return;const form=new FormData();form.set("file",file);toast("Đang đọc format mẫu…");
      try{
        const response=await fetch("/api/style-references",{method:"POST",body:form});const result=await response.json();
        if(!response.ok)throw new Error(result.error||"Không nhập được format");
        Object.assign(L,result.palette,{referenceAsset:result.assetUrl,referenceName:result.filename,questionStyle:"custom",presetName:file.name.replace(/\.[^.]+$/,"")});
        build();preview();toast("Đã lấy bảng màu từ format mẫu");
      }catch(error){toast("Không nhập được format: "+error.message);build();}
    }));
    $$("[data-lylogo]",scrim).forEach(input=>input.addEventListener("change",async e=>{
      const file=e.target.files?.[0];if(!file)return;if(file.size>15*1024*1024){toast("Logo phải dưới 15 MB");return;}
      const form=new FormData();form.set("file",file);
      try{const response=await fetch("/api/style-references",{method:"POST",body:form});const result=await response.json();if(!response.ok)throw new Error(result.error||"Không lưu được logo");L.logo=result.assetUrl;build();preview();}
      catch(error){toast("Không lưu được logo: "+error.message);}
    }));
    $$("[data-lylogodel]",scrim).forEach(button=>button.addEventListener("click",()=>{L.logo=null;build();preview();}));
  }
  const onKey=e=>{if(e.key==="Escape")close();};
  function close(){scrim.remove();document.removeEventListener("keydown",onKey);}
  $$("[data-x]",scrim).forEach(button=>button.addEventListener("click",close));
  scrim.addEventListener("click",e=>{if(e.target===scrim)close();});document.addEventListener("keydown",onKey);
  $("#lyReset",scrim).addEventListener("click",()=>{
    for(const key of Object.keys(L))delete L[key];Object.assign(L,structuredClone(DEFAULT_LAYOUT));selectedPresetId=null;build();preview();
  });
  $("#lySavePreset",scrim).addEventListener("click",()=>{
    const name=String(L.presetName||"Mẫu riêng").trim().slice(0,80);
    let preset=PRESETS.find(item=>item.id===selectedPresetId);
    if(!preset){preset={id:"preset-"+crypto.randomUUID(),createdAt:new Date().toISOString()};PRESETS.push(preset);}
    Object.assign(preset,{name,layout:structuredClone(L),header:structuredClone(H),updatedAt:new Date().toISOString()});
    selectedPresetId=preset.id;activePresetId=preset.id;void saveWorkspace(true);build();toast("Đã lưu preset “"+name+"” trong Kho");
  });
  $("#lySave",scrim).addEventListener("click",()=>{
    layout=structuredClone(L);header=structuredClone(H);activePresetId=selectedPresetId;
    close();paintCanvas();renderSheet();void saveWorkspace(true);toast("Đã áp dụng preset trình bày");
  });
  build();preview();
}

/** Lề và cỡ chữ đổ thẳng vào style của tờ giấy xem trước. */
function paperStyle(L = layout){
  const F = resolveFormat(L);
  const fonts = {
    latex:'"Latin Modern Roman","STIX Two Text","Cambria Math",serif',
    sans:'Inter,"Segoe UI",Arial,sans-serif',
    legacy:'Cambria,"Times New Roman",serif'
  };
  return `padding:${F.margin.top}cm ${F.margin.right}cm ${F.margin.bottom}cm ${F.margin.left}cm;` +
    `font-size:${F.fontSize}pt;line-height:${F.lineGap};` +
    `--paper-font:${fonts[F.fontFamily]};font-family:var(--paper-font);` +
    /* Bảng màu đi qua ĐÚNG ba biến này. CSS không được gán màu cứng cho từng
       form nữa — làm thế thì hộp màu trong trình tuỳ biến bấm xong không đổi gì. */
    `--preset-form:${F.ink};--preset-soft:${F.soft};--preset-border:${F.border};` +
    (F.columns === 2 ? "column-count:2;column-gap:1cm;" : "");
}

function workAreaHtml(lines, label, style = "lines"){
  const count = Math.max(0, Math.min(30, Number(lines) || 0));
  if(!count) return "";
  return `<div class="workarea${style === "blank" ? " blank" : ""}" style="height:${Math.max(64, count * 23 + 24)}px"><b>${esc(label || "Bài làm")}</b></div>`;
}

function shortAnswerHtml(x, answerMode = false, F = resolveFormat(layout)){
  if(F.shortStyle === "line"){
    const value = answerMode && x.sa ? `${x.sa.value ?? ""} ${x.sa.unit ?? ""}`.trim() : "........................................";
    return `<div class="short-line"><b>Trả lời:</b> ${esc(value)}</div>`;
  }
  const count = F.shortBoxCount;
  const raw = answerMode && x.sa ? String(x.sa.value ?? "") : "";
  const values = count === 1 ? [raw] : Array.from({ length:count }, (_, i) => raw[i] || "");
  const cells = values.map(value => `<span class="short-answer-cell${count === 1 ? " wide" : ""}">${esc(value)}</span>`).join("");
  const unit = answerMode && x.sa?.unit ? `<small>${esc(x.sa.unit)}</small>` : "";
  return `<div class="short-form"><b>Trả lời ngắn</b><span class="short-answer-boxes">${cells}</span>${unit}</div>`;
}

function extraLayoutHtml(position, L = layout){
  const top = position === "top";
  const note = top ? L.topNote : L.bottomNote;
  const image = top ? L.topImage : L.bottomImage;
  if(!note && !image) return "";
  return `<div class="layout-extra ${top ? "top" : "bottom"}">
    ${image ? `<img src="${esc(image)}" alt="${top ? "Ảnh đầu đề" : "Ảnh cuối đề"}">` : ""}
    ${note ? `<div>${tex(note)}</div>` : ""}
  </div>`;
}

function sectionHeadingHtml(text, L = layout){
  return `<h5 class="section-heading ${resolveFormat(L).sectionHeading}">${esc(text).toUpperCase()}</h5>`;
}

function watermarkHtml(L = layout){
  const F = resolveFormat(L);
  if(!F.watermark) return "";
  return `<div class="watermark" aria-hidden="true"
    style="opacity:${F.watermarkOpacity/100};transform:rotate(${F.watermarkAngle}deg)">
    ${esc(F.watermark)}</div>`;
}

/* ═══════════════════════════════════════════════════════════ ráp đề ══ */
/* Bản trước xếp khối kiểu Scratch. Bản này là dàn bài: mỗi phần một tiêu đề,
   mỗi câu một dòng — đọc lướt được cả đề, gần với tờ giấy sẽ in ra hơn. */

const ROMAN = ["I","II","III","IV","V"];

function secCount(b){
  return b.items.reduce((a,it) =>
    a + (it.mode === "rnd" ? (it.picked?.length ?? it.n) : 1), 0);
}

function qlineHtml(no, x, bi, path, fromRnd){
  return `<div class="qline${fromRnd ? " fromrnd" : ""}" data-open="${x.id}">
    <span class="i">${no}</span>
    <span class="t">${tex(x.stem)}</span>
    <span class="d">${x.diff}</span>
    <span class="tp">${esc(TOPICS[x.topic] ?? "")}</span>
    ${path ? `<button class="x" type="button" data-ri="${path}" aria-label="Bỏ câu này">×</button>`
           : `<span class="x" title="câu rút ngẫu nhiên — sửa ở dòng trên">·</span>`}
  </div>`;
}

/** Nút lên/xuống. Khối nào cũng xê dịch được — phiếu bài tập không có thứ tự cố định. */
function moveBtns(bi){
  return `<button class="btn btn-ghost btn-sm mv" type="button" data-mv="${bi}.-1"
            title="Đưa lên trên" ${bi === 0 ? "disabled" : ""}>↑</button>
          <button class="btn btn-ghost btn-sm mv" type="button" data-mv="${bi}.1"
            title="Đưa xuống dưới" ${bi === DOC.length - 1 ? "disabled" : ""}>↓</button>`;
}

const COVER_DEFAULT = () => ({
  org:"SỞ GD&ĐT HÀ NỘI", school:"TRƯỜNG THPT NGUYỄN TRÃI",
  title:"PHIẾU BÀI TẬP", subject:"Vật lí 12",
  note:"Chuyên đề: Dao động cơ", year:"Năm học 2026 – 2027", logo:null
});

function paintCanvas(){
  const c = $("#canvas");
  c.innerHTML = "";

  /* Đi theo ĐÚNG THỨ TỰ trong DOC. Bản trước vẽ đầu đề trước rồi mới tới các
     phần, nên kéo đầu đề xuống giữa tờ cũng vô nghĩa — mà phiếu bài tập thì
     hay có chữ dẫn nhập nằm trên đầu đề. */
  let secN = 0;

  DOC.forEach((b, bi) => {
    const el = document.createElement("div");
    el.className = "block";
    el.dataset.bi = bi;

    if(b.kind === "hdr"){
      el.innerHTML = `
        <div class="sec-h"><span class="cap">Đầu đề</span><span class="fill"></span>
          ${moveBtns(bi)}
          <button class="btn btn-ghost btn-sm" type="button" data-rm="${bi}" title="Bỏ khối này">×</button>
        </div>
        <div class="hdrline">
          <span class="t">${esc(header.school)} · ${esc(header.title)} ·
            ${header.duration} phút${header.showCode ? " · mã " + esc(header.code) : ""}</span>
          <div class="grow"></div>
          <button class="btn btn-ghost btn-sm" type="button" data-hdr>Sửa đầu đề</button>
        </div>`;
      c.appendChild(el); return;
    }

    if(b.kind === "cover"){
      const d = b.data;
      el.innerHTML = `
        <div class="sec-h"><span class="cap">Trang bìa</span><span class="fill"></span>
          ${moveBtns(bi)}
          <button class="btn btn-ghost btn-sm" type="button" data-rm="${bi}" title="Bỏ trang bìa">×</button>
        </div>
        <div class="hdrline">
          <span class="t">${esc(d.title || "(chưa đặt tên)")} · ${esc(d.subject || "")}</span>
          <div class="grow"></div>
          <button class="btn btn-ghost btn-sm" type="button" data-cover="${bi}">Sửa trang bìa</button>
        </div>`;
      c.appendChild(el); return;
    }

    if(b.kind === "break"){
      el.innerHTML = `<div class="breakline">
        <span class="fill"></span><span class="cap">Ngắt sang trang mới</span><span class="fill"></span>
        ${moveBtns(bi)}
        <button class="btn btn-ghost btn-sm" type="button" data-rm="${bi}">×</button></div>`;
      c.appendChild(el); return;
    }

    if(b.kind === "text"){
      el.innerHTML = `
        <div class="sec-h"><span class="cap">Khối chữ</span><span class="fill"></span>
          ${moveBtns(bi)}
          <button class="btn btn-ghost btn-sm" type="button" data-rm="${bi}" title="Bỏ khối chữ">×</button>
        </div>
        <div class="textblock" data-tb="${bi}">
          <div class="tbbar">
            ${[["bold","B","Đậm"],["italic","I","Nghiêng"],["underline","U","Gạch chân"]]
              .map(([cmd,lab,ti]) =>
                `<button type="button" class="tbtn" data-cmd="${cmd}" title="${ti}"
                   style="font-weight:${cmd==="bold"?700:400};font-style:${cmd==="italic"?"italic":"normal"};
                          text-decoration:${cmd==="underline"?"underline":"none"}">${lab}</button>`).join("")}
            <span class="tbsep"></span>
            ${[["justifyLeft","⯇"],["justifyCenter","≡"],["justifyRight","⯈"]]
              .map(([cmd,lab]) => `<button type="button" class="tbtn" data-cmd="${cmd}">${lab}</button>`).join("")}
            <span class="tbsep"></span>
            <button type="button" class="tbtn" data-block="h3">Tiêu đề</button>
            <button type="button" class="tbtn" data-block="p">Đoạn</button>
            <button type="button" class="tbtn" data-ins="\$…\$">Công thức</button>
          </div>
          <div class="tbedit" contenteditable="true" data-ed="${bi}"
               aria-label="Khối chữ tự do">${b.html || "<p>Gõ gì cũng được ở đây…</p>"}</div>
        </div>`;
      c.appendChild(el); return;
    }

    if(b.kind !== "sec") return;
    secN++;

    const n = secCount(b);
    const pts = POINTS[b.type] * n;
    const open = !b.folded;

    let rows = "";
    let no = 0;
    b.items.forEach((it, ii) => {
      const path = `${bi}.${ii}`;
      if(it.mode === "q"){
        const x = qById(it.qid);
        if(!x) return;
        rows += qlineHtml(++no, x, bi, path, false);
        return;
      }
      const pool = ofSubject().filter(z => z.type === b.type && z.diff === it.diff).length;
      const got = it.picked?.length ?? 0;
      rows += `<div class="rndline">
        <span class="i">${no+1}–${no+it.n}</span>
        <span>Rút
          <select data-rn="${path}" aria-label="Số câu rút">${
            [1,2,3,4,5,6,8,10,12,14,16].map(v=>
              `<option value="${v}" ${v===it.n?"selected":""}>${v}</option>`).join("")
          }</select> câu mức
          <select data-rd="${path}" aria-label="Độ khó">${
            DIFFS.map(d=>`<option value="${d}" ${d===it.diff?"selected":""}>${DNAME[d]}</option>`).join("")
          }</select></span>
        <span>${
          it.picked === null || it.picked === undefined
            ? `chưa rút · kho có ${pool} câu hợp lệ`
            : got < it.n
              ? `<b style="color:var(--danger);font-weight:500">chỉ rút được ${got}/${it.n}</b> · kho có ${pool}`
              : `đã rút ${got} câu`
        }</span>
        <div class="grow"></div>
        <button class="x" type="button" data-ri="${path}" aria-label="Bỏ khối ngẫu nhiên">×</button>
      </div>`;
      if(it.picked?.length){
        for(const id of it.picked){
          const x = qById(id);
          if(x) rows += qlineHtml(++no, x, bi, null, true);
        }
      } else {
        for(let k = 0; k < it.n; k++)
          rows += `<div class="qline pending"><span class="i">${++no}</span>
            <span class="t">chưa rút — mức ${DNAME[it.diff].toLowerCase()}</span>
            <span class="d">${it.diff}</span><span class="tp"></span><span class="x"></span></div>`;
      }
    });
    if(!rows) rows = `<div class="rndline"><span class="i"></span>
      <span>Phần này chưa có câu nào.</span></div>`;

    el.innerHTML = `
      <div class="sec-h">
        <button class="fold" type="button" data-fold="${bi}"
                aria-expanded="${open}" title="${open ? "Thu gọn" : "Mở ra"}">${open ? "▾" : "▸"}</button>
        <span class="dot ${CLS2[b.type]}"></span>
        <span class="nm" data-rename="${bi}" title="Bấm để đổi tên phần">${esc(secTitle(b))}</span>
        <span class="sub">${n} câu${pts ? ` · ${diem(pts)} điểm` : ""} · ${SECNOTE[b.type]}</span>
        <span class="fill"></span>
        <button class="btn btn-ghost btn-sm" type="button" data-find="${bi}">Thêm câu</button>
        <button class="btn btn-ghost btn-sm" type="button" data-rnd="${bi}">Rút ngẫu nhiên</button>
        ${moveBtns(bi)}
        <button class="btn btn-ghost btn-sm" type="button" data-rm="${bi}" title="Bỏ cả phần">×</button>
      </div>
      <div class="seclist" data-sec="${bi}" ${open ? "" : "hidden"}>${
        finderFor === bi ? finderHtml(b.type) : ""}${rows}</div>
      ${open ? "" : `<div class="folded-note">Đang thu gọn — ${n} câu</div>`}`;
    c.appendChild(el);
  });

  const tip = document.createElement("div");
  tip.className = "addbar";
  tip.innerHTML =
    `<span class="cap">Thêm vào đề</span>
     <div class="addrow">
       ${Object.keys(TYPES).map(t =>
         `<button class="addbtn" type="button" data-add="${t}">
            <span class="dot ${CLS2[t]}"></span>${TYPES[t]}</button>`).join("")}
     </div>
     <div class="addrow">
       <button class="addbtn" type="button" data-add="hdr">Đầu đề</button>
       <button class="addbtn" type="button" data-add="cover">Trang bìa</button>
       <button class="addbtn" type="button" data-add="text">Khối chữ tự do</button>
       <button class="addbtn" type="button" data-add="break">Ngắt trang</button>
     </div>`;
  c.appendChild(tip);

  if(finderFor !== null) wireFinder();
  paintTally();
}

function finderHtml(type){
  return `<div class="finder" id="finder">
    <input type="search" id="finderQ" placeholder="Tìm câu ${TYPES[type].toLowerCase()} trong kho"
           aria-label="Tìm câu trong kho">
    <ul id="finderList"></ul>
  </div>`;
}

function wireFinder(){
  const box = $("#finder");
  if(!box) return;
  const bi = finderFor;
  const type = DOC[bi].type;
  const inp = $("#finderQ", box), ul = $("#finderList", box);

  function fill(){
    const kw = inp.value;
    const list = ofSubject().filter(x =>
      x.type === type &&
      !DOC[bi].items.some(it => it.mode === "q" && it.qid === x.id) &&
      (!kw || fold(`${plain(x.stem)} ${x.src}`).includes(fold(kw))));
    ul.innerHTML = list.length ? "" :
      `<li style="color:var(--ink-4);cursor:default">Không còn câu ${TYPES[type].toLowerCase()} nào khớp.</li>`;
    for(const x of list){
      const li = document.createElement("li");
      li.innerHTML = `<div class="t">${tex(x.stem)}</div>
        <div class="s">${x.diff} · ${esc(TOPICS[x.topic] ?? "")} · ${esc(x.src)}</div>`;
      li.addEventListener("click", () => {
        touchDoc();
        DOC[bi].items.push({ mode:"q", qid:x.id });
        paintCanvas(); renderSheet(); toast("Đã thêm 1 câu");
        const again = $("#finderQ");
        if(again){ again.value = kw; again.focus(); }
      });
      ul.appendChild(li);
    }
  }
  inp.addEventListener("input", fill);
  inp.addEventListener("keydown", e => {
    if(e.key === "Escape"){ finderFor = null; paintCanvas(); }
  });
  fill(); inp.focus();
}

/* Tổng số câu của cả đề, đối chiếu với cấu trúc thi thật. Không có con số này
   thì phải tự cộng nhẩm từng phần — đúng thứ máy nên làm hộ. */
function paintTally(){
  const bp = BLUEPRINTS[subject];
  const want = bp.secs.reduce((a,[,n]) => a + n, 0);
  let have = 0;
  const short = [];
  const mix = { NB:0, TH:0, VD:0, VDC:0 };

  for(const b of DOC){
    if(b.kind !== "sec") continue;
    const n = secCount(b);
    have += n;
    const target = bp.secs.find(([t]) => t === b.type)?.[1];
    if(target && n !== target) short.push(`${TYPES[b.type]} ${n}/${target}`);
    for(const x of flatten(b)) if(x.diff) mix[x.diff]++;
  }

  const ok = have === want && !short.length;
  const el = $("#tally");
  el.className = "tally" + (ok ? " ok" : "");
  el.innerHTML = `<b>${have}</b><span class="muted">/${want} câu · ${
    short.length ? "lệch ở " + esc(short.join(", ")) : ok ? "khớp cấu trúc" : bp.name}</span>`;
  $("#mixline").textContent = DIFFS.map(d => `${d} ${mix[d]}`).join(" · ");

  const pages = Math.max(1, Math.ceil(have / 12));
  $("#pageEst").textContent = `A4 · khoảng ${pages} trang`;
}

$("#canvas").addEventListener("click", e => {
  if(e.target.closest("[data-hdr]")){ openHeaderEditor(); return; }

  const add = e.target.closest("[data-add]");
  if(add){
    touchDoc();
    const k = add.dataset.add;
    if(k === "hdr")        DOC.push({ kind:"hdr" });
    else if(k === "cover") DOC.unshift({ kind:"cover", data:COVER_DEFAULT() });
    else if(k === "text")  DOC.push({ kind:"text", html:"<p>Gõ gì cũng được ở đây…</p>" });
    else if(k === "break") DOC.push({ kind:"break" });
    else                   DOC.push({ kind:"sec", type:k, items:[] });
    paintCanvas(); renderSheet();
    // Khối mới nằm cuối, cuộn xuống cho thấy — không thì bấm xong tưởng hỏng.
    if(k !== "cover") $("#canvas").scrollTop = $("#canvas").scrollHeight;
    return;
  }

  const mv = e.target.closest("[data-mv]");
  if(mv){
    touchDoc(); finderFor = null;
    const [i, d] = mv.dataset.mv.split(".").map(Number);
    const j = i + d;
    if(j >= 0 && j < DOC.length){ [DOC[i], DOC[j]] = [DOC[j], DOC[i]]; }
    paintCanvas(); renderSheet(); return;
  }

  const fold = e.target.closest("[data-fold]");
  if(fold){
    const b = DOC[+fold.dataset.fold];
    b.folded = !b.folded;
    paintCanvas(); return;
  }

  const ren = e.target.closest("[data-rename]");
  if(ren){
    const b = DOC[+ren.dataset.rename];
    const v = prompt("Tên phần này hiện trên đề:", secTitle(b));
    if(v !== null){ touchDoc(); b.title = v.trim() || null; paintCanvas(); renderSheet(); }
    return;
  }

  const cov = e.target.closest("[data-cover]");
  if(cov){ openCoverEditor(+cov.dataset.cover); return; }

  const find = e.target.closest("[data-find]");
  if(find){
    finderFor = finderFor === +find.dataset.find ? null : +find.dataset.find;
    paintCanvas(); return;
  }

  const rnd = e.target.closest("[data-rnd]");
  if(rnd){
    touchDoc();
    DOC[+rnd.dataset.rnd].items.push({ mode:"rnd", n:2, diff:"TH", picked:null });
    paintCanvas(); renderSheet(); return;
  }

  const rm = e.target.closest("[data-rm]");
  if(rm){
    touchDoc(); finderFor = null;
    DOC.splice(+rm.dataset.rm,1);
    paintCanvas(); renderSheet(); return;
  }

  const ri = e.target.closest("[data-ri]");
  if(ri){
    touchDoc();
    const [a,b] = ri.dataset.ri.split(".");
    DOC[+a].items.splice(+b,1);
    finderFor = null;
    paintCanvas(); renderSheet(); return;
  }

  const open = e.target.closest("[data-open]");
  if(open) openEditor(open.dataset.open);
});

/* ── khối chữ tự do: cái "Word mini" ──────────────────────────────────────
 * contenteditable + execCommand. execCommand đã bị đánh dấu cũ nhưng vẫn chạy
 * ở mọi trình duyệt và không cần thư viện ngoài — đúng tinh thần thư mục web/
 * này (không build, không dependency). Đổi sang bộ soạn thảo thật thì làm ở
 * Phase 1, chỗ đã có bundler.
 */
$("#canvas").addEventListener("input", e => {
  const ed = e.target.closest("[data-ed]");
  if(!ed) return;
  touchDoc();
  DOC[+ed.dataset.ed].html = ed.innerHTML;
  renderSheet();               // không vẽ lại canvas, kẻo con trỏ nhảy về đầu
});

$("#canvas").addEventListener("mousedown", e => {
  const b = e.target.closest(".tbtn");
  if(!b) return;
  // Giữ con trỏ trong vùng soạn thảo: mousedown mặc định làm mất focus.
  e.preventDefault();
  const wrap = b.closest("[data-tb]");
  const ed = $(".tbedit", wrap);
  ed.focus();
  if(b.dataset.cmd) document.execCommand(b.dataset.cmd, false, null);
  if(b.dataset.block) document.execCommand("formatBlock", false, b.dataset.block);
  if(b.dataset.ins) document.execCommand("insertText", false, "$…$");
  touchDoc();
  DOC[+ed.dataset.ed].html = ed.innerHTML;
  renderSheet();
});

/* ── trang bìa ─────────────────────────────────────────────────────────── */

function openCoverEditor(bi){
  const d = { ...DOC[bi].data };
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Trang bìa">
    <div class="modal-head"><h3>Trang bìa</h3><div class="grow"></div>
      <button class="btn btn-ghost" type="button" data-x>Đóng</button></div>
    <div class="modal-body">
      <div class="ed-left" id="cvBody"></div>
      <div class="ed-right"><span class="cap">Xem trước</span><div id="cvPrev"></div></div>
    </div>
    <div class="modal-foot"><div class="grow"></div>
      <button class="btn" type="button" data-x>Huỷ</button>
      <button class="btn btn-primary" type="button" id="cvSave">Lưu</button></div></div>`;
  document.body.appendChild(scrim);

  const FIELDS = [
    ["org","Cơ quan chủ quản"], ["school","Trường / trung tâm"],
    ["title","Tên phiếu / đề"], ["subject","Môn và lớp"],
    ["note","Dòng ghi chú (chuyên đề, đợt…)"], ["year","Năm học"]
  ];

  function prev(){
    $("#cvPrev", scrim).innerHTML =
      `<div class="sheet cover" style="${paperStyle()}">${coverHtml(d)}</div>`;
  }
  function build(){
    $("#cvBody", scrim).innerHTML = FIELDS.map(([k,lab]) =>
      `<label><span class="lbl">${lab}</span>
        <input type="text" data-cv="${k}" value="${esc(d[k] ?? "")}"></label>`).join("") +
      `<div>
        <span class="lbl">Logo trên bìa</span>
        <div class="figedit-acts">
          ${d.logo ? `<span class="logoprev"><img src="${esc(d.logo)}" alt=""></span>` : ""}
          <label class="btn btn-sm" style="cursor:pointer">${d.logo ? "Thay logo" : "Tải logo lên"}
            <input type="file" accept="image/*" data-cvlogo hidden></label>
          ${d.logo ? '<button class="btn btn-sm btn-danger" type="button" data-cvlogodel>Bỏ logo</button>' : ""}
        </div>
      </div>
      <p class="hint">Trang bìa in riêng một tờ, phần đề bắt đầu ở tờ sau.</p>`;

    $$("[data-cv]", scrim).forEach(i => i.addEventListener("input", e => {
      d[e.target.dataset.cv] = e.target.value; prev();
    }));
    $$("[data-cvlogo]", scrim).forEach(i => i.addEventListener("change", e => {
      const f = e.target.files?.[0];
      if(!f) return;
      if(f.size > 1_000_000){ toast("Logo nên dưới 1MB"); return; }
      const fr = new FileReader();
      fr.onload = () => { d.logo = String(fr.result); build(); prev(); };
      fr.readAsDataURL(f);
    }));
    $$("[data-cvlogodel]", scrim).forEach(b =>
      b.addEventListener("click", () => { d.logo = null; build(); prev(); }));
  }

  const onKey = (ev) => { if(ev.key === "Escape") close(); };
  function close(){ scrim.remove(); document.removeEventListener("keydown", onKey); }
  $$("[data-x]", scrim).forEach(b => b.addEventListener("click", close));
  scrim.addEventListener("click", ev => { if(ev.target === scrim) close(); });
  document.addEventListener("keydown", onKey);
  $("#cvSave", scrim).addEventListener("click", () => {
    touchDoc(); DOC[bi].data = d; close(); paintCanvas(); renderSheet();
    toast("Đã cập nhật trang bìa");
  });

  build(); prev();
}

function coverHtml(d){
  return `<div class="cv-org">${esc(d.org ?? "")}</div>
    <div class="cv-school">${esc(d.school ?? "")}</div>
    ${d.logo ? `<div class="cv-logo"><img src="${esc(d.logo)}" alt=""></div>` : ""}
    <div class="cv-title">${esc(d.title ?? "")}</div>
    <div class="cv-subject">${esc(d.subject ?? "")}</div>
    ${d.note ? `<div class="cv-note">${esc(d.note)}</div>` : ""}
    <div class="cv-year">${esc(d.year ?? "")}</div>`;
}

$("#canvas").addEventListener("change", e => {
  // Đổi số câu hay độ khó thì lần rút cũ không còn đúng nữa — bỏ đi, rút lại.
  const { rn, rd } = e.target.dataset;
  if(!rn && !rd) return;
  touchDoc();
  if(rn){ const [a,b] = rn.split("."); Object.assign(DOC[+a].items[+b], { n:+e.target.value, picked:null }); }
  if(rd){ const [a,b] = rd.split("."); Object.assign(DOC[+a].items[+b], { diff:e.target.value, picked:null }); }
  paintCanvas(); renderSheet();
});

$("#btnClear").addEventListener("click", () => {
  if(DOC.length && !confirm("Xoá sạch đề đang soạn?")) return;
  touchDoc();
  DOC = []; finderFor = null; paintCanvas(); renderSheet();
});

$("#btnShuffle").addEventListener("click", () => {
  toast("Trộn mã đề 101/102/103/104 chưa làm — xem mục 7D trong HANDOFF.md");
});

$("#btnLayout").addEventListener("click", openLayoutEditor);

$("#btnFoldAll").addEventListener("click", () => {
  const secs = DOC.filter(b => b.kind === "sec");
  if(!secs.length) return;
  const foldAll = secs.some(b => !b.folded);      // còn phần nào mở thì thu hết
  secs.forEach(b => { b.folded = foldAll; });
  $("#btnFoldAll").textContent = foldAll ? "Mở tất cả các phần" : "Thu gọn các phần";
  paintCanvas();
  $(".tool-more")?.removeAttribute("open");
});

/* ═════════════════════════════════════════════════════ xem trước ══ */

function headerHtml(L = layout, h = header){
  const idline = h.showId
    ? `<div class="idline"><span>Họ và tên: ..............................</span>
       <span>Lớp: ..........</span><span>SBD: ..........</span></div>` : "";
  const codeTxt = h.showCode ? `<br>Mã đề ${esc(h.code)}` : "";

  if(h.tmpl === "bk"){
    return `<div class="hd-bk"><div class="hd-bk-line"><span>${esc(h.org)}</span><span>${esc(h.school)}</span></div>
      <div class="hd-bk-title"><b>${esc(h.title)}</b>${h.subject ? `<span>${esc(h.subject)}</span>` : ""}</div></div>${idline}`;
  }

  if(h.tmpl === "gon"){
    return `<div class="hd1 inline"><b>${esc(h.school)}</b> — ${esc(h.title)} ·
      ${esc(h.subject)} · ${h.duration} phút${h.showCode ? " · mã "+esc(h.code) : ""}</div>${idline}`;
  }
  if(h.tmpl === "logo"){
    // Chưa tải logo thì vẫn vẽ ô tròn giữ chỗ, để giáo viên thấy nó sẽ nằm đâu.
    const mark = L.logo
      ? `<span class="logo img" style="width:${L.logoSize}px;height:${L.logoSize}px"><img src="${esc(L.logo)}" alt=""></span>`
      : `<span class="logo">LOGO</span>`;
    return `<div class="hd2"><div style="display:flex;gap:10px;align-items:center">
      ${mark}
      <span><b>${esc(h.school)}</b>${esc(h.org)}<br>Năm học ${esc(h.year)}</span></div>
      <div style="text-align:right"><b>${esc(h.title).toUpperCase()}</b>${esc(h.subject)}<br>
      Thời gian: ${h.duration} phút${codeTxt}</div></div>${idline}`;
  }
  return `<div class="hd2"><div>${esc(h.org)}<b>${esc(h.school).toUpperCase()}</b>
    <span style="font-size:12px">Năm học ${esc(h.year)}</span></div>
    <div style="text-align:right"><b>${esc(h.title).toUpperCase()}</b>${esc(h.subject)}<br>
    Thời gian làm bài: ${h.duration} phút${codeTxt}</div></div>${idline}`;
}

/* Trải khối thành danh sách câu thật theo đúng thứ tự sẽ in.
   Khối ngẫu nhiên chưa chốt thì trả về chỗ trống để bản xem trước báo. */
function flatten(sec){
  const out = [];
  for(const it of sec.items){
    if(it.mode === "q") out.push(qById(it.qid) ?? null);
    else if(it.picked?.length) for(const id of it.picked) out.push(qById(id) ?? null);
    else for(let k = 0; k < it.n; k++) out.push({ _pending: it.diff });
  }
  return out.filter(Boolean);
}

function groupContextHtml(x){
  if(!x.groupId) return "";
  return `<div class="group-context q"><div class="group-title">${esc(x.groupLabel || "Dữ liệu dùng chung cho các câu sau")}</div>
    <div>${tex(x.groupStem || "")}</div>${figHtml(x.groupFig,"fg")}</div>`;
}

function repairLegacyMathSource(value){
  let source=String(value ?? "");
  if(source.includes("$") || !/\\(?:mathbb|overrightarrow|begin\s*\{cases\}|d?frac|int|sum|prod)/.test(source)) return source;
  return `$${source}$`;
}

/* Nhãn phương án. Kiểu "circle" là mặc định của mẫu BK/HCMUT: chữ cái nằm trong
   một ô tròn để học sinh khoanh thẳng lên đề, không có dấu chấm sau chữ. */
const mcLabelHtml = (x, i, F) => F.mcStyle === "circle"
  ? `<b class="mccircle">${chLabel(x,i)}</b>`
  : `<b style="display:inline">${chLabel(x,i)}.</b>`;

/* ── Thân câu hỏi: bốn dạng, dựng MỘT lần cho cả hai khung ────────────────
 *
 * Trước đây "Tối giản" và "có khung card" là hai hàm riêng, mỗi hàm hiểu
 * `mcStyle`/`tfStyle` một kiểu — nên chọn "Card / ô" trong lúc form tổng là Tối
 * giản thì màn hình vẽ chữ trơn, chọn xong không thấy gì đổi. Nay khung và thân
 * tách hẳn: khung quyết định có viền hay không, thân đọc `resolveFormat()`.
 */
function mcChoicesHtml(x, F, answerMode = false){
  if(!x.ch?.length) return "";
  const columns = mcColumnsFor(x.ch, F.mcColumns);
  const grid = `style="grid-template-columns:repeat(${columns},minmax(0,1fr))"`;
  if(F.mcStyle === "cards"){
    return `<div class="answer-options" ${grid}>${x.ch.map((choice, i) => {
      const correct = answerMode && x.ans === i;
      return `<div class="answer-option${correct ? " correct" : ""}"><span>${chLabel(x,i)}</span><div>${tex(choice)}</div>${correct ? "<b>✓</b>" : ""}</div>`;
    }).join("")}</div>`;
  }
  const mcClass = F.mcStyle === "tabular" ? "ch latex-tabular mc-tabular"
    : F.mcStyle === "circle" ? "ch mc-circle" : "ch";
  return `<div class="${mcClass}" ${grid}>${x.ch.map((choice, i) => {
    const correct = answerMode && x.ans === i;
    return `<div class="${correct ? "choice-correct" : ""}">${mcLabelHtml(x,i,F)} ${tex(choice)}${correct ? " ✓" : ""}</div>`;
  }).join("")}</div>`;
}

function tfBodyHtml(x, F, answerMode = false){
  if(!x.tf?.length) return "";
  if(F.tfStyle === "list")
    return x.tf.map(([statement, value], i) => `<div class="tf-simple"><b>${TFIDX[i]})</b> ${tex(statement)}${
      answerMode ? ` <b>${value === true ? "Đ" : value === false ? "S" : "—"}</b>` : ""}</div>`).join("");
  return trueFalseTableHtml(x, answerMode, F);
}

function questionBodyHtml(x, F, answerMode = false){
  let h = "";
  if(x.type === "MC"){
    h += mcChoicesHtml(x, F, answerMode);
    if(answerMode && x.ans == null) h += `<div class="no-answer">Không có đáp án in sẵn</div>`;
  }
  if(x.type === "TF") h += tfBodyHtml(x, F, answerMode);
  if(x.type === "SHORT"){
    h += shortAnswerHtml(x, answerMode, F);
    if(!answerMode) h += workAreaHtml(F.shortWorkLines, F.shortWorkLabel, F.shortStyle === "line" ? "blank" : "lines");
  }
  if(x.type === "ESSAY" && !answerMode) h += workAreaHtml(F.essayWorkLines, F.essayWorkLabel, F.essayStyle);
  return h;
}

function questionHtmlForLayout(x, no, showGroup = false, L = layout, answerMode = false){
  const F = resolveFormat(L);
  const g = normFig(x.fig);
  const head = showGroup ? groupContextHtml(x) : "";

  if(F.card){
    let h = head + `<div class="q qcard">`;
    h += `<div class="qcard-head"><b>Câu ${no}.</b>${F.showTypeLabel ? `<em>${TYPE_NAME[x.type] ?? ""}</em>` : ""}</div>`;
    h += `<div class="qcard-stem">${tex(x.stem)}</div>${figAt(x.fig,"top","fg")}`;
    h += questionBodyHtml(x, F, answerMode);
    if(answerMode && x.sol) h += `<div class="styled-solution"><b>Lời giải.</b> ${tex(x.sol)}</div>`;
    return h + figAt(x.fig,"below","fg") + `</div>`;
  }

  const floated = g?.place === "right" || g?.place === "left" ? figHtml(x.fig,"fg") : "";
  let h = head + `<div class="q">${floated}<b style="display:inline">Câu ${no}.</b> ${tex(x.stem)}` +
          figAt(x.fig,"top","fg");
  h += questionBodyHtml(x, F, answerMode);
  if(answerMode && x.sol) h += `<div class="styled-solution"><b>Lời giải.</b> ${tex(x.sol)}</div>`;
  return h + figAt(x.fig,"below","fg") + `</div>`;
}

function questionHtml(x, no, showGroup = false){
  return questionHtmlForLayout(x,no,showGroup,layout);
}

function trueFalseTableHtml(x, answerMode = false, F = resolveFormat(layout)){
  const tabular = F.tfStyle === "tabular";
  return `<div class="tf-form${tabular ? " latex-tabular" : ""}"><div class="tf-form-head"><b>Phát biểu</b><b>Đúng</b><b>Sai</b></div>${x.tf.map(([statement, value], i) =>
    `<div class="tf-form-row"><div><b>${TFIDX[i]})</b> ${tex(statement)}</div>
      <span class="tf-box${answerMode && value === true ? " checked" : ""}">${answerMode && value === true ? "✓" : ""}</span>
      <span class="tf-box${answerMode && value === false ? " checked" : ""}">${answerMode && value === false ? "✓" : ""}</span></div>`).join("")}</div>`;
}

function answerHtml(x, no, showGroup = false){
  if(resolveFormat(layout).card) return questionHtmlForLayout(x, no, showGroup, layout, true);
  if(x.type === "MC")
    return `<div class="q"><b style="display:inline">Câu ${no}.</b> ${x.ans == null ? '<span class="ph">không có đáp án in sẵn</span>' : chLabel(x, x.ans)}</div>`;
  if(x.type === "TF" && x.tf)
    return `<div class="q"><b style="display:inline">Câu ${no}.</b> ${
      x.tf.map(([,v],i)=>`${TFIDX[i]}) ${v === true ? "Đ" : v === false ? "S" : "—"}`).join("  ")}</div>`;
  if(x.type === "SHORT" && x.sa)
    return `<div class="q"><b style="display:inline">Câu ${no}.</b> ${
      esc(x.sa.value)} ${esc(x.sa.unit)}</div>`;
  return `<div class="q"><b style="display:inline">Câu ${no}.</b> <span class="ph">(tự luận)</span></div>`;
}

function solutionHtml(x, no, showGroup = false){
  let h = (showGroup ? groupContextHtml(x) : "") + `<div class="q"><b style="display:inline">Câu ${no}.</b> `;
  // Câu đúng/sai chấm theo từng ý nên lời giải cũng phải theo từng ý.
  if(x.type === "TF" && x.tf?.some(s => s[2])){
    h += `<div>${x.tf.map(([t,v,why],i) =>
      `<div style="margin-left:14px">${TFIDX[i]}) <b style="display:inline">${v ? "Đúng" : "Sai"}</b>${
        why ? ` — ${tex(why)}` : ""}</div>`).join("")}</div>`;
    if(x.sol) h += `<div style="margin-top:4px">${tex(x.sol)}</div>`;
  } else {
    h += x.sol ? tex(x.sol) : '<span class="ph">chưa có lời giải</span>';
  }
  return h + `</div>`;
}

/* Ma trận đặc tả: chuyên đề × mức độ, đếm từ chính đề đang soạn. Đây là bảng
   giáo viên phải nộp kèm đề, trước nay phải gõ tay. */
function matrixHtml(){
  const cells = {}, totals = { NB:0, TH:0, VD:0, VDC:0 };
  let all = 0;
  for(const b of DOC){
    if(b.kind !== "sec") continue;
    for(const x of flatten(b)){
      if(x._pending || !x.topic) continue;
      cells[x.topic] ??= { NB:0, TH:0, VD:0, VDC:0 };
      cells[x.topic][x.diff]++; totals[x.diff]++; all++;
    }
  }
  const rows = Object.keys(cells);
  if(!rows.length) return `<div class="ph" style="text-align:center;padding:36px 0">
    Chưa có câu nào chốt được — ma trận sẽ hiện ở đây.</div>`;

  return `<div class="hd1"><b>MA TRẬN ĐẶC TẢ — ${esc(header.title).toUpperCase()}</b>
      ${esc(header.subject)}</div>
    <table><thead><tr><th>Chuyên đề</th>${
      DIFFS.map(d=>`<th style="text-align:center">${d}</th>`).join("")
    }<th style="text-align:center">Tổng</th></tr></thead><tbody>${
      rows.map(t => {
        const r = cells[t];
        const sum = DIFFS.reduce((a,d)=>a+r[d],0);
        return `<tr><td>${esc(TOPICS[t] ?? t)}</td>${
          DIFFS.map(d=>`<td class="n">${r[d] || ""}</td>`).join("")
        }<td class="n"><b style="display:inline">${sum}</b></td></tr>`;
      }).join("")
    }<tr><td><b style="display:inline">Tổng</b></td>${
      DIFFS.map(d=>`<td class="n"><b style="display:inline">${totals[d]}</b></td>`).join("")
    }<td class="n"><b style="display:inline">${all}</b></td></tr></tbody></table>`;
}

function sheetHtml(){
  if(sheetMode === "matran") return matrixHtml();

  const key = sheetMode === "dapan", sol = sheetMode === "loigiai";
  let h = "";

  /* Đi đúng thứ tự khối, giống hệt màn ráp đề và giống hệt file Word xuất ra.
     Bản đáp án và lời giải bỏ trang bìa với khối chữ — đó là tờ dành cho giáo
     viên, không phải tờ phát cho học sinh. */
  for(const b of DOC){
    if(b.kind === "cover"){
      if(key || sol) continue;
      h += `<div class="cover">${coverHtml(b.data)}</div><div class="pagebreak"></div>`;
      continue;
    }
    if(b.kind === "hdr"){
      h += (key || sol)
        ? `<div class="hd1"><b>${sol ? "LỜI GIẢI" : "ĐÁP ÁN"} — ${esc(header.title).toUpperCase()}</b>
           ${esc(header.subject)}${header.showCode ? " · mã "+esc(header.code) : ""}</div>`
        : headerHtml() + extraLayoutHtml("top");
      continue;
    }
    if(b.kind === "break"){ h += `<div class="pagebreak"></div>`; continue; }
    if(b.kind === "text"){
      if(!key && !sol) h += `<div class="freetext">${b.html ?? ""}</div>`;
      continue;
    }
    if(b.kind !== "sec") continue;

    h += sectionHeadingHtml(secTitle(b));
    if(b.note) h += `<div class="q ph">${esc(b.note)}</div>`;
    const list = flatten(b);
    if(!list.length){ h += `<div class="q ph">(phần này chưa có câu nào)</div>`; continue; }
    let lastGroup = null;
    list.forEach((x, i) => {
      if(x._pending){
        h += `<div class="q"><b style="display:inline">Câu ${i+1}.</b>
          <span class="ph">chưa rút — ${DNAME[x._pending].toLowerCase()}</span></div>`;
      } else {
        const showGroup = Boolean(x.groupId && x.groupId !== lastGroup);
        h += key ? answerHtml(x, i+1, showGroup) : sol ? solutionHtml(x, i+1, showGroup) : questionHtml(x, i+1, showGroup);
        lastGroup = x.groupId || null;
      }
    });
  }

  if(!key && !sol) h += extraLayoutHtml("bottom");
  if(!key && !sol && header.showPage && h)
    h += `<div class="ph" style="text-align:center;margin-top:14px">Trang 1/4</div>`;
  return h || `<div class="ph" style="text-align:center;padding:40px 0">
    Chưa có phần nào. Đề sẽ hiện ở đây.</div>`;
}

$$("[data-sheet]").forEach(b => b.addEventListener("click", () => {
  sheetMode = b.dataset.sheet;
  $$("[data-sheet]").forEach(x =>
    x.setAttribute("aria-pressed", x.dataset.sheet === sheetMode ? "true" : "false"));
  renderSheet();
  // Đổi sang Đề/Đáp án/Lời giải là đổi hẳn nội dung tờ giấy, nên dựng lại luôn.
  if(previewMode === "pdf" && sheetMode !== "matran" && pdfPreview.key !== previewKey()) void buildPdfPreview();
}));

const SPINNER = `<svg viewBox="0 0 120 96" width="120" height="96" role="img"
  aria-label="Đang dựng bản xem trước"><g style="color:var(--acc-ink)">
  <path d="M20 12 H100" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <g class="pend"><line x1="60" y1="12" x2="60" y2="66" stroke="currentColor" stroke-width="2"/>
  <circle cx="60" cy="74" r="11" fill="currentColor"/></g></g></svg>`;

function renderSheet(){
  const el = $("#sheet");
  // Ma trận là bảng tra, không phải tờ đề — không áp lề và watermark vào nó.
  const paper = sheetMode !== "matran";
  el.style.cssText = paper ? paperStyle() : "";
  [...el.classList].filter(name => name.startsWith("qstyle-")).forEach(name => el.classList.remove(name));
  el.classList.add(`qstyle-${layout.questionStyle || "classic"}`);
  el.classList.toggle("paper", paper);
  el.innerHTML = (paper ? watermarkHtml() : "") + sheetHtml();
  applySheetZoom();
  paintPreviewMode();
}

/* ── Tờ giấy đúng khổ A4 ──────────────────────────────────────────────────
 *
 * Trước đây `.sheet` rộng theo khung bên phải, nên nó ngắt dòng ở chỗ khác hẳn
 * tờ giấy thật — nhìn "bé và ảo" đúng như người dùng nói. Nay `.sheet` rộng
 * đúng 21cm; muốn xem to nhỏ thì phóng, chứ không bóp bề ngang trang giấy.
 */
const SHEET_ZOOMS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
let sheetZoom = null;        // null = tự vừa khung
let lastSheetScale = 0.6;    // mức dùng lại khi chưa đo được bề ngang

function fitSheetZoom(){
  const wrap = $("#sheetwrap"), sheet = $("#sheet");
  const paperWidth = sheet?.offsetWidth || 0;
  const room = (wrap?.clientWidth || 0) - 40;
  // Đo lúc màn còn ẩn thì cả hai bằng 0 và ra mức phóng vô nghĩa. Trả null để
  // bên gọi biết là "chưa đo được" và giữ nguyên mức cũ.
  if(paperWidth < 50 || room < 50) return null;
  return Math.max(0.35, Math.min(1, room / paperWidth));
}

function applySheetZoom(){
  const scale = $("#sheetScale"), sheet = $("#sheet");
  if(!scale || !sheet || $("#sheetScale").hidden) return;
  if(sheetMode === "matran"){
    scale.style.cssText = "";
    $("#btnSheetZoom").textContent = "100%";
    return;
  }
  const k = sheetZoom ?? fitSheetZoom() ?? lastSheetScale;
  lastSheetScale = k;
  scale.style.transform = `scale(${k})`;
  // `transform` không đổi chỗ nó chiếm, nên phải tự khai lại cỡ sau khi thu
  // phóng — thiếu bước này thì trang bị cắt cụt hoặc thừa một khoảng trắng dài.
  scale.style.width = `${sheet.offsetWidth * k}px`;
  scale.style.height = `${sheet.offsetHeight * k}px`;
  $("#btnSheetZoom").textContent = `${Math.round(k * 100)}%`;
}

const sheetZoomStep = (dir) => {
  const now = sheetZoom ?? fitSheetZoom() ?? lastSheetScale;
  const index = SHEET_ZOOMS.findIndex(step => step > now + 1e-6);
  const next = dir > 0
    ? SHEET_ZOOMS[index < 0 ? SHEET_ZOOMS.length - 1 : index]
    : SHEET_ZOOMS[Math.max(0, (index < 0 ? SHEET_ZOOMS.length : index) - 1)];
  sheetZoom = next;
  applySheetZoom();
};
$("#btnSheetIn").addEventListener("click", () => sheetZoomStep(1));
$("#btnSheetOut").addEventListener("click", () => sheetZoomStep(-1));
$("#btnSheetZoom").addEventListener("click", () => { sheetZoom = null; applySheetZoom(); });
addEventListener("resize", () => { if(sheetZoom === null) applySheetZoom(); });

/* Cột xem trước mặc định đã đủ rộng cho tờ A4 gần cỡ thật, nhưng màn hẹp thì vẫn
   phải thu. Nút này giấu hẳn cột soạn đề để xem đúng cỡ 100%. */
$("#btnPreviewWide").addEventListener("click", () => {
  const wide = $("#s-rap").classList.toggle("wide");
  $("#btnPreviewWide").textContent = wide ? "Thu lại" : "Mở rộng";
  sheetZoom = null;
  requestAnimationFrame(applySheetZoom);
});

/* ── Thanh kéo chia chỗ giữa cột soạn đề và tờ giấy ───────────────────────
 *
 * Bề rộng "đúng" khác nhau theo người: người ngồi rút câu cần cột trái rộng,
 * người đang chỉnh trình bày cần tờ giấy to. Nhớ lại lựa chọn theo máy để mở app
 * lần sau không phải kéo lại. Bấm đúp là về mặc định.
 */
const PREVIEW_WIDTH_KEY = "eduvault.previewWidth";
function setPreviewWidth(px){
  const rap = $("#s-rap");
  if(px == null){ rap.style.removeProperty("--preview-w"); localStorage.removeItem(PREVIEW_WIDTH_KEY); }
  else {
    // Chừa tối thiểu 360px cho cột soạn đề, và không cho tờ giấy hẹp hơn 380px.
    const max = Math.max(380, rap.clientWidth - 360);
    const width = Math.round(Math.min(max, Math.max(380, px)));
    rap.style.setProperty("--preview-w", `${width}px`);
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(width));
  }
  if(sheetZoom === null) requestAnimationFrame(applySheetZoom);
}

(function wirePreviewSplitter(){
  const handle = $("#rapSplit"), rap = $("#s-rap");
  if(!handle) return;
  const saved = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
  if(Number.isFinite(saved) && saved >= 380) setPreviewWidth(saved);

  const widthFrom = (clientX) => rap.getBoundingClientRect().right - clientX;
  const onMove = (e) => setPreviewWidth(widthFrom(e.clientX));
  const stop = () => {
    handle.classList.remove("dragging");
    document.body.style.userSelect = "";
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerup", stop);
  };
  handle.addEventListener("pointerdown", e => {
    e.preventDefault();
    handle.classList.add("dragging");
    // Không có dòng này thì kéo ngang là bôi đen chữ ở cả hai cột.
    document.body.style.userSelect = "none";
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", stop);
  });
  handle.addEventListener("dblclick", () => setPreviewWidth(null));
  handle.addEventListener("keydown", e => {
    const step = e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0;
    if(!step) return;
    e.preventDefault();
    setPreviewWidth($(".preview").getBoundingClientRect().width + step);
  });
})();

/* ── Xem trước bằng PDF THẬT ──────────────────────────────────────────────
 *
 * Bản dựng bằng HTML chỉ gần giống tờ giấy: nó không biết pdfLaTeX ngắt dòng ở
 * đâu, không có cùng phông, và bốn kiểu phương án của nó không khớp một-một với
 * bốn kiểu bên bộ xuất — đúng chỗ người dùng kêu "chọn format này mà xuất ra cái
 * khác". Ở đây hiện đúng cái file sẽ tải về.
 *
 * KHÔNG tự biên dịch lại sau mỗi lần gõ: mỗi lượt tốn vài giây pdfLaTeX và server
 * chạy tuần tự. Sửa đề thì đánh dấu là cũ rồi để người dùng bấm Làm mới.
 */
/**
 * Mặc định là "trình bày của bạn", KHÔNG phải PDF LaTeX.
 *
 * Cả ba đường ra nay đọc chung `resolveFormat()` nên nội dung khớp nhau; chọn
 * bản HTML làm mặc định chỉ vì nó hiện tức thì, còn PDF phải chờ pdfLaTeX chạy
 * vài giây cho mỗi lần dựng.
 */
let previewMode = "style";    // style | pdf
let pdfPreview = { url:null, key:null, busy:false, error:null };

const previewKey = () => `${sheetMode}|${JSON.stringify(DOC)}|${JSON.stringify(header)}|${JSON.stringify(layout)}`;

function paintPreviewMode(){
  const usePdf = previewMode === "pdf" && sheetMode !== "matran";
  $$("[data-pv]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.pv === previewMode)));
  $("#sheetScale").hidden = usePdf;
  $("#pdfView").hidden = !usePdf;
  $("#sheetZoomTools").hidden = usePdf || sheetMode === "matran";
  if(!usePdf) return;
  const stale = pdfPreview.key !== previewKey();
  const note = $("#pdfNote");
  $("#pdfFrame").hidden = !pdfPreview.url;
  const warn = `<span>Đây là file PDF thật do pdfLaTeX biên dịch, mang cùng bộ trình bày với tab <b>Trình bày của bạn</b> và với file Word. Khác biệt còn lại chỉ là chỗ ngắt dòng và ngắt trang của pdfLaTeX.</span>`;
  if(pdfPreview.busy) note.innerHTML = `${SPINNER}<span>Đang biên dịch PDF bằng LaTeX…</span>`;
  /* Lỗi phải sống qua được `paintPreviewMode`. Bản trước ghi lỗi thẳng vào ô này
     rồi khối `finally` gọi lại hàm này và xoá sạch — người dùng chỉ thấy "Bấm
     Làm mới", bấm lại vẫn hỏng, không đời nào đoán ra vì sao. */
  else if(pdfPreview.error) note.innerHTML = `<span class="stale">Không biên dịch được: ${esc(pdfPreview.error)}</span>`;
  else if(!pdfPreview.url) note.innerHTML = `<span>Bấm <b>Làm mới</b> để biên dịch.</span> ${warn}`;
  else if(stale) note.innerHTML = `<span class="stale">Đề đã đổi từ lần biên dịch trước — bấm <b>Làm mới</b>.</span>`;
  else note.innerHTML = warn;
  note.hidden = false;
}

async function buildPdfPreview(){
  if(pdfPreview.busy) return;
  if(sheetMode === "matran"){ previewMode = "fast"; renderSheet(); return; }
  pdfPreview.busy = true;
  pdfPreview.error = null;
  const key = previewKey();
  paintPreviewMode();
  try {
    const bytes = await exportLatexPdf(sheetMode);
    if(pdfPreview.url) URL.revokeObjectURL(pdfPreview.url);
    // #view=FitH để trang mở ra vừa bề ngang khung, khỏi phải kéo zoom mỗi lần.
    pdfPreview.url = URL.createObjectURL(new Blob([bytes], { type:"application/pdf" })) + "#view=FitH&toolbar=1";
    pdfPreview.key = key;
    $("#pdfFrame").src = pdfPreview.url;
  } catch(error){
    pdfPreview.key = null;
    // Log của pdfLaTeX dài cả trang; giữ đoạn cuối vì lỗi thật nằm ở đó.
    pdfPreview.error = String(error.message).slice(-320);
    console.error("[PDF]", error);
    toast(`Xem trước PDF lỗi: ${String(error.message).slice(-120)}`);
  } finally {
    pdfPreview.busy = false;
    paintPreviewMode();
  }
}

$$("[data-pv]").forEach(b => b.addEventListener("click", () => {
  previewMode = b.dataset.pv;
  renderSheet();
  if(previewMode === "pdf" && !pdfPreview.url && sheetMode !== "matran") void buildPdfPreview();
}));

$("#btnRefresh").addEventListener("click", () => {
  if(previewMode === "pdf" && sheetMode !== "matran") return void buildPdfPreview();
  const wrap = $("#sheetwrap");
  const load = document.createElement("div");
  load.className = "loading";
  load.innerHTML = `<div>${SPINNER}<p>Đang dựng bản xem trước…</p></div>`;
  wrap.appendChild(load);
  setTimeout(() => { renderSheet(); load.remove(); }, 820);
});

/* ═══════════════════════════════════════════════════════════ xuất đề ══ */
/* TRƯỚC: xuất ra JSON rồi bảo giáo viên tự chạy pandoc ở phase0. Không đời nào
   có giáo viên nào làm thế.
   NAY: dựng thẳng file .docx trong trình duyệt (web/docx.js + web/omml.js).
   Công thức thành `<m:oMath>` — equation gốc của Word, click vào sửa được.
   Vẫn giữ nút xuất JSON cho người muốn chạy tiếp qua CLI. */

const num = (s) => Number(String(s).replace(",", ".").trim());

/** Bề rộng ảnh trên giấy A4, tính theo % cột chữ đã trừ lề. */
function figPx(widthPct){
  const usableCm = 21 - layout.marginLeft - layout.marginRight;
  const px = (usableCm / 2.54) * 96 * (widthPct / 100);
  return Math.round(px);
}

/* Hình dựng sẵn là SVG. Word không nhận SVG inline nên phải rasterise —
   vẽ SVG lên canvas rồi lấy PNG. Bất đồng bộ, nên phải gom hết hình trước
   khi dựng tài liệu. */
function svgToPng(svg, widthPx){
  return new Promise((resolve) => {
    const m = /viewBox="([\d.\s-]+)"/.exec(svg);
    const vb = m ? m[1].trim().split(/\s+/).map(Number) : [0,0,200,100];
    const ratio = vb[3] / vb[2];
    const w = widthPx, h = Math.round(widthPx * ratio);
    // currentColor không có nghĩa ngoài DOM — chốt thành đen cho bản in.
    const src = svg.replace(/currentColor/g, "#000000")
                   .replace(/<svg /, `<svg xmlns="http://www.w3.org/2000/svg" `);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w * 2; c.height = h * 2;          // ×2 cho đỡ vỡ khi in
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve({ src:c.toDataURL("image/png"), w, h });
    };
    img.onerror = () => resolve(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
  });
}

/** Ảnh giáo viên tải lên đã là data URL, chỉ cần đo lại tỉ lệ. */
function measureImage(src, widthPx){
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ src, w:widthPx, h:Math.round(widthPx * img.height / img.width) });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function prepareFigure(fig){
  const g = normFig(fig);
  if(!g?.src) return null;
  const px = figPx(g.width);
  if(FIGS[g.src]) return await svgToPng(FIGS[g.src], px);
  if(String(g.src).startsWith("data:")) return await measureImage(g.src, px);
  if(String(g.src).startsWith("/api/")){
    try {
      const response = await fetch(g.src);
      if(!response.ok) return null;
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return await measureImage(dataUrl, px);
    } catch { return null; }
  }
  return null;
}

function buildExamDoc(){
  const questions = [];
  const holes = [];

  for(const b of DOC){
    if(b.kind !== "sec") continue;
    // Tiêu đề phần đi kèm từng câu: bộ dựng LaTeX làm phẳng danh sách câu nên
    // không còn thấy khối, mà tờ đề nào cũng phải có "PHẦN I — TRẮC NGHIỆM".
    const sectionTitle = secTitle(b);
    for(const x of flatten(b)){
      if(x._pending){ holes.push(DNAME[x._pending]); continue; }
      const g = normFig(x.fig);
      questions.push({
        type: x.type,
        section_title: sectionTitle,
        section_note: b.note || null,
        printed_number:x.printedNumber || null,
        stem_latex: repairLegacyMathSource(cleanImageMarkers(x.stem)),
        bbox: reviewBox(x.bbox) || [0,0,1,1],
        group_ref: x.groupId || null,
        group: x.groupId ? {
          id:x.groupId, label:x.groupLabel || null, stem_latex:x.groupStem || "",
          bbox:reviewBox(x.groupBbox) || [0,0,1,1],
          image:x.groupFig || null,
        } : null,
        images: g?.src
          ? [{ slot:1, bbox:[0,0,1,1], caption:null, note:x.figNote ?? null,
               width_pct:g.width, placement:g.place, src:g.src }]
          : [],
        mc_choices: x.type === "MC" && x.ch
          ? x.ch.map((c,i) => ({ label: chLabel(x,i), text_latex: repairLegacyMathSource(c) })) : null,
        mc_correct: x.type === "MC" && x.ans != null ? chLabel(x, x.ans) : null,
        tf_statements: x.type === "TF" && x.tf
          ? x.tf.map(([t,v],i) => ({ idx: TFIDX[i], text_latex: repairLegacyMathSource(t), is_true: v })) : null,
        short_answer: x.type === "SHORT" && x.sa
          ? { value: num(x.sa.value), unit: x.sa.unit || null, tolerance: num(x.sa.tol) || null }
          : null,
        solution_latex: x.sol || null,
        grade: x.grade ?? null,
        topic_code: x.topic ?? null,
        difficulty: x.diff,
        answer_source:["printed","manual"].includes(x.answerSource) ? x.answerSource : "none",
        notes: null
      });
    }
  }

  return {
    doc: {
      header: {
        org: header.org, school: header.school, title: header.title,
        subject: header.subject, durationMin: header.duration,
        tmpl: header.tmpl, year: header.year, showId: header.showId !== false,
        code: header.showCode ? header.code : undefined
      },
      // Trình bày đi kèm đề, không phải cài đặt của máy: cùng một đề xuất lại
      // sau nửa năm phải ra đúng lề, đúng watermark như lần đầu.
      layout: {
        marginCm: { top:layout.marginTop, right:layout.marginRight,
                    bottom:layout.marginBottom, left:layout.marginLeft },
        fontSizePt: layout.fontSize,
        lineGap: layout.lineGap,
        logo: layout.logo,
        watermark: layout.watermark.trim() || null,
        watermarkOpacity: layout.watermarkOpacity,
        watermarkAngle: layout.watermarkAngle,
        presetName: layout.presetName,
        questionStyle: layout.questionStyle,
        fontFamily: layout.fontFamily,
        accentColor: layout.accentColor,
        accentSoft: layout.accentSoft,
        borderColor: layout.borderColor,
        sectionHeading: layout.sectionHeading,
        showTypeLabel: layout.showTypeLabel,
        mcColumns: layout.mcColumns,
        mcStyle: layout.mcStyle,
        tfStyle: layout.tfStyle,
        shortBoxCount: layout.shortBoxCount,
        shortStyle: layout.shortStyle,
        shortWorkLines: layout.shortWorkLines,
        shortWorkLabel: layout.shortWorkLabel,
        essayWorkLines: layout.essayWorkLines,
        essayWorkLabel: layout.essayWorkLabel,
        essayStyle: layout.essayStyle,
        topNote: layout.topNote,
        bottomNote: layout.bottomNote,
        topImage: layout.topImage,
        bottomImage: layout.bottomImage,
        referenceName: layout.referenceName || null
      },
      questions
    },
    holes
  };
}

function download(name, text){
  const url = URL.createObjectURL(new Blob([text], { type:"application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── dựng thân file Word ─────────────────────────────────────────────────
 * Mỗi khối trong DOC thành mấy đoạn văn. Ảnh phải gom trước (rasterise SVG
 * là việc bất đồng bộ) rồi mới ráp, nên hàm này async.
 */
async function buildDocxBody(mode){
  const body = [];
  const images = [];
  let rid = 100;                       // id quan hệ của ảnh, tránh đụng rIdStyles
  let mathCount = 0;
  const countMath = (s) => { mathCount += (String(s).match(/\$/g)?.length ?? 0) / 2; };

  /* Word đọc CHUNG bảng quyết định với bản xem trước. Bản trước tự suy lại từ
     `layout` và suy khác: kiểu Đúng–Sai, ô trả lời ngắn và tiêu đề phần đều bị
     khoá sau điều kiện "form có màu", nên form Tối giản chọn gì cũng ra danh
     sách trơn trong khi màn hình vẽ đúng thứ đã chọn. */
  const F = resolveFormat(layout);
  const S = F.fontSize;
  const key = mode === "dapan", sol = mode === "loigiai";
  const hexOf = (value) => String(value).replace(/^#/, "").toUpperCase();
  const INK = hexOf(F.ink), SOFT = hexOf(F.soft), BORDER = hexOf(F.border);

  /* Ô của bảng Word phải KẾT THÚC bằng một đoạn văn. Câu nào có lưới phương án
     thì nội dung kết thúc bằng `</w:tbl>` — thiếu đoạn văn chốt là Word báo file
     hỏng. */
  const cellSafe = (xml) => /<\/w:tbl>\s*$/.test(xml) ? xml + para("", { after:0 }) : xml;
  /** Khung card quanh câu — chỉ ba form có màu mới đóng khung, giống hệt màn hình. */
  const cardWrap = (xml) => F.card
    ? wTable([[{ content:cellSafe(xml), fill:"FFFFFF", border:BORDER }]], [100], { borderColor:BORDER })
    : xml;

  async function figPara(fig){
    const g = normFig(fig);
    const shot = await prepareFigure(fig);
    if(!shot) return "";
    rid++;
    images.push({ rid, src:shot.src });
    const align = g.place === "left" ? "left" : g.place === "right" ? "right" : "center";
    return para(imageRun(rid, shot.w, shot.h, "hinh"), { align, after:80 });
  }

  function workLineParas(lines, label, blank = false){
    const count = Math.max(0, Math.min(30, Number(lines) || 0));
    if(!count) return "";
    let out = para(txt(label || "Bài làm", { bold:true, color:INK }), { before:80, after:30, keepNext:true });
    for(let i = 0; i < count; i++)
      out += para(txt(blank ? " " : "·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·", { color:"B8C2CC" }), { after:blank ? 160 : 40 });
    return out;
  }

  function shortAnswerTable(x){
    const count = F.shortBoxCount;
    const raw = key && x.sa ? String(x.sa.value ?? "") : "";
    const values = count === 1 ? [raw] : Array.from({ length:count }, (_, i) => raw[i] || "");
    const row = values.map(value => ({
      content:para(txt(value, { bold:true, color:INK }), { align:"center", after:0 }),
      fill:"FFFDF8", border:BORDER,
    }));
    return para(txt("Trả lời ngắn", { bold:true, color:INK }), { before:50, after:30 }) +
      wTable([row], values.map(() => 100 / values.length), { borderColor:BORDER });
  }

  async function questionParas(x, no){
    let out = "";
    const g = normFig(x.fig);
    countMath(x.stem);

    // Nhãn dạng câu chỉ hiện ở ba form có khung, đúng như bản xem trước.
    const typeLabel = F.card && F.showTypeLabel && TYPE_NAME[x.type]
      ? txt(`   ${TYPE_NAME[x.type]}`, { italic:true, size:S - 1.5, color:INK }) : "";
    out += para(txt(`Câu ${no}. `, { bold:true, color:INK }) + wtex(x.stem, { size:S }) + typeLabel,
             { keepNext:true, lineGap:F.lineGap });

    /* Hình đặt "trên phương án" nghĩa là NẰM DƯỚI ĐỀ BÀI và trên bốn phương án,
       không phải trên cả câu — bản trước đẩy hình lên trước cả chữ "Câu 1.".
       Word không cho chữ chạy vòng quanh ảnh inline, nên hình "nổi hai bên"
       rơi về ảnh riêng một dòng, căn đúng phía giáo viên đã chọn. */
    if(g?.place === "top" || g?.place === "left" || g?.place === "right"){
      out += await figPara(x.fig);
    }

    if(x.type === "MC" && x.ch){
      x.ch.forEach(c => countMath(c));
      /* Ô tròn trong Word: dùng ký tự Ⓐ–Ⓗ (U+24B6…) chứ không vẽ hình.
         Chữ vẫn là chữ nên giáo viên sửa, xoá, đổi phông được như mọi ký tự
         khác — đúng cam kết "DOCX phải sửa được", khác hẳn việc chèn shape.

         Bốn kiểu phương án chạy được ở CẢ BỐN form, y như màn xem trước:
         `circle`/`cards` khoanh tròn chữ cái, `cards`/`tabular` kẻ khung ô. */
      const circledLetter = (i) => String.fromCodePoint(0x24B6 + Math.max(0, LETTER.indexOf(chLabel(x,i))));
      const useCircle = F.mcStyle === "circle" || F.mcStyle === "cards";
      const ruled = F.mcStyle === "cards" || F.mcStyle === "tabular";
      const columns = mcColumnsFor(x.ch, F.mcColumns);
      const cell = (i) => para(txt(useCircle ? `${circledLetter(i)} ` : `${chLabel(x,i)}. `, { bold:!useCircle, color:ruled ? INK : undefined }) +
        wtex(x.ch[i] ?? "", { size:S }) +
        (key && x.ans === i ? txt("   ✔", { bold:true }) : ""), { after:0 });
      const rows = [];
      for(let start = 0; start < x.ch.length; start += columns){
        rows.push(Array.from({ length:columns }, (_, offset) => {
          const i = start + offset;
          const content = i < x.ch.length ? cell(i) : para("");
          if(!ruled) return i < x.ch.length && key && x.ans === i
            ? { content, fill:"EAF8F0" } : content;
          return { content, fill:key && x.ans === i && i < x.ch.length ? "EAF8F0" : "FFFFFF",
                   border:F.mcStyle === "tabular" ? "111111" : BORDER };
        }));
      }
      out += wTable(rows, Array(columns).fill(100 / columns),
        ruled ? { borderColor:F.mcStyle === "tabular" ? "111111" : BORDER } : {});
      if(key && x.ans == null) out += para(txt("Không có đáp án in sẵn", { italic:true, color:"78818D" }), { after:80 });
    }

    if(x.type === "TF" && x.tf){
      x.tf.forEach(([s]) => countMath(s));
      if(F.tfStyle === "list"){
        out += x.tf.map(([s,v],i) =>
          para(txt(`${TFIDX[i]}) `, { bold:true, color:INK }) + wtex(s, { size:S }) +
            (key ? txt(`   ${v === true ? "Đ" : v === false ? "S" : "—"}`, { bold:true }) : ""),
            { indent:0.6, after:20 })).join("");
      } else {
        // "tabular" là bảng kẻ đen kiểu LaTeX; "table" là bảng có thanh tiêu đề màu.
        const plainHead = F.tfStyle === "tabular";
        const headFill = plainHead ? "FFFFFF" : INK;
        const headText = plainHead ? "111111" : "FFFFFF";
        const tableBorder = plainHead ? "111111" : BORDER;
        const head = ["Phát biểu","Đúng","Sai"].map(label => ({
          content:para(txt(label, { bold:true, color:headText }), { align:"center", after:0 }), fill:headFill,
        }));
        const rows = x.tf.map(([statement, value], i) => [
          { content:para(txt(`${TFIDX[i]}) `, { bold:true, color:INK }) + wtex(statement, { size:S }), { after:0 }), fill:"FFFFFF" },
          { content:para(txt(key && value === true ? "✓" : "" , { bold:true, color:"15945F" }), { align:"center", after:0 }), fill:key && value === true ? "EAF8F0" : "FFFFFF" },
          { content:para(txt(key && value === false ? "✓" : "" , { bold:true, color:"15945F" }), { align:"center", after:0 }), fill:key && value === false ? "EAF8F0" : "FFFFFF" },
        ]);
        out += wTable([head, ...rows], [70,15,15], { borderColor:tableBorder });
      }
    }

    if(x.type === "SHORT"){
      if(F.shortStyle === "line")
        out += key && x.sa
          ? para(txt("Trả lời: ") + txt(`${x.sa.value} ${x.sa.unit ?? ""}`, { bold:true }), { indent:0.6 })
          : para(txt("Trả lời: ........................................"), { indent:0.6 });
      else out += shortAnswerTable(x);
      if(!key && !sol) out += workLineParas(F.shortWorkLines, F.shortWorkLabel, F.shortStyle === "line");
    }

    if(x.type === "ESSAY" && !key && !sol)
      out += workLineParas(F.essayWorkLines, F.essayWorkLabel, F.essayStyle === "blank");

    if(g?.place === "below") out += await figPara(x.fig);

    if(sol){
      if(x.type === "TF" && x.tf?.some(st => st[2])){
        out += para(txt("Lời giải.", { bold:true, italic:true }), { indent:0.6, after:20 });
        out += x.tf.map(([,v,why],i) => {
          countMath(why ?? "");
          return para(txt(`${TFIDX[i]}) ${v === true ? "Đúng" : v === false ? "Sai" : "Chưa có đáp án"}`, { bold:true }) +
            (why ? txt(" — ") + wtex(why, { size:S - 0.5 }) : ""), { indent:1.2, after:20 });
        }).join("");
      }
      if(x.sol){
        countMath(x.sol);
        out += para(txt(x.type === "TF" ? "" : "Lời giải. ", { bold:true, italic:true }) +
                 wtex(x.sol, { size:S - 0.5 }), { indent:0.6, after:140 });
      }
    }
    return cardWrap(out);
  }

  async function groupParas(x){
    if(!x.groupId || key) return "";
    countMath(x.groupStem || "");
    // Khối dữ liệu dùng chung là hộp nền nhạt ở mọi form, giống bản xem trước.
    let out = wTable([[{ content:para(txt(x.groupLabel || "Dữ liệu dùng chung cho các câu sau", { bold:true, color:INK }) +
      (x.groupStem ? txt(" — ") + wtex(x.groupStem, { size:S }) : ""), { after:20 }), fill:SOFT }]], [100], { borderColor:BORDER });
    if(x.groupFig) out += await figPara(x.groupFig);
    return out;
  }

  for(const b of DOC){
    if(b.kind === "cover"){
      const c = b.data;
      body.push(para(txt(c.org ?? "", { caps:true }), { align:"center", before:1200 }));
      body.push(para(txt(c.school ?? "", { bold:true, size:S + 2, caps:true }), { align:"center", after:600 }));
      if(c.logo){
        const shot = await measureImage(c.logo, 120);
        if(shot){ rid++; images.push({ rid, src:shot.src });
          body.push(para(imageRun(rid, shot.w, shot.h, "logo"), { align:"center", after:400 })); }
      }
      body.push(para(txt(c.title ?? "", { bold:true, size:S + 10 }), { align:"center", after:200 }));
      body.push(para(txt(c.subject ?? "", { size:S + 3 }), { align:"center", after:120 }));
      if(c.note) body.push(para(txt(c.note), { align:"center", after:600 }));
      body.push(para(txt(c.year ?? "", { italic:true }), { align:"center", before:1600 }));
      body.push(para(txt(""), { pageBreak:true }));
      continue;
    }

    if(b.kind === "hdr"){
      const h = header;
      /* Bốn mẫu đầu đề của màn xem trước phải có đủ bốn nhánh ở đây. Bản trước
         chỉ tách riêng "bk", nên chọn mẫu "gọn" hay mẫu có logo thì Word vẫn ra
         đầu đề hai cột và logo rơi mất. */
      if(h.tmpl === "bk"){
        body.push(wTable([[para(txt(h.org)), para(txt(h.school),{align:"right"})]],[50,50]));
        body.push(wHr());
        body.push(para(txt(h.title,{bold:true,size:S+4}),{align:"center",before:100,after:40}));
        if(h.subject) body.push(para(txt(h.subject,{size:S+1}),{align:"center",after:160}));
      } else if(h.tmpl === "gon"){
        body.push(para(txt(h.school, { bold:true }) +
          txt(` — ${h.title} · ${h.subject} · ${h.duration} phút${h.showCode ? " · mã " + h.code : ""}`),
          { after:60 }));
        body.push(wHr());
      } else {
        let leftMark = "";
        if(h.tmpl === "logo" && layout.logo){
          const shot = await measureImage(layout.logo, Math.max(36, Number(layout.logoSize) || 44));
          if(shot){ rid++; images.push({ rid, src:shot.src });
            leftMark = para(imageRun(rid, shot.w, shot.h, "logo"), { after:40 }); }
        }
        const left = leftMark + para(txt(h.org)) + para(txt(h.school, { bold:true, caps:true })) +
                     para(txt(`Năm học ${h.year}`, { size:S - 2 }));
        const right = para(txt(h.title.toUpperCase(), { bold:true }), { align:"right" }) +
                      para(txt(h.subject), { align:"right" }) +
                      para(txt(`Thời gian làm bài: ${h.duration} phút`), { align:"right" }) +
                      (h.showCode ? para(txt(`Mã đề ${h.code}`), { align:"right" }) : "");
        body.push(wTable([[left, right]], [50, 50]));
        body.push(wHr());
      }
      if(h.showId){
        body.push(para(txt("Họ và tên: ................................................    " +
                      "Lớp: ................    SBD: ................"), { after:200 }));
      }
      if(!key && !sol && layout.topImage){
        const image = await figPara({ src:layout.topImage, width:100, place:"top" });
        if(image) body.push(image);
      }
      if(!key && !sol && layout.topNote)
        body.push(para(wtex(layout.topNote, { size:S }), { align:"center", after:120 }));
      continue;
    }

    if(b.kind === "text"){
      // Khối chữ tự do của giáo viên — xem htmlToParas().
      body.push(...htmlToParas(b.html ?? "", S));
      continue;
    }

    if(b.kind !== "sec") continue;

    const headingText = secTitle(b).toUpperCase();
    // Kiểu tiêu đề phần chạy được ở cả bốn form — trước đây form Tối giản chọn
    // "Thanh màu" thì màn hình vẽ thanh còn Word ra chữ đen trơn.
    if(F.sectionHeading === "bar")
      body.push(wTable([[{ content:para(txt(headingText, { bold:true, size:S + 1, color:"FFFFFF" }), { after:0 }), fill:INK }]], [100], { borderColor:INK }));
    else if(F.sectionHeading === "outline")
      body.push(wTable([[{ content:para(txt(headingText, { bold:true, size:S + 1, color:INK }), { after:0 }), fill:"FFFFFF", border:BORDER }]], [100], { borderColor:BORDER }));
    else body.push(para(txt(headingText, { bold:true, size:S + 1 }),
                { before:200, after:100, keepNext:true }));
    if(b.note) body.push(para(txt(b.note, { italic:true, size:S - 1 }), { after:100 }));

    const list = flatten(b);
    let n = 0;
    let lastGroup = null;
    for(const x of list){
      if(x._pending) continue;
      if(x.groupId && x.groupId !== lastGroup) body.push(await groupParas(x));
      body.push(await questionParas(x, ++n));
      lastGroup = x.groupId || null;
    }
  }

  if(!key && !sol && layout.bottomImage){
    const image = await figPara({ src:layout.bottomImage, width:100, place:"top" });
    if(image) body.push(image);
  }
  if(!key && !sol && layout.bottomNote)
    body.push(para(wtex(layout.bottomNote, { size:S }), { align:"center", before:120 }));

  return { body, images, mathCount:Math.round(mathCount) };
}

/** Khối chữ tự do: HTML rất hạn chế → đoạn văn Word. */
function htmlToParas(html, S){
  const box = document.createElement("div");
  box.innerHTML = html;
  const out = [];
  const runOf = (node, fmt) => {
    if(node.nodeType === 3) return txt(node.nodeValue, fmt);
    const f = { ...fmt };
    const tag = node.tagName?.toLowerCase();
    if(tag === "b" || tag === "strong") f.bold = true;
    if(tag === "i" || tag === "em") f.italic = true;
    return [...node.childNodes].map(c => runOf(c, f)).join("");
  };
  for(const el of box.children.length ? [...box.children] : [box]){
    const align = el.style?.textAlign || undefined;
    const txt = el.textContent.trim();
    if(!txt){ out.push(para("")); continue; }
    const tag = el.tagName?.toLowerCase();
    const big = tag === "h3" ? S + 3 : tag === "h4" ? S + 1 : S;
    out.push(para([...el.childNodes].map(c => runOf(c, { size:big, bold:tag?.startsWith("h") })).join(""),
               { align, after:100 }));
  }
  return out;
}

/** Tên hiển thị của một phần: giáo viên đặt gì thì dùng, không thì tên mặc định. */
function secTitle(b){
  if(b.title) return b.title;
  const i = DOC.filter(x => x.kind === "sec").indexOf(b);
  return `Phần ${ROMAN[i] ?? i + 1} — ${TYPES[b.type]}`;
}

async function exportDocx(mode){
  const { body, images, mathCount } = await buildDocxBody(mode);
  if(!body.length){ toast("Đề chưa có gì để xuất"); return null; }

  const F = resolveFormat(layout);
  const { bytes, xml } = buildDocx({
    body, images,
    layout: {
      marginTop:F.margin.top, marginRight:F.margin.right,
      marginBottom:F.margin.bottom, marginLeft:F.margin.left,
      fontSize:F.fontSize, lineGap:F.lineGap,
      fontFamily:F.fontFamily,
      // Đề hai cột phải ra hai cột trong Word, không chỉ trên màn hình.
      columns:F.columns,
      watermark:F.watermark || null,
      watermarkOpacity:F.watermarkOpacity, watermarkAngle:F.watermarkAngle
    }
  });

  const check = killTest(xml, mathCount);
  if(check.unknown.length){
    console.warn("[Word] lệnh LaTeX chưa hỗ trợ:", check.unknown.join(", "));
  }
  return { bytes, check };
}

function saveBlob(name, bytes, type){
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SHEETS = { de:"de", dapan:"dap-an", loigiai:"loi-giai" };

async function exportLatexPdf(mode){
  const { doc, holes } = buildExamDoc();
  if(holes.length) throw new Error(`Còn ${holes.length} chỗ chưa rút câu`);
  const assets = {};
  for(let i=0;i<doc.questions.length;i++){
    const question = doc.questions[i];
    const fig = question.images?.[0];
    if(!fig?.src) continue;
    const prepared = await prepareFigure({src:fig.src,width:fig.width_pct||58,place:"top"});
    if(prepared?.src) assets[`q:${i}`] = prepared.src;
  }
  const groupAssets = new Set();
  for(const question of doc.questions){
    const group = question.group;
    if(!group?.id || !group.image?.src || groupAssets.has(group.id)) continue;
    const prepared = await prepareFigure(group.image);
    if(prepared?.src) assets[`g:${group.id}`] = prepared.src;
    groupAssets.add(group.id);
  }
  /* `fetch` ném TypeError "Failed to fetch" khi KHÔNG NỐI ĐƯỢC máy chủ — server
     tắt, mất mạng, tunnel đứt. Đó không phải lỗi biên dịch LaTeX, nhưng chữ tiếng
     Anh trần trụi đó khiến người dùng đi tìm lỗi ở chỗ họ vừa đổi trình bày. */
  let response;
  try {
    response = await fetch("/api/export/latex-pdf",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({doc,mode,assets,filename:`${SHEETS[mode]||"de"}-${(header.code||"de").replace(/[^\w-]/g,"")}`})
    });
  } catch {
    throw new Error("Mất kết nối tới máy chủ EduVault — kiểm tra xem server còn chạy không rồi bấm Làm mới.");
  }
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||"Không biên dịch được LaTeX");}
  return new Uint8Array(await response.arrayBuffer());
}

$("#btnExport").addEventListener("click", async () => {
  const { holes } = buildExamDoc();
  if(holes.length){
    toast(`Còn ${holes.length} chỗ chưa rút câu — bấm “Rút lại câu ngẫu nhiên” trước đã`);
    return;
  }
  const btn = $("#btnExport");
  btn.disabled = true; btn.textContent = "Đang dựng…";
  try {
    const code = (header.code || "de").replace(/[^\w-]/g,"");
    // Mặc định xuất đúng bản đang xem. Muốn cả bộ thì dùng menu bên cạnh.
    const mode = sheetMode === "matran" ? "de" : sheetMode;
    const r = await exportDocx(mode);
    if(!r) return;
    saveBlob(`${SHEETS[mode] ?? "de"}-${code}.docx`, r.bytes, DOCX_MIME);
    toast(r.check.pass
      ? `Đã tải file Word — ${r.check.note}`
      : `Đã tải file Word nhưng ${r.check.note}`);
  } catch(err){
    console.error(err);
    toast("Dựng file Word hỏng: " + err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Xuất Word";
  }
});

/** Xuất cả bộ: đề + đáp án + lời giải, ba file. */
$("#btnExportAll").addEventListener("click", async () => {
  const btn = $("#btnExportAll");
  btn.disabled = true; btn.textContent = "Đang dựng…";
  try {
    const code = (header.code || "de").replace(/[^\w-]/g,"");
    for(const mode of ["de","dapan","loigiai"]){
      const r = await exportDocx(mode);
      if(!r) continue;
      saveBlob(`${SHEETS[mode]}-${code}.docx`, r.bytes, DOCX_MIME);
      await new Promise(res => setTimeout(res, 350));   // trình duyệt chặn tải dồn
    }
    toast("Đã tải 3 file: đề · đáp án · lời giải");
  } finally {
    btn.disabled = false; btn.textContent = "Xuất cả bộ";
  }
});

$("#btnExportJson").addEventListener("click", () => {
  const { doc } = buildExamDoc();
  const name = `de-${(header.code || "de").replace(/[^\w-]/g,"")}.json`;
  download(name, JSON.stringify(doc, null, 2));
  toast(`Đã tải ${name} — dành cho ai muốn chạy tiếp bằng phase0`);
  $(".tool-more")?.removeAttribute("open");
});

/* ═════════════════════════════════════════════════ dựng khung, rút câu ══ */

/* Dựng khung đề theo cấu trúc thi thật, NHƯNG chia độ khó theo đúng số câu
   thực có trong kho. Chia theo tỉ lệ cố định thì sinh ra khung không bao giờ
   ráp nổi — đó là bất cập nặng nhất tìm được khi chạy thử. */
function feasibleMix(type, need){
  const pool = Object.fromEntries(DIFFS.map(d =>
    [d, ofSubject().filter(q => q.type === type && q.diff === d).length]));
  const want = { NB:0.25, TH:0.35, VD:0.28, VDC:0.12 };

  const mix = {};
  let left = need;
  for(const d of DIFFS){
    const take = Math.min(pool[d], Math.round(need * want[d]));
    mix[d] = take; left -= take;
  }
  for(const d of DIFFS){
    if(left <= 0) break;
    const more = Math.min(pool[d] - mix[d], left);
    mix[d] += more; left -= more;
  }
  return { mix, shortfall: left };
}

$("#btnBlueprint").addEventListener("click", () => {
  const bp = BLUEPRINTS[subject];
  touchDoc(); finderFor = null;
  const missing = [];
  DOC = [{ kind:"hdr" }, ...bp.secs.map(([type,n]) => {
    const { mix, shortfall } = feasibleMix(type, n);
    if(shortfall > 0) missing.push(`${TYPES[type]}: thiếu ${shortfall} câu`);
    return { kind:"sec", type,
      items: DIFFS.filter(d => mix[d] > 0).map(d => ({ mode:"rnd", n:mix[d], diff:d, picked:null })) };
  })];
  header.duration = bp.duration;
  header.subject = subject === "math" ? "Toán 12" : "Vật lí 12";
  resolveRandom();
  toast(missing.length ? `Khung đã dựng — ${missing.join(" · ")}` : `Đã dựng khung ${bp.name}`);
});

/* Chốt các khối ngẫu nhiên thành câu thật, tránh trùng với câu đã chọn tay
   và trùng lẫn nhau. Không có bước này thì bản xem trước toàn chỗ trống,
   mà đề không đọc được thì không duyệt được. */
function resolveRandom(){
  const used = new Set();
  for(const b of DOC){
    if(b.kind !== "sec") continue;
    for(const it of b.items) if(it.mode === "q") used.add(it.qid);
  }
  // Chọn tay một thành viên thì xem cả cụm là đã dùng; không rút lẻ phần còn lại.
  for(const id of [...used]){
    const q = qById(id);
    if(q?.groupId) BANK.filter(x => x.vaultId === q.vaultId && x.groupId === q.groupId).forEach(x => used.add(x.id));
  }
  for(const b of DOC){
    if(b.kind !== "sec") continue;
    for(const it of b.items){
      if(it.mode !== "rnd") continue;
      const eligible = ofSubject().filter(q => q.type === b.type && q.diff === it.diff && !used.has(q.id));
      const seenGroups = new Set();
      const pool = [];
      for(const q of eligible){
        if(!q.groupId){ pool.push([q.id]); continue; }
        if(seenGroups.has(q.groupId)) continue;
        seenGroups.add(q.groupId);
        const members = BANK.filter(x => x.vaultId === q.vaultId && x.groupId === q.groupId)
          .sort((a,c) => (a.groupOrder || 0) - (c.groupOrder || 0));
        // Cụm khác dạng/độ khó không thể nằm trọn trong block này: bỏ, không xé lẻ.
        if(members.length && members.every(x => x.type === b.type && x.diff === it.diff && !used.has(x.id)))
          pool.push(members.map(x => x.id));
      }
      for(let i = pool.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      it.picked = [];
      for(const cluster of pool){
        if(it.picked.length + cluster.length > it.n) continue;
        it.picked.push(...cluster);
        if(it.picked.length === it.n) break;
      }
      it.picked.forEach(id => used.add(id));
    }
  }
  paintCanvas(); renderSheet();
}

$("#btnResolve").addEventListener("click", () => {
  if(!DOC.some(b => b.kind === "sec" && b.items.some(it => it.mode === "rnd"))){
    toast("Đề này không có khối ngẫu nhiên nào"); return;
  }
  resolveRandom();
  toast("Đã rút câu — bản xem trước là đề thật");
});

/* ═══════════════════════════════════════════════════════════ duyệt ══ */
/* Màn này trước đây không có: AI đọc xong thì câu đi thẳng vào kho, không ai
   soi. Nay mỗi câu phải qua mắt người, đặt cạnh ảnh gốc, và chỗ hai model đọc
   khác nhau thì tô vàng bắt chọn. */

let rvIdx = 0;
let rvDoc = null;         // luôn duyệt đúng một tài liệu, không có hàng "tất cả"
let rvFilter = "all";     // all | flag | clean | dup
const rvDeferred = new Set();   // câu bấm "để sau", dồn xuống cuối
/* Đếm việc đã xử lý trong phiên, để thanh tiến độ có mốc so. */
const rvSession = { done:0 };
let rvRegionMode = null;   // figure | groupFigure — chỉ còn crop hình
let rvRegionQuestionId = null;
let rvSelection = null;
let rvLastPageKey = null;  // chỉ cuộn lại ảnh khi thật sự đổi trang
const rvSelected = new Set();  // id câu đang tích để xoá hàng loạt
let rvZoom = 1;            // mức phóng ảnh trang; 1 = vừa bề ngang khung

const rvSourceKey = (p) => p.srcId ? `id:${p.srcId}` : `name:${p.src}`;
const reviewBox = (value) => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
  && value[2] > value[0] && value[3] > value[1]
    ? value.map(n => Math.max(0, Math.min(1, n))) : null;
const boxCss = (box) => `left:${box[0]*100}%;top:${box[1]*100}%;width:${(box[2]-box[0])*100}%;height:${(box[3]-box[1])*100}%`;
const groupPeers = (p) => p?.groupId ? [...PENDING, ...BANK].filter(x => x.vaultId === p.vaultId && x.groupId === p.groupId) : [];
function setGroupField(p, key, value){
  for(const peer of groupPeers(p)) peer[key] = structuredClone(value);
  const entity = p?.groupId ? GROUPS.find(group => group.vaultId === p.vaultId && group.id === p.groupId) : null;
  if(entity){
    const map = { groupLabel:"label", groupStem:"stem", groupFig:"figure", groupFigures:"figures" };
    if(map[key]) entity[map[key]] = structuredClone(value);
  }
}
function sourceJobId(source){
  return source?.jobId || /\/api\/jobs\/([^/]+)\//.exec(source?.pageUrl || "")?.[1] || null;
}
function sourceForQuestion(question){
  if(!question) return null;
  return activeSources().find(source => source.id === question.srcId)
    ?? activeSources().find(source => source.name === question.src);
}
function questionPageIndex(q){
  const explicit = Number(q?.pageIndex);
  if(Number.isInteger(explicit) && explicit > 0) return explicit;
  const match = /^Câu\s+(\d+)/i.exec(String(q?.raw?.[0] || ""));
  return match ? Number(match[1]) : null;
}
function stopReviewRegion(repaint = true){
  rvRegionMode = null; rvRegionQuestionId = null; rvSelection = null;
  if(repaint) paintReview();
}
function startReviewRegion(mode){
  const p = rvList()[rvIdx];
  if(!p) return;
  rvRegionMode = mode; rvRegionQuestionId = p.id;
  rvSelection = reviewBox(mode === "groupFigure" ? p.groupFig?.bbox : p.fig?.bbox);
  paintReview();
}

/* ── ba tín hiệu MIỄN PHÍ thay cho việc chạy model thứ hai ──────────────────
 * Xem ghi chú trong data.js chỗ bỏ đối chiếu chéo. Mỗi cờ là một lý do CỤ THỂ
 * để giáo viên phải nhìn câu này, chứ không phải một điểm tin cậy mơ hồ.
 */
/* So NGUYÊN VĂN đề bài, KHÔNG bỏ công thức đi.
   Bản trước so bằng `plain()` — hàm đó cắt sạch mọi cụm $…$, tức là cắt sạch
   số liệu. Hậu quả: "tốc độ $v = 20$" và "tốc độ $v = 60$" thành cùng một câu,
   nạp 150 câu thì 76 câu bị vu là trùng. Số liệu CHÍNH LÀ thứ phân biệt hai
   câu vật lí, không được bỏ. */
const normStem = (t) => fold(String(t))
  .replace(/\s+/g, " ")
  .replace(/[{}\$]/g, "")
  .trim();
const sameStem = (a, b) => normStem(a) === normStem(b);
const dupOf = (p) => ofSubject().find(x => sameStem(x.stem, p.stem));

function flagsOf(p){
  const f = [];
  if(dupOf(p))                    f.push({ k:"dup",  t:"Trùng câu đã có trong kho" });
  if(p.notes)                     f.push({ k:"note", t:p.notes });
  if(p.answerSource === "none")   f.push({ k:"ans",  t:"Tài liệu không in đáp án — hệ thống để trống" });
  if(p.figNote && !hasFig(p))     f.push({ k:"fig",  t:"Có hình, chưa crop được ảnh" });
  if(p.groupFigNote && !p.groupFig) f.push({ k:"fig", t:"Cụm dữ liệu có hình, chưa crop được ảnh" });
  return f;
}

/* "Tin cậy cao" = không có cờ NẶNG nào. Câu không có đáp án in sẵn và hình chưa gắn
   vẫn cho duyệt hàng loạt — hai thứ đó có thể bổ sung sau. Còn câu trùng kho hoặc
   chỗ model tự khai đọc không chắc thì phải người quyết ngay. */
const isHeavy = (f) => f.k === "dup" || f.k === "note";
const isConfident = (p) => !flagsOf(p).some(isHeavy);

/** Danh sách đang xét, sau khi lọc theo tài liệu và theo cờ. */
function rvList(){
  let list = activePending().filter(p => rvSourceKey(p) === rvDoc);
  if(rvFilter === "flag")  list = list.filter(p => flagsOf(p).some(isHeavy));
  if(rvFilter === "clean") list = list.filter(isConfident);
  if(rvFilter === "dup")   list = list.filter(p => dupOf(p));
  // Câu bấm "để sau" dồn xuống cuối chứ không mất đi.
  return [...list.filter(p => !rvDeferred.has(p.id)),
          ...list.filter(p => rvDeferred.has(p.id))];
}

function docsInQueue(){
  const m = new Map();
  for(const p of activePending()){
    const key = rvSourceKey(p);
    const source = activeSources().find(s => s.id === p.srcId) ?? activeSources().find(s => s.name === p.src);
    const row = m.get(key) ?? { key, name:source?.name ?? p.src, count:0 };
    row.count++;
    m.set(key, row);
  }
  return [...m.values()];
}

function paintPendCount(){
  const el = $("#pendCount");
  const count = activePending().length;
  el.textContent = count;
  el.hidden = !count;
}

/* ── Bảng đối chiếu OCR ↔ trang gốc ──────────────────────────────────────
 *
 * Thay cho lớp highlight cũ. Câu hỏi thật của giáo viên khi duyệt là "AI đọc có
 * đúng không, và câu này ở đâu trên đề", chứ không phải "khung màu có khít
 * không". Bảng trả lời cả hai: đọc lướt cả tài liệu trong một màn hình, bấm một
 * dòng là nhảy sang đúng câu đó và mở đúng trang gốc bên trái.
 */
/* Rút gọn LaTeX thành chữ đọc được để so bằng mắt với ảnh trang.
   KHÔNG dùng `plain()` ở đây: hàm đó cắt sạch mọi cụm $…$, mà số liệu trong
   công thức mới chính là thứ cần đối chiếu. */
const texGlance = (source) => String(source ?? "")
  .replace(/\$/g, "")
  .replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2")
  .replace(/\\(?:mathrm|text|mathbf|operatorname)\s*\{([^{}]*)\}/g, "$1")
  .replace(/\\(?:cdot|times)\b/g, "·").replace(/\\(?:le|leq)\b/g, "≤").replace(/\\(?:ge|geq)\b/g, "≥")
  .replace(/\\(?:ne|neq)\b/g, "≠").replace(/\\infty\b/g, "∞").replace(/\\pi\b/g, "π")
  .replace(/\\(?:to|rightarrow)\b/g, "→").replace(/\^\\circ/g, "°")
  .replace(/\\[a-zA-Z]+\s*/g, " ").replace(/[{}]/g, "")
  .replace(/\s+/g, " ").trim();

const rvAnswerText = (q) => {
  if(q.type === "MC") return q.ans == null ? null : chLabel(q, q.ans);
  if(q.type === "TF") return (q.tf ?? []).some(([,value]) => value != null)
    ? (q.tf ?? []).map(([,value],i) => `${TFIDX[i]}${value === true ? "Đ" : value === false ? "S" : "–"}`).join(" ") : null;
  if(q.type === "SHORT") return q.sa?.value ? `${q.sa.value}${q.sa.unit ? ` ${q.sa.unit}` : ""}` : null;
  return q.sol ? "có lời giải in" : null;
};

/** Tên hiển thị của một câu: bám đúng cách đề đánh số, không tự chế số thứ tự. */
function questionLabel(q, fallbackIndex){
  if(q.problemRef && q.printedNumber) return `${q.problemRef} · câu ${q.printedNumber}`;
  // Cả bài lớn chỉ có một câu thì số hiệu bài chính là tên câu.
  if(q.problemRef) return String(q.problemRef);
  if(q.printedNumber) return `Câu ${q.printedNumber}`;
  return `Câu thứ ${fallbackIndex + 1}`;
}

/**
 * Đơn vị chọn = CẢ CỤM, không phải từng câu lẻ.
 *
 * Cụm câu đã là đơn vị nguyên tử lúc duyệt và lúc lưu; nếu lúc chọn lại tách lẻ
 * thì người dùng phải tự đi tìm đủ các câu con nằm rải ở nhiều trang mới xoá
 * được sạch — và bỏ sót một câu là kho có nửa cụm mồ côi.
 */
const rvUnitOf = (q) => q?.groupId
  ? activePending().filter(x => x.vaultId === q.vaultId && x.groupId === q.groupId)
  : (q ? [q] : []);

const rvIsSelected = (q) => rvSelected.has(q.id);
function rvToggleSelect(q, force){
  const unit = rvUnitOf(q);
  const on = force ?? !rvIsSelected(q);
  for(const item of unit){
    if(on) rvSelected.add(item.id); else rvSelected.delete(item.id);
  }
}

/** Gom danh sách duyệt thành từng khối: một bài lớn/cụm là một khối, còn lại gom theo trang. */
function reviewBlocks(list){
  const blocks = [];
  let current = null;
  list.forEach((q, index) => {
    const key = q.groupId ? `g:${q.groupId}` : `p:${q.page}`;
    if(!current || current.key !== key){
      current = { key, group:Boolean(q.groupId), page:q.page, rows:[],
        title:q.groupId
          ? (q.groupLabel || `${q.problemRef ? `Bài ${q.problemRef}` : "Cụm dữ liệu chung"}`)
          : `Trang ${q.page}` };
      blocks.push(current);
    }
    current.rows.push({ q, index });
  });
  return blocks;
}

/**
 * Bảng soát cả tài liệu — mở trong popup.
 *
 * Bản trước ghim bảng này thường trực trên màn Duyệt và nó ăn mất một phần ba
 * chiều cao, đúng cái phần đáng ra để nhìn ảnh gốc và sửa câu. Soát cả tài liệu
 * là việc thỉnh thoảng mới làm (xem sót, xoá hàng loạt), nên nó thuộc về popup.
 */
let rvTableScrim = null;

function openReviewTable(){
  if(rvTableScrim) return;
  const scrim = document.createElement("div");
  rvTableScrim = scrim;
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal rvcheck-modal" role="dialog" aria-modal="true" aria-label="Soát cả tài liệu">
    <div class="modal-head">
      <h3>Soát cả tài liệu</h3>
      <span class="muted" style="font-size:13px" id="rvCheckInfo"></span>
      <div class="grow"></div>
      <button class="btn btn-ghost" type="button" data-x>Đóng <kbd>Esc</kbd></button>
    </div>
    <div class="rv-select-bar">
      <label class="rvcheckall"><input type="checkbox" id="rvSelectAll"><span>Chọn tất cả</span></label>
      <span class="vline"></span>
      <span class="num" id="rvSelectCount"></span>
      <div class="grow"></div>
      <button class="btn btn-sm btn-ghost" type="button" id="rvSelectClear">Bỏ chọn</button>
      <button class="btn btn-sm btn-danger" type="button" id="rvSelectDrop">Xoá câu đã chọn</button>
    </div>
    <div class="modal-body one"><div class="rv-check-wrap">
      <!-- table-layout:fixed lấy bề rộng cột từ HÀNG ĐẦU, mà hàng đầu là hàng
           tiêu đề khối có colspan — thiếu colgroup thì bốn cột chia đều nhau. -->
      <table class="rvtable">
        <colgroup><col style="width:38px"><col style="width:150px"><col><col style="width:70px"></colgroup>
        <tbody id="rvCheckRows"></tbody>
      </table>
    </div></div>
    <div class="modal-foot"><span class="muted" style="font-size:12.5px">Bấm một dòng để đóng bảng và mở đúng trang gốc của câu đó.</span></div>
  </div>`;
  document.body.appendChild(scrim);

  const close = () => { scrim.remove(); rvTableScrim = null; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if(e.key === "Escape"){ e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey);
  $$("[data-x]", scrim).forEach(b => b.addEventListener("click", close));
  scrim.addEventListener("click", e => { if(e.target === scrim) close(); });
  wireReviewTable(scrim, close);
  paintReviewTable(rvList(), rvCurrent());
}

function paintReviewTable(list, current){
  const body = rvTableScrim ? $("#rvCheckRows", rvTableScrim) : null;

  // Câu đã bị xoá/duyệt thì bỏ khỏi vùng chọn, kẻo đếm số ma.
  const alive = new Set(activePending().map(q => q.id));
  for(const id of [...rvSelected]) if(!alive.has(id)) rvSelected.delete(id);

  const count = $("#rvCheckCount");
  if(count) count.textContent = list.length || "";
  if(!body) return;

  const withAnswer = list.filter(q => rvAnswerText(q)).length;
  const needLook = list.filter(q => flagsOf(q).some(isHeavy)).length;
  $("#rvCheckInfo", rvTableScrim).textContent = list.length
    ? `${list.length} câu · ${withAnswer} câu có sẵn đáp án/lời giải${needLook ? ` · ${needLook} câu cần xem kĩ` : ""}`
    : "";
  paintSelectBar(list);

  body.innerHTML = reviewBlocks(list).map(block => {
    const allOn = block.rows.every(({ q }) => rvIsSelected(q));
    const head = `<tr class="rvpagerow">
      <td class="pick"><input type="checkbox" data-rvpickblock="${esc(block.key)}" ${allOn ? "checked" : ""}
        aria-label="Chọn cả khối"></td>
      <td colspan="3">${block.group ? "▸ " : ""}${esc(texGlance(block.title).slice(0, 90))}
      <span>${block.rows.length} câu${block.group ? " · chọn một câu là chọn cả cụm" : ""}</span></td></tr>`;
    const rows = block.rows.map(({ q, index }) => {
      const flags = flagsOf(q).filter(isHeavy);
      const answer = rvAnswerText(q);
      const stem = texGlance(cleanImageMarkers(q.stem));
      const picked = rvIsSelected(q);
      return `<tr class="rvrow${q === current ? " on" : ""}${flags.length ? " flagged" : ""}${picked ? " picked" : ""}"
          data-rvjump="${esc(q.id)}" tabindex="0" title="Bấm để mở trang ${esc(String(q.page))}">
        <td class="pick"><input type="checkbox" data-rvpick="${esc(q.id)}" ${picked ? "checked" : ""}
          aria-label="Chọn ${esc(questionLabel(q, index))}"></td>
        <td class="who"><b>${esc(questionLabel(q, index))}</b><i>${esc(TYPES[q.type] ?? q.type)}${
          q.type === "MC" && q.ch ? ` · ${q.ch.length} p.án` : ""}</i></td>
        <td class="stem">${esc(stem.slice(0, 190))}${stem.length > 190 ? "…" : ""}
          <div class="rvchips">
            <span class="rvtag ${answer ? "ok" : ""}">${answer ? `đáp án: ${esc(answer)}` : "chưa có đáp án in sẵn"}</span>
            ${q.figNote || hasFig(q) ? `<span class="rvtag ${hasFig(q) ? "ok" : "warn"}">${hasFig(q) ? "đã cắt hình" : "có hình, chưa cắt được"}</span>` : ""}
            ${flags.map(f => `<span class="rvtag warn">${esc(f.k === "note" ? "model đọc không chắc" : f.t)}</span>`).join("")}
          </div></td>
        <td class="page"><span>trang</span><b>${esc(String(q.page))}</b></td>
      </tr>`;
    }).join("");
    return head + rows;
  }).join("");
}

function paintSelectBar(list){
  if(!rvTableScrim) return;
  const picked = list.filter(rvIsSelected);
  const groups = new Set(picked.filter(q => q.groupId).map(q => q.groupId));
  const loose = picked.filter(q => !q.groupId).length;
  $("#rvSelectCount", rvTableScrim).textContent = picked.length
    ? `đã chọn ${picked.length} câu${groups.size ? ` (${groups.size} cụm${loose ? ` + ${loose} câu lẻ` : ""})` : ""}`
    : "chưa chọn câu nào";
  const drop = $("#rvSelectDrop", rvTableScrim), clear = $("#rvSelectClear", rvTableScrim);
  drop.disabled = !picked.length;
  clear.disabled = !picked.length;
  drop.textContent = picked.length ? `Xoá ${picked.length} câu đã chọn` : "Xoá câu đã chọn";
  const all = $("#rvSelectAll", rvTableScrim);
  all.checked = picked.length === list.length && list.length > 0;
  all.indeterminate = picked.length > 0 && picked.length < list.length;
}

function paintReview(){
  paintPendCount();

  const docs = docsInQueue();
  if(!docs.some(doc => doc.key === rvDoc)) rvDoc = docs[0]?.key ?? null;
  const list = rvList();
  if(rvIdx >= list.length) rvIdx = Math.max(0, list.length - 1);
  const p = list[rvIdx];
  if(rvRegionQuestionId && rvRegionQuestionId !== p?.id){
    rvRegionMode = null; rvRegionQuestionId = null; rvSelection = null;
  }

  const selecting = Boolean(p && rvRegionMode && rvRegionQuestionId === p.id);
  const groupOnPage = Boolean(p?.groupId && Number(p.groupPage || p.page) === Number(p.page));
  $("#rvCropGroup").hidden = !groupOnPage || selecting;
  $("#rvCropQuestion").hidden = !p || selecting;
  $("#rvRegionHint").hidden = !selecting;
  $("#rvRegionSave").hidden = !selecting;
  $("#rvRegionCancel").hidden = !selecting;
  $("#rvRegionSave").disabled = !rvSelection;
  if(selecting)
    $("#rvRegionHint").textContent = `Kéo khung quanh ${rvRegionMode === "groupFigure" ? "hình của cụm" : "hình của câu"}`;

  /* ── thanh trên: chọn tài liệu, lọc, tiến độ ── */
  $("#rvDocs").innerHTML = docs.length
    ? `<label class="rvdocpick"><span>Tài liệu đang duyệt</span>
        <select id="rvDocSel" aria-label="Chọn tài liệu" ${docs.length === 1 ? "disabled" : ""}>
          ${docs.map(doc => `<option value="${esc(doc.key)}" ${rvDoc===doc.key?"selected":""}>${esc(doc.name)} (${doc.count})</option>`).join("")}
        </select></label>`
    : `<span style="font-size:13px;color:var(--ink-3)">Chưa có tài liệu chờ duyệt</span>`;

  const inScope = (q) => rvSourceKey(q) === rvDoc;
  const nFlag  = activePending().filter(q => inScope(q) && flagsOf(q).some(isHeavy)).length;
  const nClean = activePending().filter(q => inScope(q) && isConfident(q)).length;
  const nDup   = activePending().filter(q => inScope(q) && dupOf(q)).length;

  $("#rvFilters").innerHTML = [
    ["all",   "Tất cả",      nFlag + nClean],
    ["flag",  "Cần xem kĩ",  nFlag],
    ["clean", "Tin cậy cao", nClean],
    ["dup",   "Trùng kho",   nDup],
  ].map(([k,lab,n]) =>
    `<button type="button" data-rvf="${k}" aria-pressed="${rvFilter===k}" ${n?"":"disabled"}>
      ${lab}<span class="n">${n}</span></button>`).join("");

  /* Thanh tiến độ thay cho dãy vạch. 200 câu mà vẽ 200 vạch thì tràn màn hình
     và cũng chẳng nói lên điều gì. */
  const total = activePending().filter(inScope).length;
  const done = rvSession.done;
  $("#rvBar").style.width = (total + done ? done / (total + done) * 100 : 0) + "%";
  $("#rvProgress").innerHTML = list.length
    ? `Câu <b>${rvIdx+1}</b><span class="muted">/${list.length}${
        rvFilter !== "all" ? " đang lọc" : ""} · còn ${total} câu trong tài liệu · tổng ${activePending().length}</span>`
    : `<span class="muted">Không còn câu nào khớp bộ lọc</span>`;
  $("#rvDone").textContent = done ? `đã xử lý ${done}` : "";

  $("#btnApproveAll").disabled = !nClean;
  $("#btnApproveAll").textContent = nClean ? `Duyệt ${nClean} câu tin cậy cao` : "Duyệt hàng loạt";
  $("#btnDropDup").hidden = !nDup;
  $("#btnDropDup").textContent = `Bỏ ${nDup} câu trùng`;

  paintReviewTable(list, p);

  if(!p){
    $("#rvScan").innerHTML = `<div class="ln" style="opacity:1">Hết câu rồi.</div>`;
    $("#rvBody").innerHTML = `<div class="empty">${
      total ? "Bộ lọc này không còn câu nào. Đổi sang <b>Tất cả</b> để xem tiếp."
            : "Duyệt xong hết. Nạp thêm tài liệu ở màn <b>Tài liệu</b>."}</div>`;
    ["rvDrop","rvEdit","rvOk","rvLater"].forEach(id => { $("#"+id).disabled = true; });
    $("#rvFlags").innerHTML = "";
    $("#rvModel").textContent = "";
    return;
  }
  ["rvDrop","rvEdit","rvOk","rvLater"].forEach(id => { $("#"+id).disabled = false; });
  $("#rvOk").innerHTML = p.groupId
    ? `Duyệt cả nhóm ${p.groupSize || groupPeers(p).length} câu <kbd>Enter</kbd>`
    : `Duyệt, sang câu sau <kbd>Enter</kbd>`;
  $("#rvModel").textContent = p.model ?? "";

  const flags = flagsOf(p);
  $("#rvFlags").innerHTML = (p.groupId
    ? `<span class="chip acc">Câu nhóm ${p.groupOrder || ""}/${p.groupSize || ""}</span>` : "") + flags.map(f =>
    `<span class="chip ${isHeavy(f) ? "warn" : "acc"}">${esc(f.k === "note" ? "Model đọc không chắc" : f.t)}</span>`).join("");

  /* Trang gốc, KHÔNG còn lớp highlight.
   *
   * Bắt model đo bbox cho từng câu vừa tốn token vừa hay lệch, mà lệch một chút
   * là giáo viên nghi luôn phần chữ — dù chữ đọc đúng. Nay đối chiếu bằng bảng
   * bên trên (bấm một dòng là nhảy đúng trang), còn ảnh trang để đọc bằng mắt.
   * Toạ độ chỉ còn dùng cho một việc: cắt hình, và cắt lệch thì crop lại tay. */
  const sourceRow = sourceForQuestion(p);
  const samePage = activePending().filter(q => rvSourceKey(q) === rvSourceKey(p) && q.page === p.page);
  const pageUrl = sourceRow?.pageUrl
    ? sourceRow.pageUrl.replace("{page}", String(p.page))
    : (sourceRow?.kind === "Ảnh" ? sourceRow.fileUrl : null);
  const overlay = selecting && rvSelection
    ? `<div class="region-selection" data-region-selection style="${boxCss(rvSelection)}"><span>Vùng sẽ crop</span></div>` : "";
  const pageCount = Number(sourceRow?.pages) || Math.max(...samePage.map(q => Number(q.page) || 1), Number(p.page) || 1);
  const fallbackLines = samePage.map(q => {
    const lines = (q.raw ?? []).map((tx,k) =>
      `<div class="ln${k ? " opt" : ""}"${q === p ? ' style="opacity:1"' : ""}>${esc(tx)}</div>`).join("");
    return q === p ? `<div class="here"><span class="tagtop">Câu đang duyệt</span>${lines}</div>` : lines;
  }).join("");
  $("#rvScan").innerHTML = pageUrl
    ? `<div class="sourcehead"><b>Trang ${p.page}${pageCount > 1 ? `/${pageCount}` : ""}</b>
        <span class="muted">${esc(p.printedNumber ? `câu số ${p.printedNumber} in trên đề` : "trang chứa câu đang duyệt")}</span>
        <a href="${esc(sourceRow.fileUrl + (sourceRow.kind === "Lô ảnh" ? `?page=${p.page}` : ""))}" target="_blank">Mở ảnh gốc</a></div>
       <div class="sourcepage${selecting ? " selecting" : ""}" id="rvSourcePage"><img id="rvPageImage" draggable="false" src="${esc(pageUrl)}" alt="Trang ${p.page} của ${esc(sourceRow.name)}">${overlay}</div>`
    : (sourceRow?.fileUrl
      ? `<a class="btn btn-sm" href="${esc(sourceRow.fileUrl)}" target="_blank">Mở PDF gốc — trang ${p.page}</a>${fallbackLines}`
      : fallbackLines);

  // Đổi câu mà vẫn giữ nguyên chỗ cuộn của trang trước thì dễ tưởng là trang không đổi.
  const resetScroll = () => { const wrap = $(".scanwrap"); if(wrap) wrap.scrollTop = 0; };
  if(rvLastPageKey !== `${rvSourceKey(p)}|${p.page}`){
    rvLastPageKey = `${rvSourceKey(p)}|${p.page}`;
    $("#rvPageImage")?.addEventListener("load", resetScroll, { once:true });
    requestAnimationFrame(resetScroll);
  }
  /* Phóng bằng cách nới chính khung `.scan` chứ không phóng riêng thẻ ảnh: như
     vậy vùng cuộn của `.scanwrap` lớn theo và kéo được tới mép trái của trang. */
  const scan = $("#rvScan");
  const wrapWidth = $(".scanwrap")?.clientWidth ?? 0;
  scan.style.maxWidth = rvZoom > 1 ? "none" : "";
  // `flex:0 0 auto` là bắt buộc: `.scan` là flex item, mặc định flex-shrink:1 sẽ
  // co nó về vừa khung và mức phóng chỉ đổi con số chứ ảnh không to thêm.
  scan.style.flex = rvZoom > 1 ? "0 0 auto" : "";
  scan.style.width = rvZoom > 1
    ? `${Math.round(Math.min(760, Math.max(240, wrapWidth - 48)) * rvZoom)}px` : "";
  $("#rvZoomLevel").textContent = `${Math.round(rvZoom * 100)}%`;
  $("#rvZoomOut").disabled = rvZoom <= ZOOM_STEPS[0];
  $("#rvZoomIn").disabled = rvZoom >= ZOOM_STEPS.at(-1);
  if(selecting) wireReviewRegionSelection();

  let stemHtml = tex(cleanImageMarkers(p.stem));
  if(p.mark){
    const m = tex(`$${p.mark}$`);
    stemHtml = stemHtml.replace(m, `<span class="mark">${m}</span>`);
  }

  let h = p.groupId ? `<div class="group-context">
      <div class="group-title"><span class="chip acc">Câu hỏi nhóm ${p.groupOrder || ""}/${p.groupSize || ""}</span>
        ${esc(p.groupLabel || "Cụm dữ liệu dùng chung")}</div>
      ${p.groupStem ? `<div>${tex(p.groupStem)}</div>`
        : `<span class="hint">Phần dẫn chung của bài này chưa đọc được thành chữ — mở trang ${p.groupPage || p.page} để xem trên ảnh gốc.</span>`}
      ${p.groupPage && p.groupPage !== p.page ? `<span class="hint">Phần dẫn chung nằm ở trang ${p.groupPage}, câu này ở trang ${p.page}.</span>` : ""}
      ${p.groupFig ? `<div class="autocrop-img">${figInner(normFig(p.groupFig).src)}</div>` : ""}
      ${p.groupFigNote && !p.groupFig ? `<span class="hint">Cụm có hình: ${esc(p.groupFigNote)} — dùng “Crop hình cụm” để gắn lại.</span>` : ""}
    </div>` : "";
  h += `<div style="display:flex;flex-direction:column;gap:6px">
      <div class="lbl" style="margin:0">Đề bài</div>
      <div class="block">${stemHtml}</div>
      ${flags.filter(isHeavy).map(f => `
        <div class="conflict">
          <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="#6b5426"
               stroke-width="16" aria-hidden="true" style="flex:none">
            <circle cx="128" cy="128" r="96"></circle><path d="M128 76v60M128 172h.1"></path></svg>
          <span class="t">${esc(f.t)}${f.k === "dup"
            ? ` — nguồn “${esc(dupOf(p).src)}”. Duyệt tiếp là kho có hai bản.` : ""}</span>
        </div>`).join("")}
    </div>`;

  if(hasFig(p)){
    h += `<div class="autocrop">
      <div><b>${p.fig?.origin === "manual" ? "Hình của câu · đã thay bằng crop tay" : "Hình đã crop tự động"}</b><span>${esc(p.figNote || "Trích từ trang gốc")}</span></div>
      <div class="autocrop-img">${figInner(normFig(p.fig).src)}</div>
    </div>`;
  } else if(p.figNote){
    h += `<div class="conflict" style="background:var(--acc-tint);box-shadow:inset 0 0 0 1px var(--acc)">
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="#5d5294"
           stroke-width="16" aria-hidden="true" style="flex:none">
        <rect x="32" y="48" width="192" height="160" rx="12"></rect>
        <path d="M32 168l52-52 44 44 28-28 40 40"></path></svg>
      <span class="t" style="color:var(--acc-ink)"><b>Câu này có hình</b> —
        “${esc(p.figNote)}”. Bbox không hợp lệ nên chưa crop được; có thể gắn ảnh thủ công.</span>
    </div>`;
  }

  if(p.type === "MC" && p.ch){
    h += `<div style="display:flex;flex-direction:column;gap:6px">
      <div class="lbl" style="margin:0">${p.ch.length} phương án${p.ans == null
        ? ' <span style="color:var(--ink-3)">· chưa có đáp án in sẵn</span>' : ""}</div>
      <div class="choices">${p.ch.map((c,i) =>
        `<button type="button" class="choice pickans${i===p.ans?" ans":""}" data-pickans="${i}">
          <b>${chLabel(p,i)}.</b> ${tex(c)}
          ${i===p.ans?'<span class="tagright">đáp án</span>':""}</button>`).join("")}</div>
      <p class="hint">${p.ans == null ? "Hệ thống không tự giải. Chỉ chọn nếu bạn muốn nhập đáp án thủ công." : "Bấm phương án khác nếu đáp án in sẵn được ghép sai."}</p>
    </div>`;
  }

  if(p.type === "TF" && p.tf){
    h += `<div style="display:flex;flex-direction:column;gap:6px">
      <div class="lbl" style="margin:0">Bốn ý — bấm để đổi Đúng/Sai</div>
      <div class="choices">${p.tf.map(([txt,v],i) =>
        `<button type="button" class="choice picktf ${v===true?"isT":v===false?"isF":""}" data-picktf="${i}">
          <b>${TFIDX[i]})</b> ${tex(txt)}
          <span class="tagright">${v===true ? "Đúng" : v===false ? "Sai" : "Chưa có"}</span></button>`).join("")}</div>
      <p class="hint">Mỗi lần bấm: Chưa có → Đúng → Sai → Chưa có.</p>
    </div>`;
  }

  if(p.type === "SHORT" && p.sa){
    h += `<div style="display:flex;flex-direction:column;gap:6px">
      <div class="lbl" style="margin:0">Đáp án dạng số</div>
      <div class="choices"><div class="choice ans"><b>=</b>
        ${esc(p.sa.value)} ${esc(p.sa.unit ?? "")}</div></div>
    </div>`;
  }

  h += `<div class="grid3">
      <label><span class="lbl">Dạng câu</span><select data-p="type">${
        Object.entries(TYPES).map(([k,v])=>
          `<option value="${k}" ${k===p.type?"selected":""}>${v}</option>`).join("")
      }</select></label>
      <label><span class="lbl">Độ khó</span><select data-p="diff">${
        DIFFS.map(d=>`<option value="${d}" ${d===p.diff?"selected":""}>${d} — ${DNAME[d]}</option>`).join("")
      }</select></label>
      <label><span class="lbl">Lớp</span><select data-p="grade">${
        [10,11,12].map(g=>`<option value="${g}" ${g===p.grade?"selected":""}>Lớp ${g}</option>`).join("")
      }</select></label>
    </div>

    <div class="grid2">
      <label><span class="lbl">Chuyên đề</span>
        <select data-p="topic">${
          topicsOf("physics").concat(topicsOf("math")).map(([k,v])=>
            `<option value="${k}" ${k===p.topic?"selected":""}>${v}</option>`).join("")
        }</select></label>
      <label><span class="lbl">Nguồn</span>
        <input type="text" data-p="src" value="${esc(p.srcLabel ?? p.src.replace(/\.[a-z]+$/,""))}"></label>
    </div>`;

  $("#rvBody").innerHTML = h;

  $$("[data-p]", $("#rvBody")).forEach(el => el.addEventListener("change", e => {
    const k = e.target.dataset.p;
    if(k === "grade") p.grade = +e.target.value;
    else if(k === "src") p.srcLabel = e.target.value;
    else p[k] = e.target.value;
    paintReview();
  }));
  $$("[data-pickans]", $("#rvBody")).forEach(b => b.addEventListener("click", () => {
    p.ans = +b.dataset.pickans;
    p.answerSource = "manual";
    paintReview();
  }));
  $$("[data-picktf]", $("#rvBody")).forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.picktf;
    p.tf[i][1] = p.tf[i][1] == null ? true : p.tf[i][1] === true ? false : null;
    p.answerSource = p.tf.some(([,value]) => value != null) ? "manual" : "none";
    paintReview();
  }));
}

function wireReviewRegionSelection(){
  const page = $("#rvSourcePage");
  const img = $("#rvPageImage");
  if(!page || !img) return;
  let start = null;
  const point = (e) => {
    const r = img.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
            Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
  };
  const draw = () => {
    let mark = $("[data-region-selection]", page);
    if(!mark){
      mark = document.createElement("div");
      mark.className = "region-selection";
      mark.dataset.regionSelection = "";
      mark.innerHTML = "<span>Vùng sẽ lưu</span>";
      page.appendChild(mark);
    }
    mark.style.cssText = boxCss(rvSelection);
    $("#rvRegionSave").disabled = !rvSelection;
  };
  page.addEventListener("pointerdown", e => {
    if(e.button !== 0) return;
    e.preventDefault(); start = point(e); rvSelection = null;
    page.setPointerCapture(e.pointerId);
  });
  page.addEventListener("pointermove", e => {
    if(!start) return;
    const end = point(e);
    const box = [Math.min(start[0], end[0]), Math.min(start[1], end[1]),
                 Math.max(start[0], end[0]), Math.max(start[1], end[1])];
    rvSelection = box[2] - box[0] > 0.006 && box[3] - box[1] > 0.006 ? box : null;
    if(rvSelection) draw();
  });
  page.addEventListener("pointerup", e => {
    if(!start) return;
    start = null;
    if(page.hasPointerCapture(e.pointerId)) page.releasePointerCapture(e.pointerId);
  });
  page.addEventListener("pointercancel", () => { start = null; });
}

/* Đưa một câu đã duyệt vào kho. Trả về null nếu kho đầy trần của gói — người
   gọi phải xử lý, không được nuốt im lặng rồi để giáo viên tưởng câu đã vào. */
function approve(p){
  if(capacityLeft(p.type) <= 0){
    toast(`Kho đã đủ ${plan.cap[p.type]} câu ${TYPES[p.type].toLowerCase()} của gói ${plan.name}. ` +
          `Xoá bớt câu cũ hoặc nâng gói.`);
    return null;
  }
  const q = {
    id: "q" + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36),
    vaultId:p.vaultId || activeVaultId,
    type:p.type, diff:p.diff, topic:p.topic, grade:p.grade,
    subject: p.topic.startsWith("m") ? "math" : "physics",
    src: p.srcLabel ?? p.src.replace(/\.[a-z]+$/,""), srcId:p.srcId ?? null, ai:true,
    printedNumber:p.printedNumber ?? null,
    stem:cleanImageMarkers(p.stem), sol:p.sol || "",
    fig:p.fig ? structuredClone(p.fig) : null, figNote:p.figNote ?? null,
    figures:Array.isArray(p.figures) ? structuredClone(p.figures) : [],
    groupId:p.groupId ?? null, groupLabel:p.groupLabel ?? null, groupStem:p.groupStem ?? null,
    groupBbox:p.groupBbox ? structuredClone(p.groupBbox) : null,
    groupPage:p.groupPage ?? p.page ?? null,
    groupOrder:p.groupOrder ?? null, groupSize:p.groupSize ?? null,
    groupFig:p.groupFig ? structuredClone(p.groupFig) : null,
    groupFigures:Array.isArray(p.groupFigures) ? structuredClone(p.groupFigures) : [],
    groupFigNote:p.groupFigNote ?? null,
    answerSource:p.answerSource ?? "none"
  };
  if(p.type === "MC"){ q.ch = p.ch; q.ans = p.ans; }
  if(p.type === "TF") q.tf = p.tf ?? TFIDX.map(()=>["",null]);
  if(p.type === "SHORT") q.sa = p.sa ?? { value:"", unit:"", tol:"0" };
  BANK.push(q);
  if(q.groupId){
    let entity = GROUPS.find(group => group.vaultId === q.vaultId && group.id === q.groupId);
    if(!entity){
      entity = {
        id:q.groupId, sourceId:p.srcId ?? null, source:q.src, page:q.groupPage,
        vaultId:q.vaultId,
        label:q.groupLabel || null, stem:q.groupStem || "", bbox:q.groupBbox,
        figure:q.groupFig, figures:q.groupFigures, questionNumbers:[], questionIds:[]
      };
      GROUPS.push(entity);
    }
    entity.questionIds = [...new Set((entity.questionIds || []).map(id => id === p.id ? q.id : id).concat(q.id))];
  }
  rvSession.done++;
  return q;
}

/** Một cụm là một đơn vị duyệt: không để nửa cụm nằm trong kho, nửa còn chờ. */
function approveUnit(p){
  const unit = p.groupId
    ? PENDING.filter(item => item.vaultId === p.vaultId && item.groupId === p.groupId).sort((a,b) => (a.groupOrder || 0) - (b.groupOrder || 0))
    : [p];
  const needed = unit.reduce((map, item) => map.set(item.type, (map.get(item.type) || 0) + 1), new Map());
  for(const [type, count] of needed){
    if(capacityLeft(type) < count){
      toast(`Cần còn ${count} chỗ ${TYPES[type].toLowerCase()} để lưu nguyên nhóm; kho hiện không đủ.`);
      return [];
    }
  }
  const approved = unit.map(item => ({ pending:item, bank:approve(item) }));
  approved.forEach(({ pending }) => removePending(pending));
  return approved;
}

function removePending(p){
  const i = PENDING.indexOf(p);
  if(i >= 0) PENDING.splice(i,1);
  rvDeferred.delete(p.id);
}

function afterReviewChange(){
  syncReviewSource();
  paintFacets(); paintKho(); paintReview(); paintSources(); paintHome();
}

/* Dòng tài liệu bên màn Tài liệu đi theo: duyệt hết thì thành "đã vào kho".
   Quét MỌI dòng đang chờ, không chỉ dòng đầu tiên — nạp nhiều tài liệu một lúc
   là có nhiều dòng cùng ở trạng thái chờ. */
function syncReviewSource(){
  for(const row of SOURCES){
    if(row.state !== "review") continue;
    const rowKey = row.id ? `id:${row.id}` : `name:${row.name}`;
    const left = PENDING.filter(p => p.vaultId === row.vaultId && rvSourceKey(p) === rowKey).length;
    if(left) row.label = `Chờ duyệt ${left} câu`;
    else { row.state = "done"; row.label = "Đã vào kho"; }
  }
}

const rvCurrent = () => rvList()[rvIdx];

/** Bấm một dòng trong bảng đối chiếu = chuyển sang câu đó và mở đúng trang gốc. */
function rvJumpTo(questionId){
  const index = rvList().findIndex(q => q.id === questionId);
  if(index < 0) return;
  rvIdx = index;
  stopReviewRegion(false);
  paintReview();
  $(`[data-rvjump="${CSS.escape(questionId)}"]`)?.scrollIntoView({ block:"nearest" });
}
function wireReviewTable(scrim, close){
  $("#rvCheckRows", scrim).addEventListener("click", e => {
    const pick = e.target.closest("[data-rvpick]");
    if(pick){
      // Tích ô không được kéo theo việc nhảy trang — hai ý định khác nhau.
      e.stopPropagation();
      const q = activePending().find(item => item.id === pick.dataset.rvpick);
      if(q) rvToggleSelect(q, pick.checked);
      paintReviewTable(rvList(), rvCurrent());
      return;
    }
    const block = e.target.closest("[data-rvpickblock]");
    if(block){
      e.stopPropagation();
      const rows = reviewBlocks(rvList()).find(item => item.key === block.dataset.rvpickblock)?.rows ?? [];
      for(const { q } of rows) rvToggleSelect(q, block.checked);
      paintReviewTable(rvList(), rvCurrent());
      return;
    }
    const row = e.target.closest("[data-rvjump]");
    // Đóng bảng rồi mới nhảy: người dùng bấm vào một câu là để XEM nó, chứ không
    // phải để tiếp tục nhìn bảng.
    if(row){ close(); rvJumpTo(row.dataset.rvjump); }
  });

  $("#rvCheckRows", scrim).addEventListener("keydown", e => {
    if(e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("[data-rvjump]");
    if(row){ e.preventDefault(); close(); rvJumpTo(row.dataset.rvjump); }
  });

  $("#rvSelectAll", scrim).addEventListener("change", e => {
    const list = rvList();
    if(e.target.checked) for(const q of list) rvSelected.add(q.id);
    else rvSelected.clear();
    paintReviewTable(list, rvCurrent());
  });
  $("#rvSelectClear", scrim).addEventListener("click", () => {
    rvSelected.clear(); paintReviewTable(rvList(), rvCurrent());
  });
  $("#rvSelectDrop", scrim).addEventListener("click", async () => {
    const picked = rvList().filter(rvIsSelected);
    if(!picked.length) return;
    const groups = new Set(picked.filter(q => q.groupId).map(q => q.groupId));
    const detail = groups.size ? ` (trong đó ${groups.size} cụm câu bị xoá trọn cụm)` : "";
    // Xoá khỏi hàng chờ là không lùi được: muốn có lại phải OCR lại tài liệu.
    if(!confirm(`Xoá ${picked.length} câu khỏi hàng chờ duyệt${detail}?\n\nKhông hoàn tác được — muốn có lại phải OCR lại tài liệu.`)) return;
    for(const q of picked) removePending(q);
    rvSelected.clear();
    rvSession.done += picked.length;
    afterReviewChange();
    toast(`Đã xoá ${picked.length} câu khỏi hàng chờ`);
    if(!rvList().length) close();
    await saveWorkspace(true);
  });
}

$("#rvOpenCheck").addEventListener("click", openReviewTable);

/* Phóng ảnh trang.
 *
 * Ảnh scan 160 dpi thu vừa nửa màn hình thì chỉ số mờ đúng chỗ cần đối chiếu.
 * Vùng crop tính theo `getBoundingClientRect()` của chính thẻ img nên kéo khung
 * ở mức phóng nào cũng ra đúng toạ độ — không phải quy đổi lại. */
const ZOOM_STEPS = [0.75, 1, 1.4, 2, 3, 4];
function setReviewZoom(next, anchor = null){
  const before = rvZoom;
  rvZoom = Math.min(ZOOM_STEPS.at(-1), Math.max(ZOOM_STEPS[0], next));
  const wrap = $(".scanwrap");
  // Giữ nguyên điểm đang nhìn thay vì nhảy về đầu trang.
  const keep = wrap && before ? {
    x:(wrap.scrollLeft + (anchor?.x ?? wrap.clientWidth / 2)) / before,
    y:(wrap.scrollTop + (anchor?.y ?? wrap.clientHeight / 2)) / before,
  } : null;
  paintReview();
  if(wrap && keep){
    wrap.scrollLeft = keep.x * rvZoom - (anchor?.x ?? wrap.clientWidth / 2);
    wrap.scrollTop = keep.y * rvZoom - (anchor?.y ?? wrap.clientHeight / 2);
  }
}
const zoomNeighbour = (dir) => ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1,
  ZOOM_STEPS.findIndex(step => step >= rvZoom - 1e-6) + dir))] ?? rvZoom;
$("#rvZoomIn").addEventListener("click", () => setReviewZoom(zoomNeighbour(1)));
$("#rvZoomOut").addEventListener("click", () => setReviewZoom(zoomNeighbour(-1)));
$("#rvZoomLevel").addEventListener("click", () => setReviewZoom(1));
$(".scanwrap").addEventListener("wheel", e => {
  if(!e.ctrlKey) return;   // cuộn thường vẫn là cuộn trang
  e.preventDefault();
  const box = e.currentTarget.getBoundingClientRect();
  setReviewZoom(zoomNeighbour(e.deltaY < 0 ? 1 : -1),
    { x:e.clientX - box.left, y:e.clientY - box.top });
}, { passive:false });

$("#rvCropQuestion").addEventListener("click", () => startReviewRegion("figure"));
$("#rvCropGroup").addEventListener("click", () => startReviewRegion("groupFigure"));
$("#rvRegionCancel").addEventListener("click", () => stopReviewRegion());
$("#rvRegionSave").addEventListener("click", async () => {
  const p = rvCurrent();
  if(!p || p.id !== rvRegionQuestionId || !reviewBox(rvSelection)) return;
  const box = [...rvSelection];
  {
    const source = sourceForQuestion(p);
    const jobId = sourceJobId(source);
    if(!jobId){ toast("Tài liệu cũ chưa có lượt OCR để crop trực tiếp"); return; }
    const save = $("#rvRegionSave");
    save.disabled = true; save.textContent = "Đang crop…";
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/crops`, {
        method:"POST", headers:{ "content-type":"application/json" },
        body:JSON.stringify({ page:p.page, bbox:box })
      });
      const result = await response.json();
      if(!response.ok) throw new Error(result.error || "Crop thất bại");
      if(rvRegionMode === "groupFigure"){
        const old = normFig(p.groupFig);
        const fig = { ...result.figure, width:old?.width ?? 65, place:old?.place ?? "top" };
        setGroupField(p, "groupFig", fig);
        setGroupField(p, "groupFigures", [fig]);
        setGroupField(p, "groupFigNote", "Người dùng crop từ cụm dữ liệu gốc");
      } else {
        const old = normFig(p.fig);
        const fig = { ...result.figure, width:old?.width ?? 45, place:old?.place ?? "top" };
        /* Đây là thao tác thay hình của đúng câu đang duyệt, không append vào danh sách cũ. */
        p.fig = fig;
        p.figures = [fig];
        p.figNote = "Người dùng crop từ đề gốc";
        p.stem = cleanImageMarkers(p.stem);
      }
      toast("Đã crop và gắn hình vào câu hỏi");
    } catch(err){
      toast(`Không crop được: ${err.message}`);
      save.disabled = false;
      return;
    }
  }
  stopReviewRegion(false);
  paintReview();
  await saveWorkspace(true);
});

$("#btnExportPdf").addEventListener("click",async()=>{
  const btn=$("#btnExportPdf");btn.disabled=true;btn.textContent="Đang biên dịch…";
  try{
    const mode=sheetMode==="matran"?"de":sheetMode;
    const bytes=await exportLatexPdf(mode);
    const code=(header.code||"de").replace(/[^\w-]/g,"");
    saveBlob(`${SHEETS[mode]||"de"}-${code}.pdf`,bytes,"application/pdf");
    toast("Đã tải PDF biên dịch trực tiếp bằng LaTeX");
  }catch(error){console.error(error);toast("Xuất PDF LaTeX lỗi: "+error.message);}
  finally{btn.disabled=false;btn.textContent="Xuất PDF";}
});

$("#rvOk").addEventListener("click", () => {
  const p = rvCurrent();
  if(!p) return;
  const approved = approveUnit(p);
  if(!approved.length) return;
  afterReviewChange();
  if(approved.length > 1) toast(`Đã lưu nguyên nhóm ${approved.length} câu vào kho`);
});

$("#rvDrop").addEventListener("click", () => {
  const p = rvCurrent();
  if(!p) return;
  removePending(p);
  rvSession.done++;
  afterReviewChange();
});

/* "Để sau": không bỏ, không duyệt — đẩy xuống cuối hàng. Nạp 200 câu thì kiểu
   gì cũng có câu phải tra sách mới quyết được; chặn ở đó là tắc cả hàng. */
$("#rvLater").addEventListener("click", () => {
  const p = rvCurrent();
  if(!p) return;
  rvDeferred.add(p.id);
  paintReview();
  toast("Để sau — câu này dồn xuống cuối hàng");
});

$("#rvEdit").addEventListener("click", () => {
  const p = rvCurrent();
  if(!p) return;
  const approved = approveUnit(p);
  if(!approved.length) return;
  const q = approved.find(item => item.pending === p)?.bank || approved[0].bank;
  afterReviewChange();
  openEditor(q.id);
});

$("#btnApproveAll").addEventListener("click", () => {
  const candidates = activePending().filter(p => rvSourceKey(p) === rvDoc && isConfident(p));
  const scope = candidates.filter(p => !p.groupId || PENDING.filter(peer => peer.vaultId === p.vaultId && peer.groupId === p.groupId).every(isConfident));
  if(!scope.length){ toast("Câu nào cũng còn chỗ cần mắt người"); return; }
  if(scope.length > 20 &&
     !confirm(`Duyệt một lượt ${scope.length} câu vào kho?\n\n` +
              `Đây là những câu không trùng kho và model không tự khai chỗ nào đọc không chắc.`)){
    return;
  }
  /* Phải chốt danh sách TRƯỚC rồi mới gỡ theo đúng đối tượng: câu vừa vào kho
     sẽ khiến chính nó thành "câu trùng", lọc lại là không gỡ được gì. */
  const seen = new Set(), vao = [];
  for(const p of scope){
    const key = p.groupId || p.id;
    if(seen.has(key)) continue;
    seen.add(key);
    vao.push(...approveUnit(p));
  }
  rvIdx = 0;
  afterReviewChange();
  toast(`Đã duyệt ${vao.length} câu; các nhóm được lưu nguyên khối`);
});

$("#btnDropDup").addEventListener("click", () => {
  const dups = activePending().filter(p => rvSourceKey(p) === rvDoc && dupOf(p));
  if(!dups.length) return;
  if(!confirm(`Bỏ ${dups.length} câu đã có sẵn trong kho?`)) return;
  dups.forEach(removePending);
  rvSession.done += dups.length;
  rvIdx = 0;
  afterReviewChange();
  toast(`Đã bỏ ${dups.length} câu trùng`);
});

$("#rvFilters").addEventListener("click", e => {
  const b = e.target.closest("[data-rvf]");
  if(!b) return;
  rvFilter = b.dataset.rvf; rvIdx = 0; paintReview();
});

$("#rvDocs").addEventListener("change", e => {
  if(e.target.id !== "rvDocSel") return;
  rvDoc = e.target.value; rvIdx = 0; rvFilter = "all"; paintReview();
});

document.addEventListener("keydown", e => {
  if(!$("#s-duyet").classList.contains("on")) return;
  if(document.querySelector(".scrim")) return;
  if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if(e.key === "Enter"){ e.preventDefault(); $("#rvOk").click(); }
  else if(e.key === "e" || e.key === "E"){ $("#rvEdit").click(); }
  else if(e.key === "x" || e.key === "X"){ $("#rvDrop").click(); }
  else if(e.key === "s" || e.key === "S"){ $("#rvLater").click(); }
  else if(e.key === "ArrowRight"){ rvIdx = Math.min(rvList().length-1, rvIdx+1); paintReview(); }
  else if(e.key === "ArrowLeft"){ rvIdx = Math.max(0, rvIdx-1); paintReview(); }
});

/* ═══════════════════════════════════════════ nguồn / thêm tài liệu ══ */

const upload = {
  subject:"Vật lí", grade:12, srcLabel:"",
  tier: plan.tiers[0],            // mức đọc — gói thấp chỉ mở được mức Nhanh
  pages: 8,                        // số trang ước tính của tài liệu sắp nạp
  autoApprove:false, files:[]
};

function paintSources(){
  const tb = $("#srcRows");
  tb.innerHTML = "";
  for(const r of activeSources()){
    const tr = document.createElement("tr");
    const cls = { done:"ok", review:"warn", run:"acc", failed:"danger" }[r.state] ?? "";
    const shortError = r.error ? String(r.error).trim().split(/\r?\n/)
      .map(line => line.replace(/\s*Assertion failed:.*$/i, "").trim())
      .filter(line => line && !/UV_HANDLE_CLOSING|src\\win\\async\.c/i.test(line)).at(-1) || "" : "";
    tr.innerHTML = `
      <td><b style="font-weight:500">${esc(r.name)}</b>
        <div class="sub">${esc(r.kind)} · mức ${esc(OCR_TIERS[r.tier ?? "nhanh"].name)}${
          r.emptyPages ? ` · ${r.emptyPages} trang không có câu hỏi (bìa, hướng dẫn hoặc trang trắng)` : ""
        }${shortError ? ` · ${esc(shortError).slice(0,120)}` : ""}</div>
        ${r.state === "run" ? `<div class="mini"><i style="width:${r.prog}%"></i></div>` : ""}</td>
      <td class="r">${r.pages}</td>
      <td class="r">${r.found ?? "—"}</td>
      <td class="r">${r.scans ?? "—"}</td>
      <td><span class="chip ${cls}">${esc(r.label)}</span></td>
      <td class="r">${
        r.state === "review" ? `<button class="btn btn-sm btn-primary" type="button" data-review="${esc(r.id ? `id:${r.id}` : `name:${r.name}`)}">Duyệt</button>` :
        r.state === "done"   ? '<button class="btn btn-sm btn-ghost" type="button" data-see="'+esc(r.name)+'">Xem câu</button>' :
        r.state === "failed" && r.id ? '<button class="btn btn-sm" type="button" data-retry-source="'+esc(r.id)+'">Thử lại</button>' : ""
      }</td>`;
    tb.appendChild(tr);
  }
  const pages = activeSources().reduce((a,r)=>a+r.pages,0);
  const used  = activeSources().reduce((a,r)=>a+(r.scans ?? r.pages),0);
  $("#srcSummary").textContent =
    `${pages} trang trong tháng này · hết ${used} ${UNIT.many}`;
  paintQuota();
}

/* ── Theo dõi một lượt OCR đang chạy trên máy chủ ─────────────────────────
 *
 * Server không còn giữ request HTTP suốt lúc đọc tài liệu nữa (PDF 8 trang treo
 * 3–5 phút thì trình duyệt và cloudflared cắt trước khi model kịp trả lời).
 * Upload chỉ tạo job; ở đây hỏi tiến độ mỗi 2 giây. Đóng tab giữa chừng cũng
 * không mất gì: server vẫn chạy tiếp và ghi kết quả vào workspace.
 */
const PHASE_LABEL = { pages:"Đang tách trang", ocr:"Đang đọc trang", reconcile:"Đang ghép đáp án và cụm câu" };

async function followIngestJob(jobId, row, targetVaultId){
  const started = Date.now();
  for(;;){
    await new Promise(resolve => setTimeout(resolve, 2000));
    let payload;
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache:"no-store" });
      payload = await response.json();
      if(!response.ok) throw new Error(payload.error || "Không hỏi được trạng thái OCR");
    } catch(error){
      // Mất mạng một nhịp không có nghĩa là job hỏng — job chạy ở server.
      if(Date.now() - started > 30 * 60_000) throw error;
      continue;
    }
    const job = payload.job || {};
    if(job.status === "review"){
      Object.assign(row, payload.source ?? {}, { _temp:false, state:"review", prog:100, error:"" });
      for(const question of payload.questions ?? []) if(!PENDING.some(item => item.id === question.id))
        PENDING.push({ ...question, vaultId:question.vaultId || targetVaultId });
      for(const group of payload.groups ?? []) if(!GROUPS.some(item => item.id === group.id))
        GROUPS.push({ ...group, vaultId:group.vaultId || targetVaultId });
      return { ok:true, questions:payload.questions?.length ?? 0 };
    }
    if(job.status === "failed"){
      Object.assign(row, payload.source ?? {}, { _temp:false, state:"failed", label:"OCR lỗi", prog:0,
        error:job.error || "OCR lỗi" });
      return { ok:false, error:job.error || "OCR lỗi" };
    }
    const progress = job.progress || {};
    const pages = Number(progress.pages) || Number(row.pages) || 0;
    const page = Number(progress.page) || 0;
    row.label = progress.phase === "ocr" && pages
      ? `Đang đọc trang ${page}/${pages}`
      : PHASE_LABEL[progress.phase] || "Đang chờ máy chủ đọc";
    // Tiến độ THẬT theo trang, không phải thanh chạy giả cộng 2% mỗi 0,9 giây.
    row.prog = pages ? Math.min(97, Math.round((Math.max(0, page - 0.35) / pages) * 100)) : 6;
    paintSources();
  }
}

async function retrySource(row){
  if(!row?.id || row.state === "run") return;
  const targetVaultId = row.vaultId || activeVaultId;
  row.state = "run"; row.label = "Đang thử lại OCR"; row.prog = 4; row.error = "";
  syncPaused = true; paintSources();
  try {
    const response = await fetch(`/api/sources/${encodeURIComponent(row.id)}/retry`, {
      method:"POST", headers:{ "content-type":"application/json" },
      body:JSON.stringify({
        vaultId:targetVaultId, subject:upload.subject === "Toán" ? "math" : "physics",
        grade:upload.grade, tier:row.tier || upload.tier, srcLabel:upload.srcLabel,
      }),
    });
    const result = await response.json();
    if(!response.ok) throw Object.assign(new Error(result.error || "OCR lại thất bại"), { source:result.source });
    Object.assign(row, result.source, { _temp:false });
    paintSources();
    const done = await followIngestJob(result.jobId, row, targetVaultId);
    if(!done.ok) throw new Error(done.error);
    scansLeft -= row.scans || 0;
    toast(`OCR lại xong — ${done.questions} câu đang chờ duyệt`);
  } catch(error) {
    Object.assign(row, error.source ?? {}, { state:"failed", label:"OCR lỗi", error:error.message, prog:0 });
    toast(`OCR vẫn lỗi: ${String(error.message).split(/\r?\n/).at(-1)}`);
  } finally {
    syncPaused = false;
    paintSources(); paintReview(); paintHome(); await saveWorkspace(true);
  }
}

/* Đồng hồ trên thanh tiêu đề: lượt quét còn lại, KHÔNG phải tiền.
   Hết lượt thì nói thẳng còn bao nhiêu ngày nữa reset, đừng để người ta đoán. */
function paintQuota(){
  const left = Math.max(0, scansLeft);
  $("#scansLeft").textContent = left;
  $("#scansTotal").textContent = plan.scans;
  const bar = $("#quotaBar");
  bar.style.width = Math.min(100, (plan.scans - left) / plan.scans * 100) + "%";
  bar.classList.toggle("hot", left <= plan.scans * 0.1);
  $("#planName").textContent = plan.name;
}

/* Sức chứa kho theo gói. Đây là ràng buộc giáo viên chạm vào thật, nên phải
   hiện thường trực chứ không để đến lúc nạp xong mới báo "kho đầy". */
function capOf(type){ return plan.cap[type]; }
function countOf(type){ return BANK.filter(x => x.type === type).length; }

function capacityLeft(type){
  const cap = capOf(type);
  return cap === null ? Infinity : cap - countOf(type);
}

function paintCapacity(){
  const box = $("#capacity");
  if(!box) return;
  const rows = Object.keys(TYPES).map(t => {
    const cap = capOf(t), n = countOf(t);
    if(cap === null)
      return `<div class="caprow"><span>${TYPES[t]}</span>
        <span class="num">${n}</span><i class="capbar"><b style="width:0"></b></i>
        <span class="muted" style="font-size:12px">không giới hạn</span></div>`;
    const pct = Math.min(100, n / cap * 100);
    const full = n >= cap;
    return `<div class="caprow${full ? " full" : ""}"><span>${TYPES[t]}</span>
      <span class="num">${n}<span class="muted">/${cap}</span></span>
      <i class="capbar"><b style="width:${pct}%"></b></i>
      <span class="muted" style="font-size:12px">${full ? "đã đầy" : `còn ${cap - n}`}</span></div>`;
  }).join("");
  box.innerHTML = rows;
}

$("#srcRows").addEventListener("click", e => {
  const retry = e.target.closest("[data-retry-source]");
  if(retry){
    const row = activeSources().find(item => item.id === retry.dataset.retrySource);
    if(row) void retrySource(row);
    return;
  }
  const review = e.target.closest("[data-review]");
  if(review){ rvDoc = review.dataset.review; rvIdx = 0; rvFilter = "all"; go("duyet"); paintReview(); }
  const see = e.target.closest("[data-see]");
  if(see){
    filters.src.clear();
    const nm = see.dataset.see.replace(/\.[a-z]+$/,"");
    if(srcList().includes(nm)) filters.src.add(nm);
    go("kho"); paintFacets(); paintKho();
    if(!filters.src.size) toast("Câu của tài liệu này nằm rải trong kho, không lọc riêng được");
  }
});

/* Upload thật: server lưu source, tạo job, gọi pipeline phase0 và trả câu vào hàng duyệt. */
async function uploadReal(){
  if(!upload.files.length){ toast("Chọn PDF, nhiều ảnh hoặc dán ảnh từ clipboard trước đã"); return; }
  const targetVaultId = activeVaultId;
  const { total } = scanCost();
  if(total > scansLeft){
    toast(`Cần ${total} ${UNIT.many} mà chỉ còn ${scansLeft}. Nâng gói hoặc chọn mức đọc nhẹ hơn.`);
    return;
  }

  const files = [...upload.files];
  const isBatch = files.length > 1 && files.every(file => file.type.startsWith("image/"));
  const per = OCR_TIERS[upload.tier].cost;
  const first = files[0];
  const row = {
    _temp:true,
    vaultId:targetVaultId,
    name:isBatch ? (upload.srcLabel.trim() || `${files.length} ảnh — ${first.name}`) : first.name,
    kind:isBatch ? "Lô ảnh" : first.type.startsWith("image/") ? "Ảnh" : "PDF",
    tier:upload.tier, pages:isBatch ? files.length : first.type.startsWith("image/") ? 1 : upload.pages,
    found:null, scans:(isBatch ? files.length : first.type.startsWith("image/") ? 1 : upload.pages) * per,
    state:"run", label:isBatch ? `Đang nối ${files.length} trang liên quan` : "Đang chờ OCR", prog:2
  };
  SOURCES.push(row);
  syncPaused = true;
  paintSources(); estimate();

  row.prog = 4; paintSources();
  let questionCount = 0, failed = false;
  try {
    const form = new FormData();
    if(isBatch) files.forEach(file => form.append("files", file));
    else form.set("file", first);
    form.set("subject", upload.subject === "Toán" ? "math" : "physics");
    form.set("grade", String(upload.grade));
    form.set("tier", upload.tier);
    form.set("srcLabel", upload.srcLabel);
    form.set("vaultId", targetVaultId);
    form.set("pages", String(row.pages || 1));
    const response = await fetch(isBatch ? "/api/upload-batch" : "/api/upload", { method:"POST", body:form });
    const result = await response.json();
    if(!response.ok) throw Object.assign(new Error(result.error || "OCR thất bại"), { source:result.source });
    Object.assign(row, result.source, { _temp:false });
    upload.files = [];
    renderUploadQueue();
    paintSources();
    const done = await followIngestJob(result.jobId, row, targetVaultId);
    if(!done.ok) throw new Error(done.error);
    row.scans = (row.pages || 1) * per;
    scansLeft -= row.scans;
    questionCount = done.questions;
  } catch(err){
    failed = true;
    Object.assign(row, err.source ?? {}, { _temp:false, state:"failed", label:"OCR lỗi", error:err.message, prog:0 });
  }
  $("#sourceFile").value = "";
  renderUploadQueue();
  syncPaused = false;
  paintSources(); paintReview(); paintHome();
  await saveWorkspace(true);
  if(failed) toast(`OCR lỗi — file vẫn nằm ở màn Tài liệu, bấm “Thử lại” là chạy tiếp những trang còn thiếu`);
  else toast(`${isBatch ? `Đã nối ${files.length} ảnh thành một tài liệu` : "Đã OCR tài liệu"} — ${questionCount} câu đang chờ duyệt`);
}

function wireUpload(){
  const drop = $("#drop");
  const picker = $("#sourceFile");
  drop.addEventListener("click", () => picker.click());
  drop.addEventListener("keydown", e => {
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); picker.click(); }
  });
  picker.addEventListener("change", e => chooseUploadFiles(e.target.files));
  ["dragenter","dragover"].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave","drop"].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("hot"); }));
  drop.addEventListener("drop", e => chooseUploadFiles(e.dataTransfer.files));
  document.addEventListener("paste", e => {
    if(!$("#s-nguon").classList.contains("on")) return;
    const pasted = [...(e.clipboardData?.items ?? [])]
      .filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile()).filter(Boolean)
      .map((file, i) => {
        const ext = { "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp" }[file.type] || "png";
        return new File([file], `clipboard-${Date.now()}-${i + 1}.${ext}`, { type:file.type, lastModified:Date.now() });
      });
    if(!pasted.length) return;
    e.preventDefault();
    chooseUploadFiles(pasted, { append:true, pasted:true });
  });
  $("#uploadQueue").addEventListener("click", e => {
    const remove = e.target.closest("[data-remove-upload]");
    if(!remove) return;
    e.stopPropagation();
    upload.files.splice(Number(remove.dataset.removeUpload), 1);
    renderUploadQueue(); estimate();
  });
  $("#btnStartUpload").addEventListener("click", () => void uploadReal());

  $$("[data-u]").forEach(el => {
    const key = el.dataset.u;
    el.addEventListener("change", e => {
      upload[key] = e.target.type === "checkbox" ? e.target.checked
                  : e.target.type === "number"   ? Math.max(1, +e.target.value || 1)
                  : e.target.value;
      estimate();
    });
  });

  paintTiers();
  renderUploadQueue();
  estimate();
}

function chooseUploadFiles(files, { append=false, pasted=false } = {}){
  const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  let incoming = [...(files ?? [])].filter(file => allowed.has(file.type) && file.size > 0 && file.size <= 15 * 1024 * 1024);
  const rejected = [...(files ?? [])].length - incoming.length;
  if(rejected) toast(`${rejected} file bị bỏ qua vì sai định dạng, rỗng hoặc lớn hơn 15 MB`);
  if(!incoming.length) return;
  let combined = append ? [...upload.files, ...incoming] : incoming;
  const seen = new Set();
  combined = combined.filter(file => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if(seen.has(key)) return false;
    seen.add(key); return true;
  });
  if(combined.some(file => file.type === "application/pdf") && combined.length > 1){
    toast("PDF cần nạp riêng; chế độ nhiều file hiện dành cho các trang ảnh");
    return;
  }
  if(combined.length > 50){ combined = combined.slice(0, 50); toast("Mỗi lượt chọn tối đa 50 ảnh"); }
  upload.files = combined;
  if(pasted){
    $("#drop").classList.add("pasted");
    setTimeout(() => $("#drop").classList.remove("pasted"), 800);
    toast(`Đã dán ${incoming.length} ảnh từ clipboard`);
  }
  renderUploadQueue(); estimate();
}

function renderUploadQueue(){
  const queue = $("#uploadQueue"), drop = $("#drop"), files = upload.files;
  queue.hidden = !files.length;
  queue.innerHTML = files.map((file, i) => `<div class="uploadfile">
    <span class="nm" title="${esc(file.name)}">${esc(file.name)}</span>
    <span class="sz">${(file.size/1024/1024).toFixed(2)} MB</span>
    <button type="button" data-remove-upload="${i}" aria-label="Bỏ ${esc(file.name)}">×</button>
  </div>`).join("");
  if(files.length){
    drop.querySelector("b").textContent = files.length === 1 ? files[0].name : `${files.length} ảnh đang chờ nạp`;
    drop.querySelector("span").textContent = `${(files.reduce((n,f)=>n+f.size,0)/1024/1024).toFixed(2)} MB tổng · có thể chọn thêm hoặc Ctrl+V để dán tiếp`;
  } else {
    drop.querySelector("b").textContent = "Kéo nhiều ảnh vào đây, bấm để chọn hoặc Ctrl+V để dán";
    drop.querySelector("span").textContent = "Một PDF hoặc tối đa 50 ảnh PNG/JPG/WebP · mỗi file tối đa 15 MB";
  }
  const pagesInput = $("[data-u='pages']");
  const exactImagePages = files.length && files.every(file => file.type.startsWith("image/"));
  pagesInput.disabled = Boolean(exactImagePages);
  if(exactImagePages){ upload.pages = files.length; pagesInput.value = String(files.length); }
}

/* Ước tính bằng LƯỢT QUÉT, không phải tiền. Xem ghi chú UNIT trong data.js.
   Giá vốn thật (USD) vẫn nằm ở phase0 — đó là số của người bán, không phải
   con số nên dí vào mặt giáo viên mỗi lần họ định nạp tài liệu. */
function scanCost(){
  const per = OCR_TIERS[upload.tier].cost;
  const pages = upload.files.length && upload.files.every(file => file.type.startsWith("image/"))
    ? upload.files.length : upload.pages;
  return { per, pages, total: per * pages };
}

function estimate(){
  const t = OCR_TIERS[upload.tier];
  const { per, pages, total } = scanCost();
  const du = total <= scansLeft;

  $("#estPer").textContent = `${per} ${UNIT.short}`;
  $("#estRows").innerHTML = `
    <span>Mức đọc ${t.name}</span><b>${t.cost} ${UNIT.short}/trang</b>
    <span>${upload.files.length > 1 ? `Lô ${upload.files.length} ảnh` : `Tài liệu ${pages} trang`}</span><b>${total} ${UNIT.short}</b>
    <span>Còn lại sau khi nạp</span><b${du ? "" : ' style="color:var(--danger)"'}>${
      du ? scansLeft - total : `thiếu ${total - scansLeft}`} ${UNIT.short}</b>`;

  $("#estNote").innerHTML = du
    ? `<span class="muted">${esc(t.desc)}</span>`
    : `<span style="color:var(--danger)">Không đủ lượt trong tháng này.
       Nâng gói hoặc chọn mức đọc nhẹ hơn.</span>`;
  $("#btnStartUpload").disabled = !du || !upload.files.length;
}

/* Mức đọc nào gói này mở được. Mức khoá vẫn hiện ra — người ta phải thấy thứ
   mình chưa có thì mới có lý do nâng gói — nhưng bấm vào thì báo rõ. */
function paintTiers(){
  const box = $("#tierBox");
  box.innerHTML = Object.entries(OCR_TIERS).map(([k,t]) => {
    const open = plan.tiers.includes(k);
    return `<button type="button" class="tier${open ? "" : " locked"}" data-tier="${k}"
      aria-pressed="${upload.tier === k}" ${open ? "" : `title="Gói ${plan.name} chưa mở mức này"`}>
      <span class="nm">${t.name}${open ? "" : " 🔒"}</span>
      <span class="ct">${t.cost} ${UNIT.short}/trang</span>
      <span class="ds">${esc(t.desc)}</span>
    </button>`;
  }).join("");

  $$("[data-tier]", box).forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.tier;
    if(!plan.tiers.includes(k)){
      toast(`Mức ${OCR_TIERS[k].name} có ở gói ${k === "chuan" ? "Plus" : "Pro"} — gói ${plan.name} chưa mở.`);
      return;
    }
    upload.tier = k;
    paintTiers(); estimate();
  }));
}

/* ══════════════════════════════════════════════════════ điều hướng ══ */

function paintVaultSwitcher(){
  const select = $("#vaultSelect");
  select.innerHTML = VAULTS.map(vault =>
    `<option value="${esc(vault.id)}" ${vault.id === activeVaultId ? "selected" : ""}>${esc(vault.name)}</option>`).join("");
}

function setVault(next){
  if(next === activeVaultId || !VAULTS.some(vault => vault.id === next)) return;
  saveCurrentDraft();
  activeVaultId = next;
  const vault = activeVault();
  subject = vault.subject === "math" ? "math" : "physics";
  currentDraft = ensureDraft(activeVaultId);
  DOC = structuredClone(currentDraft.doc);
  header = structuredClone(currentDraft.header);
  layout = { ...DEFAULT_LAYOUT, ...structuredClone(currentDraft.layout) };
  PRESETS = structuredClone(currentDraft.presets);
  activePresetId = currentDraft.activePresetId;
  docTouched = false;
  Object.values(filters).forEach(set => set.clear());
  checked.clear(); selectedId = null; finderFor = null;
  rvDoc = null; rvIdx = 0; rvFilter = "all";
  upload.subject = subject === "math" ? "Toán" : "Vật lí";
  paintVaultSwitcher();
  paintFacets(); paintKho(); paintCanvas(); renderSheet();
  paintSources(); paintReview(); paintHome(); paintCapacity(); estimate();
  void saveWorkspace(true);
  toast(`Đã mở ${vault.name}`);
}

$("#vaultSelect").addEventListener("change", e => setVault(e.target.value));
$("#vaultCreate").addEventListener("click", () => {
  const name = prompt("Tên Kho mới", "Kho chưa đặt tên")?.trim();
  if(!name) return;
  if(VAULTS.some(vault => fold(vault.name) === fold(name))){ toast("Tên Kho này đã tồn tại"); return; }
  const id = `vault-${crypto.randomUUID()}`;
  VAULTS.push({ id, name:name.slice(0,80), subject, description:"", createdAt:new Date().toISOString() });
  DRAFTS[id] = { doc:[{kind:"hdr"}], header:defaultHeaderFor({subject}), layout:{...DEFAULT_LAYOUT} };
  setVault(id);
});
$("#vaultRename").addEventListener("click", () => {
  const vault = activeVault();
  const name = prompt("Đổi tên Kho", vault.name)?.trim();
  if(!name || name === vault.name) return;
  if(VAULTS.some(item => item.id !== vault.id && fold(item.name) === fold(name))){ toast("Tên Kho này đã tồn tại"); return; }
  vault.name = name.slice(0,80);
  paintVaultSwitcher(); paintHome(); void saveWorkspace(true);
  toast("Đã đổi tên Kho");
});
paintVaultSwitcher();

$("#btnLogout").addEventListener("click", async () => {
  await saveWorkspace(true);
  await fetch("/api/auth/logout", { method:"POST" });
  location.replace("./login.html");
});

if(session?.email){
  const who = session.name || session.email.split("@")[0];
  $("#who").textContent = who.slice(0,2).toUpperCase();
  $("#who").title = session.email;
}

/* ═══════════════════════════════════════════════════════ trang chính ══ */
/* Vào app mà đập ngay 28 câu vào mặt thì không biết bắt đầu từ đâu. Màn này
   trả lời đúng bốn câu: kho có gì, còn việc gì phải làm, dùng hết bao nhiêu,
   và bấm vào đâu tiếp theo. */

function paintHome(){
  const who = session?.name || session?.email?.split("@")[0] || "";
  $("#hiName").textContent = `Chào ${who || "thầy cô"}`;
  const pend = activePending().length;
  const vaultQuestions = ofSubject().length;
  $("#hiSub").textContent = pend
    ? `Có ${pend} câu vừa đọc xong đang chờ bạn duyệt.`
    : `${activeVault().name} đang có ${vaultQuestions} câu. Gói ${plan.name}, còn ${Math.max(0,scansLeft)} ${UNIT.many} tháng này.`;

  const inDoc = DOC.filter(b => b.kind === "sec").reduce((a,b) => a + secCount(b), 0);
  const TILES = [
    ["Câu trong Kho", vaultQuestions, activeVault().name, "kho"],
    ["Chờ duyệt", pend, pend ? "cần mắt người trước khi vào kho" : "không còn gì", "duyet"],
    ["Đề đang soạn", inDoc, inDoc ? "câu đã xếp vào đề" : "chưa xếp câu nào", "rap"],
    [UNIT.many, Math.max(0,scansLeft), `trên ${plan.scans} của gói ${plan.name}`, "nguon"],
  ];
  $("#homeTiles").innerHTML = TILES.map(([lab,val,sub,go]) =>
    `<button class="tile" type="button" data-go="${go}">
      <span class="tile-n num">${val}</span>
      <span class="tile-l">${esc(lab)}</span>
      <span class="tile-s">${esc(sub)}</span>
    </button>`).join("");

  /* Ba bước, và bước nào xong thì đánh dấu xong — để người mới biết mình
     đang ở đâu, người cũ khỏi phải đọc lại. */
  const done = { nap: activeSources().length > 0, duyet: pend === 0 && vaultQuestions > 0, rap: inDoc > 0 };
  $("#homeSteps").innerHTML = [
    ["nap","Nạp tài liệu","Kéo file PDF hay ảnh chụp trang đề vào. AI đọc ra câu hỏi kèm công thức.","nguon","Nạp tài liệu"],
    ["duyet","Duyệt câu","Đặt cạnh file gốc; AI đánh dấu câu trùng, hình thiếu và chỗ đọc không chắc. Xong mới vào kho.","duyet","Mở màn duyệt"],
    ["rap","Ráp đề và xuất Word","Xếp câu thành phần, chỉnh lề và watermark, tải về file .docx sửa được.","rap","Ráp đề"],
  ].map(([k,title,desc,goTo,cta],i) =>
    `<li class="${done[k] ? "done" : ""}">
      <span class="step-n">${done[k] ? "✓" : i+1}</span>
      <div><b>${title}</b><p>${desc}</p>
        <button class="btn btn-sm" type="button" data-go="${goTo}">${cta}</button></div>
    </li>`).join("");

  // Kho theo chuyên đề: chỉ 6 dòng nhiều nhất, bấm là nhảy sang kho đã lọc sẵn.
  const counts = {};
  for(const x of ofSubject()) counts[x.topic] = (counts[x.topic] ?? 0) + 1;
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,6);
  const max = top[0]?.[1] ?? 1;
  $("#homeTopics").innerHTML = top.length
    ? top.map(([code,n]) =>
        `<button class="tbar" type="button" data-topic="${code}">
          <span class="tbar-l">${esc(TOPICS[code] ?? code)}</span>
          <span class="tbar-w"><i style="width:${n/max*100}%"></i></span>
          <span class="num">${n}</span></button>`).join("")
    : `<div class="empty" style="padding:20px">Kho này chưa có câu nào.</div>`;

  $("#homeDocs").innerHTML = activeSources().slice(-4).reverse().map(r =>
    `<div class="docrow">
      <span class="docname">${esc(r.name)}</span>
      <span class="chip ${{done:"ok",review:"warn",run:"acc"}[r.state] ?? ""}">${esc(r.label)}</span>
    </div>`).join("") || `<div class="empty" style="padding:20px">Chưa nạp tài liệu nào.</div>`;

  $("#homeTips").innerHTML = [
    "Trong kho, tích nhiều câu rồi bấm <b>+ Thêm vào đề</b> để đẩy một lượt.",
    "Ở màn Duyệt: <kbd>Enter</kbd> duyệt · <kbd>E</kbd> sửa · <kbd>X</kbd> bỏ · <kbd>← →</kbd> chuyển câu.",
    "Ráp đề thêm được <b>nhiều phần cùng dạng</b>, trang bìa và khối chữ tự do — hợp cho phiếu bài tập.",
    "Nút <b>Xuất cả bộ</b> tải một lượt ba file: đề, đáp án, lời giải.",
  ].map(s => `<li>${s}</li>`).join("");
}

/* ═════════════════════════════════════════════ màn tùy chỉnh format ══ */
const CUSTOM_SAMPLES = [
  {type:"MC",stem:"Cho hàm số $f(x)=x^2-4x+3$. Giá trị nhỏ nhất của hàm số trên $\\mathbb R$ là",ch:["$-2$","$-1$","$0$","$1$"],ans:1},
  {type:"TF",stem:"Xét tính đúng sai của các phát biểu sau.",tf:[["Hàm số xác định trên $\\mathbb R$",true],["Hàm số đồng biến trên toàn bộ $\\mathbb R$",false]]},
  {type:"SHORT",stem:"Ghi số $2026$ vào ô trả lời.",sa:{value:"2026",unit:""}},
  {type:"ESSAY",stem:"Trình bày lời giải chi tiết cho bài toán đã cho.",sol:""}
];

/* Đổi form câu hỏi là đổi cả bảng màu mặc định của form đó — nếu không thì chọn
   "Chuyên Toán" xong tờ giấy vẫn xanh và người dùng tưởng nút hỏng. Riêng "Mẫu
   riêng" giữ nguyên màu đang có, vì đó chính là bộ màu người dùng tự đặt. */
function applyQuestionStyle(target, style){
  target.questionStyle = style;
  if(style !== "custom") Object.assign(target, paletteFor(style));
}

function applyBuiltinLayout(id){
  const preset = BUILTIN_LAYOUT_PRESETS.find(item => item.id === id);
  if(!preset) return;
  const clone = structuredClone(preset.layout);
  layout = { ...DEFAULT_LAYOUT, ...paletteFor(clone.questionStyle), ...clone };
  header = { ...header, ...structuredClone(preset.header || {}) };
  activePresetId = preset.id;
  paintCustomize(); renderSheet(); void saveWorkspace(true);
  toast(`Đã áp dụng mẫu ${preset.name}`);
}

function renderCustomPreview(){
  const sheet = $("#customSheet");
  if(!sheet) return;
  sheet.className = `sheet paper qstyle-${resolveFormat(layout).questionStyle}`;
  sheet.style.cssText = paperStyle(layout);
  sheet.innerHTML = watermarkHtml(layout) + headerHtml(layout,header) +
    extraLayoutHtml("top",layout) +
    sectionHeadingHtml("Mẫu các dạng câu",layout) +
    CUSTOM_SAMPLES.map((q,i)=>questionHtmlForLayout(q,i+1,false,layout)).join("") +
    extraLayoutHtml("bottom",layout);
  fitCustomPreview();
  const active = BUILTIN_LAYOUT_PRESETS.find(item=>item.id===activePresetId) || PRESETS.find(item=>item.id===activePresetId);
  $("#customActivePreset").textContent = active?.name || layout.presetName || "Tùy chỉnh";
}

/** Thu tờ A4 thật cho vừa khung xem trước của màn Tùy chỉnh. */
function fitCustomPreview(){
  const scale = $("#customScale"), sheet = $("#customSheet"), wrap = $(".custom-paper-wrap");
  if(!scale || !sheet || !wrap) return;
  const room = wrap.clientWidth - 36, paper = sheet.offsetWidth;
  if(room < 50 || paper < 50) return;          // màn còn ẩn thì đo ra 0
  const k = Math.min(1, room / paper);
  scale.style.transform = `scale(${k})`;
  scale.style.width = `${paper * k}px`;
  scale.style.height = `${sheet.offsetHeight * k}px`;
}
addEventListener("resize", () => { if($("#s-custom").classList.contains("on")) fitCustomPreview(); });

function paintCustomize(){
  const gallery = $("#builtinPresets");
  if(!gallery) return;
  gallery.innerHTML = BUILTIN_LAYOUT_PRESETS.map(preset => `<button class="preset-card" type="button" data-builtin="${preset.id}" aria-pressed="${activePresetId===preset.id}">
    <span class="preset-card-top"><b>${esc(preset.name)}</b><span class="chip">${esc(preset.badge)}</span></span>
    <span>${esc(preset.desc)}</span><small>${preset.id === "builtin-bk" ? "Latin Modern · TN ô tròn 2 cột" : preset.id === "builtin-legacy" ? "Tối giản · TN 2 cột" : "Card · đủ 4 dạng"}</small>
  </button>`).join("");
  $$('[data-builtin]',gallery).forEach(button=>button.addEventListener('click',()=>applyBuiltinLayout(button.dataset.builtin)));

  const optionHtml = (items,current) => items.map(item=>{
    const value=Array.isArray(item)?item[0]:item,name=Array.isArray(item)?item[1]:item;
    return `<option value="${esc(value)}" ${String(value)===String(current)?"selected":""}>${esc(name)}</option>`;
  }).join("");
  $("#customControls").innerHTML = `
    <div class="custom-control-card"><div class="custom-control-title"><span class="custom-type-icon">Aa</span><div><b>Trang & font</b><small>Lề mặc định mới: 1–1–1–1 cm</small></div></div>
      <div class="grid2"><label>Font<select data-custom="fontFamily">${optionHtml([["legacy","Times / Legacy"],["latex","Latin Modern / LaTeX"],["sans","Sans hiện đại"]],layout.fontFamily)}</select></label>
      <label>Form tổng<select data-custom="questionStyle">${optionHtml([["classic","Tối giản"],["exam-blue","Hiện tại / Blue"],["specialist-pink","Chuyên Toán"],["logic-green","ĐGNL Logic"],["custom","Mẫu riêng"]],layout.questionStyle)}</select></label></div>
      <div class="grid3"><label>Cỡ chữ<select data-custom="fontSize">${optionHtml([11,12,13,14],layout.fontSize)}</select></label>
      <label>Giãn dòng<select data-custom="lineGap">${optionHtml([[1,"1,0"],[1.15,"1,15"],[1.32,"1,32"],[1.5,"1,5"]],layout.lineGap)}</select></label>
      <label>Cột trang<select data-custom="columns">${optionHtml([[1,"1 cột"],[2,"2 cột"]],layout.columns)}</select></label></div>
      <div class="margin-four">${[["marginTop","Trên"],["marginRight","Phải"],["marginBottom","Dưới"],["marginLeft","Trái"]].map(([key,name])=>`<label>${name}<input type="number" min=".5" max="5" step=".25" data-custom="${key}" value="${layout[key]}"></label>`).join("")}</div></div>
    <div class="custom-control-card"><div class="custom-control-title"><span class="custom-type-icon mc">A</span><div><b>Trắc nghiệm</b><small>Kiểu phương án và số cột</small></div></div>
      <div class="grid2"><label>Phương án<select data-custom="mcStyle">${optionHtml([["plain","Chữ thường"],["circle","Ô tròn (BK)"],["cards","Card / ô"],["tabular","Tabular LaTeX"]],layout.mcStyle)}</select></label>
      <label>Số cột<select data-custom="mcColumns">${optionHtml([1,2,4],layout.mcColumns)}</select></label></div></div>
    <div class="custom-control-card"><div class="custom-control-title"><span class="custom-type-icon tf">Đ/S</span><div><b>Đúng – Sai</b><small>Bảng tích hoặc danh sách gọn</small></div></div>
      <label>Form trả lời<select data-custom="tfStyle">${optionHtml([["table","Bảng card"],["tabular","Tabular LaTeX"],["list","Danh sách a, b, c, d"]],layout.tfStyle)}</select></label></div>
    <div class="custom-control-card"><div class="custom-control-title"><span class="custom-type-icon short">#</span><div><b>Trả lời ngắn</b><small>Ô đáp án và vùng trình bày</small></div></div>
      <div class="grid3"><label>Form<select data-custom="shortStyle">${optionHtml([["boxes","Ô trả lời"],["line","Dòng trống"]],layout.shortStyle)}</select></label>
      <label>Số ô<select data-custom="shortBoxCount">${optionHtml([1,2,3,4,5,6],layout.shortBoxCount)}</select></label>
      <label>Dòng làm bài<input type="number" min="0" max="20" data-custom="shortWorkLines" value="${layout.shortWorkLines}"></label></div></div>
    <div class="custom-control-card"><div class="custom-control-title"><span class="custom-type-icon essay">¶</span><div><b>Tự luận</b><small>Dòng chấm hoặc vùng trắng</small></div></div>
      <div class="grid2"><label>Vùng làm bài<select data-custom="essayStyle">${optionHtml([["lines","Dòng chấm"],["blank","Khoảng trắng"]],layout.essayStyle)}</select></label>
      <label>Số dòng<input type="number" min="2" max="30" data-custom="essayWorkLines" value="${layout.essayWorkLines}"></label></div></div>`;
  const numeric = new Set(["marginTop","marginRight","marginBottom","marginLeft","mcColumns","shortBoxCount",
    "shortWorkLines","essayWorkLines","fontSize","lineGap","columns"]);
  $$('[data-custom]',$("#customControls")).forEach(input=>input.addEventListener('change',e=>{
    const key = input.dataset.custom;
    if(key === "questionStyle") applyQuestionStyle(layout, e.target.value);
    else layout[key] = numeric.has(key) ? +e.target.value : e.target.value;
    activePresetId = null; layout.presetName = "Tùy chỉnh";
    renderCustomPreview(); renderSheet(); void saveWorkspace(true);
  }));
  renderCustomPreview();
}

$("#customAdvanced").addEventListener("click",openLayoutEditor);

$("#homeTopics").addEventListener("click", e => {
  const b = e.target.closest("[data-topic]");
  if(!b) return;
  filters.topic.clear(); filters.topic.add(b.dataset.topic);
  facetOpen.topic = true;
  go("kho"); paintFacets(); paintKho();
});

function go(name){
  ["home","kho","rap","custom","duyet","nguon"].forEach(k =>
    $("#s-"+k).classList.toggle("on", k === name));
  $$("#tabs button").forEach(b => {
    b.dataset.go === name ? b.setAttribute("aria-current","page") : b.removeAttribute("aria-current");
  });
  if(name === "duyet") paintReview();
  if(name === "home")  paintHome();
  if(name === "custom") paintCustomize();
  // Màn vừa hiện thì mới đo được bề ngang thật; đo lúc còn ẩn ra số sai.
  if(name === "rap") requestAnimationFrame(applySheetZoom);
  window.scrollTo(0,0);
}
$$("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));

paintFacets(); paintKho(); paintCanvas(); renderSheet();
paintSources(); wireUpload(); paintReview(); paintHome();

/* Mở lại app trong lúc máy chủ còn đang đọc dở một tài liệu thì bám tiếp vào
   đúng job đó, thay vì để dòng "Đang đọc" đứng im mãi mãi. */
(function resumeRunningSources(){
  const running = SOURCES.filter(row => row.state === "run" && row.jobId);
  if(!running.length) return;
  syncPaused = true;
  Promise.allSettled(running.map(row => followIngestJob(row.jobId, row, row.vaultId || activeVaultId)))
    .then(async () => {
      syncPaused = false;
      paintSources(); paintReview(); paintHome();
      await saveWorkspace(true);
    });
})();

setInterval(() => void saveWorkspace(), 1200);
window.addEventListener("pagehide", () => {
  const body = JSON.stringify(workspaceSnapshot());
  if(body !== lastSnapshot){
    navigator.sendBeacon("/api/workspace", new Blob([body], { type:"application/json" }));
  }
});
