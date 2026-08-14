/**
 * Bộ test cho lớp gọi model OCR.
 *
 * Mọi ca ở đây đều lấy từ một lần chạy thật trên đề HSG QG Yên Bái ngày 1 —
 * không có ca nào là tình huống tưởng tượng.
 */
import assert from "node:assert/strict";
import test from "node:test";

const {
  cleanModelText, contextBlock, normalizePage, repairJsonEscapes, repairTruncatedJson,
} = await import("../ocr-model.mjs");

test("JSON hợp lệ thì đi thẳng, không đụng gì", () => {
  const doc = { page: 3, questions: [{ stem_latex: "Tính $v$" }] };
  const parsed = repairTruncatedJson(JSON.stringify(doc));
  assert.deepEqual(parsed.value, doc);
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.repairedEscapes, false);
});

test("bọc trong ```json vẫn đọc được", () => {
  const parsed = repairTruncatedJson('```json\n{"page":2,"questions":[]}\n```');
  assert.equal(parsed.value.page, 2);
});

test("vá JSON bị cắt giữa chừng thay vì mất trắng cả trang", () => {
  const cut = '{"page":1,"groups":[],"questions":[{"stem_latex":"xong"},{"stem_latex":"dang do';
  const patched = repairTruncatedJson(cut);
  assert.equal(patched.truncated, true);
  assert.equal(patched.value.questions.length, 1);
  assert.equal(patched.value.questions[0].stem_latex, "xong");
});

test("escape LaTeX thiếu gạch chéo: vá được thay vì mất cả trang", () => {
  // Trang 7 của đề HSG: model viết \\left đúng nhưng \dfrac thiếu một gạch chéo
  // trong CÙNG một chuỗi. JSON.parse ném lỗi và cả trang biến mất.
  const raw = String.raw`{"solution_latex":"$\dfrac{1}{2}$ và $\\left( x \\right)$ và \alpha","ok":true}`;
  assert.throws(() => JSON.parse(raw), SyntaxError, "chuỗi thô phải thật sự hỏng");

  const parsed = repairTruncatedJson(raw);
  assert.ok(parsed.value, "phải vá được");
  assert.equal(parsed.repairedEscapes, true);
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.value.ok, true);
  assert.equal(parsed.value.solution_latex, String.raw`$\dfrac{1}{2}$ và $\left( x \right)$ và \alpha`);
});

test("lệnh LaTeX trùng escape điều khiển của JSON không được hỏng âm thầm", () => {
  // Đây là ca nguy hiểm nhất: "\right" và "\theta" LÀ JSON hợp lệ — chúng parse
  // thành CR + "ight" và TAB + "heta". Không có lỗi nào được ném ra, chỉ có công
  // thức sai. Vì vậy phải vá TRƯỚC khi parse chứ không đợi ngoại lệ.
  const raw = String.raw`{"a":"$\left(x\right)$ và $\theta$ và $\frac{1}{2}$ và $\beta$ và $\nabla f$"}`;
  const naive = JSON.parse(repairedFreeCopy(raw));
  assert.match(naive.a, /[\r\t\f\b\n]/, "parse thô ra ký tự điều khiển");

  const parsed = repairTruncatedJson(raw);
  assert.equal(parsed.value.a, String.raw`$\left(x\right)$ và $\theta$ và $\frac{1}{2}$ và $\beta$ và $\nabla f$`);
  assert.doesNotMatch(parsed.value.a, /[\r\t\f\b]/, "không còn ký tự điều khiển");
});

/** Parse thô, không qua lớp vá — chỉ dùng để chứng minh bản thô thật sự sai. */
function repairedFreeCopy(text) {
  return text.replace(/\\l/g, "\\\\l");   // chỉ hợp thức hoá escape KHÔNG hợp lệ
}

test("xuống dòng thật và escape hợp lệ không bị đụng vào", () => {
  const raw = String.raw`{"a":"dòng một\ndòng haié","b":"không phải lệnh: \nb) tiếp"}`;
  const parsed = repairTruncatedJson(raw);
  assert.equal(parsed.value.a, "dòng một\ndòng haié");
  assert.equal(parsed.value.b, "không phải lệnh: \nb) tiếp",
    "\\nb không phải lệnh LaTeX nên vẫn là xuống dòng");
  assert.equal(repairJsonEscapes(raw), raw, "chuỗi đã đúng thì không được sửa");
});

test("dọn hai ký tự gạch chéo + n mà model trả về thay cho xuống dòng", () => {
  const dirty = String.raw`Đoạn một.\n\nb)\n\nĐoạn hai có $x \ne y$ và $\nabla f$.`;
  const clean = cleanModelText(dirty);
  const textOnly = clean.split(/\$[^$]*\$/).join(" ");
  assert.doesNotMatch(textOnly, /\\n/, "phần chữ không còn gạch chéo + n");
  assert.match(clean, /Đoạn một\.\n\nb\)/, "dòng trống ngăn đoạn phải được giữ");
  assert.match(clean, /\$x \\ne y\$/, "lệnh trong $…$ phải giữ nguyên");
  assert.match(clean, /\\nabla/);
});

test("trang lời giải không được biến thành câu hỏi mới", () => {
  const page = normalizePage({
    page: 13, page_role: "dap_an", answers_heading: false, groups: [], printed_answers: [],
    questions: [{
      type: "ESSAY", problem_ref: "Ж5", printed_number: "1",
      stem_latex: "Biến đổi $B_x''(z)-k^2B_x(z)=0$ rồi thay số.",
      answer_source: "printed", images: [], difficulty: "VD",
    }],
  }, 13, { insideAnswerSection: true });

  assert.equal(page.questions.length, 0, "trang đáp án không được để lại câu hỏi nào");
  assert.equal(page.printed_answers.length, 1, "nội dung phải chuyển thành lời giải in sẵn");
  assert.equal(page.printed_answers[0].problem_ref, "Ж5");
  assert.match(page.printed_answers[0].solution_latex, /Biến đổi/);
});

test("nhãn page_role sai ở giữa phần đề KHÔNG được xoá câu hỏi thật", () => {
  // Đo thật: trang 4 và 5 của đề HSG là đề thuần nhưng model gọi là "dap_an".
  // Chưa qua tiêu đề ĐÁP ÁN thì không được tin nhãn đó.
  const raw = {
    page: 4, page_role: "dap_an", answers_heading: false, groups: [], printed_answers: [],
    questions: [{
      type: "ESSAY", problem_ref: "Ж4", printed_number: "2",
      stem_latex: "Đặt tại trung điểm $CD$ một bản mỏng $L$.",
      answer_source: "none", images: [], difficulty: "VD",
    }],
  };
  assert.equal(normalizePage(raw, 4).questions.length, 1, "câu hỏi thật phải còn nguyên");
  assert.equal(normalizePage(raw, 4).printed_answers.length, 0);
  assert.equal(normalizePage(raw, 4, { insideAnswerSection: true }).questions.length, 0,
    "qua tiêu đề ĐÁP ÁN rồi thì mới được chuyển");
});

test("bối cảnh tuần tự do backend dựng, không bắt model tự đoán", () => {
  assert.equal(contextBlock({}), "");
  const carry = contextBlock({
    answersFromPage: 6, openProblem: "Ж5 — Độ thâm nhập London", seenNumbers: ["1", "2"],
  });
  assert.match(carry, /phần ĐÁP ÁN\/LỜI GIẢI từ trang 6/);
  assert.match(carry, /Độ thâm nhập London/);
  assert.match(carry, /1, 2/);
});
