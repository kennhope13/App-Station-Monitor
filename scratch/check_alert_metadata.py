import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT COUNT(*), COUNT(meta."polygon")
        FROM "Alerts" a
        LEFT JOIN "DetectionEvents" e ON a."Id" = e."AlertId"
        LEFT JOIN LATERAL (
            SELECT (e."Metadata"::jsonb)->>'polygon' as polygon
        ) meta ON true;
    """)
    row = cur.fetchone()
    print(f"Total alerts: {row[0]}")
    print(f"Alerts with polygon metadata: {row[1]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
