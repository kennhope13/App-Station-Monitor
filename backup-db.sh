#!/bin/bash
# Script to backup the StationOS database from docker container

BACKUP_DIR="/home/admin-/Desktop/App-Station-Monitor/backups"
mkdir -p "$BACKUP_DIR"

BACKUP_FILE="$BACKUP_DIR/stationos_backup_$(date +%Y%m%d_%H%M%S).sql"

echo "============================================="
echo "Starting StationOS Database Backup..."
echo "Container: stationos-monitor-db"
echo "Database: StationOS"
echo "Backup Destination: $BACKUP_FILE"
echo "============================================="

# Perform pg_dump inside the docker container
sudo docker exec -t stationos-monitor-db pg_dump -U postgres StationOS > "$BACKUP_FILE"

if [ ${PIPESTATUS[0]} -eq 0 ] && [ -s "$BACKUP_FILE" ]; then
    echo "============================================="
    echo "SUCCESS: Database backup created successfully!"
    echo "File size: $(du -sh "$BACKUP_FILE" | cut -f1)"
    echo "Location: $BACKUP_FILE"
    echo "============================================="
else
    echo "============================================="
    echo "ERROR: Database backup failed!"
    echo "Please check if docker is running and you entered the correct password."
    echo "============================================="
    rm -f "$BACKUP_FILE"
    exit 1
fi
