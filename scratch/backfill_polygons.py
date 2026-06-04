import psycopg2
import json
import re

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    
    # Get all boundaries to build a lookup dictionary
    # Key: (camera_id, name) -> (boundary_id, polygon_json)
    cur.execute('SELECT "Id", "DeviceId", "Name", "PolygonJson" FROM "Boundaries";')
    boundaries = {}
    for row in cur.fetchall():
        b_id, dev_id, name, poly_json = row
        if dev_id and name:
            boundaries[(str(dev_id).lower(), name.strip())] = (b_id, poly_json)
            
    print(f"Loaded {len(boundaries)} boundaries for lookup.")

    # Select all DetectionEvents that might have region names in description
    cur.execute("""
        SELECT "Id", "CameraId", "AlertId", "Metadata"
        FROM "DetectionEvents"
        WHERE (("Metadata"->>'description') LIKE '%vung "%' OR ("Metadata"->>'description') LIKE '%vùng "%');
    """)
    events = cur.fetchall()
    print(f"Found {len(events)} events to process.")

    updated_count = 0
    for row in events:
        event_id, camera_id, alert_id, metadata = row
        if not metadata or not camera_id:
            continue
        
        desc = metadata.get('description', '')
        if not desc:
            continue
            
        # Find region name in quotes
        match = re.search(r'"([^"]+)"', desc)
        if not match:
            continue
            
        region_name = match.group(1).strip()
        lookup_key = (str(camera_id).lower(), region_name)
        
        if lookup_key in boundaries:
            b_id, poly_json = boundaries[lookup_key]
            
            # Parse polygonJson
            poly_obj = None
            if isinstance(poly_json, list):
                poly_obj = poly_json
            elif isinstance(poly_json, str):
                try:
                    poly_obj = json.loads(poly_json)
                except Exception as e:
                    print(f"Error parsing polygon json for boundary {b_id}: {e}")
                    poly_obj = None
            else:
                poly_obj = poly_json
                
            if poly_obj is not None:
                # Update metadata dict
                metadata['polygon'] = poly_obj
                
                # Update DetectionEvent
                cur.execute("""
                    UPDATE "DetectionEvents"
                    SET "Metadata" = %s, "BoundaryId" = %s
                    WHERE "Id" = %s;
                """, (json.dumps(metadata), b_id, event_id))
                
                # Update associated Alert if any
                if alert_id:
                    cur.execute("""
                        UPDATE "Alerts"
                        SET "BoundaryId" = %s
                        WHERE "Id" = %s;
                    """, (b_id, alert_id))
                    
                updated_count += 1
            
    conn.commit()
    print(f"Successfully backfilled {updated_count} detection events and alerts with polygon metadata.")
    
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
