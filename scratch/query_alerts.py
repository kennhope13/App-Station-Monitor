import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "Id", "Message", "Level", "TriggeredAt", "Status", "ImageUrl", "VideoUrl", "ThumbnailUrl"
        FROM "Alerts"
        ORDER BY "TriggeredAt" DESC
        LIMIT 20;
    """)
    rows = cur.fetchall()
    print(f"Latest 20 alerts in database:")
    for row in rows:
        print(f"ID: {row[0]}")
        print(f"  Msg: {row[1]}")
        print(f"  Lvl: {row[2]}")
        print(f"  Time: {row[3]}")
        print(f"  Status: {row[4]}")
        print(f"  Img: {row[5]}")
        print(f"  Vid: {row[6]}")
        print(f"  Thumb: {row[7]}")
        print("-" * 40)
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
