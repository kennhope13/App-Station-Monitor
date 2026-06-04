import psycopg2
import json

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "Id", "Name", "Type", "Protocol", "Config"
        FROM "Devices"
        WHERE "Type" LIKE 'camera%' OR "Type" LIKE 'thermal%';
    """)
    rows = cur.fetchall()
    print("Camera devices in DB:")
    for row in rows:
        print(f"ID: {row[0]}")
        print(f"  Name: {row[1]}")
        print(f"  Type: {row[2]}")
        print(f"  Proto: {row[3]}")
        try:
            cfg = json.loads(row[4]) if row[4] else {}
            print(f"  Config: {json.dumps(cfg, indent=2)}")
        except Exception:
            print(f"  Config: {row[4]}")
        print("-" * 40)
    
    cur.execute("""
        SELECT "Id", "Name", "Type", "DeviceId"
        FROM "RoiPoints"
        LIMIT 20;
    """)
    pts = cur.fetchall()
    print("ROI Points in DB:")
    for pt in pts:
        print(f"ID: {pt[0]}, Name: {pt[1]}, Type: {pt[2]}, DeviceId: {pt[3]}")
        
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
