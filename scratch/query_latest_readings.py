import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "PointId", "Value", "Time"
        FROM "SensorReadings"
        WHERE "DeviceId" = '4f7fb8c5-75ad-49f5-9b25-529e7fb2a2b2'
        ORDER BY "Time" DESC
        LIMIT 20;
    """)
    rows = cur.fetchall()
    print("Latest Readings:")
    for row in rows:
        print(f"Point: {row[0]}, Value: {row[1]}, Time: {row[2]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
