import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT "Id", "Name", "Condition", "Enabled"
        FROM "Rules";
    """)
    rows = cur.fetchall()
    print("Rules:")
    for row in rows:
        print(f"ID: {row[0]}")
        print(f"  Name: {row[1]}")
        print(f"  Condition: {row[2]}")
        print(f"  Enabled: {row[3]}")
        print("-" * 40)
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
