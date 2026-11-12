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
- **Reports are verified by a random code, not the report number.** Approval gives each revision 144 random bits, printed on page 1 as a QR code and link to `/verify/<code>`. A report number can be guessed; the code can't, so only someone holding the report can look it up. The public answer is an allow-list: laboratory, report and sample identity, the customer's name, results, approver and fingerprints. It never includes addresses, contacts, customer numbers, prices, or the lab's tax or bank details. A revision gets its own code, and the old code then reads as replaced. Reports approved before this existed have no QR, because their stored PDFs are never re-rendered.

## Operations
- **Scheduled work runs in the worker** on Indian time: quotation expiry, TAT checks, invoice overdue checks, reminders, and a one-minute sweep that sends mail queued inside transactions.
- **Infrastructure errors on document jobs are logged, not shown.** Users see a generic message.
- **Images are large** (about 4.8 GB), since the backend's base image carries Chromium and its libraries. The API doesn't use Chromium, but sharing one image was asked for.

## Review fixes (November 2026)
- **Document requests from a browser can't carry an email recipient or the "final" flag.** Only server code queues those. Internal kinds (the signed report's final PDF, combining letter pages) are refused as unknown on `POST /documents`, and each user may request 30 documents a minute.
- **Invoices follow the accepted quotation.** Booking copies each line's quantity and agreed amount (after line discount) onto the requested test, and the invoice bills exactly that, with the quotation's overall discount as its default. Jobs and quotations are locked while being invoiced or converted, and unique indexes stop a second job per quotation or a second report per sample.
- **Results can be "< x" or "> x".** They are stored as the number plus a qualifier, pass or fail only when certain, and can't feed a formula. Each test parameter has "Show on report": working values (dimensions, loads, individual readings) stay on the test record and off the report.
- **Every changed result value is audited** with its before and after, and "entered by" moves only when that value changes.
- **A signed report whose final PDF failed can be prepared again**, by a person or by a sweep every ten minutes.
- **Sign-in gives one answer** for a wrong password, an unknown email and a locked account. Failures are also limited per network address, and sessions end 12 hours after sign-in (`SESSION_MAX_HOURS`).
- **`ERROR_TRACKING_DSN` is an HTTPS webhook** that receives server errors as JSON, rate-limited and without request bodies, so any tracker can be used without a vendor library.
- **Formulas are bounded**: any value beyond 10^20 is refused, so one request can't exhaust memory.
- **Database errors map to plain answers**: a deadlock is a conflict to try again, a timeout says the system is busy, a foreign-key failure says the record is linked.

## File library and customer history
- **Files have two kinds.** Library files (category `library`) are the lab's own documents in folders, managed with `files.manage`. Everything else the system holds (reports, invoices, attachments) is visible in the library but managed on its own record. Visibility follows the record a file belongs to; exports that belong to no record are shown only to the person who made them. Downloads are audited.
- **New permissions arrive through role upgrades.** Default roles are only created on a fresh install, so `ROLE_UPGRADES` adds new built-in roles (Document Controller) and grants new permissions to built-in roles found by name, once per deployment, recorded in Setting. An Admin's own changes are never undone.
- **Library uploads also take Word, Excel and CSV**, checked by content; anything that isn't a PDF or an image downloads instead of opening in the browser.
- **Customer history is summary plus lists.** `GET /customers/:id/summary` counts quotations, jobs, tests, reports and money (money only with `invoices.view`, quotation values only with `quotations.view`); the lists reuse the existing endpoints filtered by customer.
- **Auto-fill.** A GSTIN is decoded on the server (state, GST code, PAN) with no outside call. A PIN code is looked up through the server in India Post's directory (`PINCODE_LOOKUP_URL`, empty turns it off), cached for 30 days; if the service is down the form simply isn't filled.
- **A quotation can be accepted from Draft**, for customers who agree on the phone or at the counter. The version's snapshot is frozen then, exactly as sending would.


## Sample photographs on reports
- **Photos are chosen on the draft and frozen with it.** The report content holds the chosen file ids, captions, print sizes and order, so the signed report and its PDF keep exactly those photos. Refreshes after a retest and new revisions carry the choice forward.
- **Only this sample's photos.** A photo may come from the sample (taken at booking, `sample-image`) or be added on the report (`report-photo`, by `reports.review` or `reports.approve`). Any other file id is refused, so one customer's photo can't land on another's report.
- **At most 12 photos, 30–180 mm wide and up to 240 mm tall**, printed in their own "Sample photographs" section after the results, numbered with their captions.
- **Photos are shrunk in the browser before upload** (sample images, report photos and result images): about 2000 pixels on the long side and under 1 MB, with the camera's rotation applied. That still prints at about 290 dpi at the largest report size. Letters, signatures and documents are sent as they are. A photo the browser can't read (some HEIC files) is sent unchanged, and the server decides.
- **"Use phone" links.** A person who may attach photos to a sample or a draft report can show a QR code; a phone that opens it can add photos to that one record, without signing in. The token is 256 random bits, stored only as a hash; the link lasts 15 minutes, takes up to 20 photos, and ends when the dialog on the computer closes. Every photo is stored with the link maker's permissions as they are at that moment, so deactivating them or narrowing their role stops their links at once. The phone sees only the lab name and the sample or report number, never the customer. Unknown, ended, expired and used-up links all get the same answer.

## Sample receipt acknowledgement
- **The acknowledgement can carry photos of the samples as received**, optional and up to 12, two to a row on the letter. Only photos taken of that job's own samples are accepted.
- **Booking can send it at once.** The booking form takes optional photos per sample and has an "Email the acknowledgement" box, ticked when there is a contact email. The job is created first, then the photos are stored, then the email is queued with them; a failure after booking is reported and never undoes the booking. Jobs booked from a quotation, or booked without sending, show a reminder on the job page until an acknowledgement has been emailed.
- **"Use phone" is offered wherever photos are added**: sample images, report photos, test result images, customer letter pages, and the booking form. During a booking the sample does not exist yet, so phone photos are held against the link, visible only to the person booking, and moved onto the sample (`POST /phone-uploads/claim`) right after the job is saved. Each link names its purpose and the phone shows only record numbers.

## The lab's identity lives in the admin panel, not the environment file
- **Only server settings and `BRAND_NAME` are in `.env`.** The lab profile (names, addresses, GSTIN, PAN, bank, accreditation, document prefix, support and legal links) and branding (app name, colours, logo, favicon, sign-in picture and line, "Powered by") are rows in `Setting` (`company.profile`, `company.branding`), edited in Admin → Lab profile and Branding. They are not in the generic settings list, so they can only change through their own checked forms.
- **No restart.** Every process keeps the profile in memory (PDF templates and emails read it synchronously) and reloads it when any process saves, announced on a Redis channel. Images are stored files, served from memory by the public branding endpoints with a version in the URL.
- **Older installs are imported once.** If `COMPANY_*` variables are present when the profile is empty, they are validated exactly as before and copied in, images included, and the setup wizard is skipped. Seeding only ever inserts, so an upgrade never overwrites what an admin saved.
- **Editing the profile needs the password confirmed** (it prints on every invoice and report) and is audited with the previous values. Drafts show the profile as it is now; approval freezes it onto the revision, as before.
- **A fresh install starts from `BRAND_NAME`** with neutral colours and the lab's initials as its logo, and an administrator is taken through a setup wizard: profile, branding, lab-type template, team, test email, review.
- **Lab-type templates only add.** They are built from public standards (no prices, nothing accredited) and create only what is missing by code, so applying one twice, or after the lab has edited its catalogue, changes nothing that exists.
- **Timezone, locale and currency are fixed** to Asia/Kolkata, en-IN and INR: the product is for Indian laboratories (GST invoices, IST dates, Indian number formats), so they are not settings.

## Email templates and modules
- **Customer emails are editable templates** (Admin → Email templates): samples received, quotation, test report, tax invoice, payment reminder, password reset. Staff notifications stay as system messages. The lab's wording is stored in `Setting` (`templates.email`); anything it has not changed uses the product's wording, so new wording in an upgrade reaches labs that never edited that email.
- **Templates are plain text, never HTML.** Blank lines make paragraphs, `**bold**`, `{{value}}`, and `{{#value}}…{{/value}}` for a passage shown only when the value exists. The wording and every value are escaped; only the reset link becomes a link, and only for http(s). Subjects lose line breaks, so a value can't add mail headers. Unknown values and unclosed passages are refused on save, with a live preview in the branded layout.
- **Modules can be turned off** (Admin → Modules): orders and quotations, dispatch, billing, file library, photos from a phone, analytics and MIS reports. The core lab workflow cannot be. Off means hidden in menus, pages and buttons, and refused by the server (`MODULE_OFF`), public phone links and module documents included; automatic payment reminders pause. Nothing is deleted. Each process caches the switches for a minute, and a save tells the others at once.
- **The email layout narrows to fit** (up to 600 px), for phone mail apps.

## Quality management (ISO/IEC 17025)
- **A Quality section** (its own module, `quality.view` / `quality.manage`, a Quality Manager role; existing installs get the role and permissions once through `ROLE_UPGRADES`).
- **Equipment log.** Calibrations, intermediate checks, maintenance, repairs and breakdowns are recorded per instrument with who did it, the outcome and the certificate. A passed calibration or maintenance sets the next due date (given, or from the instrument's interval); a failed calibration or a breakdown makes the instrument due today, so it shows overdue and, where the lab blocks overdue instruments, can't be planned. A daily notice goes to `quality.manage` holders, once per day.
- **Competency.** An authorisation says who may do which test, from when, until when, on what evidence; it can be withdrawn with a reason, never deleted. Planners see a warning when assigning a test to someone not authorised; `controls.requireAuthorisation` (off by default, a sensitive setting) makes the server refuse it. Training records sit alongside.
- **Non-conformance and CAPA.** Numbered like other documents (`NC` series). Open → action (needs a correction or root cause) → verification (needs the corrective action) → closed (needs the verification of effectiveness, by someone other than the owner). Anyone in the lab can raise one through the API; working it needs `quality.manage`.

## Privacy (DPDP Act 2023)
- **The people whose data a testing lab holds** are its customers' contacts and its staff. Admin → Privacy keeps the register of their requests (access, correction, erasure, consent withdrawal, grievance), each with a deadline (`privacy.responseDays`, default 30) and a recorded answer.
- **Finding someone's data** lists where an email address appears: customer contacts, staff accounts, job contacts and emails sent.
- **Erasure** removes the name, email and phone from customer contacts, after the password is confirmed. Jobs, reports, invoices and the email log keep what they recorded, because tax and accreditation rules require those records to stay unchanged; the answer to the person should say so.
- **The breach log** shows the 72-hour deadline for the detailed report to the Data Protection Board, and when the Board and the people affected were told. Logging one alerts the privacy managers.
- **A privacy contact** (name and email) is part of the lab profile, printed in email footers and linked from the sign-in page.

## Report a problem
- **Anyone at the bench or front desk** (`tests.work`, `jobs.view` or `quality.view`) raises a non-conformance from a test or job page with *Report a problem*: a few words, what happened, how serious. The record it concerns is filled in. The quality team works it as usual.
- **The person who raised it** sees their own reports and how far each has got (received, being fixed, being checked, closed) on their account page, through `GET /quality/nc/mine`. They do not get the full non-conformance register.

## WhatsApp
- **Through the WhatsApp Business Cloud API (Meta) only.** No unofficial gateways: they break Meta's terms and get numbers banned. The lab connects its own WhatsApp Business number with two server settings, `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. The WhatsApp module stays off, and cannot be turned on, until both are set.
- **Templates.** WhatsApp lets a business start a conversation only with a template it has approved, and the PDF goes as the template's document header. Each message (report, invoice, samples received, payment reminder) offers a set of values (contact, customer, lab name and phone, numbers, dates, amounts). In Admin → WhatsApp the lab picks which of them fill {{1}}, {{2}}… and in what order, to match the wording it had approved, along with the template's name and language. That page also has a test send (Meta's `hello_world`) and the recent messages.
- **Consent.** The sender must tick that the customer agreed to WhatsApp messages. Their name is stored on the message, and the send is audited.
- **Who may send** each kind is whoever may email it (`reports.issue`, `invoices.edit`, `reminders.send`, `jobs.create`/`jobs.edit`). Contacts' phone numbers are suggested only to people with `customers.view`, and other people see past numbers masked.
- **Delivery.** Messages are queued and sent by the worker, which retries on failure. PDFs that are not yet stored (invoice, acknowledgement) are rendered first.
- **Delivered and read.** Meta's status webhook calls `/api/v1/webhooks/whatsapp`. The URL is proved once with `WHATSAPP_VERIFY_TOKEN`, and each call must carry Meta's signature made with `WHATSAPP_APP_SECRET`; unsigned or wrongly signed calls are refused. A message's status only moves forwards (sent → delivered → read), so late or repeated receipts change nothing, and a failed one records WhatsApp's reason. Without the two settings, messages still send but stay at "sent".
- **No SMS, no Hindi text** (by request).

## Help assistant ("Ask AI")
- **Answers only from the published help pages, from this server.** The docs build writes `help-index.json`; the API reads it (`HELP_INDEX_URL` or `HELP_INDEX_PATH`, re-read every 10 minutes) and searches it with BM25, optionally blended with Voyage embeddings. Only the API calls the model, so the key never reaches a browser. Default model `claude-haiku-5-5`, low effort, `MAX_OUTPUT_TOKENS` 800, fixed system prompt marked for caching.
- **Refuse before spending.** In order: assistant off / login required; browser check (user agent, `X-Requested-With: lims-help`, allowed `Origin`); per-minute and per-day limits per person or per hashed address; Cloudflare Turnstile for anonymous visitors when configured; input cleaning (tags, control characters, length, garbage); the same question twice in 5 s; obvious prompt injection and off-topic requests (fixed reply); a relevance gate (top BM25 score ≥ 2.5 and ≥ 60% of the question's terms in the best excerpt, tuned on a 39-question set and checked on a held-out 12); the 7-day answer cache; daily and monthly budgets. Only then the model.
- **Prompt injection.** Excerpts and the question go in tagged blocks the instructions call data; tags inside them are stripped so they cannot close the blocks. Nothing secret is in the model's context.
- **Privacy.** Questions are scrubbed of emails, phone numbers, long numbers and GSTINs before they are sent or stored. Logs keep no IP, account or answer text, and are deleted after `HELP_LOG_RETENTION_DAYS` (90). Blocked text is not kept.
- **Access levels.** Pages with `access: staff` are left out of the public index; the server also never answers anonymous visitors from staff chunks, whatever index it is given.
- **CORS.** Extra `ALLOWED_ORIGINS` apply to `/api/v1/help/*` only; every other route still accepts the app's own origin alone.

## Graphs and instrument reports on test reports
- **Three kinds of test file, by purpose.** *Result images and graphs* (PNG, JPEG, WebP) print in the report body as numbered figures, labelled with the sample, test, instrument and date. *Instrument reports* (the instrument software's own PDF) print as annexures A, B… after the body. *Raw data* (any format) and *worksheets* are kept as the original record and never print. This follows ISO/IEC 17025 7.8 and NABL practice: an attachment is part of the report only if it is identified with the report and its pages are counted.
- **Annexures are merged into the one signed PDF, not attached beside it.** Each source page is placed on an A4 page (landscape for landscape pages) under a header with the annexure letter, test, title and report number, and the footer's "Page x of y" counts the annexure pages too. The body ends "Annexure A follows" and the last annexure page "End of Report", so a missing page shows.
- **Frozen by fingerprint.** The report content records each annexure's SHA-256; rendering refuses (`ANNEX_CHANGED`, 409) if the stored file no longer matches, so a re-issued copy cannot silently differ.
- **Limits.** 20 pages a PDF and 60 a test keep reports printable. Password-protected or unreadable PDFs are refused at upload with a clear message, never at issue time.
- **Printing is a per-file choice with a per-test default.** `FileObject.printOnReport`, defaulting from `TestMaster.printAttachments` (on). Captions and the print choice change through `PATCH /files/{id}` only while the test may be edited, and each change is audited. Existing result images were set to print, as they did before.
