import sqlite3
import json

db_path = "/home/admin-/stationos-main/backend/StationOS.Api/stationos.db"
# Wait, let's find where the sqlite database is.
# Let's search for *.db files.
import glob
db_files = glob.glob("/home/admin-/stationos-main/**/*.db", recursive=True)
print("Database files found:", db_files)

for dbf in db_files:
    try:
        conn = sqlite3.connect(dbf)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [r[0] for r in cursor.fetchall()]
        print(f"Tables in {dbf}:", tables)
        if "Devices" in tables:
            cursor.execute("SELECT Id, Name, Type, Config FROM Devices;")
            for row in cursor.fetchall():
                print(f"Device: {row[0]}, Name: {row[1]}, Type: {row[2]}")
                print(f"  Config: {row[3]}")
        conn.close()
    except Exception as e:
        print(f"Error reading {dbf}: {e}")
