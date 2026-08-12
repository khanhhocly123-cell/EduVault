import { SUBJECTS, TOPICS, topicsOf, TYPES, CLS, DIFFS, DNAME, FIGS, BANK, SOURCES,
         BLUEPRINTS, HEADER_TEMPLATES, DEFAULT_HEADER, DEFAULT_LAYOUT, PENDING,
         PLANS, planOf, OCR_TIERS, UNIT } from "./data.js";

/* ══════════════════════════════════════════════════════ phiên đăng nhập ══ */
/* Bản thật dùng Supabase Auth. Ở đây chỉ giữ chỗ để luồng màn hình chạy đủ. */

let session, BOOT;
try {
  const auth = await fetch("/api/session", { cache:"no-store" });
  if(!auth.ok) throw new Error("unauthorized");
  const { user } = await auth.json();
  session = { email:user.email, name:user.name, plan:user.plan };
  const state = await fetch("/api/workspace", { cache:"no-store" });
  if(!state.ok) throw new Error("Không tải được workspace");
  BOOT = await state.json();
  BANK.splice(0, BANK.length, ...(BOOT.bank ?? []));
  PENDING.splice(0, PENDING.length, ...(BOOT.pending ?? []));
  SOURCES.splice(0, SOURCES.length, ...(BOOT.sources ?? []));
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

const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

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
    const inner = readArg(toks, st);
    st.roman = was;
    return { html:`<span class="up">${inner}</span>`, kind:"atom" };
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
  const st = { i:0, roman:false };
  const html = buildList(tokenize(String(src)), st);
  if(unknownCmds.size){
    console.warn("[công thức] lệnh LaTeX chưa hỗ trợ:", [...unknownCmds].join(", "));
    unknownCmds.clear();
  }
  return `<span class="mth">${html}</span>`;
}

/* Chỉ escape phần chữ thường. Phần trong $…$ do math() tự escape lúc phát ra —
   escape trước thì "<" đã thành "&lt;" và bộ tách token đọc nhầm thành 4 ký tự. */
const tex = (src) => String(src).split("$").map((p,i) => i%2 ? math(p) : esc(p)).join("");
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
  return { src:f.src ?? null, note:f.note ?? null,
           width:f.width ?? 45, place:f.place ?? "top" };
}

/** Nội dung hình: khoá hình dựng sẵn thì lấy SVG, data URL thì dựng thẻ img. */
function figInner(src){
  if(!src) return "";
  if(FIGS[src]) return FIGS[src];
  if(String(src).startsWith("data:")) return `<img src="${esc(src)}" alt="">`;
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
const LETTER = ["A","B","C","D"];
const TFIDX  = ["a","b","c","d"];
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
let subject = BOOT.subject === "math" ? "math" : "physics";
let header = { ...DEFAULT_HEADER, ...(BOOT.header ?? {}) };
let layout = { ...DEFAULT_LAYOUT, ...(BOOT.layout ?? {}) };
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
let DOC = Array.isArray(BOOT.doc) && BOOT.doc.length ? structuredClone(BOOT.doc) : [{ kind:"hdr" }];

let saveBusy = false, saveAgain = false, syncPaused = false;
let lastSnapshot = "";
const workspaceSnapshot = () => ({
  bank:BANK, pending:PENDING, sources:SOURCES.filter(x => !x._temp),
  doc:DOC, header, layout, subject
});
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
    if(!r.ok) throw new Error((await r.json()).error || "Không lưu được workspace");
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
const ofSubject = () => BANK.filter(x => x.subject === subject);
const srcList = () => [...new Set(ofSubject().map(x=>x.src))];

/* Điểm theo cấu trúc thi thật 2025: trắc nghiệm và trả lời ngắn 0,25 đ mỗi câu,
   đúng/sai 1,0 đ mỗi câu (4 ý). Tự luận chấm tay nên không quy ra điểm. */
const POINTS = { MC:0.25, TF:1, SHORT:0.25, ESSAY:0 };
const SECNOTE = { MC:"4 phương án", TF:"1 ý 0,1 — 4 ý 1,0",
                  SHORT:"đáp án là số", ESSAY:"chấm tay" };

/* ═══════════════════════════════════════════════════════════════ kho ══ */

function match(x){
  if(x.subject !== subject) return false;
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
  facetRows($("#fTopic"),"topic", topicsOf(subject));
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
            aria-label="Chọn câu này để thêm vào đề">${TICK}</span>
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
}

function paintDetail(){
  const el = $("#detail");
  const x = selectedId ? qById(selectedId) : null;
  $("#btnEditSel").disabled = $("#btnDelSel").disabled = $("#btnAddOne").disabled = !x;
  if(!x){
    el.innerHTML = `<div class="empty">Chọn một câu bên trái để xem đầy đủ.</div>`;
    return;
  }

  let body = `<div class="dtext">${tex(x.stem)}</div>` +
    (normFig(x.fig)?.place === "below" ? "" : figHtml(x.fig));
  if(!hasFig(x) && x.figNote){
    body += `<div class="conflict"><span class="t">
      <b>Câu này có hình</b> mà chưa gắn ảnh. AI mô tả: “${esc(x.figNote)}”.
      Bấm Sửa để tải hình lên.</span></div>`;
  }

  if(x.type === "MC" && x.ch){
    body += `<div class="choices">${x.ch.map((c,i) =>
      `<div class="choice${i===x.ans?" ans":""}"><b>${LETTER[i]}.</b> ${tex(c)}
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

function removeQuestion(x){
  BANK.splice(BANK.indexOf(x),1);
  checked.delete(x.id);
  if(selectedId === x.id) selectedId = null;
  for(const s of DOC) if(s.items){
    s.items = s.items.filter(it => it.qid !== x.id);
    for(const it of s.items) if(it.picked) it.picked = it.picked.filter(id => id !== x.id);
  }
  paintFacets(); paintKho(); paintCanvas(); renderSheet();
  toast("Đã xoá 1 câu khỏi kho");
}

/* Thêm câu từ kho vào đề đang soạn: tìm phần cùng dạng câu, chưa có thì mở
   thêm một phần mới — chứ không im lặng bỏ qua. */
function addToDoc(ids){
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
  if(type === "MC" && !x.ch)  { x.ch = ["","","",""]; x.ans = 0; }
  if(type === "TF" && !x.tf)  { x.tf = TFIDX.map(()=>["",true]); }
  if(type === "SHORT" && !x.sa){ x.sa = {value:"",unit:"",tol:"0"}; }
}

function openEditor(id){
  const orig = qById(id);
  if(!orig) return;
  const x = structuredClone(orig);

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Sửa câu hỏi">
    <div class="modal-head">
      <h3>Sửa câu hỏi</h3>
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
    let h = (g?.place === "right" || g?.place === "left" ? figHtml(x.fig,"fg") : "") +
      `<b style="display:inline">Câu 1.</b> ${tex(x.stem)}` + figAt(x.fig,"top","fg");
    if(x.type === "MC" && x.ch){
      h += `<div class="ch">${x.ch.map((c,i)=>
        `<div ${i===x.ans?'style="color:#1B7350;font-weight:700"':""}>
          <b style="display:inline">${LETTER[i]}.</b> ${tex(c)}</div>`).join("")}</div>`;
    }
    if(x.type === "TF" && x.tf){
      h += x.tf.map(([t,v,why],i)=>
        `<div style="margin-left:14px">${TFIDX[i]}) ${tex(t)}
         <b style="display:inline;color:${v?"#1B7350":"#8c3a30"}">${v?"Đ":"S"}</b>
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
                      aria-label="Đáp án đúng là ${LETTER[i]}"></button>
              <b>${LETTER[i]}.</b>
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
            <div class="tfcard${v ? " isT" : " isF"}">
              <div class="tfhead">
                <b>${TFIDX[i]})</b>
                <textarea data-tf="${i}" rows="1" placeholder="Nội dung ý ${TFIDX[i]}">${esc(txt)}</textarea>
                <div class="seg" role="group" aria-label="Đáp án ý ${TFIDX[i]}">
                  <button type="button" data-tfv="${i}.1" aria-pressed="${v}">Đúng</button>
                  <button type="button" data-tfv="${i}.0" aria-pressed="${!v}">Sai</button>
                </div>
              </div>
              <input type="text" class="tfwhy" data-tfw="${i}" value="${esc(why ?? "")}"
                     placeholder="Vì sao ý này ${v ? "đúng" : "sai"}? (hiện trong bản lời giải)">
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
      ${x.answerSource === "solved"
        ? '<div class="conflict"><span class="t">Đáp án của câu này do AI tự giải, đề gốc không in. Kiểm lại trước khi dùng.</span></div>'
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
        x.tf[+i][1] = v === "1";
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

function openLayoutEditor(){
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
    sheet.className = "sheet";
    sheet.style.cssText = paperStyle(L);
    sheet.innerHTML = watermarkHtml(L) + headerHtml(L) +
      `<h5>PHẦN I. TRẮC NGHIỆM</h5>
       <div class="q"><b style="display:inline">Câu 1.</b> Một con lắc lò xo có độ cứng
         ${tex("$k = 40\\,\\mathrm{N/m}$")}. Tần số góc bằng
         <div class="ch"><div><b style="display:inline">A.</b> 20 rad/s</div>
         <div><b style="display:inline">B.</b> 200 rad/s</div></div></div>`;
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

/** Lề và cỡ chữ đổ thẳng vào style của tờ giấy xem trước. */
function paperStyle(L = layout){
  return `padding:${L.marginTop}cm ${L.marginRight}cm ${L.marginBottom}cm ${L.marginLeft}cm;` +
    `font-size:${L.fontSize}pt;line-height:${L.lineGap};` +
    (L.columns === 2 ? "column-count:2;column-gap:1cm;" : "");
}

function watermarkHtml(L = layout){
  if(!L.watermark.trim()) return "";
  return `<div class="watermark" aria-hidden="true"
    style="opacity:${L.watermarkOpacity/100};transform:rotate(${L.watermarkAngle}deg)">
    ${esc(L.watermark)}</div>`;
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
  $("#btnFoldAll").textContent = foldAll ? "Mở hết" : "Thu gọn";
  paintCanvas();
});

/* ═════════════════════════════════════════════════════ xem trước ══ */

function headerHtml(L = layout){
  const h = header;
  const idline = h.showId
    ? `<div class="idline"><span>Họ và tên: ..............................</span>
       <span>Lớp: ..........</span><span>SBD: ..........</span></div>` : "";
  const codeTxt = h.showCode ? `<br>Mã đề ${esc(h.code)}` : "";

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

function questionHtml(x, no){
  const g = normFig(x.fig);
  const floated = g?.place === "right" || g?.place === "left" ? figHtml(x.fig,"fg") : "";
  let h = `<div class="q">${floated}<b style="display:inline">Câu ${no}.</b> ${tex(x.stem)}` +
          figAt(x.fig,"top","fg");
  if(x.type === "MC" && x.ch)
    h += `<div class="ch">${x.ch.map((c,i)=>
      `<div><b style="display:inline">${LETTER[i]}.</b> ${tex(c)}</div>`).join("")}</div>`;
  if(x.type === "TF" && x.tf)
    h += x.tf.map(([t],i)=>`<div style="margin-left:14px">${TFIDX[i]}) ${tex(t)}</div>`).join("");
  if(x.type === "SHORT") h += `<div class="ph">Đáp án: ................</div>`;
  return h + figAt(x.fig,"below","fg") + `</div>`;
}

function answerHtml(x, no){
  if(x.type === "MC")
    return `<div class="q"><b style="display:inline">Câu ${no}.</b> ${LETTER[x.ans] ?? "?"}</div>`;
  if(x.type === "TF" && x.tf)
    return `<div class="q"><b style="display:inline">Câu ${no}.</b> ${
      x.tf.map(([,v],i)=>`${TFIDX[i]}) ${v ? "Đ" : "S"}`).join("  ")}</div>`;
  if(x.type === "SHORT" && x.sa)
    return `<div class="q"><b style="display:inline">Câu ${no}.</b> ${
      esc(x.sa.value)} ${esc(x.sa.unit)}</div>`;
  return `<div class="q"><b style="display:inline">Câu ${no}.</b> <span class="ph">(tự luận)</span></div>`;
}

function solutionHtml(x, no){
  let h = `<div class="q"><b style="display:inline">Câu ${no}.</b> `;
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
        : headerHtml();
      continue;
    }
    if(b.kind === "break"){ h += `<div class="pagebreak"></div>`; continue; }
    if(b.kind === "text"){
      if(!key && !sol) h += `<div class="freetext">${b.html ?? ""}</div>`;
      continue;
    }
    if(b.kind !== "sec") continue;

    h += `<h5>${esc(secTitle(b)).toUpperCase()}</h5>`;
    if(b.note) h += `<div class="q ph">${esc(b.note)}</div>`;
    const list = flatten(b);
    if(!list.length){ h += `<div class="q ph">(phần này chưa có câu nào)</div>`; continue; }
    list.forEach((x, i) => {
      if(x._pending){
        h += `<div class="q"><b style="display:inline">Câu ${i+1}.</b>
          <span class="ph">chưa rút — ${DNAME[x._pending].toLowerCase()}</span></div>`;
      } else {
        h += key ? answerHtml(x, i+1) : sol ? solutionHtml(x, i+1) : questionHtml(x, i+1);
      }
    });
  }

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
  el.innerHTML = (paper ? watermarkHtml() : "") + sheetHtml();
}

$("#btnRefresh").addEventListener("click", () => {
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
  return null;
}

function buildExamDoc(){
  const questions = [];
  const holes = [];

  for(const b of DOC){
    if(b.kind !== "sec") continue;
    for(const x of flatten(b)){
      if(x._pending){ holes.push(DNAME[x._pending]); continue; }
      const g = normFig(x.fig);
      questions.push({
        type: x.type,
        stem_latex: x.stem,
        images: g?.src
          ? [{ slot:1, bbox:[0,0,1,1], caption:null, note:x.figNote ?? null,
               width_pct:g.width, placement:g.place, src:g.src }]
          : [],
        mc_choices: x.type === "MC" && x.ch
          ? x.ch.map((c,i) => ({ label: LETTER[i], text_latex: c })) : null,
        mc_correct: x.type === "MC" ? (LETTER[x.ans] ?? null) : null,
        tf_statements: x.type === "TF" && x.tf
          ? x.tf.map(([t,v],i) => ({ idx: TFIDX[i], text_latex: t, is_true: v })) : null,
        short_answer: x.type === "SHORT" && x.sa
          ? { value: num(x.sa.value), unit: x.sa.unit || null, tolerance: num(x.sa.tol) || null }
          : null,
        solution_latex: x.sol || null,
        grade: x.grade ?? null,
        topic_code: x.topic ?? null,
        difficulty: x.diff,
        notes: null
      });
    }
  }

  return {
    doc: {
      header: {
        org: header.org, school: header.school, title: header.title,
        subject: header.subject, durationMin: header.duration,
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
        watermarkAngle: layout.watermarkAngle
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

  const S = layout.fontSize;
  const key = mode === "dapan", sol = mode === "loigiai";

  async function figPara(fig){
    const g = normFig(fig);
    const shot = await prepareFigure(fig);
    if(!shot) return "";
    rid++;
    images.push({ rid, src:shot.src });
    const align = g.place === "left" ? "left" : g.place === "right" ? "right" : "center";
    return para(imageRun(rid, shot.w, shot.h, "hinh"), { align, after:80 });
  }

  async function questionParas(x, no){
    let out = "";
    const g = normFig(x.fig);
    countMath(x.stem);

    out += para(txt(`Câu ${no}. `, { bold:true }) + wtex(x.stem, { size:S }),
             { keepNext:true, lineGap:layout.lineGap });

    /* Hình đặt "trên phương án" nghĩa là NẰM DƯỚI ĐỀ BÀI và trên bốn phương án,
       không phải trên cả câu — bản trước đẩy hình lên trước cả chữ "Câu 1.".
       Word không cho chữ chạy vòng quanh ảnh inline, nên hình "nổi hai bên"
       rơi về ảnh riêng một dòng, căn đúng phía giáo viên đã chọn. */
    if(g?.place === "top" || g?.place === "left" || g?.place === "right"){
      out += await figPara(x.fig);
    }

    if(x.type === "MC" && x.ch){
      x.ch.forEach(c => countMath(c));
      // Bốn phương án xếp lưới 2×2 — đúng cách đề Việt Nam trình bày.
      const cell = (i) => para(txt(`${LETTER[i]}. `, { bold:true }) +
        wtex(x.ch[i] ?? "", { size:S }) +
        (key && x.ans === i ? txt("   ✔", { bold:true }) : ""), { after:0 });
      out += wTable([[cell(0), cell(1)], [cell(2), cell(3)]], [50, 50]);
    }

    if(x.type === "TF" && x.tf){
      x.tf.forEach(([s]) => countMath(s));
      out += x.tf.map(([s,v],i) =>
        para(txt(`${TFIDX[i]}) `) + wtex(s, { size:S }) +
          (key ? txt(`   ${v ? "Đ" : "S"}`, { bold:true }) : ""),
          { indent:0.6, after:20 })).join("");
    }

    if(x.type === "SHORT"){
      out += key && x.sa
        ? para(txt("Đáp án: ") + txt(`${x.sa.value} ${x.sa.unit ?? ""}`, { bold:true }), { indent:0.6 })
        : para(txt("Đáp án: ......................"), { indent:0.6 });
    }

    if(g?.place === "below") out += await figPara(x.fig);

    if(sol){
      if(x.type === "TF" && x.tf?.some(st => st[2])){
        out += para(txt("Lời giải.", { bold:true, italic:true }), { indent:0.6, after:20 });
        out += x.tf.map(([,v,why],i) => {
          countMath(why ?? "");
          return para(txt(`${TFIDX[i]}) ${v ? "Đúng" : "Sai"}`, { bold:true }) +
            (why ? txt(" — ") + wtex(why, { size:S - 0.5 }) : ""), { indent:1.2, after:20 });
        }).join("");
      }
      if(x.sol){
        countMath(x.sol);
        out += para(txt(x.type === "TF" ? "" : "Lời giải. ", { bold:true, italic:true }) +
                 wtex(x.sol, { size:S - 0.5 }), { indent:0.6, after:140 });
      }
    }
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
      const left = para(txt(h.org)) + para(txt(h.school, { bold:true, caps:true })) +
                   para(txt(`Năm học ${h.year}`, { size:S - 2 }));
      const right = para(txt(h.title.toUpperCase(), { bold:true }), { align:"right" }) +
                    para(txt(h.subject), { align:"right" }) +
                    para(txt(`Thời gian làm bài: ${h.duration} phút`), { align:"right" }) +
                    (h.showCode ? para(txt(`Mã đề ${h.code}`), { align:"right" }) : "");
      body.push(wTable([[left, right]], [50, 50]));
      body.push(wHr());
      if(h.showId){
        body.push(para(txt("Họ và tên: ................................................    " +
                      "Lớp: ................    SBD: ................"), { after:200 }));
      }
      continue;
    }

    if(b.kind === "text"){
      // Khối chữ tự do của giáo viên — xem htmlToParas().
      body.push(...htmlToParas(b.html ?? "", S));
      continue;
    }

    if(b.kind !== "sec") continue;

    body.push(para(txt(secTitle(b).toUpperCase(), { bold:true, size:S + 1 }),
                { before:200, after:100, keepNext:true }));
    if(b.note) body.push(para(txt(b.note, { italic:true, size:S - 1 }), { after:100 }));

    const list = flatten(b);
    let n = 0;
    for(const x of list){
      if(x._pending) continue;
      body.push(await questionParas(x, ++n));
    }
  }

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

  const { bytes, xml } = buildDocx({
    body, images,
    layout: {
      marginTop:layout.marginTop, marginRight:layout.marginRight,
      marginBottom:layout.marginBottom, marginLeft:layout.marginLeft,
      fontSize:layout.fontSize, lineGap:layout.lineGap,
      watermark:layout.watermark.trim() || null,
      watermarkOpacity:layout.watermarkOpacity, watermarkAngle:layout.watermarkAngle
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
  for(const b of DOC){
    if(b.kind !== "sec") continue;
    for(const it of b.items){
      if(it.mode !== "rnd") continue;
      const pool = ofSubject()
        .filter(q => q.type === b.type && q.diff === it.diff && !used.has(q.id))
        .map(q => q.id);
      for(let i = pool.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      it.picked = pool.slice(0, it.n);
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
let rvDoc = "all";        // lọc theo tài liệu
let rvFilter = "all";     // all | flag | clean | dup
const rvDeferred = new Set();   // câu bấm "để sau", dồn xuống cuối
/* Đếm việc đã xử lý trong phiên, để thanh tiến độ có mốc so. */
const rvSession = { done:0 };

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
const dupOf = (p) => BANK.find(x => sameStem(x.stem, p.stem));

function flagsOf(p){
  const f = [];
  if(dupOf(p))                    f.push({ k:"dup",  t:"Trùng câu đã có trong kho" });
  if(p.notes)                     f.push({ k:"note", t:p.notes });
  if(p.answerSource === "solved") f.push({ k:"ans",  t:"Đáp án do AI tự giải, đề gốc không in" });
  if(p.figNote)                   f.push({ k:"fig",  t:"Có hình, chưa gắn ảnh" });
  return f;
}

/* "Tin cậy cao" = không có cờ NẶNG nào. Đáp án AI tự giải và hình chưa gắn thì
   vẫn cho duyệt hàng loạt — hai thứ đó sửa được sau. Còn câu trùng kho hoặc
   chỗ model tự khai đọc không chắc thì phải người quyết ngay. */
const isHeavy = (f) => f.k === "dup" || f.k === "note";
const isConfident = (p) => !flagsOf(p).some(isHeavy);

/** Danh sách đang xét, sau khi lọc theo tài liệu và theo cờ. */
function rvList(){
  let list = PENDING.filter(p => rvDoc === "all" || p.src === rvDoc);
  if(rvFilter === "flag")  list = list.filter(p => flagsOf(p).some(isHeavy));
  if(rvFilter === "clean") list = list.filter(isConfident);
  if(rvFilter === "dup")   list = list.filter(p => dupOf(p));
  // Câu bấm "để sau" dồn xuống cuối chứ không mất đi.
  return [...list.filter(p => !rvDeferred.has(p.id)),
          ...list.filter(p => rvDeferred.has(p.id))];
}

function docsInQueue(){
  const m = new Map();
  for(const p of PENDING) m.set(p.src, (m.get(p.src) ?? 0) + 1);
  return [...m.entries()];
}

function paintPendCount(){
  const el = $("#pendCount");
  el.textContent = PENDING.length;
  el.hidden = !PENDING.length;
}

function paintReview(){
  paintPendCount();

  const list = rvList();
  if(rvIdx >= list.length) rvIdx = Math.max(0, list.length - 1);
  const p = list[rvIdx];

  /* ── thanh trên: chọn tài liệu, lọc, tiến độ ── */
  const docs = docsInQueue();
  $("#rvDocs").innerHTML = docs.length > 1
    ? `<select id="rvDocSel" aria-label="Chọn tài liệu">
        <option value="all">Tất cả tài liệu (${PENDING.length})</option>
        ${docs.map(([name,n]) =>
          `<option value="${esc(name)}" ${rvDoc===name?"selected":""}>${esc(name)} (${n})</option>`).join("")}
      </select>`
    : `<span style="font-size:13px;color:var(--ink-3)">${esc(docs[0]?.[0] ?? "")}</span>`;

  const inScope = (q) => rvDoc === "all" || q.src === rvDoc;
  const nFlag  = PENDING.filter(q => inScope(q) && flagsOf(q).some(isHeavy)).length;
  const nClean = PENDING.filter(q => inScope(q) && isConfident(q)).length;
  const nDup   = PENDING.filter(q => inScope(q) && dupOf(q)).length;

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
  const total = PENDING.length;
  const done = rvSession.done;
  $("#rvBar").style.width = (total + done ? done / (total + done) * 100 : 0) + "%";
  $("#rvProgress").innerHTML = list.length
    ? `Câu <b>${rvIdx+1}</b><span class="muted">/${list.length}${
        rvFilter !== "all" ? " đang lọc" : ""} · còn ${total} câu trong hàng chờ</span>`
    : `<span class="muted">Không còn câu nào khớp bộ lọc</span>`;
  $("#rvDone").textContent = done ? `đã xử lý ${done}` : "";

  $("#btnApproveAll").disabled = !nClean;
  $("#btnApproveAll").textContent = nClean ? `Duyệt ${nClean} câu tin cậy cao` : "Duyệt hàng loạt";
  $("#btnDropDup").hidden = !nDup;
  $("#btnDropDup").textContent = `Bỏ ${nDup} câu trùng`;

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
  $("#rvModel").textContent = p.model ?? "";

  const flags = flagsOf(p);
  $("#rvFlags").innerHTML = flags.map(f =>
    `<span class="chip ${isHeavy(f) ? "warn" : "acc"}">${esc(f.k === "note" ? "Model đọc không chắc" : f.t)}</span>`).join("");

  /* Ảnh gốc chỉ vẽ các câu CÙNG TRANG, không vẽ cả hàng chờ — nạp 40 trang mà
     dựng hết thì trang giấy dài vô tận. */
  const samePage = PENDING.filter(q => q.src === p.src && q.page === p.page);
  const sourceRow = SOURCES.find(s => s.id === p.srcId || s.name === p.src);
  const sourcePreview = sourceRow?.fileUrl
    ? (sourceRow.kind === "Ảnh"
      ? `<a href="${esc(sourceRow.fileUrl)}" target="_blank" title="Mở ảnh gốc ở tab mới">
           <img src="${esc(sourceRow.fileUrl)}" alt="Trang đề gốc" style="display:block;width:100%;max-height:48vh;object-fit:contain;margin-bottom:12px;border-radius:6px"></a>`
      : `<a class="btn btn-sm" href="${esc(sourceRow.fileUrl)}" target="_blank" style="margin-bottom:12px">Mở PDF gốc — trang ${p.page}</a>`)
    : "";
  $("#rvScan").innerHTML = sourcePreview + samePage.map(q => {
    const lines = (q.raw ?? []).map((tx,k) =>
      `<div class="ln${k ? " opt" : ""}"${q === p ? ' style="opacity:1"' : ""}>${esc(tx)}</div>`).join("");
    return q === p
      ? `<div class="here"><span class="tagtop">Câu đang duyệt</span>${lines}</div>`
      : lines;
  }).join("");

  let stemHtml = tex(p.stem);
  if(p.mark){
    const m = tex(`$${p.mark}$`);
    stemHtml = stemHtml.replace(m, `<span class="mark">${m}</span>`);
  }

  let h = `<div style="display:flex;flex-direction:column;gap:6px">
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

  if(p.figNote){
    h += `<div class="conflict" style="background:var(--acc-tint);box-shadow:inset 0 0 0 1px var(--acc)">
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="#5d5294"
           stroke-width="16" aria-hidden="true" style="flex:none">
        <rect x="32" y="48" width="192" height="160" rx="12"></rect>
        <path d="M32 168l52-52 44 44 28-28 40 40"></path></svg>
      <span class="t" style="color:var(--acc-ink)"><b>Câu này có hình</b> —
        “${esc(p.figNote)}”. Duyệt xong vào phần Sửa để gắn ảnh.</span>
    </div>`;
  }

  if(p.type === "MC" && p.ch){
    h += `<div style="display:flex;flex-direction:column;gap:6px">
      <div class="lbl" style="margin:0">Bốn phương án${
        p.answerSource === "solved"
          ? ' <span style="color:var(--warn)">· AI tự giải, đề gốc không in đáp án</span>' : ""
      }</div>
      <div class="choices">${p.ch.map((c,i) =>
        `<button type="button" class="choice pickans${i===p.ans?" ans":""}" data-pickans="${i}">
          <b>${LETTER[i]}.</b> ${tex(c)}
          ${i===p.ans?'<span class="tagright">đáp án</span>':""}</button>`).join("")}</div>
      <p class="hint">Bấm vào phương án khác nếu AI chọn sai.</p>
    </div>`;
  }

  if(p.type === "TF" && p.tf){
    h += `<div style="display:flex;flex-direction:column;gap:6px">
      <div class="lbl" style="margin:0">Bốn ý — bấm để đổi Đúng/Sai</div>
      <div class="choices">${p.tf.map(([txt,v],i) =>
        `<button type="button" class="choice picktf ${v?"isT":"isF"}" data-picktf="${i}">
          <b>${TFIDX[i]})</b> ${tex(txt)}
          <span class="tagright">${v ? "Đúng" : "Sai"}</span></button>`).join("")}</div>
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
    // Người đã tự chọn đáp án thì không còn là "AI tự giải" nữa.
    p.answerSource = "printed";
    paintReview();
  }));
  $$("[data-picktf]", $("#rvBody")).forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.picktf;
    p.tf[i][1] = !p.tf[i][1];
    paintReview();
  }));
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
    type:p.type, diff:p.diff, topic:p.topic, grade:p.grade,
    subject: p.topic.startsWith("m") ? "math" : "physics",
    src: p.srcLabel ?? p.src.replace(/\.[a-z]+$/,""), ai:true,
    stem:p.stem, sol:p.sol || "",
    fig:null, figNote:p.figNote ?? null,
    answerSource:p.answerSource ?? "solved"
  };
  if(p.type === "MC"){ q.ch = p.ch; q.ans = p.ans; }
  if(p.type === "TF") q.tf = p.tf ?? TFIDX.map(()=>["",true]);
  if(p.type === "SHORT") q.sa = p.sa ?? { value:"", unit:"", tol:"0" };
  BANK.push(q);
  rvSession.done++;
  return q;
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
    const left = PENDING.filter(p => p.src === row.name).length;
    if(left) row.label = `Chờ duyệt ${left} câu`;
    else { row.state = "done"; row.label = "Đã vào kho"; }
  }
}

const rvCurrent = () => rvList()[rvIdx];

$("#rvOk").addEventListener("click", () => {
  const p = rvCurrent();
  if(!p) return;
  if(!approve(p)) return;
  removePending(p);
  afterReviewChange();
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
  const q = approve(p);
  if(!q) return;
  removePending(p);
  afterReviewChange();
  openEditor(q.id);
});

$("#btnApproveAll").addEventListener("click", () => {
  const scope = PENDING.filter(p => (rvDoc === "all" || p.src === rvDoc) && isConfident(p));
  if(!scope.length){ toast("Câu nào cũng còn chỗ cần mắt người"); return; }
  if(scope.length > 20 &&
     !confirm(`Duyệt một lượt ${scope.length} câu vào kho?\n\n` +
              `Đây là những câu không trùng kho và model không tự khai chỗ nào đọc không chắc.`)){
    return;
  }
  /* Phải chốt danh sách TRƯỚC rồi mới gỡ theo đúng đối tượng: câu vừa vào kho
     sẽ khiến chính nó thành "câu trùng", lọc lại là không gỡ được gì. */
  const vao = scope.filter(p => approve(p));
  vao.forEach(removePending);
  rvIdx = 0;
  afterReviewChange();
  toast(vao.length === scope.length
    ? `Đã duyệt ${vao.length} câu`
    : `Đã duyệt ${vao.length}/${scope.length} câu — số còn lại vướng trần gói ${plan.name}`);
});

$("#btnDropDup").addEventListener("click", () => {
  const dups = PENDING.filter(p => (rvDoc === "all" || p.src === rvDoc) && dupOf(p));
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
  rvDoc = e.target.value; rvIdx = 0; paintReview();
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
  autoApprove:false, file:null
};

function paintSources(){
  const tb = $("#srcRows");
  tb.innerHTML = "";
  for(const r of SOURCES){
    const tr = document.createElement("tr");
    const cls = { done:"ok", review:"warn", run:"acc", failed:"danger" }[r.state] ?? "";
    const shortError = r.error ? String(r.error).trim().split(/\r?\n/).at(-1) : "";
    tr.innerHTML = `
      <td><b style="font-weight:500">${esc(r.name)}</b>
        <div class="sub">${esc(r.kind)} · mức ${esc(OCR_TIERS[r.tier ?? "nhanh"].name)}${shortError ? ` · ${esc(shortError).slice(0,120)}` : ""}</div>
        ${r.state === "run" ? `<div class="mini"><i style="width:${r.prog}%"></i></div>` : ""}</td>
      <td class="r">${r.pages}</td>
      <td class="r">${r.found ?? "—"}</td>
      <td class="r">${r.scans ?? "—"}</td>
      <td><span class="chip ${cls}">${esc(r.label)}</span></td>
      <td class="r">${
        r.state === "review" ? '<button class="btn btn-sm btn-primary" type="button" data-review>Duyệt</button>' :
        r.state === "done"   ? '<button class="btn btn-sm btn-ghost" type="button" data-see="'+esc(r.name)+'">Xem câu</button>' : ""
      }</td>`;
    tb.appendChild(tr);
  }
  const pages = SOURCES.reduce((a,r)=>a+r.pages,0);
  const used  = SOURCES.reduce((a,r)=>a+(r.scans ?? r.pages),0);
  $("#srcSummary").textContent =
    `${pages} trang trong tháng này · hết ${used} ${UNIT.many}`;
  paintQuota();
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
  if(e.target.closest("[data-review]")) go("duyet");
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
  if(!upload.file){ toast("Chọn một file PDF hoặc ảnh đề trước đã"); return; }
  const { total } = scanCost();
  if(total > scansLeft){
    toast(`Cần ${total} ${UNIT.many} mà chỉ còn ${scansLeft}. Nâng gói hoặc chọn mức đọc nhẹ hơn.`);
    return;
  }

  const name = upload.file.name;
  const row = {
    _temp:true,
    name, kind: upload.tier === "ki" ? "Scan khó" : "PDF số",
    tier: upload.tier,
    pages: upload.pages, found: null, scans: total, state:"run",
    label:"Đang trích xuất", prog: 4
  };
  SOURCES.push(row);
  syncPaused = true;
  paintSources(); estimate();

  const timer = setInterval(() => { row.prog = Math.min(92, row.prog + 3); paintSources(); }, 700);
  try {
    const form = new FormData();
    form.set("file", upload.file);
    form.set("subject", upload.subject === "Toán" ? "math" : "physics");
    form.set("grade", String(upload.grade));
    form.set("tier", upload.tier);
    form.set("srcLabel", upload.srcLabel);
    const response = await fetch("/api/upload", { method:"POST", body:form });
    const result = await response.json();
    if(!response.ok) throw Object.assign(new Error(result.error || "OCR thất bại"), { source:result.source });
    Object.assign(row, result.source, { _temp:false });
    PENDING.push(...result.questions);
    scansLeft -= result.source.scans ?? result.source.pages;
    upload.file = null;
    $("#sourceFile").value = "";
    $("#drop b").textContent = "Kéo file vào đây, hoặc bấm để chọn";
    $("#drop span").textContent = "PDF hoặc ảnh chụp · tối đa 15 MB";
    toast(`Xong ${name} — ${result.questions.length} câu đang chờ duyệt`);
  } catch(err){
    Object.assign(row, err.source ?? {}, { _temp:false, state:"failed", label:"OCR lỗi", error:err.message, prog:0 });
    toast(`OCR lỗi: ${err.message}`);
  } finally {
    clearInterval(timer);
    syncPaused = false;
    paintSources(); paintReview(); paintHome();
    await saveWorkspace(true);
  }
}

function wireUpload(){
  const drop = $("#drop");
  const picker = $("#sourceFile");
  const choose = files => {
    const file = files?.[0];
    if(!file) return;
    upload.file = file;
    drop.querySelector("b").textContent = file.name;
    drop.querySelector("span").textContent = `${(file.size/1024/1024).toFixed(2)} MB · sẵn sàng nạp`;
  };
  drop.addEventListener("click", () => picker.click());
  drop.addEventListener("keydown", e => {
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); picker.click(); }
  });
  picker.addEventListener("change", e => choose(e.target.files));
  ["dragenter","dragover"].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave","drop"].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("hot"); }));
  drop.addEventListener("drop", e => choose(e.dataTransfer.files));
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
  estimate();
}

/* Ước tính bằng LƯỢT QUÉT, không phải tiền. Xem ghi chú UNIT trong data.js.
   Giá vốn thật (USD) vẫn nằm ở phase0 — đó là số của người bán, không phải
   con số nên dí vào mặt giáo viên mỗi lần họ định nạp tài liệu. */
function scanCost(){
  const per = OCR_TIERS[upload.tier].cost;
  return { per, total: per * upload.pages };
}

function estimate(){
  const t = OCR_TIERS[upload.tier];
  const { per, total } = scanCost();
  const du = total <= scansLeft;

  $("#estPer").textContent = `${per} ${UNIT.short}`;
  $("#estRows").innerHTML = `
    <span>Mức đọc ${t.name}</span><b>${t.cost} ${UNIT.short}/trang</b>
    <span>Tài liệu ${upload.pages} trang</span><b>${total} ${UNIT.short}</b>
    <span>Còn lại sau khi nạp</span><b${du ? "" : ' style="color:var(--danger)"'}>${
      du ? scansLeft - total : `thiếu ${total - scansLeft}`} ${UNIT.short}</b>`;

  $("#estNote").innerHTML = du
    ? `<span class="muted">${esc(t.desc)}</span>`
    : `<span style="color:var(--danger)">Không đủ lượt trong tháng này.
       Nâng gói hoặc chọn mức đọc nhẹ hơn.</span>`;
  $("#btnStartUpload").disabled = !du;
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

function setSubject(next){
  if(next === subject) return;
  // Đề đang soạn thuộc môn cũ. Xoá không hỏi là mất công của giáo viên.
  const dangSoan = docTouched && DOC.some(b => b.kind === "sec" && b.items.length);
  if(dangSoan && !confirm(
      `Đề đang soạn là môn ${SUBJECTS[subject]}. Chuyển sang ${SUBJECTS[next]} sẽ bỏ hết câu. Tiếp tục?`)){
    return;
  }
  subject = next;
  filters.topic.clear(); filters.src.clear();
  checked.clear(); selectedId = null; finderFor = null;
  // Đề đang soạn thuộc môn cũ nên phải dọn, nếu không sẽ trộn Toán vào đề Lý.
  DOC = DOC.filter(b => b.kind === "hdr");
  header.subject = subject === "math" ? "Toán 12" : "Vật lí 12";
  header.duration = BLUEPRINTS[subject].duration;
  $$("[data-subj]").forEach(b =>
    b.setAttribute("aria-pressed", b.dataset.subj === subject ? "true" : "false"));
  paintFacets(); paintKho(); paintCanvas(); renderSheet();
  toast(`Đã chuyển sang môn ${SUBJECTS[subject]}`);
}
$$("[data-subj]").forEach(b => b.addEventListener("click", () => setSubject(b.dataset.subj)));

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
  const pend = PENDING.length;
  $("#hiSub").textContent = pend
    ? `Có ${pend} câu vừa đọc xong đang chờ bạn duyệt.`
    : `Kho đang có ${BANK.length} câu. Gói ${plan.name}, còn ${Math.max(0,scansLeft)} ${UNIT.many} tháng này.`;

  const inDoc = DOC.filter(b => b.kind === "sec").reduce((a,b) => a + secCount(b), 0);
  const TILES = [
    ["Câu trong kho", BANK.length, `${ofSubject().length} câu môn ${SUBJECTS[subject]}`, "kho"],
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
  const done = { nap: SOURCES.length > 0, duyet: pend === 0 && BANK.length > 0, rap: inDoc > 0 };
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
    : `<div class="empty" style="padding:20px">Kho môn này chưa có câu nào.</div>`;

  $("#homeDocs").innerHTML = SOURCES.slice(-4).reverse().map(r =>
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

$("#homeTopics").addEventListener("click", e => {
  const b = e.target.closest("[data-topic]");
  if(!b) return;
  filters.topic.clear(); filters.topic.add(b.dataset.topic);
  facetOpen.topic = true;
  go("kho"); paintFacets(); paintKho();
});

function go(name){
  ["home","kho","rap","duyet","nguon"].forEach(k =>
    $("#s-"+k).classList.toggle("on", k === name));
  $$("#tabs button").forEach(b => {
    b.dataset.go === name ? b.setAttribute("aria-current","page") : b.removeAttribute("aria-current");
  });
  if(name === "duyet") paintReview();
  if(name === "home")  paintHome();
  window.scrollTo(0,0);
}
$$("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));

paintFacets(); paintKho(); paintCanvas(); renderSheet();
paintSources(); wireUpload(); paintReview(); paintHome();
setInterval(() => void saveWorkspace(), 1200);
window.addEventListener("pagehide", () => {
  const body = JSON.stringify(workspaceSnapshot());
  if(body !== lastSnapshot){
    navigator.sendBeacon("/api/workspace", new Blob([body], { type:"application/json" }));
  }
});
