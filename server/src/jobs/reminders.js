import { withTransaction } from '../db/index.js';
import { env } from '../config/env.js';
import { sendBookingEmail } from '../services/email/index.js';

/**
 * Reminder sweep: flag and notify confirmed appointments starting inside the
 * lead window that have not been reminded yet.
 *
 * `FOR UPDATE SKIP LOCKED` is the detail that matters. It makes the sweep safe
 * to run from several processes at once (or from the in-process timer and a
 * cron invocation simultaneously) without any of them sending a duplicate
 * reminder: whoever grabs a row first owns it, and the others simply skip past.
 */
export async function runReminderSweep({ leadHours = env.reminderLeadHours, limit = 100 } = {}) {
  const due = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT b.id
         FROM bookings b
        WHERE b.status = 'confirmed'
          AND b.kind = 'appointment'
          AND b.reminder_sent_at IS NULL
          AND b.starts_at > now()
          AND b.starts_at <= now() + make_interval(hours => $1)
        ORDER BY b.starts_at
        LIMIT $2
        FOR UPDATE OF b SKIP LOCKED`,
      [leadHours, limit],
    );
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    // Claim them inside the same transaction that holds the locks, so a row is
    // marked before anyone else can see it as unreminded.
    const { rows: claimed } = await client.query(
      `UPDATE bookings b
          SET reminder_sent_at = now()
        WHERE b.id = ANY($1::uuid[])
        RETURNING b.id`,
      [ids],
    );
    return claimed.map((r) => r.id);
  });

  if (due.length === 0) return { flagged: 0, sent: 0 };

  // Send outside the transaction: holding row locks across network I/O would
  // stall the booking path for as long as the mail provider takes to answer.
  const { loadBooking } = await import('../modules/bookings/booking.service.js');
  let sent = 0;
  for (const id of due) {
    try {
      const booking = await loadBooking(id);
      await sendBookingEmail('booking_reminder', booking);
      sent += 1;
    } catch (err) {
      console.error(`[reminders] booking ${id}: ${err.message}`);
    }
  }

  console.log(`[reminders] flagged ${due.length}, notified ${sent}`);
  return { flagged: due.length, sent };
}

let timer = null;

/** Start the in-process sweep. Kept opt-out so tests and CLI runs stay quiet. */
export function startReminderScheduler() {
  if (!env.remindersEnabled || timer) return null;
  const tick = () =>
    runReminderSweep().catch((err) => console.error('[reminders] sweep failed:', err.message));
  timer = setInterval(tick, env.reminderIntervalMs);
  timer.unref?.(); // never hold the process open on this alone
  console.log(
    `[reminders] sweeping every ${Math.round(env.reminderIntervalMs / 1000)}s for bookings within ${env.reminderLeadHours}h`,
  );
  tick();
  return timer;
}

export function stopReminderScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
