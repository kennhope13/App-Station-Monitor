import psycopg2
try:
    conn = psycopg2.connect(
        dbname='postgres',
        user='postgres',
        password='postgres123',
        host='localhost',
        port='6432'
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false;")
    dbs = cur.fetchall()
    print("Databases in the system:")
    for db in dbs:
        print(f"- {db[0]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
