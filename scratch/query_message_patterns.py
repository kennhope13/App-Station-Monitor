import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "DetectionType", COUNT(*), MIN("Message"), MAX("Message")
        FROM "DetectionEvents"
        GROUP BY "DetectionType";
    """)
    rows = cur.fetchall()
    print("DetectionType stats:")
    for row in rows:
        print(f"Type: {row[0]}")
        print(f"  Count: {row[1]}")
        print(f"  Min Message: {row[2]}")
        print(f"  Max Message: {row[3]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
