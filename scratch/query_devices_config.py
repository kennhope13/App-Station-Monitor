import psycopg2, json
conn = psycopg2.connect("dbname='StationOS' user='postgres' host='localhost' password='postgres123'")
cur = conn.cursor()
cur.execute('SELECT "Id", "Name", "Type", "Config" FROM "Devices";')
for row in cur.fetchall():
    print(f"ID: {row[0]}, Name: {row[1]}, Type: {row[2]}")
    try:
        # Decrypt config? Or is it decrypted or stored as plain json in database?
        # Wait, the code says: `_crypto.DecryptPasswordInConfigJson(cam.Config)`
        # Let's print the Config directly, maybe password is encrypted but keys are plain.
        print(f"Config: {row[3][:300]}")
    except:
        pass
