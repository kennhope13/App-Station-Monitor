import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "PointId", "Value", "Time" 
        FROM "SensorReadings" 
        WHERE "DeviceId" = 'c0c5eadf-81d5-4936-b211-dcb62bdbd45f'
        ORDER BY "Time" DESC
        LIMIT 30;
    """)
    rows = cur.fetchall()
    print("Latest 30 readings for Device c0c5eadf-81d5-4936-b211-dcb62bdbd45f:")
    for row in rows:
        print(f"PointId: {row[0]}, Value: {row[1]}, Time: {row[2]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
