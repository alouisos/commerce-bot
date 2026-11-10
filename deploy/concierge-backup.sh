#!/usr/bin/env bash
# Nightly backup of Concierge's database and uploads, kept for 14 days on this host.
# Copies stay on the same disk: also enable EBS snapshots (AWS DLM) or copy these off-host.
set -euo pipefail
DIR=/var/backups/concierge
install -d -m 700 -o root -g root "$DIR"
day=$(date -u +%F)
runuser -u postgres -- pg_dump -Fc concierge > "$DIR/db-$day.dump.tmp"
mv "$DIR/db-$day.dump.tmp" "$DIR/db-$day.dump"
if [[ -d /srv/concierge-data/storage ]]; then
  tar -czf "$DIR/storage-$day.tgz.tmp" -C /srv/concierge-data storage
  mv "$DIR/storage-$day.tgz.tmp" "$DIR/storage-$day.tgz"
fi
chmod 600 "$DIR"/*
find "$DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'storage-*.tgz' \) -mtime +14 -delete
echo "backup done: $DIR (db-$day.dump)"
