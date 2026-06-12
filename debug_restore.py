import psycopg2
try:
    conn = psycopg2.connect(
        dbname='StationOS',
        user='postgres',
        password='postgres123',
        host='localhost',
        port='5432'
    )
    cur = conn.cursor()
    
    print("--- Alerts Sample (Latest 5) ---")
    cur.execute('SELECT "Id", "StationId", "Message", "TriggeredAt" FROM "Alerts" ORDER BY "TriggeredAt" DESC LIMIT 5')
    alerts = cur.fetchall()
    for a in alerts:
        print(f"ID: {a[0]}, StationId: {a[1]}, Time: {a[3]}, Msg: {a[2][:50]}...")
        
    print("\n--- Current Stations ---")
    cur.execute('SELECT "Id", "Name", "Code" FROM "Stations"')
    stations = cur.fetchall()
    for s in stations:
        print(f"ID: {s[0]}, Name: {s[1]}, Code: {s[2]}")
        
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
