/* Dựng nguồn LaTeX độc lập với Word. Mọi nội dung người dùng đều đi qua
   allowlist lệnh toán trước khi đưa cho pdfLaTeX.
 *
 * Trình bày thì KHÔNG độc lập: bộ này đọc chung `resolveFormat()` với bản xem
 * trước và với bộ xuất Word. Bản trước chỉ đọc 4 trong 35 trường (lề, watermark,
 * số cột, kiểu phương án) nên tải PDF về là ra một tờ đề không phải của người
 * dùng — mất tiêu đề phần, mất cỡ chữ, mất kiểu Đúng–Sai, mất dòng làm bài.
 */
import { SYM, FUNC, UPRIGHT, ACCENT, BIGOP } from "./latex-core.js";
import { resolveFormat, mcColumnsFor, TYPE_NAME } from "./format.js";

/**
 * Allowlist lấy THẲNG từ bảng ký hiệu của bộ render màn hình.
 *
 * Trước đây đây là một danh sách chép tay và nó đã lệch: `\setminus` hiện đẹp
 * trên màn hình nhưng ra file PDF thì thành chữ "setminus" nằm giữa phương án —
 * thấy trong đúng một đề Giải tích của người dùng. Bất cứ lệnh nào màn hình vẽ
 * được thì PDF cũng phải nhận, nên hai bên phải ăn chung một nguồn.
 */
const STRUCTURAL = [
  "frac","dfrac","tfrac","cfrac","sqrt","underline","dot","ddot",
  "iiint","left","right","big","Big","bigg","Bigg","begin","end",
  "displaystyle","limits","nolimits","binom","dbinom","tbinom",
  "lfloor","rfloor","lceil","rceil","overbrace","underbrace","substack",
  "mathop","boxed","phantom","hspace","vspace","textstyle",
];
const ALLOWED_MATH = new Set([
  ...Object.keys(SYM).filter(name => /^[A-Za-z]+$/.test(name)),
  ...FUNC, ...UPRIGHT, ...Object.keys(ACCENT), ...Object.keys(BIGOP),
  ...STRUCTURAL,
]);
const ALLOWED_ENVS = new Set(["array","aligned","matrix","pmatrix","bmatrix","cases"]);

export function safeMath(source){
  let value = String(source ?? "").replace(/\r/g, "")
    .replace(/−/g,"-").replace(/≤/g,"\\le ").replace(/≥/g,"\\ge ")
    .replace(/≠/g,"\\ne ").replace(/×/g,"\\times ").replace(/∞/g,"\\infty ")
    .replace(/→/g,"\\to ").replace(/∈/g,"\\in ").replace(/∉/g,"\\notin ")
    .replace(/∅/g,"\\varnothing ");
  const lineBreak="@@EDUVAULT_LINEBREAK@@";
  value=value.replace(/\\\\/g,lineBreak);
  value = value.replace(/\\(begin|end)\s*\{([^}]+)\}/g, (_m, command, env) =>
    ALLOWED_ENVS.has(env) ? `\\${command}{${env}}` : "");
  value = value.replace(/\\([A-Za-z]+)\b/g, (_m, command) =>
    ALLOWED_MATH.has(command) ? `\\${command}` : `\\operatorname{${command}}`);
  return value.replaceAll(lineBreak,"\\\\").replace(/%/g,"\\%").replace(/#/g,"\\#");
}

export function latexText(source){
  const parts = String(source ?? "").split(/(\$[^$]*\$)/g);
  return parts.map(part => {
    if(part.startsWith("$") && part.endsWith("$")) return `$${safeMath(part.slice(1,-1))}$`;
    return part.replace(/−/g,"-").replace(/≤/g," <= ").replace(/≥/g," >= ")
      .replace(/≠/g," != ").replace(/×/g," x ")
      .replace(/\\/g,"\\textbackslash{}")
      .replace(/([#$%&_{}])/g,"\\$1").replace(/\^/g,"\\textasciicircum{}")
      .replace(/~/g,"\\textasciitilde{}").replace(/–|—/g,"--")
      .replace(/…/g,"\\ldots{}").replace(/\n/g,"\\par ");
  }).join("");
}

const answerOf = (q) => q.type === "MC" ? (q.mc_correct || "--")
  : q.type === "TF" ? (q.tf_statements || []).map(s=>`${s.idx}) ${s.is_true === true ? "Đ" : s.is_true === false ? "S" : "--"}`).join("; ")
  : q.type === "SHORT" ? `${q.short_answer?.value ?? "--"}${q.short_answer?.unit ? ` ${q.short_answer.unit}` : ""}` : "Tự luận";

function includeAsset(path){
  return path ? `\\begin{center}\\includegraphics[width=.58\\linewidth]{${String(path).replace(/\\/g,"/")}}\\end{center}\n` : "";
}

/**
 * Nhãn phương án — phải khớp ĐÚNG kiểu đang hiện trên màn xem trước.
 *
 * `circle` và `cards` đều vẽ chữ cái trong vòng tròn (mẫu BK/HCMUT để sinh viên
 * khoanh thẳng lên đề). Dùng TikZ vẽ vòng tròn tô nền — khớp đúng badge tròn
 * của bản DOCX. Fallback `\textcircled` nếu thiếu TikZ.
 */
const circled = (style) => style === "circle" || style === "cards";
const mcLabel = (label, style) => circled(style)
  ? `\\eduBadge{${latexText(label)}}`
  : `\\textbf{${latexText(label)}.}`;

function mcTable(q, columns, style){
  const choices = q.mc_choices || [];
  if(!choices.length) return "";
  const cols = mcColumnsFor(choices.map(choice => choice?.text_latex), columns);

  /* Kiểu "cards": mỗi phương án nằm trong một khung bo tròn riêng, khớp với
     bản DOCX. Dùng `\eduCardBox` (tcolorbox) nếu có, fallback sang \fbox. */
  if(style === "cards"){
    const cell = (choice) => choice
      ? `\\eduCardBox{${mcLabel(choice.label, style)} ${latexText(choice.text_latex)}}`
      : "";
    const rows=[];
    for(let i=0;i<choices.length;i+=cols){
      rows.push(Array.from({length:cols},(_,j)=>cell(choices[i+j])).join(" & ")+" \\\\[3pt]");
    }
    return `\\begin{tabular}{@{}${"l".repeat(cols)}@{}}\n${rows.join("\n")}\n\\end{tabular}\n`;
  }

  // Kiểu "tabular" của mẫu BK có kẻ khung; plain và circle thì không.
  const ruled = style === "tabular";
  const spec = ruled
    ? `@{}|${Array.from({length:cols},()=>"X|").join("")}@{}`
    : `@{}${"X".repeat(cols).split("").join(" ")}@{}`;
  const rows=[];
  for(let i=0;i<choices.length;i+=cols){
    rows.push(Array.from({length:cols},(_,j)=>{
      const choice=choices[i+j];
      return choice ? `${mcLabel(choice.label, style)} ${latexText(choice.text_latex)}` : "";
    }).join(" & ")+` \\\\${ruled ? " \\hline" : ""}`);
  }
  return `${ruled ? "\\renewcommand{\\arraystretch}{1.25}\n" : ""}\\begin{tabularx}{\\linewidth}{${spec}}\n${ruled ? "\\hline\n" : ""}${rows.join("\n")}\n\\end{tabularx}\n`;
}

/** Bảng Đúng–Sai. `tabular` kẻ khung đen, `table` có thanh tiêu đề màu. */
function tfTable(q, F){
  const rows=(q.tf_statements||[]).map(s=>
    `${latexText(`${s.idx}) ${s.text_latex}`)} & $\\square$ & $\\square$ \\\\ \\hline`).join("\n");
  /* Ô tiêu đề tô nền bằng `\colorbox` chứ KHÔNG dùng `\cellcolor` của colortbl:
     bản MiKTeX đang chạy có tabularx 2020 và nạp colortbl vào là mọi bảng X đều
     chết ngay ở `\end{tabularx}` ("Undefined control sequence … \insert@pcolumn").
     Một tính năng tô màu không đáng đổi lấy việc cả bộ xuất PDF ngừng chạy. */
  const bar = (label) => `\\colorbox{formink}{\\makebox[\\dimexpr\\linewidth-2\\fboxsep\\relax][c]{\\color{white}\\bfseries ${label}}}`;
  const head = F.tfStyle === "tabular"
    ? `\\textbf{Phát biểu} & \\textbf{Đúng} & \\textbf{Sai} \\\\ \\hline`
    : `${bar("Phát biểu")} & ${bar("Đúng")} & ${bar("Sai")} \\\\ \\hline`;
  return `\\renewcommand{\\arraystretch}{1.3}\n\\begin{tabularx}{\\linewidth}{|X|>{\\centering\\arraybackslash}p{1.6cm}|>{\\centering\\arraybackslash}p{1.6cm}|}\n\\hline\n${head}\n${rows}\n\\end{tabularx}\n`;
}

/** Danh sách a) b) c) — kiểu Đúng–Sai gọn, không kẻ bảng. */
function tfList(q){
  return (q.tf_statements||[]).map(s =>
    `\\noindent\\hspace*{.6cm}${latexText(`${s.idx}) ${s.text_latex}`)}\\par\n`).join("");
}

/** Ô trả lời ngắn: ô vuông để điền từng chữ số, hoặc một dòng kẻ. */
function shortBody(F){
  if(F.shortStyle === "line") return `\\noindent\\textbf{Trả lời:} \\rule{4.5cm}{.4pt}\\par\n`;
  const cell = `\\framebox[1.05cm]{\\rule{0pt}{.85cm}}`;
  return `\\noindent\\textbf{Trả lời ngắn}\\hspace{.4em}${Array.from({ length:F.shortBoxCount }, () => cell).join("\\hspace{-.4pt}")}\\par\n`;
}

/** Vùng làm bài: dòng chấm hoặc khoảng trắng, đúng số dòng đã chọn. */
function workLines(count, label, blank){
  if(!count) return "";
  const head = `\\noindent\\textbf{\\color{formink}${latexText(label)}}\\par\n`;
  if(blank) return `${head}\\vspace{${(count * 0.72).toFixed(2)}cm}\\par\n`;
  return head + Array.from({ length:count }, () => `\\noindent\\dotfill\\par\n`).join("");
}

function sectionTex(title, F){
  const text = latexText(String(title).toUpperCase());
  if(F.sectionHeading === "bar")
    return `\\medskip\\noindent\\eduSectionBar{${text}}\\par\\smallskip\n`;
  if(F.sectionHeading === "outline")
    return `\\medskip\\noindent\\eduSectionOutline{${text}}\\par\\smallskip\n`;
  return `\\medskip\\noindent{\\bfseries\\large ${text}}\\par\\smallskip\n`;
}

function questionTex(q,index,mode,F,asset){
  const typeLabel = F.card && F.showTypeLabel && TYPE_NAME[q.type]
    ? ` {\\small\\itshape\\color{formink}${latexText(TYPE_NAME[q.type])}}` : "";
  let out=`\\noindent\\textbf{\\color{formink}Câu ${index}.}${typeLabel} ${latexText(q.stem_latex)}\\par\n${includeAsset(asset)} `;
  if(mode === "de"){
    if(q.type === "MC") out += mcTable(q,F.mcColumns,F.mcStyle);
    if(q.type === "TF") out += F.tfStyle === "list" ? tfList(q) : tfTable(q, F);
    if(q.type === "SHORT") out += shortBody(F) + workLines(F.shortWorkLines, F.shortWorkLabel, F.shortStyle === "line");
    if(q.type === "ESSAY") out += workLines(F.essayWorkLines, F.essayWorkLabel, F.essayStyle === "blank") ||
      `\\vspace{4cm}\n`;
  } else if(mode === "dapan") out += `\\noindent\\textbf{Đáp án:} ${latexText(answerOf(q))}\\par\n`;
  else out += `\\par\\smallskip\\noindent\\textbf{Lời giải.} ${q.solution_latex ? latexText(q.solution_latex) : "Chưa có lời giải."}\\par\n`;
  // Ba form có màu đóng khung từng câu. Dùng `framed` chứ không `\fbox{\parbox}`
  // vì khung phải NGẮT ĐƯỢC qua trang — câu tự luận dài hơn một trang là bình thường.
  return (F.card ? `\\begin{educard}\n${out}\\end{educard}\n` : out) + "\\medskip\n";
}

function groupTex(group,asset){
  if(!group)return "";
  const title=group.label || "Dữ liệu dùng chung cho các câu sau";
  return `\\noindent\\fcolorbox{formborder}{formsoft}{\\begin{minipage}{.955\\linewidth}
\\textbf{\\color{formink}${latexText(title)}}${group.stem_latex ? `\\par ${latexText(group.stem_latex)}` : ""}
${includeAsset(asset)}\\end{minipage}}\\par\\medskip
`;
}

/** `#rrggbb` → `RRGGBB` cho `\definecolor{...}{HTML}{...}`. */
const texColor = (value, fallback) => {
  const hex = String(value ?? "").replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : fallback;
};

/** Đầu đề: bốn mẫu, khớp `headerHtml()` của bản xem trước. */
function headerTex(h, F, mode){
  const idline = h.showId && mode === "de"
    ? `\\noindent Họ và tên: \\rule{5.2cm}{.4pt}\\hfill Lớp: \\rule{2cm}{.4pt}\\hfill SBD: \\rule{2.4cm}{.4pt}\\par\\medskip\n` : "";
  const title = mode === "dapan" ? `ĐÁP ÁN - ${h.title||""}`
    : mode === "loigiai" ? `LỜI GIẢI - ${h.title||""}` : h.title||"ĐỀ KIỂM TRA";

  if(h.tmpl === "gon"){
    return `\\noindent\\textbf{${latexText(h.school||"")}} --- ${latexText(title)}${
      h.subject ? ` $\\cdot$ ${latexText(h.subject)}` : ""}${
      mode === "de" && h.durationMin ? ` $\\cdot$ ${Number(h.durationMin)} phút` : ""}${
      mode === "de" && h.code ? ` $\\cdot$ mã ${latexText(h.code)}` : ""}\\par\\hrule\\medskip\n${idline}`;
  }

  const top = `\\noindent\\begin{tabularx}{\\linewidth}{@{}Xr@{}}
${latexText(h.org||"")} & ${latexText(h.school||"")} \\\\
\\hline
\\end{tabularx}
`;
  const center = `\\begin{center}
{\\Large\\bfseries ${latexText(title)}}\\par
${h.subject ? `${latexText(h.subject)}\\par` : ""}
${mode === "de" && h.durationMin ? `\\textit{Thời gian làm bài: ${Number(h.durationMin)} phút}\\par` : ""}
${mode === "de" && h.code ? `\\textbf{Mã đề ${latexText(h.code)}}\\par` : ""}
\\end{center}
`;
  return top + center + idline;
}

/**
 * Chuẩn hoá `layout` của file đề (dùng `marginCm`/`fontSizePt`) về đúng tên
 * trường mà `resolveFormat` hiểu, rồi giao cho nó quyết định.
 */
function formatOf(L = {}){
  const margins = L.marginCm || {};
  return resolveFormat({
    ...L,
    marginTop: margins.top ?? L.marginTop,
    marginRight: margins.right ?? L.marginRight,
    marginBottom: margins.bottom ?? L.marginBottom,
    marginLeft: margins.left ?? L.marginLeft,
    fontSize: L.fontSizePt ?? L.fontSize,
  });
}

export function buildLatexDocument(doc,{ mode="de", assets={} }={}){
  const h=doc?.header||{};
  const F=formatOf(doc?.layout||{});

  /* Gói nào cũng có thể thiếu trên máy chưa cài đủ TeX Live. Thà tờ đề mất cái
     khung còn hơn cả lượt biên dịch hỏng, nên mọi gói ngoài bộ chuẩn đều hỏi
     `\IfFileExists` trước. */
  const watermark = F.watermark
    ? `\\IfFileExists{draftwatermark.sty}{\\usepackage{draftwatermark}\n\\SetWatermarkText{${latexText(F.watermark)}}\n\\SetWatermarkScale{2.4}\n\\SetWatermarkLightness{.9}}{}`
    : "";
  const serif = F.fontFamily === "sans"
    ? `\\renewcommand{\\familydefault}{\\sfdefault}`
    : F.fontFamily === "legacy"
      ? `\\IfFileExists{tgtermes.sty}{\\usepackage{tgtermes}}{}`
      : "";
  // Cỡ chữ: article chỉ nhận 10/11/12pt, nên chọn mức gần nhất rồi chỉnh đúng số
  // bằng \fontsize — Latin Modern là phông vector nên co giãn mượt.
  const classSize = F.fontSize <= 10.5 ? 10 : F.fontSize <= 11.5 ? 11 : 12;
  const exactSize = Math.abs(F.fontSize - classSize) > 0.01
    ? `\\AtBeginDocument{\\fontsize{${F.fontSize}}{${(F.fontSize * 1.25).toFixed(1)}}\\selectfont}` : "";

  let activeGroup=null, activeSection=null;
  const body=(doc?.questions||[]).map((q,i)=>{
    let out = "";
    if(q.section_title && q.section_title !== activeSection){
      out += sectionTex(q.section_title, F);
      if(q.section_note) out += `\\noindent\\textit{${latexText(q.section_note)}}\\par\\smallskip\n`;
      activeSection = q.section_title;
      activeGroup = null;
    }
    const groupId=q.group?.id || null;
    if(groupId && groupId!==activeGroup) out += groupTex(q.group,assets[`g:${groupId}`]);
    activeGroup=groupId;
    return out+questionTex(q,i+1,mode,F,assets[`q:${i}`]);
  }).join("\n");

  const columned = F.columns === 2
    ? `\\begin{multicols}{2}\n${body}\n\\end{multicols}\n` : body;
  const notes = mode === "de" ? {
    top: F.topNote ? `\\begin{center}\\itshape ${latexText(F.topNote)}\\end{center}\n` : "",
    bottom: F.bottomNote ? `\\medskip\\begin{center}\\itshape ${latexText(F.bottomNote)}\\end{center}\n` : "",
  } : { top:"", bottom:"" };

  return `\\documentclass[${classSize}pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T5]{fontenc}
\\usepackage[vietnamese]{babel}
\\usepackage{lmodern,amsmath,amssymb,mathtools,graphicx,tabularx,array,geometry,xcolor,multicol}
${serif}
${watermark}
\\definecolor{formink}{HTML}{${texColor(F.ink,"1D2430")}}
\\definecolor{formsoft}{HTML}{${texColor(F.soft,"F4F6F8")}}
\\definecolor{formborder}{HTML}{${texColor(F.border,"9AA4B0")}}
\\geometry{top=${F.margin.top}cm,right=${F.margin.right}cm,bottom=${F.margin.bottom}cm,left=${F.margin.left}cm}
\\linespread{${F.lineGap}}
${exactSize}
% ── Nạp package tuỳ chọn (chỉ \\usepackage, KHÔNG định nghĩa gì bên trong) ──
\\IfFileExists{tikz.sty}{\\usepackage{tikz}}{}
\\IfFileExists{tcolorbox.sty}{\\usepackage[most]{tcolorbox}}{}
% ── Badge tròn cho nhãn phương án (A, B, C, D) ──
\\newcommand{\\eduBadge}[1]{\\textcircled{\\small #1}}
\\ifdefined\\tikz
  \\renewcommand{\\eduBadge}[1]{\\tikz[baseline=(c.base)]{%
    \\node[circle,draw=formborder,fill=formsoft,inner sep=1.5pt,minimum size=1.4em,font=\\small\\bfseries](c){#1};}}
\\fi
% ── Khung bo tròn cho card phương án ──
\\newcommand{\\eduCardBox}[1]{\\fbox{\\parbox[t]{\\dimexpr\\linewidth-2\\fboxsep-2\\fboxrule\\relax}{\\vspace{1pt}#1\\vspace{1pt}}}}
\\ifdefined\\tcolorbox
  \\renewcommand{\\eduCardBox}[1]{\\begin{tcolorbox}[colframe=formborder,colback=white,arc=4pt,boxrule=0.5pt,left=4pt,right=4pt,top=2pt,bottom=2pt,boxsep=0pt]#1\\end{tcolorbox}}
\\fi
% ── Tiêu đề phần ──
\\newcommand{\\eduSectionBar}[1]{\\colorbox{formink}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep-2\\fboxrule\\relax}{\\vspace{2pt}\\bfseries\\color{white}#1\\vspace{2pt}}}}
\\newcommand{\\eduSectionOutline}[1]{\\fcolorbox{formborder}{white}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep-2\\fboxrule\\relax}{\\vspace{2pt}\\bfseries\\color{formink}#1\\vspace{2pt}}}}
\\ifdefined\\tcolorbox
  \\renewcommand{\\eduSectionBar}[1]{\\begin{tcolorbox}[colframe=formink,colback=formink,arc=4pt,boxrule=0pt,left=6pt,right=6pt,top=2pt,bottom=2pt,boxsep=0pt]\\bfseries\\color{white}#1\\end{tcolorbox}}
  \\renewcommand{\\eduSectionOutline}[1]{\\begin{tcolorbox}[colframe=formborder,colback=white,arc=4pt,boxrule=0.6pt,left=6pt,right=6pt,top=2pt,bottom=2pt,boxsep=0pt]\\bfseries\\color{formink}#1\\end{tcolorbox}}
\\fi
% ── Khung câu hỏi (educard) ──
\\newenvironment{educard}{}{}
\\ifdefined\\tcolorbox
  \\renewenvironment{educard}{\\begin{tcolorbox}[colframe=formborder,colback=white,arc=5pt,boxrule=0.5pt,left=6pt,right=6pt,top=4pt,bottom=4pt,breakable]}{\\end{tcolorbox}}
\\else
  \\IfFileExists{framed.sty}{\\usepackage{framed}\\renewcommand{\\FrameCommand}{\\fcolorbox{formborder}{white}}%
  \\renewenvironment{educard}{\\begin{framed}}{\\end{framed}}}{}
\\fi
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{2pt}
\\begin{document}
\\thispagestyle{empty}
${headerTex(h, F, mode)}${notes.top}${columned}${notes.bottom}\\end{document}
`;
}
