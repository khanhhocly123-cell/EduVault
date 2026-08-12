/* Kill test cho bộ dựng .docx — chạy bằng Node, không cần trình duyệt.
 *
 *   node web/docx-test.mjs
 *
 * Dựng một file .docx thật, ghi ra đĩa, rồi giải nén đếm thẻ. Đây đúng là phép
 * kiểm mà `phase0` chạy trên file pandoc xuất ra — cùng câu hỏi, cùng cách trả
 * lời: `<m:oMath>` có mặt nghĩa là công thức mở lên trong Word sửa được.
 *
 * docx.js và omml.js không đụng gì tới DOM nên chạy thẳng ở Node được. Chỉ
 * phần rasterise hình SVG (nằm trong app.js) mới cần canvas.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { buildDocx, killTest, p, t, tex, table, hr } from "./docx.js";

const OUT = resolve("out");
mkdirSync(OUT, { recursive: true });

/* Mấy câu có đủ thứ khó: phân số, căn, chỉ số trên dưới, chỉ số đứng trước,
   tích phân có cận, vector, đơn vị \mathrm, dấu phẩy thập phân Việt Nam. */
const CASES = [
  ["Con lắc lò xo", "Một con lắc lò xo có $k = 40\\,\\mathrm{N/m}$, $m = 100\\,\\mathrm{g}$. Tần số góc $\\omega = \\sqrt{\\dfrac{k}{m}} = 20\\,\\mathrm{rad/s}$."],
  ["Hạt nhân", "Hạt nhân $^{235}_{92}\\mathrm{U}$ có $143$ nơtron."],
  ["Tích phân", "Tính $\\int_0^1 (2x + 1)\\,\\mathrm{d}x = 2$."],
  ["Vector", "Cho $\\vec{v}$ và $\\vec{a}$ thoả $\\vec{v} \\perp \\vec{a}$, $|\\vec{v}| = 5{,}0\\,\\mathrm{m/s}$."],
  ["Thập phân", "Lấy $g = 9{,}8\\,\\mathrm{m/s^2}$ và $\\alpha = 30^\\circ$."],
  ["Phân số lồng", "$T = 2\\pi\\sqrt{\\dfrac{\\ell}{g}}$ với $\\ell = 1{,}0\\,\\mathrm{m}$."],
];

const body = [];
body.push(p(t("ĐỀ KIỂM TRA THỬ — KILL TEST", { bold: true, size: 14 }), { align: "center" }));
body.push(hr());

CASES.forEach(([name, src], i) => {
  body.push(p(t(`Câu ${i + 1}. `, { bold: true }) + tex(src, { size: 12 })));
  body.push(table(
    [[p(t("A. ", { bold: true }) + tex("$1{,}5\\,\\mathrm{s}$")),
      p(t("B. ", { bold: true }) + tex("$\\dfrac{1}{2}$"))]],
    [50, 50]
  ));
});

const { bytes, xml } = buildDocx({
  body,
  layout: { marginLeft: 3, marginTop: 2, marginRight: 2, marginBottom: 2,
            fontSize: 12, lineGap: 1.15, watermark: "LƯU HÀNH NỘI BỘ" },
});

const file = resolve(OUT, "kill-test.docx");
writeFileSync(file, bytes);

/* Mỗi câu có ít nhất 1 công thức trong đề bài + 2 trong phương án. */
const expect = CASES.length * 3;
const check = killTest(xml, expect);

console.log(`Dựng ${file}`);
console.log(`  kích thước       ${(bytes.length / 1024).toFixed(1)} KB`);
console.log(`  thẻ <m:oMath>    ${check.math} (cần ít nhất ${expect})`);
if (check.unknown.length) console.log(`  lệnh chưa hỗ trợ ${check.unknown.join(", ")}`);

/* Giải nén bằng công cụ ngoài — đây mới là bằng chứng ZIP hợp lệ, chứ tự đếm
   trong chuỗi XML thì chỉ chứng minh mình dựng đúng chuỗi. */
let unzipOk = false;
try {
  const out = execFileSync("powershell", ["-NoProfile", "-Command",
    `Add-Type -A System.IO.Compression.FileSystem;` +
    `$z=[IO.Compression.ZipFile]::OpenRead('${file.replace(/\\/g, "\\\\")}');` +
    `$z.Entries | ForEach-Object { "$($_.FullName) $($_.Length)" };$z.Dispose()`,
  ], { encoding: "utf8" });
  console.log("\n  Giải nén được, các phần bên trong:");
  for (const line of out.trim().split(/\r?\n/)) console.log("    " + line);
  unzipOk = out.includes("word/document.xml");
} catch (e) {
  console.log("\n  KHÔNG giải nén được: " + e.message.split("\n")[0]);
}

const pass = check.pass && unzipOk && !check.unknown.length;
console.log(`\n${pass ? "PASS" : "HỎNG"} — ${check.note}${unzipOk ? " · ZIP hợp lệ" : " · ZIP HỎNG"}`);
process.exit(pass ? 0 : 1);
