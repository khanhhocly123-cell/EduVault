/**
 * Dựng `templates/reference.docx` — bộ style mà pandoc mặc vào file xuất ra.
 *
 * KHÔNG chép tay một file .docx rồi nhét vào repo: làm thế thì nửa năm sau không
 * ai biết trong đó có gì và vì sao. Ở đây lấy bản mặc định của pandoc rồi vá bằng
 * code, mỗi chỗ vá có lý do ghi ngay cạnh, và chạy lại lúc nào cũng ra y hệt.
 *
 * Bản mặc định của pandoc lệch với đề thi Việt Nam ở ba chỗ:
 *   1. Font theo theme = Aptos (Word 365). Đề thi Việt Nam dùng Times New Roman.
 *   2. Mỗi đoạn cách trên 9pt dưới 9pt. Mỗi câu hỏi là một đoạn, nên đề giãn
 *      ra rất thoáng và tốn thêm cả trang giấy.
 *   3. Không đặt lề nên Word lấy 1 inch tứ phía. Chuẩn văn bản Việt Nam là
 *      trên/dưới/phải 2cm, trái 3cm để còn chỗ đóng ghim.
 *
 * Viền bảng thì KHÔNG phải sửa — bản mặc định vốn đã không có viền
 * (`TableNormal` không tồn tại, `tblLook w:firstRow="0"` tắt viền có điều kiện).
 * Vẫn ghi thẳng "không viền" vào style cho chắc, phòng pandoc sau này đổi ý.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import AdmZip from "adm-zip";

/** 1cm = 567 twip. Khổ A4 = 21 x 29,7 cm. */
const CM = 567;
const A4_W = Math.round(21 * CM);
const A4_H = Math.round(29.7 * CM);

/** Vá đúng một lần, không khớp thì ném lỗi — pandoc đổi bản là biết ngay,
 *  còn hơn im lặng cho ra cái template thiếu một nửa. */
function patch(xml: string, find: string | RegExp, replace: string, what: string): string {
  const out = xml.replace(find, replace);
  if (out === xml) {
    throw new Error(
      `Không vá được "${what}" — bản mặc định của pandoc đã đổi.\n` +
        `Mở lại src/reference.ts và đối chiếu với:  pandoc --print-default-data-file reference.docx`,
    );
  }
  return out;
}

async function pandocDefaultDocx(): Promise<Buffer> {
  return new Promise((res, rej) => {
    const p = spawn("pandoc", ["--print-default-data-file", "reference.docx"]);
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () =>
      rej(new Error("Không tìm thấy pandoc. Cài bằng:  winget install --id JohnMacFarlane.Pandoc -e")),
    );
    p.on("close", (code) => {
      if (code !== 0) return rej(new Error(`pandoc lỗi (mã ${code}): ${err}`));
      res(Buffer.concat(chunks));
    });
  });
}

export async function buildReferenceDocx(outPath: string): Promise<string> {
  const zip = new AdmZip(await pandocDefaultDocx());

  // ---------------------------------------------------------------- styles
  let styles = zip.readAsText("word/styles.xml");

  // 1. Font mặc định: Times New Roman 12pt thay cho font theo theme.
  styles = patch(
    styles,
    '<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi" />',
    '<w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" />',
    "font mặc định",
  );

  // 2a. Bỏ khoảng cách đoạn mặc định, giãn dòng đơn.
  styles = patch(
    styles,
    '<w:spacing w:after="200" />',
    '<w:spacing w:after="0" w:line="240" w:lineRule="auto" />',
    "khoảng cách đoạn mặc định",
  );

  // 2b. Body Text là style của gần như mọi đoạn pandoc sinh ra. 9pt trên + 9pt
  //     dưới mỗi câu là quá thoáng cho đề thi; 4pt dưới là vừa đủ tách câu.
  styles = patch(
    styles,
    '<w:spacing w:before="180" w:after="180" />',
    '<w:spacing w:before="0" w:after="80" />',
    "khoảng cách đoạn Body Text",
  );

  // 3. Ghi thẳng "không viền" vào style bảng, và bỏ viền dòng đầu.
  //    Cụm 4 phương án được dựng bằng bảng lưới, có viền là đề nhìn như bảng tính.
  styles = patch(
    styles,
    "<w:tblInd w:w=\"0\" w:type=\"dxa\" />",
    "<w:tblInd w:w=\"0\" w:type=\"dxa\" />\n      <w:tblBorders>\n" +
      ["top", "left", "bottom", "right", "insideH", "insideV"]
        .map((s) => `        <w:${s} w:val="none" w:sz="0" w:space="0" w:color="auto" />`)
        .join("\n") +
      "\n      </w:tblBorders>",
    "bỏ viền bảng",
  );
  styles = patch(
    styles,
    /<w:tblStylePr w:type="firstRow">[\s\S]*?<\/w:tblStylePr>/,
    "",
    "bỏ viền dòng đầu của bảng",
  );

  zip.updateFile("word/styles.xml", Buffer.from(styles, "utf8"));

  // -------------------------------------------------------------- document
  // 4. Khổ giấy và lề. Thứ tự thẻ trong <w:sectPr> theo schema OOXML là
  //    footnotePr rồi mới tới pgSz/pgMar, nên chèn ngay trước thẻ đóng.
  let doc = zip.readAsText("word/document.xml");
  doc = patch(
    doc,
    "</w:sectPr>",
    `<w:pgSz w:w="${A4_W}" w:h="${A4_H}" />` +
      `<w:pgMar w:top="${2 * CM}" w:right="${2 * CM}" w:bottom="${2 * CM}" w:left="${3 * CM}" ` +
      `w:header="708" w:footer="708" w:gutter="0" /></w:sectPr>`,
    "khổ giấy A4 và lề",
  );
  zip.updateFile("word/document.xml", Buffer.from(doc, "utf8"));

  const abs = resolve(outPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, zip.toBuffer());
  return abs;
}

/** Đọc lại file vừa dựng và xác nhận từng thứ đã vào đúng chỗ. */
export function checkReferenceDocx(path: string): { label: string; ok: boolean; detail: string }[] {
  const zip = new AdmZip(resolve(path));
  const styles = zip.readAsText("word/styles.xml");
  const doc = zip.readAsText("word/document.xml");

  const font = /w:ascii="([^"]+)"/.exec(styles)?.[1] ?? "(không có)";
  const left = /w:pgMar[^/]*w:left="(\d+)"/.exec(doc)?.[1];
  const top = /w:pgMar[^/]*w:top="(\d+)"/.exec(doc)?.[1];

  return [
    { label: "font mặc định", ok: font === "Times New Roman", detail: font },
    {
      label: "lề trái / trên",
      ok: left === String(3 * CM) && top === String(2 * CM),
      detail: left && top ? `${(+left / CM).toFixed(0)}cm / ${(+top / CM).toFixed(0)}cm` : "chưa đặt",
    },
    {
      label: "viền bảng",
      ok: styles.includes('<w:top w:val="none"') && !styles.includes("firstRow"),
      detail: styles.includes('<w:top w:val="none"') ? "đã ghi none" : "chưa ghi",
    },
    // Phải soi trong đúng khối BodyText: chuỗi w:after="80" còn nằm ở style
    // tiêu đề nữa, kiểm cả file thì lúc nào cũng đạt dù chưa vá gì.
    {
      label: "khoảng cách đoạn",
      ok: /w:styleId="BodyText"[\s\S]*?w:after="80"[\s\S]*?<\/w:style>/.test(styles),
      detail: /w:styleId="BodyText"[\s\S]*?w:after="80"[\s\S]*?<\/w:style>/.test(styles)
        ? "Body Text 4pt"
        : "Body Text vẫn 9pt",
    },
  ];
}
