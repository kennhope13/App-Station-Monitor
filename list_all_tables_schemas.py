import psycopg2
try:
    conn = psycopg2.connect(
        dbname='StationOS_Central',
        user='postgres',
        password='postgres123',
        host='localhost',
        port='6432'
    )
    cur = conn.cursor()
    cur.execute("""
        SELECT n.nspname as "Schema",
               c.relname as "Name",
               CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'i' THEN 'index' WHEN 'S' THEN 'sequence' WHEN 's' THEN 'special' WHEN 'f' THEN 'foreign table' END as "Type"
        FROM pg_catalog.pg_class c
             LEFT JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r','')
              AND n.nspname <> 'pg_catalog'
              AND n.nspname <> 'information_schema'
              AND n.nspname !~ '^pg_toast'
        ORDER BY 1,2;
    """)
    tables = cur.fetchall()
    print("Tables and Schemas in StationOS_Central:")
    for t in tables:
        print(f"- {t[0]}.{t[1]} ({t[2]})")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
