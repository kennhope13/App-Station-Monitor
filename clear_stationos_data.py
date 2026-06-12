import psycopg2

# Configuration for the StationOS database on port 5432
db_config = {
    'dbname': 'StationOS',
    'user': 'postgres',
    'password': 'postgres123',
    'host': 'localhost',
    'port': '5432'
}

data_tables = [
    'AuditLogs',
    'LoginLogs',
    'MediaFiles',
    'NotifyLogs',
    'Reports',
    'RuleTriggerLogs',
    'SensorReadings',
    'SyncQueues',
    'ThermalFrames',
    'AlertHistories',
    'Alerts',
    'DetectionEvents',
    'MaintenanceTasks'
]

try:
    conn = psycopg2.connect(**db_config)
    conn.autocommit = True
    cur = conn.cursor()
    
    print("Clearing data tables in StationOS (Port 5432)...")
    for table in data_tables:
        try:
            cur.execute(f'TRUNCATE TABLE "{table}" CASCADE;')
            print(f"- Cleared {table}")
        except Exception as e:
            print(f"- Error clearing {table}: {e}")
            conn.rollback()
            
    cur.close()
    conn.close()
    print("Finished clearing data in StationOS.")
except Exception as e:
    print(f"Connection Error: {e}")
