import { spawn } from "node:child_process";
import { mkdir, writeFile, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    // Không dùng shell: đường dẫn do người dùng đưa vào sẽ không bị nối chuỗi vào shell.
    const p = spawn(cmd, args, { cwd });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => res({ code: 127, out: String(e) }));
    p.on("close", (code) => res({ code: code ?? 1, out }));
  });
}

const PREAMBLE = String.raw`\documentclass[border=4pt,varwidth]{standalone}
\usepackage{tikz}
\usepackage[utf8]{inputenc}
\usetikzlibrary{arrows.meta,angles,quotes,patterns,decorations.pathmorphing}
\begin{document}
`;

/**
 * Biên dịch một đoạn TikZ thành PNG 300 DPI.
 * Dùng latexmk + pdftoppm của MiKTeX (đã có sẵn trên máy).
 * Trả về đường dẫn PNG, hoặc ném lỗi kèm log để bước gọi quyết định quay về ảnh gốc.
 */
export async function compileTikz(
  tikzSource: string,
  outPng: string,
  opts: { dpi?: number; keepTemp?: boolean } = {},
): Promise<string> {
  const dpi = opts.dpi ?? 300;
  const outAbs = resolve(outPng);
  const work = join(resolve("out"), ".tikz", `job-${Date.now()}`);
  await mkdir(work, { recursive: true });

  const tex = PREAMBLE + tikzSource.trim() + "\n\\end{document}\n";
  await writeFile(join(work, "fig.tex"), tex, "utf8");

  // Gọi thẳng pdflatex chứ không dùng latexmk: latexmk của MiKTeX là script Perl,
  // mà Perl thường không có sẵn trên máy Windows. Chạy 2 lượt cho các thư viện
  // TikZ cần ghi nhớ toạ độ giữa các lượt (angles, calc).
  const args = ["-interaction=nonstopmode", "-halt-on-error", "fig.tex"];
  let compile = await run("pdflatex", args, work);
  if (compile.code !== 0) {
    throw new Error(`pdflatex lỗi (mã ${compile.code}). Log cuối:\n${compile.out.slice(-1500)}`);
  }
  compile = await run("pdflatex", args, work);
  if (compile.code !== 0) {
    throw new Error(`pdflatex lượt 2 lỗi (mã ${compile.code}). Log cuối:\n${compile.out.slice(-1500)}`);
  }

  // pdftoppm thêm hậu tố số vào tên file, nên xuất ra prefix rồi đổi tên lại.
  const conv = await run("pdftoppm", ["-png", "-r", String(dpi), "-singlefile", "fig.pdf", "fig"], work);
  if (conv.code !== 0) {
    throw new Error(`pdftoppm lỗi (mã ${conv.code}):\n${conv.out.slice(-1500)}`);
  }

  const produced = (await readdir(work)).find((f) => f.startsWith("fig") && f.endsWith(".png"));
  if (!produced) throw new Error("pdftoppm chạy xong nhưng không thấy file PNG nào.");

  await mkdir(resolve(outAbs, ".."), { recursive: true });
  await rename(join(work, produced), outAbs);
  if (!opts.keepTemp) await rm(work, { recursive: true, force: true });

  return outAbs;
}

/** Hình mẫu để kiểm chứng đường ống TikZ: vật trên mặt phẳng nghiêng. */
export const SAMPLE_TIKZ = String.raw`\begin{tikzpicture}[scale=1.1,>=Stealth]
  \coordinate (O) at (0,0);
  \coordinate (B) at (6,0);
  \coordinate (T) at (6,3.2);
  \draw[thick,fill=gray!12] (O) -- (B) -- (T) -- cycle;
  \draw[thick] (O) -- ++(-0.4,0);
  \foreach \x in {0,0.45,...,5.9} \draw[gray] (\x,0) -- ++(-0.25,-0.25);

  % Vật nhỏ trên mặt nghiêng. Trọng lực phải thẳng đứng trong hệ trang giấy,
  % nên trong scope đã xoay 28.07 độ phải vẽ theo góc -90-28.07 = -118.07.
  \begin{scope}[shift={(3.6,1.92)},rotate=28.07]
    \draw[thick,fill=white] (-0.42,0) rectangle (0.42,0.62);
    \node at (0,0.31) {$m$};
    \draw[->,very thick] (0,0.31) -- ++(-118.07:1.5) node[below] {$\vec{P}$};
  \end{scope}

  \pic[draw,angle radius=1.4cm,"$\alpha$"] {angle = B--O--T};
\end{tikzpicture}`;
