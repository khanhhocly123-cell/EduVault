/* Instance public beta tách biệt hoàn toàn khỏi dữ liệu local đang dùng. */
process.env.PORT = process.env.PORT || "5174";
process.env.EDUVAULT_DATA_DIR = process.env.EDUVAULT_DATA_DIR || new URL("./data-beta", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
process.env.EDUVAULT_PUBLIC_BETA = "1";
process.env.EDUVAULT_BETA_OCR_LIMIT = process.env.EDUVAULT_BETA_OCR_LIMIT || "20";
process.env.EDUVAULT_BETA_GLOBAL_OCR_LIMIT = process.env.EDUVAULT_BETA_GLOBAL_OCR_LIMIT || "60";
process.env.NODE_ENV = "production";

await import("./server.mjs");
