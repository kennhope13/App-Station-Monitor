// src/services/pdApi.ts
// Kết nối với BoundariesController backend
// Route: /api/v1/devices/{deviceId}/boundaries
// Polygon format: JSON string "[[x,y],[x,y],...]"

export interface Boundary {
  id: string;
  deviceId: string;
  name: string;
  // Backend trả về Polygon (JSON string), ta parse thành vertices
  vertices: { x: number; y: number }[];
  warningThreshold?: number;
  alarmThreshold?: number;
  type?: string;
  enabled?: boolean;
}

const getHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('station_token') ?? ''}`,
});

const BASE = '/api/v1';
const AI_ENGINE = import.meta.env.VITE_AI_ENGINE_URL ?? 'http://localhost:8100';

// Chuyển [[x,y],...] → [{x,y},...] (tọa độ 0-1 → 0-100)
function parsePolygon(polygonJson: string): { x: number; y: number }[] {
  try {
    const arr = JSON.parse(polygonJson) as [number, number][];
    return arr.map(([x, y]) => ({ x: x * 100, y: y * 100 }));
  } catch {
    return [];
  }
}

// Chuyển [{x,y},...] 0-100 → [[x,y],...] 0-1 JSON string
function serializePolygon(vertices: { x: number; y: number }[]): string {
  return JSON.stringify(vertices.map(v => [v.x / 100, v.y / 100]));
}

// Parse thresholds JSON string từ backend
function parseThresholds(thresholdsJson?: string | null): { warn: number; alarm: number } {
  try {
    if (!thresholdsJson) return { warn: 20, alarm: 45 };
    const t = JSON.parse(thresholdsJson);
    return { warn: t.warn ?? t.warning ?? 20, alarm: t.alarm ?? 45 };
  } catch {
    return { warn: 20, alarm: 45 };
  }
}

// Parse raw boundary từ backend → Boundary interface
function parseBoundary(raw: any): Boundary {
  const { warn, alarm } = parseThresholds(raw.Thresholds ?? raw.thresholds);
  return {
    id: raw.Id ?? raw.id,
    deviceId: raw.DeviceId ?? raw.deviceId,
    name: raw.Name ?? raw.name,
    type: raw.Type ?? raw.type,
    enabled: raw.Enabled ?? raw.enabled ?? true,
    vertices: parsePolygon(raw.Polygon ?? raw.polygon ?? '[]'),
    warningThreshold: warn,
    alarmThreshold: alarm,
  };
}

/** Thông báo AI Engine reload vùng PD — fire-and-forget */
const notifyAiEngine = async (deviceId: string): Promise<void> => {
  try {
    await fetch(`${AI_ENGINE}/config/pd-regions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, stream_id: deviceId }),
    });
  } catch { /* AI Engine chưa chạy → bỏ qua */ }
};

/** GET /api/v1/devices/:id/boundaries?type=pd */
export const getPdBoundaries = async (deviceId: string): Promise<{ data: Boundary[] }> => {
  const res = await fetch(`${BASE}/devices/${deviceId}/boundaries?type=pd`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`getPdBoundaries: ${res.status}`);
  const raw: any[] = await res.json();
  return { data: raw.map(parseBoundary) };
};

/** POST /api/v1/devices/:id/boundaries */
export const createPdBoundary = async (
  deviceId: string,
  payload: { name: string; vertices: { x: number; y: number }[]; warningThreshold?: number; alarmThreshold?: number },
  _streamId?: string,
): Promise<Boundary> => {
  const body = {
    Name: payload.name,
    Type: 'pd',
    Polygon: serializePolygon(payload.vertices),
    Thresholds: JSON.stringify({ warn: payload.warningThreshold ?? 20, alarm: payload.alarmThreshold ?? 45 }),
    SeverityLevel: 'warning',
    Enabled: true,
  };
  const res = await fetch(`${BASE}/devices/${deviceId}/boundaries`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => String(res.status));
    throw new Error(`createPdBoundary ${res.status}: ${err}`);
  }
  const result = parseBoundary(await res.json());
  notifyAiEngine(deviceId);
  return result;
};

/** PUT /api/v1/boundaries/:id */
export const updatePdBoundary = async (
  _deviceId: string,
  boundaryId: string,
  payload: Partial<{ name: string; vertices: { x: number; y: number }[]; warningThreshold: number; alarmThreshold: number }>,
): Promise<Boundary> => {
  const body: any = {};
  if (payload.name) body.Name = payload.name;
  if (payload.vertices) body.Polygon = serializePolygon(payload.vertices);
  if (payload.warningThreshold !== undefined || payload.alarmThreshold !== undefined) {
    body.Thresholds = JSON.stringify({ warn: payload.warningThreshold ?? 20, alarm: payload.alarmThreshold ?? 45 });
  }
  const res = await fetch(`${BASE}/boundaries/${boundaryId}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`updatePdBoundary: ${res.status}`);
  const result = parseBoundary(await res.json());
  notifyAiEngine(_deviceId);
  return result;
};

/** DELETE /api/v1/boundaries/:id */
export const deletePdBoundary = async (
  deviceId: string,
  boundaryId: string,
  _streamId?: string,
): Promise<void> => {
  const res = await fetch(`${BASE}/boundaries/${boundaryId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`deletePdBoundary: ${res.status}`);
  notifyAiEngine(deviceId);
};
