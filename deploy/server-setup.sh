#!/usr/bin/env bash
#
# One-time (idempotent) setup of the Concierge host. Run ON the server, as root:
#
#   sudo bash server-setup.sh <domain> <dir-with-unit-and-nginx-files>
#
# deploy.sh --setup uploads this and runs it for you. It expects /etc/concierge.env
# to exist already (deploy.sh installs it first); the Postgres role password is
# read from DATABASE_URL there, so the env file is the single source of truth.
#
# What it does, each step skipped when already done:
#   1. 2 GB swapfile (the box has ~900 MB RAM, shared with Milian Jo)
#   2. Postgres 18 + pgvector from Ubuntu's archive, tuned small, loopback only
#   3. the `concierge` role, database and vector extension
#   4. /srv/concierge (code) and /srv/concierge-data/storage (uploads)
#   5. systemd units (enabled, not started: deploy.sh starts them after the code lands)
#   6. the nginx site for <domain>; never touches other sites or default_server
#   7. a Let's Encrypt certificate via certbot --nginx
#
set -euo pipefail

DOMAIN="${1:?usage: server-setup.sh <domain> <files-dir>}"
FILES="${2:?usage: server-setup.sh <domain> <files-dir>}"
ENV_FILE=/etc/concierge.env

[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }
[[ -f $ENV_FILE ]] || { echo "$ENV_FILE is missing; install it first" >&2; exit 1; }

say() { printf '\n==> %s\n' "$*"; }

say "1/7 swap"
if swapon --show=NAME --noheadings | grep -qx /swapfile; then
  echo "swapfile already active"
else
  [[ -f /swapfile ]] || fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-concierge-swappiness.conf
  sysctl -q -p /etc/sysctl.d/90-concierge-swappiness.conf
fi
free -h | sed -n '1,3p'

say "2/7 postgres + pgvector"
export DEBIAN_FRONTEND=noninteractive
if ! dpkg -s postgresql-18-pgvector >/dev/null 2>&1; then
  apt-get update -q
  apt-get install -y -q postgresql postgresql-18-pgvector
fi
PG_CONF_DIR=/etc/postgresql/18/main/conf.d
install -d "$PG_CONF_DIR"
PG_TUNE="$PG_CONF_DIR/concierge.conf"
NEW_TUNE=$(cat <<'EOF'
# Concierge on a ~1 GB box shared with another app. Defaults (128MB buffers, 100 conns) are too big.
listen_addresses = 'localhost'
shared_buffers = 64MB
effective_cache_size = 256MB
max_connections = 40
work_mem = 4MB
maintenance_work_mem = 64MB
EOF
)
if [[ "$(cat "$PG_TUNE" 2>/dev/null)" != "$NEW_TUNE" ]]; then
  printf '%s\n' "$NEW_TUNE" > "$PG_TUNE"
  systemctl restart postgresql
fi
systemctl enable --quiet postgresql

say "3/7 database role and extension"
DB_URL=$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tr -d '"'"'")
# postgres://USER:PASS@HOST:PORT/DB
if [[ ! $DB_URL =~ ^postgres(ql)?://([^:]+):([^@]+)@[^/]+/([^?]+) ]]; then
  echo "could not parse DATABASE_URL in $ENV_FILE" >&2; exit 1
fi
DB_USER=${BASH_REMATCH[2]}; DB_PASS=${BASH_REMATCH[3]}; DB_NAME=${BASH_REMATCH[4]}
cd /tmp
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v user="$DB_USER" -v pass="$DB_PASS" -v db="$DB_NAME" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'user') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'user') \gexec
ALTER ROLE :"user" PASSWORD :'pass';
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'user') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SQL
# vector is not a trusted extension, so create it as the superuser; the migration's
# CREATE EXTENSION IF NOT EXISTS is then a no-op.
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB_NAME" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
sudo -u postgres psql -tA -d "$DB_NAME" -c "SELECT 'pgvector ' || extversion FROM pg_extension WHERE extname = 'vector';"

say "4/7 directories"
install -d -o ubuntu -g ubuntu -m 755 /srv/concierge /srv/concierge-data
install -d -o ubuntu -g ubuntu -m 750 /srv/concierge-data/storage

say "5/7 systemd units"
install -m 644 "$FILES/concierge-web.service" "$FILES/concierge-worker.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --quiet concierge-web concierge-worker
echo "enabled (deploy.sh starts them)"

say "6/7 nginx site"
SITE=/etc/nginx/sites-available/concierge
if [[ -f $SITE ]] && grep -q 'managed by Certbot' "$SITE"; then
  echo "$SITE already has certbot's edits; leaving it alone"
else
  sed "s/SERVER_NAME_PLACEHOLDER/$DOMAIN/" "$FILES/nginx-concierge.conf" > "$SITE"
fi
ln -sfn "$SITE" /etc/nginx/sites-enabled/concierge
nginx -t
systemctl reload nginx

say "7/7 TLS"
if [[ -d /etc/letsencrypt/live/$DOMAIN ]]; then
  echo "certificate for $DOMAIN already exists"
else
  CERTBOT_ARGS=(--nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect)
  # Reuse the box's existing ACME account (Milian Jo's cert); only register without an email if none exists.
  if ! compgen -G "/etc/letsencrypt/accounts/*/directory/*" >/dev/null; then
    CERTBOT_ARGS+=(--register-unsafely-without-email)
  fi
  certbot "${CERTBOT_ARGS[@]}"
fi

say "setup done"
