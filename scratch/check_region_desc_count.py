import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT COUNT(*)
        FROM "DetectionEvents"
        WHERE ("Metadata"->>'description') LIKE '%vung "%' OR ("Metadata"->>'description') LIKE '%vùng "%';
    """)
    row = cur.fetchone()
    print(f"Events with region name in description: {row[0]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
