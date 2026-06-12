import psycopg2

# Configuration for Central DB
db_config = {
    'dbname': 'StationOS_Central',
    'user': 'postgres',
    'password': 'postgres123',
    'host': 'localhost',
    'port': '6432'
}

# Tables to clear in Central DB (Everything)
all_tables = [
    'AuditLogs', 'LoginLogs', 'MediaFiles', 'NotifyLogs', 'Reports',
    'RuleTriggerLogs', 'SensorReadings', 'SyncQueues', 'ThermalFrames',
    'AlertHistories', 'Alerts', 'DetectionEvents', 'MaintenanceTasks',
    'Devices', 'Stations', 'Rules', 'Boundaries', 'RoiPoints',
    'SldFiles', 'SldPoints'
]

try:
    conn = psycopg2.connect(**db_config)
    conn.autocommit = True
    cur = conn.cursor()
    
    print("Emptying ALL tables in StationOS_Central (Port 6432)...")
    for table in all_tables:
        try:
            cur.execute(f'TRUNCATE TABLE "{table}" CASCADE;')
            print(f"- Cleared {table}")
        except Exception as e:
            if "does not exist" not in str(e):
                print(f"- Error clearing {table}: {e}")
            conn.rollback()
            
    cur.close()
    conn.close()
    print("Central database is now completely empty.")
except Exception as e:
    print(f"Connection Error: {e}")
