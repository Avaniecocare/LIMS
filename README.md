# LIMS backend

NestJS (Fastify) modular monolith for the white-label laboratory information management system. It owns all business logic, permissions, status changes, calculations, GST, numbering, PDFs and audit logging. The frontend is in `LIMS-UI`, deployment in `LIMS-Deploy`.

## Quick start

```sh
docker compose up
```

This starts PostgreSQL, Redis, MinIO, Mailpit, the API (port 3000) and the worker. It runs migrations and loads the demo seed. All data and company details are fictional.

## Without Docker

Requires Node 24+, PostgreSQL and Redis. `npm run` scripts read `.env`:

```sh
cp .env.example .env
npm ci
npx playwright install chromium
npx prisma migrate deploy
node scripts/dev-s3.mjs &           # S3-compatible store if MinIO isn't available
npm run build
node --env-file=.env dist/main.js api
node --env-file=.env dist/main.js worker
```

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Unit and API tests against a real PostgreSQL |
| `npm run lint`, `npm run typecheck` | Static checks |
| `npm run build` | Compile to `dist/` |
| `npm run openapi:generate` | Write `openapi.json` from the compiled code |
| `npm run openapi:check` | Fail on a breaking change against `openapi/baseline.json` |

Tests expect PostgreSQL at `TEST_DATABASE_URL` and Redis at `TEST_REDIS_URL`. The defaults are `postgresql://lims@localhost:5432/lims_test` and `redis://localhost:6379/1`. **The test database's schema is dropped on every run.**

## Configuration

Two groups of environment variables, both listed in `.env.example`:

- `COMPANY_*` describes the deployed company. Only `src/config/company.config.ts` reads them. They are validated at startup: a missing or invalid value stops the process with exit code 78, naming the variable but not its value.
- Everything else is infrastructure or secrets, read by `src/config/infra.config.ts`.

Quote values containing `#` or spaces in env files: `COMPANY_PRIMARY_COLOR="#0f4c81"`.

## Layout

- `src/config` typed configuration
- `src/common` errors, pagination, request context, regional helpers
- `src/core` database, audit, settings, numbering, storage, queues, mail
- `src/modules/*` one NestJS module per business area
- `src/worker` background processing (same image, `node dist/main.js worker`)
- `prisma` schema and migrations

## API contract

REST under `/api/v1`. OpenAPI is generated from the code by the Nest Swagger plugin, so DTO files must end in `.dto.ts`. CI publishes `openapi.json` as a versioned artifact and fails on a breaking change unless it is listed in `openapi/approved-breaking.json`.

Errors always use `{ "error": { code, message, requestId, fields: [{ field, message }] } }`. Lists always use `{ data, meta: { page, pageSize, total, totalPages } }`.

Git hooks: `git config core.hooksPath .githooks` (needs gitleaks).
