/**
 * Bảng chuyên đề DUY NHẤT của cả dự án.
 *
 * Trước đây prompt trích xuất và web/data.js mỗi bên tự giữ một danh sách riêng
 * và hai bên đã lệch nhau: prompt có p10.momentum, p10.circular, p10.solid,
 * p11.current mà app không có mã nào trong bốn cái đó. Model gán mã hợp lệ theo
 * prompt xong app không hiểu, câu rơi vào chuyên đề rỗng.
 *
 * Sửa ở đây thì sửa luôn `web/data.js` mục TOPICS — hai file phải khớp từng mã.
 */

export type Subject = "physics" | "math";

export const SUBJECT_NAMES: Record<Subject, string> = {
  physics: "Vật lí",
  math: "Toán",
};

export const TOPICS: Record<Subject, Record<string, string>> = {
  physics: {
    "p10.kinematics": "Động học",
    "p10.dynamics": "Động lực học",
    "p10.energy": "Năng lượng",
    "p10.momentum": "Động lượng",
    "p10.circular": "Chuyển động tròn",
    "p10.solid": "Biến dạng vật rắn",
    "p11.oscillation": "Dao động",
    "p11.wave": "Sóng",
    "p11.efield": "Điện trường",
    "p11.current": "Dòng điện, mạch điện",
    "p12.thermal": "Vật lí nhiệt",
    "p12.gas": "Khí lí tưởng",
    "p12.magnetic": "Từ trường",
    "p12.nuclear": "Hạt nhân",
  },
  math: {
    "m10.vector": "Vectơ",
    "m10.set": "Mệnh đề, tập hợp",
    "m11.sequence": "Dãy số, cấp số",
    "m11.space": "Quan hệ vuông góc",
    "m11.limit": "Giới hạn, hàm số liên tục",
    "m12.derivative": "Khảo sát hàm số",
    "m12.integral": "Nguyên hàm, tích phân",
    "m12.oxyz": "Toạ độ Oxyz",
    "m12.stats": "Thống kê",
    "m12.prob": "Xác suất có điều kiện",
  },
};

/** Suy môn từ mã: p… = Vật lí, m… = Toán. Khỏi lặp dữ liệu ở hai chỗ. */
export const subjectOfTopic = (code: string): Subject => (code.startsWith("m") ? "math" : "physics");

export const isKnownTopic = (code: string): boolean => code in TOPICS[subjectOfTopic(code)];

/** Danh sách mã trải phẳng để nhét vào prompt. */
export function topicCodeList(subject: Subject): string {
  return Object.entries(TOPICS[subject])
    .map(([code, name]) => `${code} (${name})`)
    .join(", ");
}
