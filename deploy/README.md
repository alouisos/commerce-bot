# Deploying Concierge

Two long-running processes (web: `next start`, worker: `tsx src/worker/index.ts`, both run from `node_modules/.bin` by the units, equivalent to `npm start` / `npm run worker`), Postgres with pgvector, an S3-compatible bucket, and nginx in front. Mirrors the Milian Jo conventions in its `deploy/` directory. Nothing here is applied automatically; run the steps yourself.

On the shared box Milian Jo already owns port 3000, so Concierge listens on **3100** (`PORT=3100` in `concierge-web.service`, upstream in `nginx-concierge.conf`).

## 1. App directory and environment file
Create the app directory, owned by the service user (`ubuntu` in the units):

    sudo mkdir -p /srv/concierge && sudo chown ubuntu:ubuntu /srv/concierge

Create the environment file **before** building or migrating: `npm run db:migrate` reads `DATABASE_URL` from the environment (without it, it silently targets the local dev database). Copy `.env.example` to `/etc/concierge.env` and fill it in (steps 2 and 3 give the database and storage values). It holds secrets, so it is **not** in the repo. It is owned by root and readable by the service user's group only, so you can source it as `ubuntu` for the build and migration (the services run as `ubuntu` with these values anyway; systemd reads it as root):

    sudo install -o root -g ubuntu -m 640 /dev/null /etc/concierge.env
    sudo $EDITOR /etc/concierge.env

Production values: `APP_URL=https://<APP_HOST>`, `FAKE_MODEL=false`, `FAKE_EMBEDDINGS=false`, `CRAWL_ALLOW_PRIVATE_HOSTS=false`, `BETTER_AUTH_SECRET` from `openssl rand -base64 48`, `PLATFORM_OWNER_EMAILS`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`. `CHAT_MODEL` must be one of the metered models (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) or the app refuses to start. Never set `ALLOW_FAKES_IN_PRODUCTION`: with `NODE_ENV=production` the app refuses `FAKE_MODEL`/`FAKE_EMBEDDINGS` unless it is `true`, which only the local e2e run uses.

## 2. Postgres with pgvector
Create a hosted Postgres with the `vector` extension, version 0.8 or later (knowledge search uses `hnsw.iterative_scan`), e.g. Neon with pgvector enabled. Put its connection string in `DATABASE_URL` in `/etc/concierge.env`.

## 3. Object storage
Create an S3-compatible bucket (e.g. Cloudflare R2) and an access key scoped to it. Set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in `/etc/concierge.env`.

## 4. Build and migrate
From the app directory in `/srv/concierge` (see step 6), as `ubuntu`, load the environment into the shell, then build and migrate. The build itself needs no secrets, but loading the file first keeps one routine for both:

    set -a; . /etc/concierge.env; set +a
    npm ci && npm run build
    npm run db:migrate

## 5. DNS
Point an A/AAAA record for the app subdomain (APP_HOST, e.g. `app.example.com`) at the server.

## 6. Install the app, units and nginx site
Place the built app at `/srv/concierge` (created in step 1), including `node_modules`, `.next`, `public`, `src`.
`tsx` (used by the worker) is a devDependency, so install with `npm ci` (not `--omit=dev`) or move it to dependencies.

**`node` must be on systemd's PATH.** The units run `node_modules/.bin/next` and `node_modules/.bin/tsx`, whose shims start with `#!/usr/bin/env node`, and systemd's default PATH only has the system directories. A distro or NodeSource package installs `node` in `/usr/bin` (or `/usr/local/bin`), which works as is; check with `command -v node`. If node comes from nvm, mise, asdf or similar (under a home directory), set an absolute PATH in **both** units, in `[Service]`:

    # e.g. for nvm; use the directory `dirname "$(command -v node)"` prints for the ubuntu user
    Environment=PATH=/home/ubuntu/.nvm/versions/node/v24.11.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

(`ProtectHome=read-only` still allows executing from there.) Update the path when you upgrade node.

    sudo cp deploy/concierge-web.service deploy/concierge-worker.service /etc/systemd/system/
    sed 's/SERVER_NAME_PLACEHOLDER/app.example.com/' deploy/nginx-concierge.conf \
      | sudo tee /etc/nginx/sites-available/concierge
    sudo ln -sfn /etc/nginx/sites-available/concierge /etc/nginx/sites-enabled/concierge
    sudo nginx -t && sudo systemctl reload nginx

The nginx config is deliberately not `default_server`. Do not overwrite it after certbot has edited it.

## 7. TLS
    sudo certbot --nginx -d app.example.com

## 8. Start
    sudo systemctl daemon-reload
    sudo systemctl enable --now concierge-web concierge-worker
    journalctl -u concierge-web -u concierge-worker -f

## Before go-live checklist
Do every item; several have never been verified against the live services.

1. **Live chat.** With a real `ANTHROPIC_API_KEY` and `FAKE_MODEL=false`, run one live chat and confirm the stream works. This exercises the trailing mid-conversation `role:"system"` message and `fallbacks:"default"`, which were never verified against the live API. Replace `<KEY>` with a site's public key and use an allowed origin:

        curl -N -X POST 'https://<APP_HOST>/api/widget/chat?key=<KEY>' \
          -H 'Content-Type: application/json' \
          -H 'Origin: https://<ALLOWED_ORIGIN>' \
          -d '{"key":"<KEY>","sid":"golive-check-1","cid":null,"message":"What do you sell?","page":{"url":"https://<ALLOWED_ORIGIN>/","title":"Home","lang":"en","headings":[],"visibleText":"","product":null}}'

   Expect `start`, a series of `delta` events, then `done`, arriving incrementally. A `fallback` event or a non-200 status means the call failed; check the logs.
2. **Embeddings.** With a real `VOYAGE_API_KEY` and `FAKE_EMBEDDINGS=false`, upload one document under Knowledge and confirm it reaches "ready".
3. `CRAWL_ALLOW_PRIVATE_HOSTS` is unset or `false` in production (it disables the SSRF guard).
4. `BETTER_AUTH_SECRET` is a long random value (`openssl rand -base64 48`).
5. `PLATFORM_OWNER_EMAILS` is set, and each owner has **signed up and then been verified on the server**: owner access needs a verified email (sign-up is open and does not verify addresses, so an unverified listed address proves nothing). After signing up: `cd /srv/concierge && set -a && . /etc/concierge.env && set +a && npm run user:verify-email -- <email>`. Check the printed creation time is yours; if the address already had an account you did not create, delete that user instead.
6. Migrations have run (`npm run db:migrate`, with `/etc/concierge.env` loaded).
7. The worker service is running (`systemctl status concierge-worker`) and the weekly re-crawl schedule is registered (check the worker logs).
8. TLS works, and the nginx `X-Forwarded-For` overwrite (`proxy_set_header X-Forwarded-For $remote_addr;`) is in place: rate limiting trusts the leftmost entry.
9. Upload one image under Knowledge and confirm its description appears (exercises Claude vision).

## Security assumptions (stage 1)
- **Crawler DNS rebinding (accepted).** Before each request (and each redirect hop) the SSRF guard resolves the host and rejects private, loopback and link-local addresses, but `fetch` then resolves the name again. A hostile DNS server can answer "public" for the check and "private" for the fetch (time-of-check/time-of-use), so a customer who controls a site's DNS could get the crawler to read an internal HTML page into their own bot's knowledge. Accepted for stage 1: sites are added by signed-in customers and the crawler only sends GETs and keeps only text from HTML. It does mean any HTTP service on the box or its private network (e.g. Milian Jo on `127.0.0.1:3000`) must not serve anything over plain GET that isn't fine to be public. Pinning the checked address for the connection is the fix when that no longer holds.
- **X-Forwarded-For is trusted only because nginx overwrites it.** Rate limits key on the leftmost `X-Forwarded-For` entry. That is safe only while every request reaches the app through the nginx site here, which sets `proxy_set_header X-Forwarded-For $remote_addr;` (replacing, not appending, whatever the client sent) and while the app listens on `127.0.0.1` only (`HOSTNAME=127.0.0.1` in the web unit). Do not expose port 3100 directly or put another proxy in front without revisiting this.

## Operations
- Logs: `journalctl -u concierge-web -u concierge-worker`.
- Update: pull, then `set -a; . /etc/concierge.env; set +a; npm ci && npm run build && npm run db:migrate`, then `sudo systemctl restart concierge-web concierge-worker`.
