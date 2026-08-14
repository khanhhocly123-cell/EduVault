import assert from "node:assert/strict";
import test from "node:test";
import { buildLatexDocument, latexText, safeMath } from "../latex.mjs";
import { mathToOmml, takeUnknownCommands } from "../omml.js";

const sample = {
  header:{org:"ĐẠI HỌC BÁCH KHOA",school:"HCMUT",title:"ĐỀ KIỂM TRA",subject:"Giải tích",durationMin:60,code:"001"},
  layout:{marginCm:{top:1,right:1,bottom:1,left:1},mcColumns:4,tfStyle:"tabular",watermark:null},
  questions:[
    {type:"MC",stem_latex:"Cho $f(x)=x^2-4x+3$.",mc_choices:["-2","-1","0","1"].map((text_latex,i)=>({label:"ABCD"[i],text_latex})),mc_correct:"B"},
    {type:"TF",stem_latex:"Xét các phát biểu.",tf_statements:[{idx:"a",text_latex:"$f'(x)=2x-4$",is_true:true}]},
  ],
};

test("nguồn PDF dùng Latin Modern, lề 1 cm và tabular cho TN/ĐS",()=>{
  const tex=buildLatexDocument(sample);
  assert.match(tex,/\\usepackage\{lmodern,/);
  assert.match(tex,/\\geometry\{top=1cm,right=1cm,bottom=1cm,left=1cm\}/);
  assert.match(tex,/\\begin\{tabularx\}/);
  assert.match(tex,/\\textbf\{Phát biểu\}/);
});

/* ── PDF phải mang ĐÚNG trình bày đang hiện trên màn hình ────────────────────
 * Người dùng chọn kiểu ở màn Tùy chỉnh rồi tải file về thấy một tờ đề khác:
 * bản cũ chỉ đọc 4 trong 35 trường trình bày. Mấy test dưới khoá từng trường đã
 * rơi, theo đúng bảng quyết định dùng chung `resolveFormat()`.
 */
const withLayout = (layout, questions) => buildLatexDocument({
  header:{ title:"Đề" }, layout:{ marginCm:{top:1,right:1,bottom:1,left:1}, ...layout },
  questions,
}, { mode:"de" });

const tfQuestion = { type:"TF", stem_latex:"Xét các phát biểu.",
  tf_statements:[{ idx:"a", text_latex:"Đúng chứ", is_true:true }] };

test("ba kiểu Đúng–Sai ra ba kết quả khác nhau", () => {
  const list = withLayout({ tfStyle:"list" }, [tfQuestion]);
  assert.doesNotMatch(list, /\\textbf\{Phát biểu\}/);
  assert.match(list, /hspace\*\{\.6cm\}a\)/);

  const table = withLayout({ tfStyle:"table" }, [tfQuestion]);
  assert.match(table, /\\colorbox\{formink\}/);

  const tabular = withLayout({ tfStyle:"tabular" }, [tfQuestion]);
  assert.match(tabular, /\\textbf\{Phát biểu\}/);
  assert.doesNotMatch(tabular.split("\\begin{document}")[1], /\\colorbox\{formink\}/);
  // colortbl giết tabularx trên bản MiKTeX phổ biến — đừng nạp lại nó.
  assert.doesNotMatch(tabular, /colortbl/);
});

test("trả lời ngắn: ô vuông hay dòng kẻ là do tuỳ chỉnh quyết", () => {
  const short = { type:"SHORT", stem_latex:"Điền số." };
  const boxes = withLayout({ shortStyle:"boxes", shortBoxCount:4 }, [short]);
  assert.equal((boxes.match(/\\framebox/g) ?? []).length, 4);
  const line = withLayout({ shortStyle:"line" }, [short]);
  assert.match(line, /\\textbf\{Trả lời:\} \\rule/);
  assert.doesNotMatch(line, /\\framebox/);
});

test("dòng làm bài tự luận in đúng số dòng đã chọn", () => {
  const essay = { type:"ESSAY", stem_latex:"Trình bày lời giải." };
  const lines = withLayout({ essayStyle:"lines", essayWorkLines:6, essayWorkLabel:"Bài làm" }, [essay]);
  assert.equal((lines.match(/\\dotfill/g) ?? []).length, 6);
  assert.match(lines, /Bài làm/);
  const blank = withLayout({ essayStyle:"blank", essayWorkLines:6 }, [essay]);
  assert.doesNotMatch(blank, /\\dotfill/);
  assert.match(blank, /\\vspace\{4\.32cm\}/);
});

test("tiêu đề phần, cỡ chữ, giãn dòng và hai cột không được rơi mất", () => {
  const tex = withLayout(
    { sectionHeading:"bar", fontSizePt:14, lineGap:1.5, columns:2 },
    [{ type:"ESSAY", stem_latex:"Câu hỏi", section_title:"Phần I — Tự luận" }],
  );
  // `latexText` đổi gạch dài "—" thành "--" của LaTeX.
  assert.match(tex, /PHẦN I -- TỰ LUẬN/);
  assert.match(tex, /\\colorbox\{formink\}/);
  assert.match(tex, /\\linespread\{1\.5\}/);
  assert.match(tex, /\\fontsize\{14\}/);
  assert.match(tex, /\\begin\{multicols\}\{2\}/);
});

test("bảng màu của người dùng đi thẳng vào nguồn PDF", () => {
  const tex = withLayout({ accentColor:"#C20A5B", borderColor:"#DF7BA8" }, []);
  assert.match(tex, /\\definecolor\{formink\}\{HTML\}\{C20A5B\}/);
  assert.match(tex, /\\definecolor\{formborder\}\{HTML\}\{DF7BA8\}/);
});

test("không cho nội dung người dùng chèn lệnh LaTeX nguy hiểm",()=>{
  assert.doesNotMatch(safeMath("\\input{secret}"),/\\input/);
  assert.doesNotMatch(latexText("\\write18{calc}"),/\\write18/);
});

test("giữ nguyên các lệnh đề Toán thực tế: cases, mathbb và overrightarrow",()=>{
  const source=String.raw`\begin{cases}x+y-3<0\\x-y+1>0\end{cases},\ \mathbb R,\ \overrightarrow{AB}`;
  assert.equal(takeUnknownCommands().length,0);
  const omml=mathToOmml(source);
  assert.match(omml,/<m:m>/);
  assert.match(omml,/ℝ/);
  assert.match(omml,/<m:acc>/);
  assert.deepEqual(takeUnknownCommands(),[]);
  assert.match(safeMath(source),/\\begin\{cases\}/);
  assert.match(safeMath(source),/\\overrightarrow/);
  assert.match(safeMath(source),/0\\\\x-y/);
});

test("bốn kiểu phương án xuất ra bốn kết quả khác nhau, khớp bản xem trước", () => {
  const question = { type:"MC", stem_latex:"Chọn phương án đúng",
    mc_choices:[{ label:"A", text_latex:"$1$" }, { label:"B", text_latex:"$2$" }] };
  const build = (mcStyle) => buildLatexDocument({
    header:{ title:"Đề" }, layout:{ mcColumns:1, mcStyle }, questions:[question],
  }, { mode:"de" });

  // plain: chữ cái đậm kèm dấu chấm
  assert.match(build("plain"), /\\textbf\{A\.\}/);
  // circle + cards: chữ cái trong vòng tròn nhãn eduBadge
  assert.match(build("circle"), /\\eduBadge\{A\}/);
  assert.match(build("cards"), /\\eduBadge\{A\}/);
  // cards: mỗi phương án một khung riêng eduCardBox
  assert.match(build("cards"), /\\eduCardBox\{/);
  assert.doesNotMatch(build("circle"), /\\eduCardBox\{/);
  // tabular: có kẻ khung
  assert.match(build("tabular"), /\\hline/);
});

test("lệnh toán màn hình vẽ được thì PDF cũng phải nhận", () => {
  // \setminus từng ra chữ "setminus" giữa phương án trong PDF của người dùng vì
  // allowlist chép tay bị lệch với bảng ký hiệu của bộ render.
  for(const command of ["setminus","dfrac","infty","perp","parallel","varnothing",
                        "arctan","lfloor","binom","cup","cap","notin","Rightarrow"]){
    const out = safeMath(`\\${command}`);
    assert.equal(out, `\\${command}`, `\\${command} bị đổi thành ${out}`);
  }
  // Lệnh không có trong bảng vẫn phải bị bọc lại, không được thả thẳng cho LaTeX.
  assert.match(safeMath(String.raw`\input`), /operatorname/);
});
