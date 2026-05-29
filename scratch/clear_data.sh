#!/bin/bash
echo "Đang xóa sạch dữ liệu vùng vẽ (Boundaries) trong Database..."
docker exec -i stationos-dev-db psql -U postgres -d StationOS -c "DELETE FROM \"Boundaries\";" 2>/dev/null || \
docker exec -i stationmonitor-db psql -U postgres -d StationOS -c "DELETE FROM \"Boundaries\";" 2>/dev/null || \
PGPASSWORD=CHANGE_ME psql -h localhost -U postgres -d StationOS -c "DELETE FROM \"Boundaries\";" 2>/dev/null || \
python3 -c "import psycopg2; conn=psycopg2.connect('host=localhost dbname=StationOS user=postgres password=CHANGE_ME'); cur=conn.cursor(); cur.execute('DELETE FROM \"Boundaries\";'); conn.commit()" 2>/dev/null

echo "✅ Đã xóa sạch dữ liệu vùng vẽ!"
