import psycopg2
try:
    conn = psycopg2.connect(
        dbname='StationOS_Central',
        user='postgres',
        password='postgres123',
        host='localhost',
        port='6432'
    )
    cur = conn.cursor()
    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
    """)
    tables = cur.fetchall()
    print("Tables in StationOS_Central:")
    for table in tables:
        print(f"- {table[0]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
