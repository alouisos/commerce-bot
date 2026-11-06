# Concierge

Multi-tenant SaaS website chatbot: a Next.js app (admin and widget API), a pg-boss worker, Postgres with pgvector, and an embeddable widget. Design and plan live in `docs/superpowers/`; Next.js 16 specifics in `docs/next16-notes.md`.

## Development

```bash
docker compose up -d db      # Postgres 17 + pgvector on :5433 (databases: concierge, concierge_test)
cp .env.example .env
npm install
npm run dev
```

Scripts: `dev`, `build`, `start`, `worker`, `test`, `test:e2e`, `db:generate`, `db:migrate`, `widget:build`, `lint`, `typecheck`.
