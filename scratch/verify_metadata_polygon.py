import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "Id", "Metadata", "AlertId"
        FROM "DetectionEvents"
        WHERE ("Metadata"->>'polygon') IS NOT NULL
        LIMIT 5;
    """)
    rows = cur.fetchall()
    print("Events with polygon in Metadata:")
    for row in rows:
        print(f"ID: {row[0]}")
        print(f"  Metadata: {row[1]}")
        print(f"  AlertId: {row[2]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
