import psycopg2
import psycopg2.extras
import uuid

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    psycopg2.extras.register_uuid()
    cur = conn.cursor()
    
    # Select IDs
    cur.execute("SELECT \"Id\", \"Message\" FROM \"Alerts\" WHERE \"Source\" = 'storage_monitor' AND \"Message\" LIKE '%/snap%';")
    rows = cur.fetchall()
    
    if not rows:
        print("No snap alerts found in Alerts table.")
    else:
        # Check type of first element to see if it's already a UUID or string
        first_id = rows[0][0]
        print(f"Type of ID from DB: {type(first_id)}")
        
        alert_ids = []
        for row in rows:
            val = row[0]
            if isinstance(val, uuid.UUID):
                alert_ids.append(val)
            elif isinstance(val, str):
                alert_ids.append(uuid.UUID(val))
            else:
                alert_ids.append(uuid.UUID(str(val)))
                
        print(f"Found {len(alert_ids)} snap alerts to delete.")
        
        # Delete from AlertHistories first due to foreign key
        cur.execute("DELETE FROM \"AlertHistories\" WHERE \"AlertId\" = ANY(%s);", (alert_ids,))
        histories_deleted = cur.rowcount
        print(f"Deleted {histories_deleted} matching rows from AlertHistories.")
        
        # Delete from Alerts
        cur.execute("DELETE FROM \"Alerts\" WHERE \"Id\" = ANY(%s);", (alert_ids,))
        alerts_deleted = cur.rowcount
        print(f"Deleted {alerts_deleted} matching rows from Alerts.")
        
        conn.commit()
        print("Transaction committed successfully.")
        
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error during cleanup: {e}")
