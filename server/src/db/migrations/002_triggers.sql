-- =========================================================================
-- 002_triggers.sql - keep derived columns honest
-- =========================================================================

-- `reserved_range` is what the exclusion constraint actually compares, so it
-- must not be writable by application code. A BEFORE trigger recomputes it on
-- every insert and update from starts_at / ends_at / buffer_minutes.
--
-- Why a trigger and not a GENERATED column: `timestamptz + interval` is STABLE
-- rather than IMMUTABLE in Postgres (an interval can carry months/days, whose
-- meaning depends on the session TimeZone), and generated columns require an
-- immutable expression. A trigger has no such restriction and gives the same
-- guarantee: the value cannot drift from its inputs.
--
-- The buffer is applied to the trailing edge only. Applying it to both edges
-- would put 2x buffer between adjacent appointments; with a trailing-only
-- buffer, back-to-back bookings end up separated by exactly buffer_minutes.
CREATE OR REPLACE FUNCTION bookings_sync_reserved_range() RETURNS trigger AS $fn$
BEGIN
  NEW.reserved_range := tstzrange(
    NEW.starts_at,
    NEW.ends_at + make_interval(mins => NEW.buffer_minutes),
    '[)'
  );
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_sync_reserved_range_trg
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_sync_reserved_range();

-- Generic updated_at bump for the tables that carry one.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER providers_touch_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Guard against an IANA zone typo reaching the database, where it would only
-- surface much later as a wrong rendering. `now() AT TIME ZONE <bad zone>`
-- raises invalid_parameter_value, which is exactly what we want.
CREATE OR REPLACE FUNCTION assert_valid_timezone(tz text) RETURNS boolean AS $fn$
BEGIN
  PERFORM now() AT TIME ZONE tz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$fn$ LANGUAGE plpgsql STABLE;

ALTER TABLE users
  ADD CONSTRAINT users_timezone_valid CHECK (assert_valid_timezone(timezone));
ALTER TABLE providers
  ADD CONSTRAINT providers_timezone_valid CHECK (assert_valid_timezone(timezone));
