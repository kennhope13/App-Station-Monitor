import psycopg2
import json

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "Id", "Name", "Type", "Config"
        FROM "Devices"
        WHERE "Type" LIKE 'camera%';
    """)
    rows = cur.fetchall()
    print("Camera configs in DB:")
    for row in rows:
        print(f"ID: {row[0]}")
        print(f"  Name: {row[1]}")
        print(f"  Type: {row[2]}")
        print(f"  Config: {json.dumps(row[3], indent=2) if isinstance(row[3], dict) else row[3]}")
        print("-" * 40)
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
