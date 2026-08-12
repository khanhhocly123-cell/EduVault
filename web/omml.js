/* LaTeX-subset → OMML (Office Math Markup Language).
 *
 * ĐÂY LÀ THỨ CẢ DỰ ÁN TREO VÀO. `<m:oMath>` là equation gốc của Word: mở file
 * lên click vào công thức là sửa được, không phải ảnh. Trước đây muốn có nó
 * phải chạy pandoc ở `phase0`, tức là giáo viên phải cài pandoc — không đời nào.
 * File này dựng OMML thẳng trong trình duyệt.
 *
 * Bộ tách token dùng chung với bộ hiển thị trên màn hình (`latex-core.js`), nên
 * công thức hiện đúng trên web thì cũng ra đúng trong Word. Trước đây hai bên
 * có hai bảng ký hiệu riêng thì kiểu gì cũng lệch.
 *
 * Không hỗ trợ hết LaTeX — chỉ đúng phần `docs/ai-pipeline.md` cho phép model
 * sinh ra. Gặp lệnh lạ thì in chữ đứng và cảnh báo, TUYỆT ĐỐI không nhả dấu
 * gạch chéo vào file Word cho giáo viên đọc.
 */

import { tokenize, SYM, SPACE, FUNC, UPRIGHT, ACCENT, BIGOP } from "./latex-core.js";

const X = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** Một run chữ. `roman` = chữ đứng (số, đơn vị, tên hàm); mặc định nghiêng. */
function run(text, roman) {
  if (text === "") return "";
  const pr = roman ? `<m:rPr><m:sty m:val="p"/></m:rPr>` : "";
  return `<m:r>${pr}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>` +
    `<m:t xml:space="preserve">${X(text)}</m:t></m:r>`;
}

/** Bọc một cụm làm "phần tử" của cấu trúc — OMML dùng <m:e> cho mọi ô con. */
const e = (inner) => `<m:e>${inner}</m:e>`;

const unknown = new Set();

/* Ký tự chỉ là chữ cái mới nghiêng. Chữ số, dấu phép tính, dấu ngoặc đứng thẳng
   — đúng lối sách giáo khoa, và cũng là cách Word tự làm. */
const isLetter = (ch) => /[a-zA-ZÀ-ỹα-ωΑ-Ω]/.test(ch);

function emitChar(ch, st) {
  if (ch === "-") ch = "−"; // dấu trừ thật, không phải gạch nối
  return run(ch, st.roman || !isLetter(ch));
}

function readArg(toks, st) {
  const t = toks[st.i];
  if (!t) return "";
  if (t.k === "{") {
    st.i++;
    const h = buildList(toks, st);
    if (toks[st.i]?.k === "}") st.i++;
    return h;
  }
  return step(toks, st);
}

function cmd(name, toks, st) {
  if (name in SPACE) {
    const s = SPACE[name];
    return s ? run(s, true) : "";
  }
  if (name === "\\") return `<m:r><m:t xml:space="preserve"> </m:t></m:r>`;

  if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
    const a = readArg(toks, st), b = readArg(toks, st);
    return `<m:f><m:fPr><m:ctrlPr/></m:fPr><m:num>${a}</m:num><m:den>${b}</m:den></m:f>`;
  }

  if (name === "sqrt") {
    let deg = "";
    if (toks[st.i]?.k === "ch" && toks[st.i].v === "[") {
      st.i++;
      let d = "";
      while (toks[st.i] && !(toks[st.i].k === "ch" && toks[st.i].v === "]")) d += toks[st.i++].v ?? "";
      if (toks[st.i]) st.i++;
      deg = run(d, true);
    }
    // degHide phải là 1 khi căn bậc hai, không thì Word chừa một ô trống bên trái.
    const hide = deg ? "0" : "1";
    return `<m:rad><m:radPr><m:degHide m:val="${hide}"/><m:ctrlPr/></m:radPr>` +
      `<m:deg>${deg}</m:deg>${e(readArg(toks, st))}</m:rad>`;
  }

  if (UPRIGHT.has(name)) {
    const was = st.roman;
    st.roman = true;
    const inner = readArg(toks, st);
    st.roman = was;
    return inner;
  }

  if (name in ACCENT) {
    const chr = { vec: "⃗", ovl: "¯", hat: "̂", tld: "̃" }[ACCENT[name]];
    const inner = readArg(toks, st);
    // Gạch ngang trên đầu là cấu trúc riêng của OMML, không phải dấu phụ.
    if (ACCENT[name] === "ovl") return `<m:bar><m:barPr><m:pos m:val="top"/><m:ctrlPr/></m:barPr>${e(inner)}</m:bar>`;
    return `<m:acc><m:accPr><m:chr m:val="${chr}"/><m:ctrlPr/></m:accPr>${e(inner)}</m:acc>`;
  }

  /* Toán tử lớn (∫ ∑ ∏). Cận trên/cận dưới phải nằm TRONG <m:nary>, nên phải
     ngó trước xem có ^ hoặc _ đi ngay sau không rồi mới dựng. */
  if (name in BIGOP) {
    let sub = "", sup = "";
    for (let k = 0; k < 2; k++) {
      const t = toks[st.i];
      if (!t || (t.k !== "^" && t.k !== "_")) break;
      st.i++;
      if (t.k === "^") sup = readArg(toks, st); else sub = readArg(toks, st);
    }
    const body = buildList(toks, st, true);
    return `<m:nary><m:naryPr><m:chr m:val="${BIGOP[name]}"/>` +
      `<m:limLoc m:val="undOvr"/><m:subHide m:val="${sub ? 0 : 1}"/>` +
      `<m:supHide m:val="${sup ? 0 : 1}"/><m:ctrlPr/></m:naryPr>` +
      `<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup>${e(body)}</m:nary>`;
  }

  if (FUNC.has(name)) return run(name, true);

  if (name === "left" || name === "right") {
    const t = toks[st.i];
    if (!t) return "";
    st.i++;
    let ch = t.k === "cmd" ? (SYM[t.v] ?? "") : (t.v ?? "");
    if (ch === ".") ch = "";
    return ch ? run(ch, true) : "";
  }

  if (name in SYM) return emitChar(SYM[name], st);

  unknown.add(name);
  return run(name, true);
}

function step(toks, st) {
  const t = toks[st.i++];
  if (!t) return "";
  if (t.k === "{") {
    const h = buildList(toks, st);
    if (toks[st.i]?.k === "}") st.i++;
    return h;
  }
  if (t.k === "ch") return emitChar(t.v, st);
  if (t.k === "cmd") return cmd(t.v, toks, st);
  return "";
}

/** Chỉ số trên/dưới. Có cả hai thì OMML có cấu trúc riêng `sSubSup`. */
function script(base, sup, sub) {
  if (sup && sub)
    return `<m:sSubSup><m:sSubSupPr><m:ctrlPr/></m:sSubSupPr>${e(base)}<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`;
  if (sup) return `<m:sSup><m:sSupPr><m:ctrlPr/></m:sSupPr>${e(base)}<m:sup>${sup}</m:sup></m:sSup>`;
  if (sub) return `<m:sSub><m:sSubPr><m:ctrlPr/></m:sSubPr>${e(base)}<m:sub>${sub}</m:sub></m:sSub>`;
  return base;
}

/**
 * `stopAtRel` dùng cho toán tử lớn: thân của ∫ dừng lại trước dấu "=" đầu tiên,
 * nếu không thì cả vế phải chui vào trong dấu tích phân.
 */
function buildList(toks, st, stopAtRel = false) {
  let out = "";
  let last = "";           // run cuối cùng, để gắn chỉ số trên/dưới vào
  while (st.i < toks.length) {
    const t = toks[st.i];
    if (t.k === "}") break;
    if (stopAtRel && t.k === "ch" && "=<>".includes(t.v)) break;

    if (t.k === "^" || t.k === "_") {
      st.i++;
      let sup = "", sub = "";
      if (t.k === "^") sup = readArg(toks, st); else sub = readArg(toks, st);
      const n = toks[st.i];
      if (n && (n.k === "^" || n.k === "_") && n.k !== t.k) {
        st.i++;
        if (n.k === "^") sup = readArg(toks, st); else sub = readArg(toks, st);
      }

      /* Không có gì đứng trước dấu ^ hoặc _ thì đây là chỉ số ĐỨNG TRƯỚC, kiểu
         hạt nhân $^{235}_{92}U$. Word có cấu trúc riêng cho nó là <m:sPre>;
         nếu dựng sSubSup với base rỗng thì Word vẽ một ô vuông trống bên cạnh
         chữ U — nhìn như lỗi font. */
      if (!last) {
        const base = st.i < toks.length && toks[st.i].k !== "}" ? step(toks, st) : "";
        out += `<m:sPre><m:sPrePr><m:ctrlPr/></m:sPrePr>` +
          `<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup>${e(base)}</m:sPre>`;
        last = "";
        continue;
      }

      out = out.slice(0, out.length - last.length) + script(last, sup, sub);
      last = "";
      continue;
    }

    const piece = step(toks, st);
    out += piece;
    last = piece;
  }
  return out;
}

/**
 * Gộp các run liền nhau cùng định dạng.
 *
 * Bộ dựng phát mỗi KÝ TỰ thành một `<m:r>` riêng — đúng nhưng phí kinh khủng:
 * một run rỗng đã ~200 byte, nên đề 28 câu phình lên 150KB toàn thẻ lặp.
 * Quét một lượt gộp lại: chỉ nối hai run khi phần đầu (định dạng) GIỐNG HỆT
 * nhau, nên chữ nghiêng không bị dính vào chữ đứng.
 */
function compactRuns(xml) {
  const RUN = /<m:r>(.*?)<m:t xml:space="preserve">(.*?)<\/m:t><\/m:r>/g;
  const parts = [];
  let last = 0, m;
  while ((m = RUN.exec(xml)) !== null) {
    parts.push({ raw: xml.slice(last, m.index), pr: m[1], text: m[2] });
    last = m.index + m[0].length;
  }
  if (!parts.length) return xml;
  const tail = xml.slice(last);

  let out = "";
  let curPr = null, curText = "";
  const flush = () => {
    if (curPr !== null) out += `<m:r>${curPr}<m:t xml:space="preserve">${curText}</m:t></m:r>`;
    curPr = null; curText = "";
  };
  for (const pt of parts) {
    // Có XML xen giữa (phân số, căn…) thì mạch run đứt, phải xả ra trước.
    if (pt.raw) { flush(); out += pt.raw; }
    if (curPr === pt.pr) curText += pt.text;
    else { flush(); curPr = pt.pr; curText = pt.text; }
  }
  flush();
  return out + tail;
}

/** Một cụm `$...$` → một `<m:oMath>`. */
export function mathToOmml(src) {
  const st = { i: 0, roman: false };
  const body = buildList(tokenize(String(src)), st);
  return `<m:oMath>${compactRuns(body)}</m:oMath>`;
}

/**
 * Cả đoạn chữ lẫn công thức → chuỗi run/oMath xen kẽ, nhét thẳng vào <w:p>.
 * `rPr` là định dạng chữ thường (đậm, nghiêng, cỡ) áp cho phần chữ.
 */
export function texToRuns(src, rPr = "") {
  const parts = String(src ?? "").split("$");
  let out = "";
  parts.forEach((p, i) => {
    if (i % 2) {
      out += mathToOmml(p);
    } else if (p !== "") {
      out += `<w:r>${rPr}<w:t xml:space="preserve">${X(p)}</w:t></w:r>`;
    }
  });
  return out;
}

/** Lệnh chưa hỗ trợ — gọi sau khi dựng xong file để báo một lần. */
export function takeUnknownCommands() {
  const list = [...unknown];
  unknown.clear();
  return list;
}
