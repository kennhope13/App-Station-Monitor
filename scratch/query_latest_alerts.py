import pg8000

conn = pg8000.connect(host="localhost", port=5432, database="StationOS", user="postgres", password="postgres123")
cursor = conn.cursor()

cursor.execute('SELECT "Id", "DeviceId", "Message", "Level", "Status", "TriggeredAt" FROM "Alerts" ORDER BY "TriggeredAt" DESC LIMIT 5;')
rows = cursor.fetchall()
for row in rows:
    print(f"Id: {row[0]}, DeviceId: {row[1]}, Message: {row[2]}, Level: {row[3]}, Status: {row[4]}, TriggeredAt: {row[5]}")

cursor.close()
conn.close()
