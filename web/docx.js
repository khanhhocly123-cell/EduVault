/* Dựng file .docx thẳng trong trình duyệt. Không thư viện ngoài, không build.
 *
 * .docx là một file ZIP chứa mấy file XML. Ở đây ghi ZIP theo phương thức
 * "store" (không nén) — Word đọc bình thường, và đỡ phải nhét cả bộ deflate
 * vào. File to hơn khoảng 3 lần, nhưng một đề 28 câu vẫn chỉ tầm 100KB.
 *
 * Công thức đi qua omml.js thành `<m:oMath>` — equation gốc của Word, mở lên
 * click vào sửa được. Đó là điểm bán hàng của cả sản phẩm, nên có hàm
 * `killTest()` ở cuối đếm lại số thẻ trước khi cho tải về.
 */

import { texToRuns, takeUnknownCommands } from "./omml.js";

/* ══════════════════════════════════════════════════════════════ ZIP ══ */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

/** Ghi ZIP không nén. entries: [{name, data:Uint8Array}] */
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const en of entries) {
    const name = enc.encode(en.name);
    const crc = crc32(en.data);
    const size = en.data.length;

    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),                    // giờ/ngày — để 0, Word không quan tâm
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(name.length), ...u16(0),
    ]);
    chunks.push(local, name, en.data);

    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]), name);

    offset += local.length + name.length + size;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;

  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(cdStart), ...u16(0),
  ]);

  const total = offset + cdSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...chunks, ...central, end]) { out.set(c, p); p += c.length; }
  return out;
}

/* ═══════════════════════════════════════════════════════════ XML ══ */

const X = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word"';

/** cm → twip (1/20 pt). Word đo lề bằng twip. */
const cm = (v) => Math.round(v * 567);
/** pt → half-point, đơn vị của <w:sz>. */
const half = (pt) => Math.round(pt * 2);
/** px → EMU, đơn vị đo ảnh trong DrawingML. */
const emu = (px) => Math.round(px * 9525);

/**
 * Một đoạn văn.
 * opt: {align, bold, italic, size, before, after, indent, keepNext, pageBreak, spacing}
 */
export function p(content, opt = {}) {
  const jc = opt.align ? `<w:jc w:val="${opt.align}"/>` : "";
  const ind = opt.indent ? `<w:ind w:left="${cm(opt.indent)}"/>` : "";
  const spacing =
    `<w:spacing w:before="${opt.before ?? 0}" w:after="${opt.after ?? 60}"` +
    (opt.lineGap ? ` w:line="${Math.round(opt.lineGap * 240)}" w:lineRule="auto"` : "") + `/>`;
  const keep = opt.keepNext ? "<w:keepNext/>" : "";
  const brk = opt.pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : "";
  return `${brk ? `<w:p>${brk}</w:p>` : ""}<w:p><w:pPr>${keep}${spacing}${jc}${ind}</w:pPr>${content}</w:p>`;
}

/** Định dạng chữ cho một run. */
export function rPr({ bold, italic, size, color, caps } = {}) {
  if (!bold && !italic && !size && !color && !caps) return "";
  return `<w:rPr>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}` +
    `${caps ? "<w:caps/>" : ""}` +
    `${size ? `<w:sz w:val="${half(size)}"/><w:szCs w:val="${half(size)}"/>` : ""}` +
    `${color ? `<w:color w:val="${color}"/>` : ""}</w:rPr>`;
}

/** Chữ thuần, không qua bộ đọc LaTeX. */
export function t(text, fmt) {
  return `<w:r>${rPr(fmt)}<w:t xml:space="preserve">${X(text)}</w:t></w:r>`;
}

/** Chữ có `$...$` — phần công thức thành OMML. */
export const tex = (src, fmt) => texToRuns(src, rPr(fmt));

/**
 * Bảng không viền — dùng cho đầu đề hai cột và cho lưới 4 phương án.
 * `widths` tính theo phần trăm, `rows` là mảng các mảng chuỗi XML đoạn văn.
 *
 * Không viền là CỐ Ý: đề thi Việt Nam xếp đầu đề hai cột và xếp phương án
 * thành lưới, nhưng không ai kẻ khung. Bảng ở đây chỉ để canh cột.
 */
export function table(rows, widths) {
  const grid = widths.map((w) => `<w:gridCol w:w="${Math.round(w * 94)}"/>`).join("");
  const body = rows.map((cells) =>
    `<w:tr>${cells.map((c, i) =>
      `<w:tc><w:tcPr><w:tcW w:w="${Math.round(widths[i] * 94)}" w:type="dxa"/>` +
      `<w:tcMar><w:left w:w="0" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tcMar>` +
      `</w:tcPr>${c || p("")}</w:tc>`).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((s) => `<w:${s} w:val="none" w:sz="0" w:space="0"/>`).join("")}</w:tblBorders>` +
    `<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0"/>` +
    `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

/** Đường kẻ ngang hết chiều rộng — dùng dưới đầu đề. */
export function hr() {
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="000000"/></w:pBdr>` +
    `<w:spacing w:after="120"/></w:pPr></w:p>`;
}

/* ═══════════════════════════════════════════════════════════ ảnh ══ */

/** data URL → bytes. Trả null nếu không phải ảnh nhúng. */
function dataUrlToBytes(src) {
  const m = /^data:image\/([a-z+]+);base64,(.+)$/i.exec(String(src ?? ""));
  if (!m) return null;
  const bin = atob(m[2]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return { ext: m[1] === "jpeg" ? "jpg" : m[1], data: buf };
}

/** Khối ảnh inline. widthPx/heightPx tính sẵn ở phía gọi. */
function imageRun(rid, widthPx, heightPx, name) {
  const cx = emu(widthPx), cy = emu(heightPx);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${rid}" name="${X(name)}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${rid}" name="${X(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rId${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/* ═════════════════════════════════════════════════════ tài liệu ══ */

/**
 * Dựng .docx.
 *
 *   body    — mảng chuỗi XML đoạn văn (dùng p(), t(), tex() ở trên)
 *   layout  — lề cm, cỡ chữ pt, giãn dòng, watermark
 *   images  — [{src (data URL), widthPx, heightPx}] theo đúng thứ tự imageRun đã gọi
 */
export function buildDocx({ body, layout = {}, images = [], title = "Đề" }) {
  const L = {
    marginTop: 2, marginRight: 2, marginBottom: 2, marginLeft: 3,
    fontSize: 12, lineGap: 1.15, watermark: null, watermarkAngle: -30,
    ...layout,
  };

  /* ── phần ảnh: mỗi ảnh một file trong word/media + một quan hệ ── */
  const media = [];
  const rels = [
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ];
  images.forEach((im, k) => {
    const b = dataUrlToBytes(im.src);
    if (!b) return;
    const name = `image${k + 1}.${b.ext}`;
    media.push({ name: `word/media/${name}`, data: b.data });
    rels.push(`<Relationship Id="rId${im.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
  });

  let headerPart = "";
  if (L.watermark) {
    rels.push(`<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`);
    // Watermark là chữ nghệ thuật VML nằm trong header — đúng cách Word tự làm
    // khi bấm Design > Watermark, nên mở ra sửa/xoá được như watermark thật.
    headerPart = `${HEAD}<w:hdr ${NS}><w:p><w:r><w:pict>` +
      `<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@11,21600e" ` +
      `xmlns:o="urn:schemas-microsoft-com:office:office"/>` +
      `<v:shape id="wm" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;` +
      `width:420pt;height:110pt;rotation:${L.watermarkAngle};z-index:-251654144;` +
      `mso-position-horizontal:center;mso-position-horizontal-relative:margin;` +
      `mso-position-vertical:center;mso-position-vertical-relative:margin" ` +
      `fillcolor="#c0c0c0" stroked="f">` +
      `<v:fill opacity="${Math.round((L.watermarkOpacity ?? 8) * 655)}f"/>` +
      `<v:textpath style="font-family:&quot;Times New Roman&quot;;font-size:1pt" string="${X(L.watermark)}"/>` +
      `</v:shape></w:pict></w:r></w:p></w:hdr>`;
  }

  const sect =
    `<w:sectPr>` +
    (L.watermark ? `<w:headerReference w:type="default" r:id="rIdHdr"/>` : "") +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="${cm(L.marginTop)}" w:right="${cm(L.marginRight)}" ` +
    `w:bottom="${cm(L.marginBottom)}" w:left="${cm(L.marginLeft)}" ` +
    `w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr>`;

  const document = `${HEAD}<w:document ${NS}><w:body>${body.join("")}${sect}</w:body></w:document>`;

  /* Times New Roman 12pt, khổ A4 — đúng bộ style của `phase0/src/reference.ts`,
     vì file xuất từ app và file xuất từ CLI phải giống hệt nhau. */
  const styles = `${HEAD}<w:styles ${NS}>` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>` +
    `<w:sz w:val="${half(L.fontSize)}"/><w:szCs w:val="${half(L.fontSize)}"/>` +
    `<w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="${Math.round(L.lineGap * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
    `</w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    `</w:styles>`;

  const contentTypes = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Default Extension="jpg" ContentType="image/jpeg"/>` +
    `<Default Extension="svg" ContentType="image/svg+xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    (L.watermark ? `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>` : "") +
    `</Types>`;

  const rootRels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;

  const files = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "word/document.xml", data: enc.encode(document) },
    { name: "word/styles.xml", data: enc.encode(styles) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(docRels) },
    ...media,
  ];
  if (headerPart) files.push({ name: "word/header1.xml", data: enc.encode(headerPart) });

  return { bytes: zip(files), xml: document, title };
}

export { imageRun, dataUrlToBytes };

/**
 * KILL TEST — đếm lại trước khi cho tải về.
 *
 * Câu hỏi sinh tử của dự án là "công thức có sửa được trong Word không". Cách
 * kiểm duy nhất đáng tin là đếm thẻ `<m:oMath>` trong document.xml. Bên
 * `phase0` cũng kiểm y hệt bằng cách giải nén file rồi đếm.
 */
export function killTest(xml, expectMath) {
  const math = (xml.match(/<m:oMath>/g) ?? []).length;
  const imgs = (xml.match(/<w:drawing>/g) ?? []).length;
  const unknown = takeUnknownCommands();
  return {
    math, imgs, unknown,
    pass: math >= expectMath,
    note: math >= expectMath
      ? `${math} công thức là equation sửa được`
      : `chỉ có ${math}/${expectMath} công thức — có chỗ rơi mất`,
  };
}
