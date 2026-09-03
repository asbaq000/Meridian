-- =========================================================================
-- 003_late_cancellation.sql
--
-- Cancelling and rescheduling stop sharing a rule.
--
-- Blocking a customer from cancelling inside the cutoff window had a perverse
-- outcome: someone who definitely is not coming could not say so, and the
-- provider was left holding a slot that no one else could book either. The
-- late notice is information the provider needs, and withholding it helps
-- nobody.
--
-- So: cancelling is always permitted, and a cancellation made inside the
-- window is recorded as late rather than refused. Rescheduling keeps the hard
-- rule, because it does not merely inform the provider - it asks them to
-- accommodate a different time.
-- =========================================================================

ALTER TABLE bookings
  ADD COLUMN cancelled_late boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN bookings.cancelled_late IS
  'Cancelled inside the provider''s notice window. The cancellation still went '
  'through; this records that it was late, for the provider''s email and any '
  'downstream fee policy.';

COMMENT ON COLUMN bookings.cutoff_overridden IS
  'An admin forced a reschedule through the cutoff window. Cancellations no '
  'longer need an override, so this now only ever applies to reschedules.';

-- Lets an admin view answer "how often is this provider cancelled on late?"
-- without scanning the whole table.
CREATE INDEX bookings_cancelled_late_idx ON bookings (provider_id, cancelled_at DESC)
  WHERE cancelled_late;
