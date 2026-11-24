# LIMS backend

By [Taravik Private Limited](https://taravik.com). Proprietary: see [LICENSE](LICENSE).

NestJS (Fastify) modular monolith for the white-label laboratory information management system. It owns all business logic, permissions, status changes, calculations, GST, numbering, PDFs and audit logging. The frontend is in `LIMS-UI`, deployment in `LIMS-Deploy`.

## Quick start

```sh
docker compose up
```

This starts PostgreSQL, Redis, a local S3-compatible store, Mailpit (mail viewer on port 8025), the API (port 3000) and the worker. It runs migrations and loads the demo seed. All data and company details are fictional. Demo users are `<role>@demo.example` (admin, sales, reception, planner, tech, tech2, hod, reviewer, signatory, dispatch, accounts, management), password `Demo-Password-1!`.

Note: the images use port 5432, 6379 and 9000 on your machine, so stop anything already using them.

## Without Docker

Requires Node 24+, PostgreSQL and Redis. `npm run` scripts read `.env`:

```sh
cp .env.example .env
npm ci
npx playwright install chromium
npx prisma migrate deploy
node scripts/dev-s3.mjs &           # local S3-compatible store
npm run build
node --env-file=.env dist/main.js api
node --env-file=.env dist/main.js worker
```

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Unit and API tests against a real PostgreSQL |
| `npm run lint`, `npm run typecheck` | Static checks |
| `npm run format`, `npm run format:check` | Apply or check Prettier formatting (`.prettierrc.json`) |
| `npm run knip` | Fail on unused files, exports or dependencies (`knip.json` lists the entry points) |
| `npm run build` | Compile to `dist/` |
| `npm run openapi:generate` | Write `openapi.json` from the compiled code |
| `npm run openapi:check` | Fail on a breaking change against `openapi/baseline.json` |
| `npm run db:seed`, `npm run db:seed:remove` | Load the demo data, or remove it in one command |
| `node load-test/run.mjs` | Load test; see below |

A pre-commit hook (husky and lint-staged, installed by `npm install`) formats and lints the files being committed. CI runs the same checks on the whole repository.

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

## Load test

Repeatable, against a dedicated database with 500,000 tests, 4% of them still open (`OPEN_PERCENT`). GitHub runs it on every `build/**` push, and a stress with all of them open:

```sh
export DATABASE_URL=postgresql://lims@localhost:5432/lims_load
npx prisma migrate deploy
node load-test/run.mjs --seed
node --env-file=.env dist/seed/cli.js seed      # for a user to sign in with
# start the API against that database, then:
API_URL=http://localhost:3000 EMAIL=admin@demo.example PASSWORD='Demo-Password-1!' node load-test/run.mjs
```

It fails if any endpoint's 95th percentile exceeds `P95_BUDGET_MS` (default 800).

## API contract

REST under `/api/v1`. OpenAPI is generated from the code by the Nest Swagger plugin, so DTO files must end in `.dto.ts`. CI publishes `openapi.json` as a versioned artifact and fails on a breaking change unless it is listed in `openapi/approved-breaking.json`.

Errors always use `{ "error": { code, message, requestId, fields: [{ field, message }] } }`. Lists always use `{ data, meta: { page, pageSize, total, totalPages } }`.

Git hooks: `git config core.hooksPath .githooks` (needs gitleaks).
