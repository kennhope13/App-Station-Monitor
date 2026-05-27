# -*- coding: utf-8 -*-
"""
Modbus TCP Realtime Viewer for IP 192.168.10.100
Đọc trực tiếp dữ liệu tủ: 3 Nhiệt độ (T1, T2, T3) và 1 Phóng điện cục bộ (PD)
Không yêu cầu thư viện bên ngoài (Sử dụng Socket thuần của Python).
"""

import socket
import time
import sys
import struct

# Cấu hình kết nối
IP_ADDRESS = "192.168.10.100"
PORT = 502
UNIT_ID = 1
POLL_INTERVAL = 2  # giây

# Định nghĩa màu sắc hiển thị trong console
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'

def print_header():
    print(f"{Colors.HEADER}{Colors.BOLD}================================================================{Colors.END}")
    print(f"{Colors.CYAN}{Colors.BOLD}       HỆ THỐNG GIÁM SÁT REALTIME MODBUS TCP - IP: {IP_ADDRESS}{Colors.END}")
    print(f"{Colors.BLUE}   Đọc dữ liệu tủ: 3 Cảm biến nhiệt độ (T1, T2, T3) và 1 PD{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}================================================================{Colors.END}")
    print(f"{Colors.BOLD}{'Thời gian':<20} | {'T1 (°C)':<10} | {'T2 (°C)':<10} | {'T3 (°C)':<10} | {'PD (dB)':<10}{Colors.END}")
    print("-" * 64)

def build_modbus_request(unit_id, start_addr, count):
    # Transaction ID (2 bytes), Protocol ID (2 bytes), Length (2 bytes), Unit ID (1 byte), FC (1 byte), Addr (2 bytes), Count (2 bytes)
    return struct.pack(">HHHBBHH", 1, 0, 6, unit_id, 3, start_addr, count)

def parse_modbus_response(response_bytes):
    # Header MBAP: 7 bytes (TransID: 2, ProtoID: 2, Len: 2, UnitID: 1)
    # PDU: Function Code (1 byte), Byte Count (1 byte), Data...
    if len(response_bytes) < 9:
        return None
    
    header = struct.unpack(">HHHBB", response_bytes[:8])
    byte_count = response_bytes[8]
    data_bytes = response_bytes[9:]
    
    if len(data_bytes) < byte_count:
        return None
    
    # Giải mã dữ liệu sang list short (16-bit signed integer)
    num_registers = byte_count // 2
    registers = []
    for i in range(num_registers):
        val = struct.unpack(">h", data_bytes[i*2 : i*2+2])[0]
        registers.append(val)
    return registers

def read_realtime_data():
    # Chuẩn bị gói tin Modbus TCP đọc 14 thanh ghi liên tiếp từ địa chỉ 0
    # Đọc từ thanh ghi 0 đến 13 để lấy đủ:
    # 0: T1, 2: T3, 4: T2, 6: Độ ẩm, 8: PD
    request = build_modbus_request(UNIT_ID, 0, 14)
    
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3.0)
    
    try:
        s.connect((IP_ADDRESS, PORT))
        s.sendall(request)
        response = s.recv(1024)
        s.close()
        
        registers = parse_modbus_response(response)
        if not registers or len(registers) < 9:
            return None
            
        # Trích xuất các thanh ghi theo giả lập của StationOS
        # _registers[0]  = T1 (pha 1)
        # _registers[4]  = T2 (pha 2)
        # _registers[2]  = T3 (pha 3)
        # _registers[8]  = PD (phóng điện)
        raw_t1 = registers[0]
        raw_t3 = registers[2]
        raw_t2 = registers[4]
        raw_pd = registers[8]
        
        # Áp dụng Scale hệ số 0.1
        t1 = raw_t1 / 10.0
        t2 = raw_t2 / 10.0
        t3 = raw_t3 / 10.0
        pd = raw_pd / 10.0
        
        return t1, t2, t3, pd
    except socket.timeout:
        print(f"{Colors.FAIL}[LỖI]{Colors.END} Timeout kết nối tới {IP_ADDRESS}:{PORT}")
    except Exception as e:
        print(f"{Colors.FAIL}[LỖI]{Colors.END} Không thể kết nối hoặc đọc dữ liệu: {e}")
    finally:
        try:
            s.close()
        except:
            pass
    return None

def main():
    # Bật ANSI colors trên Windows console nếu có thể
    if sys.platform == 'win32':
        try:
            import os
            os.system('color')
        except:
            pass
            
    print_header()
    
    try:
        while True:
            now_str = time.strftime("%Y-%m-%d %H:%M:%S")
            data = read_realtime_data()
            
            if data:
                t1, t2, t3, pd = data
                
                # Cảnh báo màu đỏ/vàng nếu nhiệt độ hoặc PD cao
                t1_color = Colors.GREEN if t1 < 75 else (Colors.WARNING if t1 < 85 else Colors.FAIL)
                t2_color = Colors.GREEN if t2 < 75 else (Colors.WARNING if t2 < 85 else Colors.FAIL)
                t3_color = Colors.GREEN if t3 < 75 else (Colors.WARNING if t3 < 85 else Colors.FAIL)
                pd_color = Colors.GREEN if pd < 20 else (Colors.WARNING if pd < 35 else Colors.FAIL)
                
                print(f"{now_str} | "
                      f"{t1_color}{t1:7.1f}{Colors.END} | "
                      f"{t2_color}{t2:7.1f}{Colors.END} | "
                      f"{t3_color}{t3:7.1f}{Colors.END} | "
                      f"{pd_color}{pd:7.1f}{Colors.END}")
            else:
                print(f"{now_str} | {Colors.FAIL}{'MẤT KẾT NỐI VỚI THIẾT BỊ':^41}{Colors.END}")
                
            time.sleep(POLL_INTERVAL)
            
    except KeyboardInterrupt:
        print(f"\n{Colors.CYAN}Đã dừng chương trình giám sát.{Colors.END}")

if __name__ == "__main__":
    main()
