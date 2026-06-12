import sqlite3
try:
    conn = sqlite3.connect('backend/StationOS.Api/station.db')
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cur.fetchall()
    print("Tables in station.db (SQLite):")
    for table in tables:
        print(f"- {table[0]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
