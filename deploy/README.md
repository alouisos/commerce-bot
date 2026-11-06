# Deploying Concierge

Two long-running processes (web: `next start`, worker: `tsx src/worker/index.ts`, both run from `node_modules/.bin` by the units, equivalent to `npm start` / `npm run worker`), Postgres with pgvector, an S3-compatible bucket, and nginx in front. Mirrors the Milian Jo conventions in its `deploy/` directory. Nothing here is applied automatically; run the steps yourself.

On the shared box Milian Jo already owns port 3000, so Concierge listens on **3100** (`PORT=3100` in `concierge-web.service`, upstream in `nginx-concierge.conf`).

## 1. Postgres with pgvector
Create a hosted Postgres with the `vector` extension (e.g. Neon; enable pgvector). Put its connection string in `DATABASE_URL`, then from the app directory:

    npm ci && npm run build
    npm run db:migrate

## 2. Object storage
Create an S3-compatible bucket (e.g. Cloudflare R2) and an access key scoped to it. Set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

## 3. Environment file
Copy `.env.example` to `/etc/concierge.env` and fill it in. It holds secrets, so it is **not** in the repo and must be owned by root with mode 600:

    sudo install -o root -g root -m 600 /dev/null /etc/concierge.env
    sudo $EDITOR /etc/concierge.env

Production values: `APP_URL=https://<APP_HOST>`, `FAKE_MODEL=false`, `FAKE_EMBEDDINGS=false`, `CRAWL_ALLOW_PRIVATE_HOSTS=false`, `BETTER_AUTH_SECRET` from `openssl rand -base64 48`, `PLATFORM_OWNER_EMAILS`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`.

## 4. DNS
Point an A/AAAA record for the app subdomain (APP_HOST, e.g. `app.example.com`) at the server.

## 5. Install the app, units and nginx site
Place the built app at `/srv/concierge` (owned by the service user, `ubuntu` in the units), including `node_modules`, `.next`, `public`, `src`.
`tsx` (used by the worker) is a devDependency, so install with `npm ci` (not `--omit=dev`) or move it to dependencies.

    sudo cp deploy/concierge-web.service deploy/concierge-worker.service /etc/systemd/system/
    sed 's/SERVER_NAME_PLACEHOLDER/app.example.com/' deploy/nginx-concierge.conf \
      | sudo tee /etc/nginx/sites-available/concierge
    sudo ln -sfn /etc/nginx/sites-available/concierge /etc/nginx/sites-enabled/concierge
    sudo nginx -t && sudo systemctl reload nginx

The nginx config is deliberately not `default_server`. Do not overwrite it after certbot has edited it.

## 6. TLS
    sudo certbot --nginx -d app.example.com

## 7. Start
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
5. `PLATFORM_OWNER_EMAILS` is set.
6. Migrations have run (`npm run db:migrate`).
7. The worker service is running (`systemctl status concierge-worker`) and the weekly re-crawl schedule is registered (check the worker logs).
8. TLS works, and the nginx `X-Forwarded-For` overwrite (`proxy_set_header X-Forwarded-For $remote_addr;`) is in place: rate limiting trusts the leftmost entry.
9. Upload one image under Knowledge and confirm its description appears (exercises Claude vision).

## Operations
- Logs: `journalctl -u concierge-web -u concierge-worker`.
- Update: pull, `npm ci && npm run build && npm run db:migrate`, then `sudo systemctl restart concierge-web concierge-worker`.
