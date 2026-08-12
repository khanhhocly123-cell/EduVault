import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodTextFormat, zodResponseFormat } from "openai/helpers/zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { z } from "zod";

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** false = model không có trong PRICING, costUsd là số rác. Đừng dùng để định giá. */
  costKnown: boolean;
  /** Cổng Stali trả chi phí thật bằng VNĐ ở header — có thì tin số này hơn bảng giá. */
  costVnd?: number;
  /** true = đang chạy trên hạn mức miễn phí, không mất tiền nhưng có trần lượt gọi. */
  freeTier?: boolean;
  elapsedMs: number;
}

export interface ExtractResult<T> {
  data: T;
  usage: Usage;
}

export interface VisionProvider {
  readonly id: string;
  extract<T>(args: {
    file: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    model: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
  }): Promise<ExtractResult<T>>;
}

export type Vendor = "anthropic" | "openai" | "gemini" | "stali";

/**
 * Mỗi nhà = một URL gốc + một biến môi trường + một kiểu API.
 *
 *   anthropic  Messages API gốc
 *   openai     Responses API gốc
 *   gemini     Google AI Studio, qua CỔNG TƯƠNG THÍCH OpenAI của Google.
 *              Không gọi generateContent gốc: cổng này nhận đúng
 *              /chat/completions + json_schema nên dùng lại được y hệt đường
 *              dây của Stali, đỡ một class provider.
 *   stali      Cổng gộp 56 model (Claude/GPT/Gemini/DeepSeek…), trả phí bằng
 *              ví VNĐ. Cùng giao thức chat completions.
 *
 * Muốn thêm nhà mới (OpenRouter, Groq, một cổng nội bộ…): thêm một dòng ở đây
 * là xong, không phải viết provider mới.
 */
export interface VendorConfig {
  label: string;
  envKey: string;
  /** Bỏ trống = dùng URL mặc định của SDK. */
  baseUrl?: string;
  api: "anthropic" | "responses" | "chat";
  /** Ghi chú hiện trong `npm run doctor`. */
  hint: string;
}

export const VENDORS: Record<Vendor, VendorConfig> = {
  anthropic: {
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    api: "anthropic",
    hint: "console.anthropic.com — trả bằng thẻ quốc tế",
  },
  openai: {
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    api: "responses",
    hint: "platform.openai.com — trả bằng thẻ quốc tế",
  },
  gemini: {
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    api: "chat",
    hint: "aistudio.google.com/apikey — CÓ HẠN MỨC MIỄN PHÍ, lấy key trong 30 giây",
  },
  stali: {
    label: "Stali",
    envKey: "STALI_API_KEY",
    baseUrl: "https://api.stali.vn/v1",
    api: "chat",
    hint: "api.stali.vn — nạp ví bằng VietQR, một key gọi được cả Claude/GPT/Gemini",
  },
};

/**
 * Suy ra nhà từ tên model. Trước đây tra bảng PRICING, nên model nào chưa kịp
 * điền giá là KHÔNG GỌI ĐƯỢC — sai chỗ: giá và định tuyến là hai việc khác nhau.
 * Muốn ép nhà (ví dụ chạy claude-sonnet-5 qua ví Stali thay vì thẳng Anthropic)
 * thì viết `stali:claude-sonnet-5`.
 */
export function splitModel(model: string): { vendor: Vendor; id: string } {
  const m = /^(anthropic|openai|gemini|stali):(.+)$/.exec(model);
  if (m) return { vendor: m[1] as Vendor, id: m[2]! };

  if (model.startsWith("gemini-") || model.startsWith("gemma-")) return { vendor: "gemini", id: model };
  if (model.startsWith("claude-")) return { vendor: "anthropic", id: model };
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3"))
    return { vendor: "openai", id: model };
  // Model của Stali hay có tiền tố kiểu `req/…` hoặc `stali/…`.
  if (model.includes("/")) return { vendor: "stali", id: model };

  throw new Error(
    `Không đoán được model "${model}" thuộc nhà nào.\n` +
      `Viết rõ nhà ở đầu, ví dụ "gemini:${model}" hoặc "stali:${model}".`,
  );
}

export interface ModelPrice {
  vendor: Vendor;
  /** USD / 1 triệu token */
  input: number;
  output: number;
  /** giá token đọc lại từ cache, tính theo bội số giá input */
  cacheReadMult: number;
  /** giá token ghi vào cache. Nhà OpenAI không tính tiền ghi nên để 0. */
  cacheWriteMult: number;
  /** Đang nằm trong hạn mức miễn phí — costUsd = 0 là ĐÚNG, không phải chưa điền giá. */
  freeTier?: boolean;
}

/**
 * Bảng giá USD / 1 triệu token. Phần Anthropic chốt 2026-06-24, phần OpenAI
 * chốt theo đợt giảm giá 2026-07-30.
 * ĐÂY LÀ SỐ THAM CHIẾU — kiểm lại trên hoá đơn thật trước khi dùng để định giá gói.
 * Sonnet 5 đang có giá giới thiệu $2/$10 đến hết 2026-08-31.
 *
 * Hệ số cache của Anthropic: ghi 1,25× và đọc 0,1× ứng với TTL 5 phút. Bật TTL
 * 1 giờ thì hệ số ghi thành 2,0 — sửa ở đây khi đổi TTL.
 */
const ANTHROPIC_CACHE = { cacheReadMult: 0.1, cacheWriteMult: 1.25 };
const OPENAI_CACHE = { cacheReadMult: 0.1, cacheWriteMult: 0 };

export const PRICING: Record<string, ModelPrice> = {
  "claude-opus-5": { vendor: "anthropic", input: 5.0, output: 25.0, ...ANTHROPIC_CACHE },
  "claude-opus-4-8": { vendor: "anthropic", input: 5.0, output: 25.0, ...ANTHROPIC_CACHE },
  "claude-sonnet-5": { vendor: "anthropic", input: 2.0, output: 10.0, ...ANTHROPIC_CACHE },
  "claude-sonnet-4-6": { vendor: "anthropic", input: 3.0, output: 15.0, ...ANTHROPIC_CACHE },
  "claude-haiku-4-5": { vendor: "anthropic", input: 1.0, output: 5.0, ...ANTHROPIC_CACHE },
  "claude-fable-5": { vendor: "anthropic", input: 10.0, output: 50.0, ...ANTHROPIC_CACHE },

  "gpt-5.6-luna": { vendor: "openai", input: 0.2, output: 1.2, ...OPENAI_CACHE },

  /* Google AI Studio — HẠN MỨC MIỄN PHÍ.
   * Đo thật ngày 12/08/2026 trên một trang đề Vật lí chụp điện thoại (4 câu,
   * 1 câu có hình): cả ba model đọc đúng 4/4, tốn ~1.500 token vào + 800–1.200
   * token ra mỗi trang.
   * freeTier = true nghĩa là 0đ vì Google chưa tính tiền ở hạn mức này, KHÔNG
   * phải vì quên điền giá. Chuyển sang tài khoản trả phí thì phải điền giá thật
   * vào đây, nếu không mọi con số chi phí trong app đều là 0 giả. */
  "gemini-3.6-flash": { vendor: "gemini", input: 0, output: 0, ...OPENAI_CACHE, freeTier: true },
  "gemini-3.5-flash": { vendor: "gemini", input: 0, output: 0, ...OPENAI_CACHE, freeTier: true },
  "gemini-3.5-flash-lite": { vendor: "gemini", input: 0, output: 0, ...OPENAI_CACHE, freeTier: true },
  "gemini-3.1-pro-preview": { vendor: "gemini", input: 0, output: 0, ...OPENAI_CACHE, freeTier: true },
  "gemini-2.5-flash": { vendor: "gemini", input: 0, output: 0, ...OPENAI_CACHE, freeTier: true },
};

/**
 * API trả về id có hậu tố ngày (`claude-sonnet-5-20260115`) chứ không phải alias
 * mình gửi đi. Không cắt hậu tố thì tra bảng trượt và chi phí ra 0 — nhìn tưởng rẻ.
 */
export function normalizeModelId(model: string): string {
  if (PRICING[model]) return model;
  const stripped = model.replace(/-\d{8}$/, "");
  return PRICING[stripped] ? stripped : model;
}

/**
 * Số token đã chuẩn hoá về một cách đếm duy nhất, bất kể nhà nào.
 * `freshInput` là token vào KHÔNG tính phần cache — hai nhà đếm khác nhau nên
 * việc quy đổi nằm ở từng provider, chỗ nó thuộc về.
 */
export interface TokenCount {
  freshInput: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function costOf(
  model: string,
  t: TokenCount,
): { costUsd: number; costKnown: boolean; freeTier?: boolean } {
  const p = PRICING[normalizeModelId(model)];
  if (!p) return { costUsd: 0, costKnown: false };
  if (p.freeTier) return { costUsd: 0, costKnown: true, freeTier: true };
  const usd =
    (t.freshInput * p.input +
      t.output * p.output +
      t.cacheWrite * p.input * p.cacheWriteMult +
      t.cacheRead * p.input * p.cacheReadMult) /
    1_000_000;
  return { costUsd: usd, costKnown: true };
}

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Đọc file, trả về base64 kèm media type. Dùng chung cho cả hai nhà. */
async function readAsBase64(file: string): Promise<{ data: string; mediaType: string; isPdf: boolean }> {
  const ext = extname(file).toLowerCase();
  const data = (await readFile(file)).toString("base64");

  if (ext === ".pdf") return { data, mediaType: "application/pdf", isPdf: true };

  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) {
    throw new Error(`Định dạng không hỗ trợ: ${ext}. Dùng .pdf, .png, .jpg, .gif hoặc .webp.`);
  }
  return { data, mediaType, isPdf: false };
}

/** Đọc file thành content block phù hợp: PDF -> document, ảnh -> image. */
async function toContentBlock(file: string) {
  const { data, mediaType, isPdf } = await readAsBase64(file);

  if (isPdf) {
    return {
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf" as const, data },
    };
  }
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: mediaType as "image/png", data },
  };
}

export class AnthropicProvider implements VisionProvider {
  readonly id = "anthropic";
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async extract<T>({
    file,
    system,
    user,
    schema,
    model,
    effort,
  }: {
    file: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    model: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
  }): Promise<ExtractResult<T>> {
    const block = await toContentBlock(file);
    const started = Date.now();

    const response = await this.client.messages.parse({
      model: splitModel(model).id,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: [block, { type: "text", text: user }] }],
      output_config: {
        format: zodOutputFormat(schema as never),
        ...(effort ? { effort } : {}),
      },
    });

    const elapsedMs = Date.now() - started;

    if (response.stop_reason === "refusal") {
      throw new Error(
        `Model từ chối xử lý (${response.stop_details?.category ?? "không rõ lý do"}). ` +
          `Kiểm tra nội dung trang đầu vào.`,
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "Output bị cắt vì chạm max_tokens. Trang này quá nhiều câu — cắt nhỏ hoặc tăng max_tokens.",
      );
    }
    if (!response.parsed_output) {
      throw new Error("Model trả về output không khớp schema.");
    }

    const u = response.usage;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    // Nhà Anthropic: input_tokens ĐÃ TRỪ phần cache, dùng thẳng làm freshInput.
    const { costUsd, costKnown } = costOf(response.model, {
      freshInput: u.input_tokens,
      output: u.output_tokens,
      cacheRead,
      cacheWrite,
    });

    return {
      data: response.parsed_output as T,
      usage: {
        model: response.model,
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd,
        costKnown,
        elapsedMs,
      },
    };
  }
}

/**
 * Bản OpenAI của cùng một interface. Cần cho hai việc:
 *   - chạy GPT-5.6 Luna ở bước 1, rẻ hơn Haiku khoảng 4,5 lần mỗi trang;
 *   - bước 2 đối chiếu chéo THẬT SỰ khác nhà. Hai lượt cùng nhà Claude thì
 *     lỗi hệ thống nào cả nhà cùng mắc sẽ lọt qua cả hai lượt.
 *
 * CHƯA CHẠY THỬ ĐƯỢC vì chưa có OPENAI_API_KEY. Code đã typecheck, còn đường
 * dây thật thì phải đợi key — lần chạy đầu tiên phải soi kỹ.
 */
export class OpenAIProvider implements VisionProvider {
  readonly id = "openai";
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = apiKey ? new OpenAI({ apiKey }) : new OpenAI();
  }

  async extract<T>({
    file,
    system,
    user,
    schema,
    model,
    effort,
  }: {
    file: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    model: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
  }): Promise<ExtractResult<T>> {
    const { data, mediaType, isPdf } = await readAsBase64(file);
    const started = Date.now();

    const fileBlock = isPdf
      ? {
          type: "input_file" as const,
          filename: file.split(/[\\/]/).pop() ?? "trang.pdf",
          file_data: `data:application/pdf;base64,${data}`,
        }
      : { type: "input_image" as const, image_url: `data:${mediaType};base64,${data}`, detail: "auto" as const };

    // Thang effort của nhà OpenAI chỉ có low/medium/high. Hai mức trên của
    // Anthropic dồn xuống high thay vì để API trả lỗi 400.
    const reasoningEffort =
      effort === "xhigh" || effort === "max" ? "high" : effort;

    const response = await this.client.responses.parse({
      model: splitModel(model).id,
      instructions: system,
      input: [{ role: "user", content: [fileBlock, { type: "input_text", text: user }] }],
      max_output_tokens: 16000,
      text: { format: zodTextFormat(schema as never, "extraction") },
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    });

    const elapsedMs = Date.now() - started;

    if (response.status === "incomplete") {
      const why = response.incomplete_details?.reason ?? "không rõ lý do";
      throw new Error(
        why === "max_output_tokens"
          ? "Output bị cắt vì chạm max_output_tokens. Trang này quá nhiều câu — cắt nhỏ hoặc tăng giới hạn."
          : `Model dừng giữa chừng (${why}).`,
      );
    }
    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const c of item.content as Array<{ type: string; refusal?: string }>) {
        if (c.type === "refusal") {
          throw new Error(
            `Model từ chối xử lý: ${c.refusal ?? "không rõ lý do"}. Kiểm tra nội dung trang đầu vào.`,
          );
        }
      }
    }
    if (!response.output_parsed) {
      throw new Error("Model trả về output không khớp schema.");
    }

    const u = response.usage;
    const cacheRead = u?.input_tokens_details?.cached_tokens ?? 0;
    // Nhà OpenAI: input_tokens ĐÃ BAO GỒM phần đọc từ cache, phải trừ ra kẻo
    // tính hai lần. Nhà này cũng không tính tiền ghi cache.
    const { costUsd, costKnown } = costOf(response.model, {
      freshInput: Math.max(0, (u?.input_tokens ?? 0) - cacheRead),
      output: u?.output_tokens ?? 0,
      cacheRead,
      cacheWrite: 0,
    });

    return {
      data: response.output_parsed as T,
      usage: {
        model: response.model,
        inputTokens: u?.input_tokens ?? 0,
        outputTokens: u?.output_tokens ?? 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: 0,
        costUsd,
        costKnown,
        elapsedMs,
      },
    };
  }
}

/**
 * Bản dùng chung cho MỌI cổng nói giao thức OpenAI Chat Completions:
 * Gemini (qua cổng tương thích của Google), Stali, OpenRouter, Groq, hay một
 * cổng nội bộ nào đó. Khác nhau đúng ba thứ: URL gốc, key, tên model.
 *
 * Vì sao là chat completions chứ không phải Responses API như OpenAIProvider:
 * Responses là API riêng của OpenAI, cổng tương thích của Google KHÔNG có nó.
 * Chat completions thì cổng nào cũng nói được — đó là mẫu số chung.
 *
 * Vì sao tự parse thay vì dùng `client.chat.completions.parse()`: helper của
 * SDK trông chờ vài trường riêng của OpenAI (refusal, parsed) mà cổng thứ ba
 * hay thiếu. Tự đọc content rồi đưa qua zod thì cổng nào cũng chạy, và lỗi
 * lệch schema hiện ra ngay tại đây chứ không chui vào trong SDK.
 */
export class ChatProvider implements VisionProvider {
  readonly id: string;
  private client: OpenAI;
  private cfg: VendorConfig;

  constructor(vendor: Vendor, apiKey?: string) {
    this.cfg = VENDORS[vendor];
    this.id = vendor;
    const key = apiKey ?? process.env[this.cfg.envKey];
    if (!key) {
      throw new Error(`Thiếu ${this.cfg.envKey} trong .env — lấy key tại ${this.cfg.hint}`);
    }
    this.client = new OpenAI({ apiKey: key, baseURL: this.cfg.baseUrl });
  }

  async extract<T>({
    file,
    system,
    user,
    schema,
    model,
  }: {
    file: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    model: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
  }): Promise<ExtractResult<T>> {
    const { data, mediaType, isPdf } = await readAsBase64(file);
    if (isPdf) {
      throw new Error(
        `Cổng ${this.cfg.label} nhận ảnh, không nhận PDF thẳng qua đường này.\n` +
          `Tách PDF thành ảnh trước: pdftoppm -r 150 -png de.pdf trang`,
      );
    }

    const started = Date.now();
    const { data: res, response } = await this.client.chat.completions
      .create({
        model: splitModel(model).id,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: user },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } },
            ],
          },
        ],
        max_completion_tokens: 16000,
        response_format: zodResponseFormat(schema as never, "extraction"),
      })
      .withResponse();
    const elapsedMs = Date.now() - started;

    const choice = res.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new Error(
        "Output bị cắt vì chạm giới hạn token. Trang này quá nhiều câu — cắt nhỏ hoặc tăng max_completion_tokens.",
      );
    }
    const content = choice?.message?.content;
    if (!content) {
      throw new Error(
        `Cổng ${this.cfg.label} trả về rỗng (finish_reason=${choice?.finish_reason ?? "?"}).`,
      );
    }

    let parsed: T;
    try {
      parsed = schema.parse(JSON.parse(content));
    } catch (e) {
      throw new Error(
        `Output không khớp schema: ${(e as Error).message}\n` +
          `--- model trả về ---\n${content.slice(0, 800)}`,
      );
    }

    const u = res.usage;
    const cacheRead = u?.prompt_tokens_details?.cached_tokens ?? 0;
    // Giống nhà OpenAI: prompt_tokens ĐÃ GỒM phần cache, phải trừ kẻo tính hai lần.
    const { costUsd, costKnown, freeTier } = costOf(res.model ?? model, {
      freshInput: Math.max(0, (u?.prompt_tokens ?? 0) - cacheRead),
      output: u?.completion_tokens ?? 0,
      cacheRead,
      cacheWrite: 0,
    });

    // Stali nói thẳng chi phí thật bằng VNĐ ở header — tin số đó hơn bảng giá
    // chép tay, vì nó là số sẽ bị trừ khỏi ví.
    const vndHeader = response.headers.get("x-stali-cost-vnd");
    const costVnd = vndHeader ? Number(vndHeader) : undefined;

    return {
      data: parsed,
      usage: {
        model: response.headers.get("x-stali-model") ?? res.model ?? model,
        inputTokens: u?.prompt_tokens ?? 0,
        outputTokens: u?.completion_tokens ?? 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: 0,
        costUsd,
        costKnown,
        ...(Number.isFinite(costVnd) ? { costVnd } : {}),
        ...(freeTier ? { freeTier } : {}),
        elapsedMs,
      },
    };
  }
}

/**
 * Chọn provider theo model. `--model gemini-3.5-flash` và
 * `--verify-model claude-opus-5` tự chạy đúng hai nhà, không phải khai báo thêm.
 */
export function providerFor(model: string): VisionProvider {
  const { vendor } = splitModel(model);
  if (vendor === "anthropic") return new AnthropicProvider();
  if (vendor === "openai") return new OpenAIProvider();
  return new ChatProvider(vendor);
}

/** Tên model đã bỏ tiền tố nhà — đây mới là cái gửi lên API. */
export function modelId(model: string): string {
  return splitModel(model).id;
}

/** Biến môi trường chứa key của từng nhà — dùng để báo lỗi cho đúng chỗ. */
export function apiKeyEnvFor(model: string): string {
  return VENDORS[splitModel(model).vendor].envKey;
}

export function vendorOf(model: string): Vendor | null {
  try {
    return splitModel(model).vendor;
  } catch {
    return null;
  }
}

export function formatUsage(u: Usage, pages = 1): string {
  const vnd = u.costUsd * 26_000; // tỉ giá thô, chỉ để dễ hình dung
  const cache =
    u.cacheReadTokens || u.cacheWriteTokens
      ? `  token cache      đọc ${u.cacheReadTokens} / ghi ${u.cacheWriteTokens}`
      : null;

  const lines = [
    `  model            ${u.model}`,
    `  token vào/ra     ${u.inputTokens} / ${u.outputTokens}`,
    cache,
    `  thời gian        ${(u.elapsedMs / 1000).toFixed(1)}s`,
  ].filter(Boolean) as string[];

  // Cổng Stali trả tiền thật ở header — số này thắng mọi bảng giá chép tay.
  if (u.costVnd !== undefined) {
    lines.push(
      `  chi phí          ${Math.round(u.costVnd).toLocaleString("vi-VN")} đ  (cổng Stali báo về)`,
      `  quy ra mỗi trang ${Math.round(u.costVnd / pages).toLocaleString("vi-VN")} đ`,
    );
    return lines.join("\n");
  }

  if (u.freeTier) {
    lines.push(
      `  chi phí          0đ — đang chạy hạn mức MIỄN PHÍ của Google.`,
      `                   Đủ để thử và làm eval. Lên tài khoản trả phí thì phải`,
      `                   điền giá thật vào PRICING, không thì mọi số đều là 0 giả.`,
    );
    return lines.join("\n");
  }

  if (!u.costKnown) {
    lines.push(
      `  chi phí          KHÔNG TÍNH ĐƯỢC — "${u.model}" không có trong PRICING.`,
      `                   Thêm nó vào providers.ts trước khi lấy số này đi định giá.`,
    );
    return lines.join("\n");
  }

  lines.push(
    `  chi phí          $${u.costUsd.toFixed(4)}  (~${Math.round(vnd).toLocaleString("vi-VN")} đ)`,
    `  quy ra mỗi trang $${(u.costUsd / pages).toFixed(4)}  (~${Math.round(vnd / pages).toLocaleString("vi-VN")} đ)`,
  );
  return lines.join("\n");
}
