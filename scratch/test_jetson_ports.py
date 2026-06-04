import socket
import sys

ip = "192.168.10.104"
ports = [80, 5000, 8000, 8080, 8100, 8105, 1984]

print(f"Probing {ip}...")
for port in ports:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(1.0)
    result = s.connect_ex((ip, port))
    if result == 0:
        print(f"Port {port} is OPEN")
    else:
        print(f"Port {port} is CLOSED")
    s.close()
