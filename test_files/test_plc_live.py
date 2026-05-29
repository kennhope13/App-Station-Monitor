"""
test_plc_live.py — Đọc live data từ PLC Siemens S7-1215C
IP: 192.168.10.100 | Port 102 (S7) + Port 4840 (OPC-UA)

Chạy:  python test_plc_live.py
Dừng:  Ctrl+C

Thử theo thứ tự:
  1. S7comm (port 102) — đọc DB32 trực tiếp
  2. OPC-UA (port 4840) — browse & subscribe
"""

import asyncio
import sys
import time
from datetime import datetime

# Fix Windows terminal encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# ── Terminal colors ─────────────────────────────────────────────
RESET  = "\033[0m";  BOLD = "\033[1m"
RED    = "\033[31m"; GREEN = "\033[32m"
YELLOW = "\033[33m"; CYAN  = "\033[36m"
GRAY   = "\033[90m"; MAG   = "\033[35m"

ok   = lambda s: f"{GREEN}✔{RESET} {s}"
fail = lambda s: f"{RED}✘{RESET} {s}"
info = lambda s: f"{CYAN}→{RESET} {s}"
warn = lambda s: f"{YELLOW}⚠{RESET} {s}"
live = lambda s: f"{MAG}◉{RESET} {s}"
dim  = lambda s: f"{GRAY}{s}{RESET}"

PLC_IP   = "192.168.10.100"
PLC_RACK = 0
PLC_SLOT = 1        # S7-1200: slot=1, S7-300: slot=2
PLC_DB   = 32       # DB chứa dữ liệu đo (theo StationMonitor config)
PLC_LEN  = 10       # đọc 10 bytes

# Mapping offset → tên điểm đo (theo PlcPollingWorker.cs)
DB_MAP = {
    0: ("nhiet_do_pha_1", "°C"),
    2: ("nhiet_do_pha_2", "°C"),
    4: ("nhiet_do_pha_3", "°C"),
    8: ("phong_dien",     "dB"),
}

OPCUA_URL = f"opc.tcp://{PLC_IP}:4840"
POLL_S    = 0.5  # giây giữa mỗi lần đọc (0.5s = 2 lần/giây)

# ── Đọc Int16 big-endian (chuẩn Siemens) ───────────────────────
def read_int16(data: bytes, offset: int) -> int:
    if offset + 1 >= len(data):
        return 0
    return int.from_bytes(data[offset:offset+2], byteorder="big", signed=True)

# ══════════════════════════════════════════════════════════════
# PHƯƠNG PHÁP 1: S7comm qua python-snap7
# ══════════════════════════════════════════════════════════════
def run_s7():
    try:
        import snap7
        from snap7.util import get_int
    except ImportError:
        print(fail("python-snap7 chưa cài: pip install python-snap7"))
        return False

    print(f"\n{BOLD}── S7comm (port 102) ───────────────────────────────{RESET}")
    print(info(f"Kết nối S7 → {PLC_IP} rack={PLC_RACK} slot={PLC_SLOT}"))

    client = snap7.Client()
    try:
        client.connect(PLC_IP, PLC_RACK, PLC_SLOT)
    except Exception as e:
        print(fail(f"Kết nối thất bại: {e}"))
        print(warn("Cần bật 'Permit access with PUT/GET' trong TIA Portal"))
        return False

    if not client.get_connected():
        print(fail("Không kết nối được"))
        return False

    print(ok(f"Kết nối S7 thành công → đọc DB{PLC_DB} mỗi {POLL_S}s\n"))
    print(f"{'Thời gian':<12} {'Điểm đo':<22} {'Giá trị':>10}")
    print("─" * 50)

    try:
        while True:
            try:
                data = client.db_read(PLC_DB, 0, PLC_LEN)
                ts   = datetime.now().strftime("%H:%M:%S")
                row  = []
                for offset, (name, unit) in DB_MAP.items():
                    val = read_int16(data, offset)
                    row.append(f"{name}={BOLD}{val}{RESET}{unit}")
                    print(f"{GRAY}{ts}{RESET}  {name:<22} {BOLD}{val:>6}{RESET} {unit}")
                print()
            except Exception as e:
                ts = datetime.now().strftime("%H:%M:%S")
                print(f"{GRAY}{ts}{RESET}  {RED}Lỗi đọc: {e}{RESET}")
            time.sleep(POLL_S)
    except KeyboardInterrupt:
        print(f"\n{ok('Dừng S7.')}")
        client.disconnect()
        return True


# ══════════════════════════════════════════════════════════════
# PHƯƠNG PHÁP 2: OPC-UA qua asyncua
# ══════════════════════════════════════════════════════════════
async def run_opcua():
    try:
        from asyncua import Client, ua
        from asyncua.common.subscription import DataChangeNotif
    except ImportError:
        print(fail("asyncua chưa cài: pip install asyncua"))
        return False

    print(f"\n{BOLD}── OPC-UA (port 4840) ──────────────────────────────{RESET}")
    print(info(f"Kết nối OPC-UA → {OPCUA_URL}"))

    class DataHandler:
        def datachange_notification(self, node, val, data):
            ts  = datetime.now().strftime("%H:%M:%S")
            nid = node.nodeid.to_string()
            print(live(f"[{GRAY}{ts}{RESET}] {CYAN}{nid:<45}{RESET} = {BOLD}{val}{RESET}"))

    async with Client(url=OPCUA_URL) as client:
        print(ok("Kết nối OPC-UA thành công"))

        # Đọc thông tin thiết bị
        info_nodes = {
            "Model":    "ns=3;s=Model",
            "Firmware": "ns=3;s=SoftwareRevision",
            "Mode":     "ns=3;s=OperatingMode",
        }
        for label, nid in info_nodes.items():
            try:
                val = await client.get_node(nid).read_value()
                print(f"  {label:<12} = {BOLD}{val}{RESET}")
            except Exception:
                pass

        # Browse để tìm variable nodes có thể subscribe
        print(f"\n{info('Browse PLC_1 tìm variable...')}")
        plc_node = client.get_node("ns=3;s=PLC")
        variables = []

        async def browse_vars(node, depth=4):
            if depth == 0:
                return
            try:
                children = await node.get_children()
                for child in children:
                    cls = (await child.read_node_class()).value
                    nid = child.nodeid.to_string()
                    if cls == 2:  # Variable
                        try:
                            val = await child.read_value()
                            if val is not None:
                                variables.append(child)
                                name = (await child.read_browse_name()).Name
                                print(f"  📊 {CYAN}{nid:<40}{RESET} {name} = {val}")
                        except Exception:
                            pass
                    elif cls == 1:  # Object
                        await browse_vars(child, depth - 1)
            except Exception:
                pass

        await browse_vars(plc_node)

        if not variables:
            print(warn("Không tìm thấy variable nào có giá trị."))
            print(warn("PLC chưa expose Data Block qua OPC-UA."))
            print(info("Vào TIA Portal → PLC_1 → OPC UA → Server Interface → expose DB cần dùng"))
            print(info("Hiện tại chỉ có metadata, subscribe metadata để test realtime..."))
            # Subscribe metadata như OperatingMode để test kết nối realtime
            mode_node = client.get_node("ns=3;s=OperatingMode")
            variables = [mode_node]

        # Subscribe realtime
        print(f"\n{BOLD}Subscribe realtime {POLL_S}s — Ctrl+C để dừng{RESET}")
        print(f"{'─'*60}")

        handler = DataHandler()
        sub = await client.create_subscription(POLL_S * 1000, handler)
        handles = await sub.subscribe_data_change(variables)

        try:
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            print(f"\n{ok('Dừng OPC-UA.')}")
            await sub.unsubscribe(handles)
            await sub.delete()

    return True


# ══════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════
async def main():
    print(f"\n{BOLD}{'='*52}{RESET}")
    print(f"{BOLD}  LIVE DATA -- PLC {PLC_IP}{RESET}")
    print(f"{BOLD}{'='*52}{RESET}")
    print(f"  {dim('S7-1215C AC/DC/Rly | DB32 | OPC-UA ns=3;s=PLC')}\n")

    # Thử S7 trước (đọc được nhiều hơn)
    success = run_s7()
    if success:
        return

    # Fallback: OPC-UA
    print(info("S7 không kết nối được → chuyển sang OPC-UA..."))
    await run_opcua()


if __name__ == "__main__":
    asyncio.run(main())
