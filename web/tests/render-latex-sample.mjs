import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import sharp from "sharp";
import { buildLatexDocument } from "../latex.mjs";

const out=resolve(process.argv[2] || "../tmp/pdfs");
await mkdir(out,{recursive:true});
const graph=join(out,"sample-graph.png");
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="280" viewBox="0 0 720 280">
  <rect width="720" height="280" fill="white"/><path d="M45 230H680M110 255V25" stroke="#222" stroke-width="3"/>
  <path d="M65 50 Q290 330 625 45" fill="none" stroke="#315fc6" stroke-width="7"/>
  <text x="650" y="220" font-size="28">x</text><text x="125" y="38" font-size="28">y</text>
</svg>`)).png().toFile(graph);

const questions=[
  {type:"MC",stem_latex:"Cho hàm số $f(x)=x^2-4x+3$ có đồ thị như hình. Giá trị nhỏ nhất bằng",images:[{src:graph}],mc_choices:["-2","-1","0","1"].map((text_latex,i)=>({label:"ABCD"[i],text_latex})),mc_correct:"B"},
  {type:"MC",stem_latex:"Cặp số nào là nghiệm của hệ $\\begin{cases}x+y-3<0\\\\x-y+1>0\\end{cases}$?",mc_choices:["$(1;0)$","$(0;2)$","$(-1;1)$","$(1;2)$"].map((text_latex,i)=>({label:"ABCD"[i],text_latex}))},
  {type:"MC",stem_latex:"Vectơ nào bằng $\\overrightarrow{AB}$ trong không gian $\\mathbb R^3$?",mc_choices:["$\\overrightarrow{AA'}$","$\\overrightarrow{D'C'}$","$\\overrightarrow{CD}$","$\\overrightarrow{AD}$"].map((text_latex,i)=>({label:"ABCD"[i],text_latex}))},
  {type:"TF",stem_latex:"Xét tính đúng sai của các phát biểu sau.",tf_statements:[
    {idx:"a",text_latex:"Hàm số xác định trên $\\mathbb R$.",is_true:true},
    {idx:"b",text_latex:"Phương trình $f'(x)=0$ có hai nghiệm.",is_true:false},
    {idx:"c",text_latex:"Giá trị cực tiểu bằng $-1$.",is_true:true},
    {idx:"d",text_latex:"Đồ thị đi qua gốc tọa độ.",is_true:false},
  ]},
  {type:"SHORT",stem_latex:"Ghi số 2026 vào bốn ô trả lời.",short_answer:{value:2026}},
  {type:"ESSAY",stem_latex:"Chứng minh rằng $a^2+b^2 \\ge 2ab$ và trình bày đầy đủ các bước."},
];
const doc={
  header:{org:"Khóa học: GIẢI TÍCH",school:"HCMUT",title:"ĐỀ THI CUỐI KỲ",subject:"Môn: Toán",durationMin:60,code:"001"},
  layout:{marginCm:{top:1,right:1,bottom:1,left:1},mcColumns:4,watermark:"EDUVAULT"},questions,
};
await writeFile(join(out,"exam.tex"),buildLatexDocument(doc,{assets:{"q:0":"sample-graph.png"}}),"utf8");
const pdflatex=process.env.PDFLATEX_PATH || "C:\\Users\\leose\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64\\pdflatex.exe";
await new Promise((ok,fail)=>{
  const child=spawn(pdflatex,["-interaction=nonstopmode","-halt-on-error","-no-shell-escape","exam.tex"],{cwd:out,stdio:"inherit",windowsHide:true});
  child.on("error",fail);child.on("close",code=>code===0?ok():fail(new Error(`pdfLaTeX exit ${code}`)));
});
