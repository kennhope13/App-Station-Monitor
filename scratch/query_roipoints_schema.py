import psycopg2

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'RoiPoints';
    """)
    rows = cur.fetchall()
    for row in rows:
        print(f"Col: {row[0]}, Type: {row[1]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
