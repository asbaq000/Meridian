# Meridian — smart booking & scheduling

A Calendly-shaped booking system where the interesting parts are underneath the UI: slots are
derived from recurring rules rather than stored, every instant is UTC and every rendering names its
zone, and **a slot cannot be double-booked because the database will not let it happen** — not
because the application checks first.

```
Next.js 15 (App Router) + Tailwind v4   ->   Express + Node 20   ->   Postgres 14+
```

---

## The three decisions that shape everything

### 1. Double-booking is a schema problem, not a code problem

`bookings` carries a `tstzrange` of the time actually consumed (the appointment plus the provider's
buffer), and a GiST exclusion constraint over `(provider_id, reserved_range)`:

```sql
CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
  provider_id    WITH =,
  reserved_range WITH &&
) WHERE (status = 'confirmed')
```

Consequences worth spelling out:

- There is **no check-then-insert anywhere in the codebase**. `createBooking` does not ask whether
  the slot is free; it inserts and lets Postgres arbitrate. Of two concurrent transactions, exactly
  one commits and the other gets SQLSTATE `23P01`, which becomes a `409 SLOT_TAKEN`.
- The constraint is **partial** (`WHERE status = 'confirmed'`), so cancelling frees the slot the
  instant the `UPDATE` commits. There is no release step that could be forgotten.
- Admin "block time" is a `bookings` row with `kind = 'block'`, so blocked time is covered by the
  same constraint. Nothing can be booked over a block, through any code path — including one an
  admin uses to bypass published hours.
- `reserved_range` is maintained by a `BEFORE INSERT OR UPDATE` trigger, never by application code,
  so it cannot drift from `starts_at` / `ends_at` / `buffer_minutes`.

A unique index on `(provider_id, starts_at)` would *look* like it solves this and does not: it
accepts a 10:00–11:00 booking alongside a 10:15–10:45 one. Range exclusion is the difference.

### 2. An instant and a wall-clock time are different types

- `timestamptz` everywhere — Postgres normalises it to UTC, so "store in UTC" is enforced by the
  type system rather than by discipline.
- Availability rules are stored as `(day_of_week, start_minute, end_minute)` — wall clock, no zone.
  They only become instants when resolved against the provider's IANA zone.
- That resolution is built from calendar fields, not by adding minutes to local midnight. On a
  spring-forward date those differ: midnight + 540 minutes is 10:00 local on a 23-hour day, while
  "09:00" is what the provider meant.
- Nothing in the app formats an instant without naming a zone. `formatForZone(instant, zone)` is the
  only formatter, and every booking is serialised with **both** the provider's and the customer's
  local rendering alongside the raw UTC value.

### 2b. The browser's zone is not knowable during render

Next renders client components on the server first, so anything read from the
*runtime* rather than from props or state will differ between the two passes:

- `Intl.DateTimeFormat().resolvedOptions().timeZone` reports the Node process's
  zone during SSR and the user's zone in the browser. On a UTC deploy host that
  is a mismatch for essentially every user.
- `DateTime.now()` in a `useState` initialiser gives the server one instant and
  the hydrating client another.

So the rule is: **no clock and no zone detection during the first render.** Both
runtimes start at UTC with a `--:--` placeholder, and `AuthProvider` resolves the
real zone in an effect after mount (`timezoneResolved` says when it is known).
`timezoneOptions()` is a pure function of its arguments for the same reason - it
used to call `browserTimezone()` internally, which made the `<option>` list
itself unhydratable.

Note that a hydration warning mentioning `bis_skin_checked`, `bis_register`,
`data-liner-extension-version` or similar is **not** this bug - those attributes
are injected by browser extensions (Bitdefender, Liner) before React loads.
`<html>` and `<body>` carry `suppressHydrationWarning` for exactly that, which
suppresses one level only, so a real mismatch inside the app still reports.

### 3. Slots are derived, never stored

`slotEngine.js` is pure — no database, no `Date.now()`; the clock is an argument. That is what makes
DST, buffers, horizons and exceptions testable without a server, and it is why the hardest logic in
the project has the densest tests.

```
recurring rules for the weekday
  -> replaced wholesale by a custom_hours exception, if one exists
  -> dropped entirely by a blocked exception
  -> merged into non-overlapping wall-clock windows
  -> resolved to UTC instants against the provider zone   (DST happens here)
  -> walked in `granularity` steps
  -> filtered by min-notice, horizon, and existing reserved ranges
```

---

## Setup

**Requires** Node 20+ and a Postgres 14+ database. The `pgcrypto` and `btree_gist` extensions are
created by the first migration; both are available on Neon, Supabase, RDS and stock Postgres.

```bash
npm install
cp server/.env.example server/.env    # then fill in DATABASE_URL
npm run migrate
npm run seed
npm run dev                           # API on :4000, web on :3000
```

**No database to hand?** `npm run db:local` unpacks real Postgres binaries into `node_modules` and
runs a cluster on `127.0.0.1:55432` with a `booking` and a `booking_test` database — no Docker, no
install, no cloud account. Leave it running in its own terminal and point both URLs at it. It is a
development fixture only; anything real should use a managed Postgres.

### Connecting to Supabase

Use the **session pooler**, not the direct host:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Two things bite here. `db.<project-ref>.supabase.co` has had its A record removed — it is IPv6-only,
so any machine without an IPv6 route fails with `ENOTFOUND` that looks like a wrong hostname. And
the pooler username is `postgres.<project-ref>`, not `postgres`; getting it wrong returns
`XX000 tenant/user not found`, which reads like an outage rather than a typo. The region is the one
shown in your project settings.

`npm run dev` runs both workspaces. `web/.env.local` only matters if the API is not on
`http://localhost:4000`.

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Required. |
| `TEST_DATABASE_URL` | Separate database for `npm test`. **The suite truncates tables** — never point this at your dev database. |
| `JWT_SECRET` | Signing secret. Change it for anything real. |
| `RESEND_API_KEY` | Optional. Empty → emails print to the console; set → real delivery, no code change. |
| `REMINDERS_ENABLED` | Run the 24h reminder sweep inside the API process. |

### Seeded accounts

Password for all: `password123`

| Role | Email | Timezone |
| --- | --- | --- |
| admin | `admin@booking.test` | Europe/Berlin |
| provider | `nadia@booking.test` | Europe/Berlin |
| provider | `kenji@booking.test` | Asia/Tokyo |
| customer | `sam@booking.test` | America/Los_Angeles |
| customer | `priya@booking.test` | Asia/Kolkata |

Sign in as `sam@` (Los Angeles) and book with Nadia (Berlin) to see the cross-timezone path — that
pairing is seeded deliberately, because a booking app seeded with one timezone looks correct right
up until someone in another one uses it.

---

## Tests

```bash
npm test
```

`server/tests/slotEngine.test.js` needs no database. Everything else needs `TEST_DATABASE_URL`.

| File | Covers |
| --- | --- |
| `slotEngine.test.js` | Slot derivation, exceptions, buffers, horizons, and DST — including the wall-clock hour that does not exist on a spring-forward day and the one that happens twice in autumn. |
| `concurrency.test.js` | 25 simultaneous requests for one slot; overlapping-but-not-identical starts; buffer contention; a raw two-transaction race below the application entirely; a freed slot being re-contended; concurrent reschedules onto one target. |
| `bookingFlow.test.js` | Slot lifecycle, cross-timezone rendering, availability enforcement, the cancel-always / reschedule-blocked split, reschedule release-then-take. |
| `adminAndReminders.test.js` | Blocks, admin calendar, the reminder sweep under concurrent runs, availability editing, buffer changes that would conflict. |

The concurrency tests assert on **the row count in the table**, not on response codes — that is what
a double-booking actually is.

### What the concurrency tests found

The first run failed, usefully. Under genuine simultaneity the losing writer does not get
`23P01 (exclusion_violation)` — it gets `40P01 (deadlock_detected)`. Both transactions insert their
own tuple, then each scans the GiST index, finds the other's uncommitted row and waits for it: a
real cycle, which Postgres breaks after `deadlock_timeout` (1s) by killing one. Exactly one booking
still survived, so the guarantee held — but 24 of 25 racers were getting a 500 instead of a usable
409, and each waited a full second to get it.

Two changes, in order of importance:

1. **Retry on `40P01`/`40001`.** A deadlock means the transaction was aborted *before* the
   constraint could answer, so the slot's status is genuinely unknown. Retrying gets a real answer:
   either the insert succeeds because the other writer rolled back, or it fails with a clean
   `23P01` because they committed.
2. **A transaction-scoped advisory lock per provider** (`pg_advisory_xact_lock`) taken before the
   insert. This is *not* the correctness mechanism — the exclusion constraint is, and it holds with
   or without the lock, which is why the raw two-transaction test deliberately bypasses it. The lock
   is for liveness: writers queue instead of forming a cycle, so the loser gets an instant,
   deterministic `SLOT_TAKEN`. It took the suite from 63s to 6s.

---

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/register` `\|` `/login` | Self-registration always creates a `customer`. |
| `GET` `PATCH` | `/api/auth/me` | Includes the caller's providers. |
| `GET` | `/api/providers` `\|` `/:idOrSlug` | Public. Accepts a uuid or a slug. |
| `GET` | `/api/providers/:id/slots?from&to&timezone` | Derived slots, grouped by the **viewer's** local date. |
| `GET` `PUT` `POST` `DELETE` | `/api/providers/:id/availability/...` | Rules and exceptions. Owner or admin. |
| `POST` | `/api/bookings` | The concurrency-safe path. |
| `POST` | `/api/bookings/:id/cancel` | Always succeeds; late ones flagged. |
| `POST` | `/api/bookings/:id/reschedule` | Cutoff enforced; `override` is admin-only. |
| `GET` | `/api/admin/calendar?from&to&timezone` | Every provider, rendered in the admin's zone. |
| `POST` `DELETE` | `/api/admin/blocks` | Blocked time, same constraint as bookings. |
| `POST` | `/api/admin/reminders/run` | Runs the sweep on demand. |
| `GET` | `/api/admin/emails` | Every notification, delivered or failed. |

Errors carry a stable `code` (`SLOT_TAKEN`, `OUTSIDE_AVAILABILITY`, `CANCELLATION_CUTOFF_PASSED`,
`BUFFER_CONFLICTS_WITH_BOOKINGS`, …) so the frontend branches on the cause rather than on prose.

---

## Notifications

`services/email/` puts the seam at the transport, not the call sites. With no `RESEND_API_KEY` the
console transport prints formatted messages; with one, delivery goes to Resend. Either way every
message is written to `email_log`, which is what the admin Notifications tab reads and what the
tests assert against — so notifications are verifiable without stubbing anything.

Every template renders the appointment in **both** parties' zones, because a confirmation that only
shows one is useless to whoever forwards it.

Reminders: `runReminderSweep()` claims rows with `FOR UPDATE SKIP LOCKED`, so several processes (or
the in-process timer and a cron invocation at once) can never double-send. Run standalone with
`npm run job:reminders -w server`.

---

## Deploying to Vercel

Two Vercel projects from this one repo, because the two halves have different
shapes: `web/` is a normal Next.js app, and `server/` becomes a serverless
function.

Three things change when the API stops being a long-lived process, and they are
already handled in the code - worth knowing so nothing here looks arbitrary:

- **No `app.listen`.** `api/[...path].js` exports the Express app instead. It is
  a catch-all route so the function still receives the original request URL,
  which Express needs for its own routing. `src/server.js` stays the local
  entry point.
- **Reminders move to Vercel Cron.** A `setInterval` inside a function that is
  frozen between invocations never fires. `vercel.json` schedules an hourly call
  to `GET /api/cron/reminders`, guarded by `CRON_SECRET`. The sweep itself is
  unchanged and still claims rows with `FOR UPDATE SKIP LOCKED`, so a double
  invocation cannot double-send.
- **One database connection per instance.** Each warm instance keeps its own
  pool, so `max` multiplies across instances. It drops to 1 when `VERCEL` is set.

### 1. API project

New Project -> import this repo -> **Root Directory: `server`**. If Vercel asks,
allow it to include files outside the root directory: the npm workspace lockfile
lives at the repo root.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler**, port **6543** - not the 5432 session pooler |
| `JWT_SECRET` | a long random string |
| `CRON_SECRET` | a long random string; Vercel Cron presents it as a bearer token |
| `CORS_ORIGIN` | the web project's URL, once you have it |
| `NODE_ENV` | `production` |
| `RESEND_API_KEY` | optional; without it emails go to the function logs |

Port 6543 matters. The 5432 session pooler holds a connection for the life of
the session, which serverless exhausts quickly. Transaction mode hands the
connection back at each commit. The `pg_advisory_xact_lock` used on the booking
path is transaction-scoped, so it survives transaction pooling intact - a
session-level lock would not have.

### 2. Web project

New Project -> same repo -> **Root Directory: `web`**.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | the API project's URL, e.g. `https://meridian-api.vercel.app` |

Then go back and set `CORS_ORIGIN` on the API to this project's URL and redeploy
it, or every browser request will be blocked.

### 3. Migrations

Vercel does not run them. Apply them from your machine against the same database
before the first deploy - use the **5432** session pooler for this, since DDL
belongs on a session connection:

```bash
npm run migrate
npm run seed      # optional: demo providers and accounts
```

### Checking it worked

`GET /api/health` on the API URL returns the database time and the active email
transport. If it answers but the site cannot reach it, the cause is almost
always `CORS_ORIGIN` still pointing somewhere else.

---

## Notable behaviours

- **Cancelling is never refused; rescheduling still is.** These are not the
  same act. Cancelling *informs* the provider - it hands time back, and blocking
  it only means they hold a slot nobody can use, including the customer who is
  definitely not coming. Rescheduling *asks* them to take a different time,
  which is what short notice makes unreasonable. So a cancellation inside the
  notice window goes through and is recorded as `cancelled_late` (the
  provider's email says so, and any fee policy has something to act on), while
  a reschedule inside the window returns `409 CANCELLATION_CUTOFF_PASSED`
  unless an admin explicitly overrides it.
- **Reschedule releases before it takes**, inside one transaction. A small shift (10:00 → 10:15)
  therefore does not collide with itself, and if the new slot loses a race the `ROLLBACK` leaves the
  original booking exactly as it was. A reschedule can never destroy a booking by failing halfway.
- **Raising a provider's buffer rewrites future bookings.** If that would make two existing
  appointments overlap, the change is refused with `BUFFER_CONFLICTS_WITH_BOOKINGS` rather than half
  applied.
- **Admins can book outside published hours but never over an existing booking.** The availability
  check is skippable; the exclusion constraint is not.
- **Invalid IANA zones are rejected at the database**, via a CHECK constraint, not only in the API.

## Known limits

- Availability rules use a single weekly pattern per provider with optional `effective_from` /
  `effective_to`; there is no rule-level recurrence beyond weekly.
- The reminder sweep is a poll, not a scheduler. At the volumes this is built for that is the right
  trade; a large deployment would want a queue.
- Out of scope per the brief: payments, multi-resource group bookings, recurring appointment series,
  SMS.
