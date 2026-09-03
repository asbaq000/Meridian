-- =========================================================================
-- 001_init.sql - core schema
--
-- Design notes that matter:
--
--  * Every instant is `timestamptz`. Postgres normalises timestamptz to UTC
--    internally, so "store all times in UTC" is enforced by the type system
--    rather than by convention. Wall-clock inputs (availability rules) are
--    stored as timezone-naive minute offsets and are only resolved to real
--    instants against a provider's IANA timezone - which is what makes DST
--    transitions come out right.
--
--  * Double-booking is prevented by a GiST EXCLUSION CONSTRAINT, not by
--    application code. There is deliberately no check-then-insert anywhere
--    in this codebase: the database rejects the second writer of a racing
--    pair even when both transactions read an empty calendar.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist; -- lets us mix `uuid WITH =` and `range WITH &&`

-- ---------------------------------------------------------------- users ---
CREATE TYPE user_role AS ENUM ('admin', 'provider', 'customer');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text        NOT NULL,
  password_hash  text        NOT NULL,
  name           text        NOT NULL,
  role           user_role   NOT NULL DEFAULT 'customer',
  -- IANA zone, e.g. 'Europe/Berlin'. Used to render every instant we show
  -- this user, and to render their copy of a confirmation email.
  timezone       text        NOT NULL DEFAULT 'UTC',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness without requiring the citext extension.
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- ------------------------------------------------------------ providers ---
-- A "provider" is the bookable entity: a person, a room, a piece of kit.
-- It may or may not be attached to a login (user_id).
CREATE TABLE providers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  slug            text        NOT NULL,
  description     text        NOT NULL DEFAULT '',
  timezone        text        NOT NULL DEFAULT 'UTC',
  -- Minimum gap enforced between two appointments, in minutes.
  buffer_minutes  integer     NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 480),
  -- Default appointment length, and the granularity slot starts are offered on.
  slot_minutes    integer     NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 1440),
  -- Customers cannot book something starting sooner than this.
  min_notice_minutes integer  NOT NULL DEFAULT 60 CHECK (min_notice_minutes >= 0),
  -- How far ahead the calendar is open.
  booking_horizon_days integer NOT NULL DEFAULT 60 CHECK (booking_horizon_days BETWEEN 1 AND 730),
  -- Cancellations/reschedules are refused within this many hours of the start.
  cancellation_cutoff_hours integer NOT NULL DEFAULT 24 CHECK (cancellation_cutoff_hours >= 0),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX providers_slug_key ON providers (lower(slug));
CREATE INDEX providers_user_id_idx ON providers (user_id);

-- --------------------------------------------------- availability rules ---
-- Recurring weekly availability, expressed in the PROVIDER's local wall clock.
-- day_of_week follows ISO-8601: 1 = Monday ... 7 = Sunday (matching Luxon's
-- DateTime#weekday, so there is no off-by-one translation layer anywhere).
-- start/end are minutes from local midnight; end_minute = 1440 means midnight.
CREATE TABLE availability_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  day_of_week   smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_minute  integer  NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute    integer  NOT NULL CHECK (end_minute   BETWEEN 1 AND 1440),
  -- Optional validity window, so "new hours from March" needs no delete.
  effective_from date,
  effective_to   date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_rules_order CHECK (end_minute > start_minute),
  CONSTRAINT availability_rules_effective_order
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX availability_rules_provider_idx ON availability_rules (provider_id, day_of_week);

-- ---------------------------------------------- availability exceptions ---
-- One-off overrides for a single local date.
--   'blocked'      -> the whole date is unavailable (holiday)
--   'custom_hours' -> replaces the recurring rules for that date entirely
CREATE TYPE availability_exception_kind AS ENUM ('blocked', 'custom_hours');

CREATE TABLE availability_exceptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  kind           availability_exception_kind NOT NULL,
  start_minute   integer CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute     integer CHECK (end_minute   BETWEEN 1 AND 1440),
  note           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- 'blocked' carries no hours; 'custom_hours' must carry a valid range.
  CONSTRAINT availability_exceptions_shape CHECK (
    (kind = 'blocked'      AND start_minute IS NULL AND end_minute IS NULL) OR
    (kind = 'custom_hours' AND start_minute IS NOT NULL AND end_minute IS NOT NULL
                           AND end_minute > start_minute)
  )
);

CREATE INDEX availability_exceptions_provider_idx
  ON availability_exceptions (provider_id, exception_date);

-- ------------------------------------------------------------- bookings ---
CREATE TYPE booking_status AS ENUM ('confirmed', 'cancelled', 'completed');

-- An admin "block time" entry is stored as a booking row with kind='block'.
-- That is not a shortcut: it means blocked time is covered by exactly the same
-- exclusion constraint as real appointments, so nothing can ever be booked
-- over a block, by any code path.
CREATE TYPE booking_kind AS ENUM ('appointment', 'block');

CREATE TABLE bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  customer_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  kind           booking_kind   NOT NULL DEFAULT 'appointment',
  status         booking_status NOT NULL DEFAULT 'confirmed',

  -- The appointment itself, as the customer understands it.
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,

  -- The window the provider is actually consumed for: the appointment plus
  -- the provider's buffer on the trailing edge. Maintained by a trigger (see
  -- 002) so it can never drift from starts_at/ends_at/buffer_minutes.
  buffer_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 480),
  -- Seeded with the empty range; the BEFORE trigger in 002 overwrites it on
  -- every insert and update, so application code never supplies this value.
  reserved_range tstzrange NOT NULL DEFAULT 'empty',

  -- Snapshot of the timezones in play at booking time, so a later profile
  -- edit cannot retroactively rewrite what a confirmation email said.
  customer_timezone text NOT NULL DEFAULT 'UTC',
  provider_timezone text NOT NULL DEFAULT 'UTC',

  notes               text NOT NULL DEFAULT '',
  cancelled_at        timestamptz,
  cancelled_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason text NOT NULL DEFAULT '',
  -- True when a cancel/reschedule inside the cutoff window was pushed through
  -- by an admin. Kept for audit rather than thrown away.
  cutoff_overridden   boolean NOT NULL DEFAULT false,

  -- A reschedule cancels this row and inserts a replacement; these link the two.
  rescheduled_to   uuid REFERENCES bookings(id) ON DELETE SET NULL,
  rescheduled_from uuid REFERENCES bookings(id) ON DELETE SET NULL,

  reminder_sent_at timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bookings_time_order CHECK (ends_at > starts_at),
  -- Appointments belong to a customer; admin blocks do not.
  CONSTRAINT bookings_customer_shape CHECK (
    (kind = 'appointment' AND customer_id IS NOT NULL) OR kind = 'block'
  ),

  -- ===================================================================
  -- THE constraint. Two confirmed rows for the same provider may not hold
  -- overlapping reserved windows. Postgres takes a lock on the GiST index
  -- entry, so of two concurrent inserts for the same slot exactly one
  -- commits and the other raises SQLSTATE 23P01 (exclusion_violation).
  --
  -- Partial (`WHERE status = 'confirmed'`) so cancelling frees the slot the
  -- instant the UPDATE commits, with no cleanup step.
  -- ===================================================================
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    provider_id    WITH =,
    reserved_range WITH &&
  ) WHERE (status = 'confirmed')
);

CREATE INDEX bookings_provider_time_idx ON bookings (provider_id, starts_at)
  WHERE status = 'confirmed';
CREATE INDEX bookings_customer_idx ON bookings (customer_id, starts_at DESC);
-- Supports the reminder sweep.
CREATE INDEX bookings_reminder_idx ON bookings (starts_at)
  WHERE status = 'confirmed' AND kind = 'appointment' AND reminder_sent_at IS NULL;

-- --------------------------------------------------------- email outbox ---
-- Every notification is recorded, whether it went to Resend or to the console
-- transport. Gives the admin view something to show and makes the tests able
-- to assert on notifications without stubbing the transport.
CREATE TABLE email_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid REFERENCES bookings(id) ON DELETE CASCADE,
  to_email    text NOT NULL,
  template    text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  transport   text NOT NULL,
  status      text NOT NULL DEFAULT 'sent',
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_log_booking_idx ON email_log (booking_id, created_at DESC);
