import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "Id", "DetectionType", "DetectedAt", "Metadata"
        FROM "DetectionEvents"
        ORDER BY "DetectedAt" DESC
        LIMIT 5;
    """)
    rows = cur.fetchall()
    print("Latest detection events in DB:")
    for row in rows:
        print(f"ID: {row[0]}")
        print(f"  Type: {row[1]}")
        print(f"  DetectedAt: {row[2]}")
        print(f"  Metadata: {row[3]}")
        print("-" * 40)
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
