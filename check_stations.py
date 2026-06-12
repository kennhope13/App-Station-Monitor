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
    cur.execute("SELECT \"Id\", \"Name\" FROM \"Stations\"")
    stations = cur.fetchall()
    print("Stations in StationOS_Central:")
    for s in stations:
        print(f"ID: {s[0]}, Name: {s[1]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
