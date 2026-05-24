// ============================================================
// points.ts — Hằng số Point ID của cảm biến
// Khớp 1-1 với pointId mà backend gửi về.
// Khi backend đổi tên point, chỉ cần sửa tại đây.
// ============================================================

// Nhiệt độ 3 pha máy biến áp
export const PT_TEMP_1 = 'nhiet_do_pha_1';
export const PT_TEMP_2 = 'nhiet_do_pha_2';
export const PT_TEMP_3 = 'nhiet_do_pha_3';
export const PT_TEMP_ALL = [PT_TEMP_1, PT_TEMP_2, PT_TEMP_3] as const;

// Phóng điện cục bộ (Partial Discharge)
export const PT_PD = 'phong_dien';

// Camera: P1–P10 là các điểm camera trên SLD
export const PT_CAM_IDS = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10'] as const;

// Label hiển thị tương ứng với từng point nhiệt độ
export const TEMP_LABELS: Record<string, string> = {
  [PT_TEMP_1]: 'Nhiệt độ Pha 1',
  [PT_TEMP_2]: 'Nhiệt độ Pha 2',
  [PT_TEMP_3]: 'Nhiệt độ Pha 3',
  [PT_PD]:     'Phóng điện PD',
};

// Tên hiển thị cho từng điểm đo camera nhiệt (mock)
export const CAM_POINT_LABELS: Record<string, string> = {
  P1:  'Đầu cáp Pha A — Tủ 471',
  P2:  'Đầu cáp Pha B — Tủ 471',
  P3:  'Đầu cáp Pha C — Tủ 471',
  P4:  'Tiếp điểm dao cách ly 471',
  P5:  'Thanh cái 110kV',
  P6:  'Cáp lực đầu vào Pha A',
  P7:  'Cáp lực đầu vào Pha B',
  P8:  'Cáp lực đầu vào Pha C',
  P9:  'Đầu cáp Pha A — Tủ 472',
  P10: 'Đầu cáp Pha B — Tủ 472',
};
