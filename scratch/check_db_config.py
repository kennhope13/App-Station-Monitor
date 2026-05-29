import psycopg2
import json

try:
    conn = psycopg2.connect("host=localhost port=5432 dbname=StationOS user=postgres password=postgres123")
    cur = conn.cursor()
    cur.execute('SELECT "Config" FROM "Devices" WHERE "Id" = \'4f7fb8c5-75ad-49f5-9b25-529e7fb2a2b2\';')
    row = cur.fetchone()
    if row:
        print("Raw Config in DB:", row[0])
    else:
        print("Device not found")
    cur.close()
    conn.close()
except Exception as e:
    print("Error connecting/querying DB:", e)
