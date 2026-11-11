#!/usr/bin/env bash
#
# Build Concierge locally and deploy it to the Ubuntu host.
#
#   ./deploy/deploy.sh [--host IP] [--user ubuntu] [--key path.pem] [--domain bot.example.com]
#                      [--setup] [--env-file path] [--replace-env] [--web-only]
#
#   --setup        first run: upload and run deploy/server-setup.sh (swap, Postgres + pgvector,
#                  directories, systemd units, nginx site, TLS). Safe to re-run.
#   --env-file F   upload F as /etc/concierge.env if the server has none (or always, with
#                  --replace-env). It holds secrets: keep it out of the repo, mode 600.
#   --web-only     restart only concierge-web, leaving the worker (and any running crawl)
#                  alone. Only for changes that don't touch worker code (src/worker, src/lib
#                  used by jobs) or the database schema.
#
# Every run:
#   1. exports HEAD (committed code only; never your local .env) to a temp dir,
#      runs npm ci and the production build there
#   2. rsyncs the build to /srv/concierge (node_modules is not shipped)
#   3. on the server: npm ci when package-lock.json changed, db:migrate, restart both units
#   4. checks the app answers on 127.0.0.1:3100 and through nginx
#
# The build is done here because the host is too small to run `next build` next to
# Milian Jo. Nothing here touches Milian Jo's nginx site, port 3000 or /srv/milian-jo.
#
set -euo pipefail

HOST="100.28.24.208"
USER="ubuntu"
KEY="$HOME/Projects/Keys/manxmachina-website.pem"
DOMAIN="bot.manxmachina.com"
SETUP=0
ENV_FILE=""
REPLACE_ENV=0
SERVICES="concierge-web concierge-worker"
APP_DIR="/srv/concierge"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --setup) SETUP=1; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --replace-env) REPLACE_ENV=1; shift ;;
    --web-only) SERVICES="concierge-web"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -r $KEY ]] || { echo "ssh key not readable: $KEY" >&2; exit 1; }
[[ -z $ENV_FILE || -r $ENV_FILE ]] || { echo "env file not readable: $ENV_FILE" >&2; exit 1; }

# Same connection hardening as Milian Jo's deploy.sh: the path to this host drops
# connections now and then, so every step retries and shares one control socket.
SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15
  -o ConnectionAttempts=5
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=6
  -o ControlMaster=auto
  -o ControlPath=/tmp/concierge-deploy-%r@%h:%p
  -o ControlPersist=300
)
SSH=(ssh -i "$KEY" "${SSH_OPTS[@]}" "$USER@$HOST")
SSH_CMD="ssh -i $KEY ${SSH_OPTS[*]}"

say() { printf '\n==> %s\n' "$*"; }
retry() {
  local n
  for n in 1 2 3 4; do
    "$@" && return 0
    echo "  attempt $n failed; retrying in $((n * 3))s" >&2
    sleep $((n * 3))
  done
  return 1
}

# ---------------------------------------------------------------- 1. build
if [[ -n "$(git -C "$HERE" status --porcelain)" ]]; then
  echo "warning: uncommitted changes are NOT deployed (the build uses HEAD)" >&2
fi
REV=$(git -C "$HERE" rev-parse --short HEAD)
BUILD=$(mktemp -d "${TMPDIR:-/tmp}/concierge-build.XXXXXX")
trap 'rm -rf "$BUILD"' EXIT

say "building $REV in $BUILD"
git -C "$HERE" archive HEAD | tar -x -C "$BUILD"
(
  cd "$BUILD"
  npm ci --no-audit --no-fund --loglevel=error
  # Placeholder values so env validation passes during the build. Nothing at build time
  # calls the database or the APIs; the real values come from /etc/concierge.env at runtime.
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    APP_URL="https://$DOMAIN" \
    DATABASE_URL="postgres://build:build@127.0.0.1:1/build" \
    BETTER_AUTH_SECRET="build-time-placeholder-not-used-at-runtime" \
    ANTHROPIC_API_KEY="build-placeholder" VOYAGE_API_KEY="build-placeholder" \
    npm run build
)
echo "$REV" > "$BUILD/REVISION"

# ---------------------------------------------------------------- 2. server prep
say "connecting to $USER@$HOST"
retry "${SSH[@]}" true

if [[ -n $ENV_FILE ]]; then
  if [[ $REPLACE_ENV -eq 1 ]] || ! "${SSH[@]}" 'test -f /etc/concierge.env'; then
    say "installing /etc/concierge.env"
    # Through stdin: the secrets never sit in a temporary file on the server.
    getent_cmd='getent passwd concierge >/dev/null || sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin concierge'
    "${SSH[@]}" "$getent_cmd"
    "${SSH[@]}" 'sudo install -o root -g concierge -m 640 /dev/stdin /etc/concierge.env' < "$ENV_FILE"
  else
    echo "/etc/concierge.env already exists; not replacing it (use --replace-env)"
  fi
fi

if [[ $SETUP -eq 1 ]]; then
  say "server setup"
  "${SSH[@]}" 'rm -rf /tmp/concierge-setup && mkdir -p /tmp/concierge-setup'
  retry scp -q -i "$KEY" "${SSH_OPTS[@]}" \
    "$BUILD/deploy/server-setup.sh" "$BUILD/deploy/concierge-web.service" \
    "$BUILD/deploy/concierge-worker.service" "$BUILD/deploy/nginx-concierge.conf" \
    "$USER@$HOST:/tmp/concierge-setup/"
  "${SSH[@]}" "sudo bash /tmp/concierge-setup/server-setup.sh '$DOMAIN' /tmp/concierge-setup && rm -rf /tmp/concierge-setup"
fi

"${SSH[@]}" "test -f /etc/concierge.env && test -d $APP_DIR" || {
  echo "server is not set up (no /etc/concierge.env or $APP_DIR); run with --setup --env-file" >&2
  exit 1
}

# ---------------------------------------------------------------- 3. ship
say "syncing to $APP_DIR"
# node_modules is installed on the server (native packages must match its Node).
# Excluded paths are also protected from --delete. Every pattern is anchored with a
# leading / (top level only): an unanchored `node_modules` would also drop
# .next/node_modules, the links Turbopack uses to load server externals such as pg.
retry rsync -az --delete --partial -e "$SSH_CMD" \
  --exclude /node_modules --exclude /.lock-hash --exclude /.storage \
  --exclude /.next/cache --exclude /.next/server/route-cache --exclude /tests --exclude /e2e --exclude /docs \
  "$BUILD/" "$USER@$HOST:$APP_DIR/"

say "service user, permissions, units"
"${SSH[@]}" 'rm -rf /tmp/concierge-units && mkdir -p /tmp/concierge-units'
retry scp -q -i "$KEY" "${SSH_OPTS[@]}" \
  "$BUILD/deploy/concierge-web.service" "$BUILD/deploy/concierge-worker.service" \
  "$BUILD/deploy/concierge-backup.service" "$BUILD/deploy/concierge-backup.timer" "$BUILD/deploy/concierge-backup.sh" \
  "$USER@$HOST:/tmp/concierge-units/"
# Idempotent. The app runs as the unprivileged user `concierge`; the code stays owned by ubuntu and is
# only readable by that user, so the app can't change what a later deploy runs.
"${SSH[@]}" "bash -s" <<'UNITS'
set -euo pipefail
getent passwd concierge >/dev/null || sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin concierge
sudo install -d -o concierge -g concierge -m 750 /srv/concierge/.next/cache
sudo chown -R concierge:concierge /srv/concierge-data
sudo chown root:concierge /etc/concierge.env
sudo chmod 640 /etc/concierge.env
for b in /etc/concierge.env.bak-*; do [[ -e $b ]] && sudo chown root:concierge "$b" && sudo chmod 640 "$b"; done
cd /tmp/concierge-units
changed=0
for f in concierge-web.service concierge-worker.service concierge-backup.service concierge-backup.timer; do
  if ! cmp -s "$f" "/etc/systemd/system/$f"; then sudo install -m 644 "$f" "/etc/systemd/system/$f"; changed=1; fi
done
cmp -s concierge-backup.sh /usr/local/sbin/concierge-backup || sudo install -m 750 concierge-backup.sh /usr/local/sbin/concierge-backup
if [[ $changed -eq 1 ]]; then sudo systemctl daemon-reload; fi
sudo systemctl enable --quiet --now concierge-backup.timer
rm -rf /tmp/concierge-units
UNITS

say "install, migrate, restart"
"${SSH[@]}" "bash -s" <<EOF
set -euo pipefail
cd $APP_DIR
LOCK=\$(sha256sum package-lock.json | cut -c1-64)
if [[ ! -d node_modules || "\$(cat .lock-hash 2>/dev/null)" != "\$LOCK" ]]; then
  echo "package-lock.json changed: npm ci"
  # dev dependencies are needed: the worker runs under tsx, migrations use drizzle-kit.
  npm ci --include=dev --no-audit --no-fund --loglevel=error
  echo "\$LOCK" > .lock-hash
fi
# Code readable by the service user only (group), never writable by it.
sudo chgrp -R concierge $APP_DIR
sudo chmod -R g+rX,g-w,o-rwx $APP_DIR
sudo chmod 750 $APP_DIR
sudo chown -R concierge:concierge $APP_DIR/.next/cache
# Next writes its page cache here at runtime; a new build starts with an empty one.
sudo rm -rf $APP_DIR/.next/server/route-cache
sudo install -d -o concierge -g concierge -m 750 $APP_DIR/.next/server/route-cache
# A database dump before every migration (the 10 most recent are kept).
sudo install -d -m 700 /var/backups/concierge
sudo -u postgres pg_dump -Fc concierge | sudo tee /var/backups/concierge/pre-deploy-$REV-\$(date +%s).dump >/dev/null
sudo bash -c 'ls -1t /var/backups/concierge/pre-deploy-*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f'
# The env file is readable by root and the service user only.
set -a; . <(sudo cat /etc/concierge.env); set +a
npm run --silent db:migrate
sudo systemctl restart $SERVICES
EOF

# ---------------------------------------------------------------- 4. verify
say "health check"
"${SSH[@]}" 'for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/sign-in || true)
  [[ $code =~ ^(200|30[0-9])$ ]] && { echo "app: HTTP $code"; break; }
  sleep 2
done
[[ ${code:-000} =~ ^(200|30[0-9])$ ]] || { echo "app did not come up (last HTTP $code)"; sudo journalctl -u concierge-web -n 40 --no-pager; exit 1; }
systemctl is-active concierge-worker >/dev/null || { echo "worker is not running"; sudo journalctl -u concierge-worker -n 40 --no-pager; exit 1; }
echo "worker: active"'
code=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/sign-in" || true)
echo "https://$DOMAIN/sign-in: HTTP $code"
say "deployed $REV"
