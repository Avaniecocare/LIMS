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

## Workflow
- **Requested tests exist before they are planned.** Booking creates them with status `Planned` and no `plannedAt`, so rates are captured at booking. The API's `planned` flag says which they are.
- **Rates freeze at booking:** accepted quotation, then customer rate, then standard rate. Invoices use the frozen rate, so a rate change later doesn't reach work already booked. Accounts can override a line on a draft invoice with a reason.
- **Calculated results use inputs as reported,** at their stated decimals, so anyone can repeat the working from the printed figures.
- **Stages complete strictly in order.** Submitting needs all stages complete and a value for every parameter.
- **Report hash.** The signature stores a hash of the frozen content, which prints on the report, and the PDF's SHA-256, which can't print on itself. Both are recorded.
- **Withheld reports** release only when every issued invoice for the job is paid, and at least one exists.
- **A cancelled sample or job with an approved or issued report is refused.** The report must be revised instead. Lines on draft invoices are removed; issued invoices stay until corrected by a credit note.
- **Payments are reversed, never deleted.** Issued invoices can only be cancelled if no payment or credit is held against them.
- **Grand totals round to the nearest rupee,** with the difference shown as round-off.
- **Soft-deleted master codes stay reserved,** so a code can't later mean something else on old records.

## Access
- **Customer identity needs `customers.view` everywhere,** including documents and attachments on jobs and samples. Planners and HoDs work from codes.
- **Reception converts quotations through a price-free endpoint** and doesn't hold `quotations.view`.
- **Notifications carry codes only,** since they reach technicians.

## Operations
- **Scheduled work runs in the worker** on Indian time: quotation expiry, TAT checks, invoice overdue checks, reminders, and a one-minute sweep that sends mail queued inside transactions.
- **Infrastructure errors on document jobs are logged, not shown.** Users see a generic message.
- **Images are large** (about 4.8 GB), since the backend's base image carries Chromium and its libraries. The API doesn't use Chromium, but sharing one image was asked for.
