/**
 * Tự kiểm phần logic thuần: không gọi mạng, không cần API key.
 *
 * Đáng có vì cả bài toán định giá gói dịch vụ treo trên đúng hàm `costOf`, mà
 * hai nhà đếm token theo hai kiểu khác nhau — chỗ dễ sai nhất và cũng là chỗ
 * sai xong không ai biết, vì nó chỉ ra một con số nhỏ hơn sự thật.
 */
import {
  costOf,
  normalizeModelId,
  vendorOf,
  apiKeyEnvFor,
  providerFor,
  splitModel,
  PRICING,
  VENDORS,
} from "./providers.js";
import { isKnownTopic, TOPICS } from "./topics.js";
import { extractionSystem } from "./prompt.js";

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "OK  " : "SAI "} ${name}`);
  if (!ok) console.log(`         cần ${JSON.stringify(want)}, nhận ${JSON.stringify(got)}`);
}

function checkThrows(name: string, fn: () => unknown) {
  try {
    fn();
    fail++;
    console.log(`  SAI  ${name} — đáng lẽ phải ném lỗi`);
  } catch {
    pass++;
    console.log(`  OK   ${name}`);
  }
}

export function selftest(): number {
  console.log("Định tuyến model theo nhà\n");
  check("gpt-5.6-luna là của openai", vendorOf("gpt-5.6-luna"), "openai");
  check("claude-sonnet-5 là của anthropic", vendorOf("claude-sonnet-5"), "anthropic");
  check("cắt được hậu tố ngày trong id model", normalizeModelId("claude-sonnet-5-20260115"), "claude-sonnet-5");
  check("id model lạ thì giữ nguyên", normalizeModelId("mo-hinh-la"), "mo-hinh-la");
  check("luna đòi key OpenAI", apiKeyEnvFor("gpt-5.6-luna"), "OPENAI_API_KEY");
  check("claude đòi key Anthropic", apiKeyEnvFor("claude-opus-5"), "ANTHROPIC_API_KEY");
  checkThrows("model lạ thì ném lỗi chứ không đoán nhà", () => providerFor("mo-hinh-la"));

  console.log("\nTính tiền — hai nhà đếm token khác nhau\n");
  // 1000*2 + 1000*10 + 2000*(2*1,25) + 4000*(2*0,1) = 17.800 phần triệu USD
  check(
    "anthropic tính cả ghi cache 1,25x và đọc cache 0,1x",
    costOf("claude-sonnet-5", { freshInput: 1000, output: 1000, cacheRead: 4000, cacheWrite: 2000 }).costUsd.toFixed(6),
    (17_800 / 1e6).toFixed(6),
  );
  // 1000*0,2 + 1000*1,2 + 4000*(0,2*0,1) = 1.480 phần triệu USD
  check(
    "openai không tính tiền ghi cache",
    costOf("gpt-5.6-luna", { freshInput: 1000, output: 1000, cacheRead: 4000, cacheWrite: 0 }).costUsd.toFixed(6),
    (1_480 / 1e6).toFixed(6),
  );
  check(
    "model lạ thì báo không tính được, không trả 0 im lặng",
    costOf("mo-hinh-la", { freshInput: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 }).costKnown,
    false,
  );
  check(
    "bỏ qua token cache thì rẻ đi thấy rõ — đây là lỗi cũ",
    costOf("claude-sonnet-5", { freshInput: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 }).costUsd <
      costOf("claude-sonnet-5", { freshInput: 1000, output: 1000, cacheRead: 4000, cacheWrite: 2000 }).costUsd,
    true,
  );
  check(
    "mọi model trong PRICING đều khai nhà có thật",
    Object.values(PRICING).every((p) => p.vendor in VENDORS),
    true,
  );
  check(
    "mọi model trong PRICING đều tự định tuyến được, không cần ghi rõ nhà",
    Object.keys(PRICING).every((m) => {
      try {
        return splitModel(m).vendor === PRICING[m]!.vendor;
      } catch {
        return false;
      }
    }),
    true,
  );
  check("ghi rõ nhà thì đi đúng nhà đó", splitModel("stali:claude-sonnet-5").vendor, "stali");
  check("ghi rõ nhà thì tên model gửi đi đã bỏ tiền tố", splitModel("stali:claude-sonnet-5").id, "claude-sonnet-5");
  check(
    "model hạn mức miễn phí báo rõ là free, không báo 'không tính được'",
    costOf("gemini-3.5-flash", { freshInput: 1500, output: 1000, cacheRead: 0, cacheWrite: 0 }).freeTier,
    true,
  );

  console.log("\nBảng chuyên đề và prompt\n");
  check("mã Vật lí hợp lệ", isKnownTopic("p11.oscillation"), true);
  check("mã Toán hợp lệ", isKnownTopic("m12.integral"), true);
  check("mã tự chế bị bắt", isKnownTopic("p99.khong-co"), false);

  const sysLy = extractionSystem("physics");
  const sysToan = extractionSystem("math");
  check("prompt Vật lí không lẫn mã Toán", /\bm1[012]\./.test(sysLy), false);
  check("prompt Toán không lẫn mã Vật lí", /\bp1[012]\./.test(sysToan), false);
  check(
    "prompt Vật lí liệt kê đủ mã Vật lí",
    Object.keys(TOPICS.physics).every((c) => sysLy.includes(c)),
    true,
  );
  check(
    "prompt Toán liệt kê đủ mã Toán",
    Object.keys(TOPICS.math).every((c) => sysToan.includes(c)),
    true,
  );
  check("prompt Toán dặn quy ước tích phân", sysToan.includes("\\mathrm{d}x"), true);
  check("cả hai prompt đều dặn dấu phẩy thập phân", sysLy.includes("$0{,}5$") && sysToan.includes("$0{,}5$"), true);

  console.log(`\n${fail === 0 ? "TẤT CẢ ĐẠT" : "CÓ CHỖ SAI"} — ${pass} đạt, ${fail} sai`);
  return fail;
}
