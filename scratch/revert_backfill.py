import psycopg2
import json

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    
    # Select all DetectionEvents with polygon metadata, except the original one
    original_event_id = '5664667b-9015-41d7-98c2-64f981da0252'
    
    cur.execute("""
        SELECT "Id", "Metadata", "AlertId"
        FROM "DetectionEvents"
        WHERE ("Metadata"->>'polygon') IS NOT NULL
          AND "Id" != %s;
    """, (original_event_id,))
    
    rows = cur.fetchall()
    print(f"Found {len(rows)} events to revert.")
    
    reverted_count = 0
    for row in rows:
        event_id, metadata, alert_id = row
        if not metadata:
            continue
            
        # Remove 'polygon' from metadata dict
        if 'polygon' in metadata:
            del metadata['polygon']
            
        # Update DetectionEvent: clear BoundaryId and Metadata polygon
        cur.execute("""
            UPDATE "DetectionEvents"
            SET "Metadata" = %s, "BoundaryId" = NULL
            WHERE "Id" = %s;
        """, (json.dumps(metadata), event_id))
        
        # Update Alert: clear BoundaryId
        if alert_id:
            cur.execute("""
                UPDATE "Alerts"
                SET "BoundaryId" = NULL
                WHERE "Id" = %s;
            """, (alert_id,))
            
        reverted_count += 1
        
    conn.commit()
    print(f"Successfully reverted {reverted_count} backfilled events.")
    
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
