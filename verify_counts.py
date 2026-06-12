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
    
    tables = ['Stations', 'Devices', 'Users', 'SensorReadings', 'Alerts', 'AuditLogs']
    print("Record counts in StationOS (Port 5432):")
    for table in tables:
        cur.execute(f'SELECT COUNT(*) FROM "{table}"')
        count = cur.fetchone()[0]
        print(f"- {table}: {count}")
        
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
