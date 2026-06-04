import psycopg2
import time

conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
cur = conn.cursor()

# Get the count of alerts before waiting
cur.execute('SELECT COUNT(*) FROM "Alerts";')
initial_count = cur.fetchone()[0]
print(f"Initial alert count: {initial_count}")

print("Waiting 10 seconds for any new alerts...")
time.sleep(10)

cur.execute('SELECT COUNT(*) FROM "Alerts";')
final_count = cur.fetchone()[0]
print(f"Final alert count: {final_count}")

if final_count > initial_count:
    print(f"Detected {final_count - initial_count} new alerts!")
    cur.execute('SELECT "Id", "Message", "Level", "TriggeredAt" FROM "Alerts" ORDER BY "TriggeredAt" DESC LIMIT %s;', (final_count - initial_count,))
    for row in cur.fetchall():
        print(f"  New Alert: ID={row[0]} Msg='{row[1]}' Level={row[2]} Time={row[3]}")
else:
    print("No new alerts triggered.")

cur.close()
conn.close()
