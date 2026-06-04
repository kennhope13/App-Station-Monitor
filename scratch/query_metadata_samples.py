import psycopg2
import json

try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    
    # 1. Thermal hotspot metadata sample
    cur.execute("""
        SELECT "Metadata"
        FROM "DetectionEvents"
        WHERE "DetectionType" = 'thermal_hotspot' AND "Metadata" IS NOT NULL
        LIMIT 5;
    """)
    print("Thermal hotspot metadata samples:")
    for row in cur.fetchall():
        print(row[0])
        
    print("-" * 50)
    
    # 2. Partial discharge metadata sample
    cur.execute("""
        SELECT "Metadata"
        FROM "DetectionEvents"
        WHERE "DetectionType" = 'partial_discharge' AND "Metadata" IS NOT NULL
        LIMIT 5;
    """)
    print("Partial discharge metadata samples:")
    for row in cur.fetchall():
        print(row[0])
        
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
