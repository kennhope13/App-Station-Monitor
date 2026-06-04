import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "Id", "Name", "Tx", "Ty", "DeviceId"
        FROM "RoiPoints";
    """)
    rows = cur.fetchall()
    print("ROI Points in DB:")
    for row in rows:
        print(f"ID: {row[0]}")
        print(f"  Name: {row[1]}")
        print(f"  Coords: ({row[2]}, {row[3]})")
        print(f"  DeviceId: {row[4]}")
        print("-" * 40)
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
