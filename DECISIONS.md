# Decisions

Choices made where the brief left room. Each is the default; anything a lab may reasonably change is a setting.

## Stack
- **Prisma 7.10, not `latest`.** npm's `latest` tag points at an 8.0 release candidate, so the last stable line is pinned.
- **TypeScript 6 in this repo.** `@nestjs/swagger` does not accept TypeScript 7 yet. `LIMS-UI` uses 5.9 because `openapi-typescript` needs it.
- **Node 24 in images and CI.** Development ran on Node 26 LTS; 24 is the base that the Playwright image and the Node Docker tags pair with most reliably. `engines` allows both.
- **OpenAPI from the Nest Swagger compiler plugin**, which reads DTO types and class-validator decorators. This avoids duplicate `@ApiProperty` annotations. DTOs must live in `*.dto.ts`.
- **Own expression parser for formulas.** Common evaluator libraries have a history of sandbox escapes and use floats. See the formula module.

## Storage
- **Local Compose uses a small `s3rver` container, not MinIO.** The brief asks for MinIO, but in November 2026 official MinIO images no longer exist on Docker Hub, and macOS binaries return HTTP 410. The app speaks plain S3, so any S3-compatible service works by changing `S3_ENDPOINT`. Production's image is a required setting in `LIMS-Deploy`.

## Security
- **CSRF:** a per-session token returned by `/auth/me` and login, sent as `X-CSRF-Token`, in addition to `SameSite=Lax`. The UI keeps it in memory.
- **Lockout:** 5 failures lock an account for 15 minutes. Login is also rate limited to 10 attempts per minute per IP and email.
- **Password policy:** 10+ characters with upper, lower, digit and symbol. New users and admin resets must change the password at first sign-in.
- **First-run setup** is public only while no user exists, serialised by an advisory lock. Set `SETUP_TOKEN` to require a token as well; `LIMS-Deploy` always does.
- **GSTIN validation** checks format and the mod-36 check digit, for both company and customers.
- **Audit log is append-only at database level:** triggers reject UPDATE, DELETE and TRUNCATE. Because the app connects as the table owner, a DBA could still disable the trigger; `LIMS-Deploy` can run the app under a non-owner role to close this.

## Numbering
- Formats are settings using `{PREFIX}`, `{FY}` and `{SEQ:n}`. Series reset each financial year, except customer numbers (CRN), which are unique for life.
- A number is allocated with a row-locking upsert inside the caller's transaction, so concurrent creators serialise and a rollback does not burn a number.

## Settings and roles
- Default roles are created once. After that an Admin owns the mapping; upgrades add new permission codes but never change an existing role's grants.
- At least one role in use must keep user management, and Admins cannot remove their own access, so a deployment cannot lock itself out.
- Changing a separation-of-duties or impartiality control requires a reason, written to the audit log.
