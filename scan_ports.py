import psycopg2
ports = ['5432', '6432', '5433']
for port in ports:
    try:
        conn = psycopg2.connect(
            dbname='postgres',
            user='postgres',
            password='postgres123',
            host='localhost',
            port=port,
            connect_timeout=2
        )
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false;")
        dbs = cur.fetchall()
        print(f"Port {port} - Databases:")
        for db in dbs:
            print(f"  - {db[0]}")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Port {port} - Error: {e}")
