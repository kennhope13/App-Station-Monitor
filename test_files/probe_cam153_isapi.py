"""
probe_cam153_isapi.py — Quét endpoint ISAPI ẩn của camera 153
DS-QAAI264G1-P | 192.168.10.153

Chỉ GET (read-only) — KHÔNG sửa config camera.
In ra endpoint nào trả 200, status code, content-type, size, và preview JSON.

Chạy: python probe_cam153_isapi.py
"""

import sys, requests, json
from requests.auth import HTTPDigestAuth
from concurrent.futures import ThreadPoolExecutor, as_completed

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

CAM_IP   = "192.168.10.153"
CAM_AUTH = HTTPDigestAuth("admin", "Demo@2024")
BASE     = f"http://{CAM_IP}"
TIMEOUT  = 5

# Màu terminal
G="\033[32m"; Y="\033[33m"; R="\033[31m"; C="\033[36m"; GRY="\033[90m"; B="\033[1m"; X="\033[0m"

# ── Danh sách endpoint cần thử ──────────────────────────────────────────
# Pattern: từ nhánh AcousticLeakDetection đã biết, suy ra các resource cùng namespace
PATHS = [
    # === Đã xác nhận có (làm baseline) ===
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/AcousticImageOverlayParams",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/AcousticImageOverlayParams/capabilities",

    # === Khám phá namespace AcousticLeakDetection ===
    "/ISAPI/System/AcousticLeakDetection",
    "/ISAPI/System/AcousticLeakDetection/capabilities",
    "/ISAPI/System/AcousticLeakDetection/AudioIn",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/capabilities",

    # === Realtime data (mục tiêu chính) ===
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/RealTimeData",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/realtimeData",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/RealTimeStatus",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/Status",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/status",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/CurrentData",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/LiveData",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/Measurement",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/Decibel",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/DecibelInfo",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/Frequency",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/FrequencyInfo",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/SoundSource",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/SoundSourceLocation",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/SoundSourceInfo",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/AudioLevel",

    # === Config / params trong cùng namespace ===
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/FilterParams",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/FilterParams/capabilities",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/ModeParams",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/ModeParams/capabilities",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/Mode",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/PartialDischarge",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/PartialDischargeParams",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/GasLeakage",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/GasLeakageParams",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/General",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/GeneralParams",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/PRPD",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/PRPDSpectrum",
    "/ISAPI/System/AcousticLeakDetection/AudioIn/1/Spectrum",

    # === Audio detection (đã có trong PDF, kiểm tra để chắc) ===
    "/ISAPI/System/Audio/channels/1/audioDetection",
    "/ISAPI/System/Audio/channels/1/audioDetection/capabilities",
    "/ISAPI/Smart/AudioDetection/1",
    "/ISAPI/Smart/AudioDetection/1/capabilities",
    "/ISAPI/Smart/AudioDetection/channels/1",

    # === Streaming (đôi khi có metadata stream) ===
    "/ISAPI/Streaming/channels/1/capabilities",
    "/ISAPI/Streaming/channels/1",
    "/ISAPI/Streaming/channels/101",
    "/ISAPI/Streaming/MetadataChannels/1",
    "/ISAPI/Streaming/MetadataChannels",

    # === Event ===
    "/ISAPI/Event/notification/capabilities",
    "/ISAPI/Event/triggers",
    "/ISAPI/Event/triggers/capabilities",
    "/ISAPI/Event/notification/alertStream/capabilities",

    # === System capabilities (rất hay có manifest tất cả endpoint) ===
    "/ISAPI/System/capabilities",
    "/ISAPI/System/deviceInfo",
    "/ISAPI/System/Audio/capabilities",
    "/ISAPI/Image/channels/1/capabilities",
    "/ISAPI/Smart/capabilities",
]

def probe(path):
    url = BASE + path + "?format=json"
    try:
        r = requests.get(url, auth=CAM_AUTH, timeout=TIMEOUT)
        return (path, r.status_code, r.headers.get("Content-Type", "?"), len(r.content), r.text)
    except Exception as e:
        return (path, -1, str(e), 0, "")

def short(s, n=200):
    s = s.replace("\n", " ").replace("\t", " ")
    while "  " in s: s = s.replace("  ", " ")
    return s[:n] + ("…" if len(s) > n else "")

def main():
    print(f"\n{B}{'='*72}{X}")
    print(f"{B}  PROBE ISAPI — CAMERA 153 (DS-QAAI264G1-P){X}")
    print(f"{B}  {len(PATHS)} endpoints, GET only, timeout={TIMEOUT}s{X}")
    print(f"{B}{'='*72}{X}\n")

    hits, misses = [], []

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(probe, p): p for p in PATHS}
        for fut in as_completed(futures):
            path, status, ctype, size, body = fut.result()
            if status == 200:
                hits.append((path, status, ctype, size, body))
                print(f"{G}✔ 200{X}  {C}{path}{X}  {GRY}({size}B, {ctype.split(';')[0]}){X}")
            elif status in (401, 403):
                print(f"{Y}△ {status}{X}  {path}  {GRY}auth issue{X}")
                misses.append((path, status))
            elif status == 404:
                misses.append((path, status))
            elif status == -1:
                print(f"{R}✗ ERR{X}  {path}  {GRY}{ctype}{X}")
                misses.append((path, status))
            else:
                print(f"{Y}? {status}{X}  {path}")
                misses.append((path, status))

    # ── In chi tiết các hit ───────────────────────────────────────────
    print(f"\n{B}{'='*72}{X}")
    print(f"{B}  KẾT QUẢ: {len(hits)} HIT / {len(PATHS)} endpoint{X}")
    print(f"{B}{'='*72}{X}\n")

    for path, status, ctype, size, body in sorted(hits):
        print(f"{B}{G}── {path}{X}")
        print(f"  {GRY}{ctype} | {size}B{X}")
        # Cố parse JSON cho đẹp
        try:
            j = json.loads(body)
            preview = json.dumps(j, indent=2, ensure_ascii=False)
            # Cắt nếu quá dài
            lines = preview.split("\n")
            if len(lines) > 25:
                preview = "\n".join(lines[:25]) + f"\n  {GRY}... ({len(lines)-25} dòng nữa){X}"
            print(preview)
        except Exception:
            print(f"  {short(body, 400)}")
        print()

    # Tổng kết 404
    n404 = sum(1 for _, s in misses if s == 404)
    print(f"{GRY}404 (không tồn tại): {n404}  |  Lỗi khác: {len(misses)-n404}{X}\n")

if __name__ == "__main__":
    main()
