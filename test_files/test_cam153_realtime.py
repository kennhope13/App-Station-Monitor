"""
test_cam153_realtime.py — Live data từ Camera Acoustic Imaging 153
DS-QAAI264G1-P | 192.168.10.153 | admin/Demo@2024

Đo được:
  - dB   : cường độ tín hiệu PD (audioDecibel)
  - Hz   : tần số chủ đạo (frequency)
  - Vị trí: nguồn âm trên ảnh (SoundSourceLocation)
  - Ảnh  : snapshot có acoustic overlay mỗi N giây

Chạy: python test_cam153_realtime.py
Dừng: Ctrl+C
"""

import sys, requests, time, threading, os, re
from requests.auth import HTTPDigestAuth
from datetime import datetime

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# ── Config ─────────────────────────────────────────────────────────
CAM_IP   = "192.168.10.153"
CAM_AUTH = HTTPDigestAuth("admin", "Demo@2024")
SNAP_DIR = os.path.join(os.path.dirname(__file__), "cam153_snapshots")
SNAP_INTERVAL = 10   # giây giữa mỗi lần lưu snapshot
os.makedirs(SNAP_DIR, exist_ok=True)

# ── Colors ─────────────────────────────────────────────────────────
R="\033[0m"; BOLD="\033[1m"
RED="\033[31m"; GRN="\033[32m"; YEL="\033[33m"; CYN="\033[36m"; MAG="\033[35m"; GRY="\033[90m"

# ── State ──────────────────────────────────────────────────────────
latest = {"db": None, "hz": None, "location": False, "ts": None}
stats  = {"db_vals": [], "hz_vals": [], "count": 0, "alerts": 0}

# Ngưỡng cảnh báo cho 110kV ngoài trời (tham khảo IEC 60270)
THRESH_DB_WARN  = 45.0   # dB — cảnh báo
THRESH_DB_ALARM = 55.0   # dB — báo động
THRESH_HZ_PD    = 2000   # Hz — trên 2kHz nghi PD cao

def alert_level(db):
    if db is None: return GRY, "—"
    if db >= THRESH_DB_ALARM: return RED + BOLD, "⚠ ALARM"
    if db >= THRESH_DB_WARN:  return YEL, "△ WARN"
    return GRN, "✔ OK"

def extract_tag(xml_str, tag):
    m = re.search(rf'<{tag}>(.*?)</{tag}>', xml_str, re.DOTALL)
    return m.group(1).strip() if m else None

# ── Snapshot thread ────────────────────────────────────────────────
def snapshot_loop():
    while True:
        time.sleep(SNAP_INTERVAL)
        try:
            r = requests.get(
                f"http://{CAM_IP}/ISAPI/Streaming/channels/1/picture",
                auth=CAM_AUTH, timeout=8
            )
            if r.status_code == 200:
                ts = datetime.now().strftime("%H%M%S")
                db_str = f"{latest['db']:.1f}dB" if latest['db'] else "nodb"
                fname = os.path.join(SNAP_DIR, f"snap_{ts}_{db_str}.jpg")
                with open(fname, "wb") as f:
                    f.write(r.content)
                print(f"\n{GRY}[{datetime.now().strftime('%H:%M:%S')}]{R} 📷 Snapshot → {os.path.basename(fname)}")
        except Exception as e:
            print(f"\n{GRY}Snapshot error: {e}{R}")

# ── Main event loop ────────────────────────────────────────────────
def main():
    print(f"\n{BOLD}{'='*62}{R}")
    print(f"{BOLD}  CAMERA 153 — DS-QAAI264G1-P  Acoustic Imaging / PD Detector{R}")
    print(f"{BOLD}  IP: {CAM_IP}  |  Snapshot mỗi {SNAP_INTERVAL}s vào {SNAP_DIR}{R}")
    print(f"{BOLD}{'='*62}{R}")
    print(f"  {GRY}Tần số quét: 25.53kHz – 49.53kHz (siêu âm phóng điện){R}")
    print(f"  {YEL}Ngưỡng WARN: ≥{THRESH_DB_WARN}dB  |  ALARM: ≥{THRESH_DB_ALARM}dB{R}")
    print(f"{BOLD}{'='*62}{R}\n")
    print(f"  {'Thời gian':<10} {'dB':>8}  {'Hz':>8}  {'Vị trí':^10}  {'Trạng thái'}")
    print(f"  {'─'*58}")

    threading.Thread(target=snapshot_loop, daemon=True).start()

    url = f"http://{CAM_IP}/ISAPI/Event/notification/alertStream"
    buf = b""

    while True:
        try:
            r = requests.get(url, auth=CAM_AUTH, timeout=60, stream=True)
            for chunk in r.iter_content(chunk_size=512):
                if not chunk:
                    continue
                buf += chunk
                while b"</EventNotificationAlert>" in buf:
                    end = buf.find(b"</EventNotificationAlert>") + len(b"</EventNotificationAlert>")
                    block = buf[:end]
                    buf = buf[end:]
                    xs = block.find(b"<EventNotification")
                    if xs < 0:
                        continue
                    xml_str = block[xs:].decode(errors="replace")
                    alarm_type = extract_tag(xml_str, "alarmType")
                    event_type = extract_tag(xml_str, "eventType")
                    ts = datetime.now().strftime("%H:%M:%S")
                    stats["count"] += 1

                    if alarm_type == "audioDecibel":
                        val = extract_tag(xml_str, "audioDecibel")
                        if val:
                            db = float(val)
                            latest["db"] = db
                            latest["ts"] = ts
                            stats["db_vals"].append(db)
                            color, status = alert_level(db)
                            if db >= THRESH_DB_WARN:
                                stats["alerts"] += 1
                            hz_str = f"{latest['hz']:.0f}" if latest['hz'] else "─"
                            loc_str = "📍 YES" if latest["location"] else "─"
                            print(f"  {GRY}{ts}{R}  {color}{db:>7.2f}dB{R}  {CYN}{hz_str:>7}Hz{R}  {loc_str:^10}  {color}{status}{R}")

                    elif alarm_type == "frequency":
                        val = extract_tag(xml_str, "frequency")
                        if val:
                            hz = float(val)
                            latest["hz"] = hz
                            pd_flag = f" {MAG}← PD?{R}" if hz >= THRESH_HZ_PD else ""
                            # in inline nhỏ gọn
                            print(f"  {GRY}{ts}{R}  {'':>8}   {MAG}{hz:>7.0f}Hz{R}{pd_flag}")

                    elif alarm_type == "SoundSourceLocation":
                        latest["location"] = True
                        state = extract_tag(xml_str, "eventState") or ""
                        print(f"  {GRY}{ts}{R}  {'':>8}   {'':>8}   {YEL}📍 {state.upper()}{R}")

                    elif event_type == "videoloss":
                        state = extract_tag(xml_str, "eventState") or ""
                        if state == "active":
                            print(f"\n  {RED}[{ts}] ⚠ Camera mất tín hiệu!{R}\n")

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"\n{YEL}[{datetime.now().strftime('%H:%M:%S')}] Reconnecting... ({e}){R}")
            time.sleep(3)

    # Summary
    print(f"\n{BOLD}{'='*62}{R}")
    print(f"{BOLD}  KẾT QUẢ PHIÊN ĐO{R}")
    print(f"{BOLD}{'='*62}{R}")
    if stats["db_vals"]:
        print(f"  Tổng events   : {stats['count']}")
        print(f"  Số cảnh báo   : {RED}{stats['alerts']}{R}")
        print(f"  dB min/max/avg: {min(stats['db_vals']):.2f} / {max(stats['db_vals']):.2f} / {sum(stats['db_vals'])/len(stats['db_vals']):.2f}")
    if stats["hz_vals"]:
        print(f"  Hz min/max    : {min(stats['hz_vals']):.0f} / {max(stats['hz_vals']):.0f}")
    print()

if __name__ == "__main__":
    main()
