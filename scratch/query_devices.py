import psycopg2
import json

conn = psycopg2.connect("host=localhost port=5432 dbname=StationOS user=postgres password=postgres123")
cur = conn.cursor()

cur.execute("SELECT "Id", "Name", "Type", "Subtype", "Config" FROM \"Devices\"")
devices = cur.fetchall()

print("--- Devices ---")
for d in devices:
    print(f"ID: {d[0]}, Name: {d[1]}, Type: {d[2]}, SubType: {d[3]}")
    print(f"Config: {d[4]}")
    print()

cur.execute("SELECT "Id", "DeviceId", "Label", "Type", "X", "Y", "Polygon", "Alarm", "PreAlarm" FROM \"ThermalPoints\"")
points = cur.fetchall()
print("--- ThermalPoints ---")
for p in points:
    print(f"ID: {p[0]}, DeviceID: {p[1]}, Label: {p[2]}, Type: {p[3]}, X: {p[4]}, Y: {p[5]}, Polygon: {p[6]}, Alarm: {p[7]}, PreAlarm: {p[8]}")
    print()

cur.close()
conn.close()
