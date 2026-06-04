import psycopg2
conn = psycopg2.connect("dbname='StationOS' user='postgres' host='localhost' password='postgres123'")
cur = conn.cursor()
cur.execute('SELECT "Config" FROM "Devices" WHERE "Type" = \'camera_pd\';')
for row in cur.fetchall():
    print(row[0])
