import psycopg2
conn = psycopg2.connect("dbname='StationOS' user='postgres' host='localhost' password='postgres123'")
cur = conn.cursor()
cur.execute('SELECT "Id", "Name", "Type", "Config" FROM "Devices";')
for row in cur.fetchall():
    print(f"ID: {row[0]} | Name: {row[1]} | Type: {row[2]} | Config: {row[3]}")
