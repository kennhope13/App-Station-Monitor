import psycopg2
try:
    conn = psycopg2.connect(
        dbname='StationOS',
        user='postgres',
        password='postgres123',
        host='localhost',
        port='6432'
    )
    print("Connected to StationOS database successfully!")
    conn.close()
except Exception as e:
    print(f"Error: {e}")
