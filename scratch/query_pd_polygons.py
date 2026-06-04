import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "Id", "Name", "PolygonJson"
        FROM "Boundaries"
        WHERE "DeviceId" = '4f7fb8c5-75ad-49f5-9b25-529e7fb2a2b2';
    """)
    rows = cur.fetchall()
    print("PD Boundaries Polygons:")
    for row in rows:
        print(f"ID: {row[0]}")
        print(f"  Name: {row[1]}")
        print(f"  PolygonJson: {row[2]}")
        print("-" * 40)
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
