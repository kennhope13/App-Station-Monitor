import psycopg2
import json

try:
    conn = psycopg2.connect(
        host="localhost",
        port=5432,
        database="StationOS",
        user="postgres",
        password="postgres123"
    )
    cur = conn.cursor()
    cur.execute('SELECT "Id", "Name", "Type", "Config" FROM "Devices";')
    rows = cur.fetchall()
    print(f"Found {len(rows)} devices:")
    for r in rows:
        print("----------------------------------------")
        print(f"ID: {r[0]}")
        print(f"Name: {r[1]}")
        print(f"Type: {r[2]}")
        try:
            cfg = json.loads(r[3]) if isinstance(r[3], str) else r[3]
            print(f"Config: {json.dumps(cfg, indent=2, ensure_ascii=False)}")
        except Exception as e:
            print(f"Config (Raw): {r[3]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error querying database: {e}")
