import { env } from '../../config/env.js';
import { query } from '../../db/index.js';
import { TEMPLATES } from './templates.js';

/**
 * Email delivery, behind a transport interface.
 *
 * The brief asks for "a real provider slotted in cleanly", so the seam is the
 * transport, not the call sites. Nothing outside this file knows whether a
 * message went to Resend or to stdout; `sendBookingEmail` is the same call
 * either way, and every message is recorded in `email_log` regardless, which
 * is what the admin view reads and what the tests assert against.
 */

const consoleTransport = {
  name: 'console',
  async send({ to, subject, text }) {
    const rule = '-'.repeat(72);
    console.log(
      `\n${rule}\n[email:console] To: ${to}\n[email:console] Subject: ${subject}\n${rule}\n${text}\n${rule}\n`,
    );
    return { id: `console-${Date.now()}` };
  },
};

/**
 * Resend over plain fetch. The `resend` npm package would work equally well;
 * one HTTP call is not worth a dependency, and this keeps the install slim.
 */
const resendTransport = {
  name: 'resend',
  async send({ to, subject, text }) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text }),
    });
    if (!res.ok) {
      throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
    }
    return res.json();
  },
};

export function getTransport() {
  return env.resendApiKey ? resendTransport : consoleTransport;
}

/** Low-level send. Logs to email_log whether delivery succeeded or not. */
export async function sendEmail({ to, subject, text, template, bookingId = null }) {
  const transport = getTransport();
  let status = 'sent';
  let error = null;
  try {
    await transport.send({ to, subject, text });
  } catch (err) {
    // A notification failing must never roll back a booking that is already
    // committed. Record it and move on; the admin view surfaces failures.
    status = 'failed';
    error = err.message;
    console.error(`[email] delivery failed via ${transport.name}: ${err.message}`);
  }

  await query(
    `INSERT INTO email_log (booking_id, to_email, template, subject, body, transport, status, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [bookingId, to, template, subject, text, transport.name, status, error],
  ).catch((err) => console.error(`[email] could not write email_log: ${err.message}`));

  return { status, transport: transport.name };
}

/**
 * Send one booking notification to everyone who should get it: the customer
 * always, and the provider's user account when the provider has one.
 */
export async function sendBookingEmail(template, booking, ctx = {}) {
  const render = TEMPLATES[template];
  if (!render) throw new Error(`Unknown email template: ${template}`);

  const recipients = [];
  if (booking.customer_email) {
    recipients.push({ email: booking.customer_email, role: 'customer' });
  }

  const { rows } = await query(
    `SELECT u.email FROM providers p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
    [booking.provider_id],
  );
  if (rows[0]?.email) recipients.push({ email: rows[0].email, role: 'provider' });

  const results = [];
  for (const recipient of recipients) {
    const { subject, text } = render(booking, recipient.role, ctx);
    results.push(
      await sendEmail({
        to: recipient.email,
        subject,
        text,
        template,
        bookingId: booking.id,
      }),
    );
  }
  return results;
}
