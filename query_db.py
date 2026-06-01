import psycopg2
conn = psycopg2.connect("dbname='postgres123' user='postgres' host='localhost' password='password'")
cur = conn.cursor()
cur.execute("SELECT \"Config\" FROM \"Devices\" WHERE \"Config\" LIKE '%192.168.10.120%';")
for row in cur.fetchall():
    print(row[0])
