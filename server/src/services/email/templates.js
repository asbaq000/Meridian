import { formatForZone, diffMinutes } from '../../lib/time.js';

/**
 * Every template renders the appointment twice: once in the recipient's own
 * zone, once in the other party's. That is the point of the requirement -
 * a customer in Los Angeles booking a provider in Berlin needs to see 08:00
 * PDT *and* know the provider sees 17:00 CEST, or the confirmation is useless
 * to whoever forwards it.
 */
function bothClocks(booking, recipientRole) {
  const customer = {
    label: 'Your time',
    value: formatForZone(booking.starts_at, booking.customer_timezone),
  };
  const provider = {
    label: `${booking.provider_name}'s time`,
    value: formatForZone(booking.starts_at, booking.provider_timezone),
  };
  if (recipientRole === 'provider') {
    return [
      { label: 'Your time', value: provider.value },
      { label: `${booking.customer_name ?? 'Customer'}'s time`, value: customer.value },
    ];
  }
  return [customer, provider];
}

const line = (label, value) => `${label.padEnd(22)} ${value}`;

function body(heading, booking, recipientRole, extraLines = []) {
  const duration = Math.round(diffMinutes(booking.starts_at, booking.ends_at));
  const clocks = bothClocks(booking, recipientRole);
  return [
    heading,
    '',
    line('Provider', booking.provider_name),
    booking.customer_name ? line('Customer', booking.customer_name) : null,
    line('Duration', `${duration} minutes`),
    '',
    ...clocks.map((c) => line(c.label, c.value)),
    line('UTC', booking.starts_at),
    ...(booking.notes ? ['', line('Notes', booking.notes)] : []),
    ...(extraLines.length ? ['', ...extraLines] : []),
    '',
    `Reference: ${booking.id}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export const TEMPLATES = {
  booking_confirmed: (booking, role) => ({
    subject: `Booking confirmed - ${booking.provider_name}, ${formatForZone(
      booking.starts_at,
      role === 'provider' ? booking.provider_timezone : booking.customer_timezone,
      { includeZone: false },
    )}`,
    text: body(
      role === 'provider'
        ? `${booking.customer_name ?? 'A customer'} has booked an appointment with you.`
        : `Your appointment with ${booking.provider_name} is confirmed.`,
      booking,
      role,
    ),
  }),

  booking_cancelled: (booking, role) => ({
    subject: `Booking cancelled - ${booking.provider_name}, ${formatForZone(
      booking.starts_at,
      role === 'provider' ? booking.provider_timezone : booking.customer_timezone,
      { includeZone: false },
    )}`,
    text: body(
      'This appointment has been cancelled and the time is available again.',
      booking,
      role,
      [
        booking.cancellation_reason ? line('Reason', booking.cancellation_reason) : null,
        booking.cancelled_late
          ? line('Note', 'Cancelled inside the notice window - short notice.')
          : null,
        booking.cutoff_overridden
          ? line('Note', 'Pushed through the cutoff by admin override.')
          : null,
      ].filter(Boolean),
    ),
  }),

  booking_rescheduled: (booking, role, ctx = {}) => ({
    subject: `Booking moved - ${booking.provider_name}, ${formatForZone(
      booking.starts_at,
      role === 'provider' ? booking.provider_timezone : booking.customer_timezone,
      { includeZone: false },
    )}`,
    text: body(
      'This appointment has been moved. The new time is below.',
      booking,
      role,
      ctx.previous
        ? [
            line(
              'Previously',
              formatForZone(
                ctx.previous.starts_at,
                role === 'provider' ? booking.provider_timezone : booking.customer_timezone,
              ),
            ),
          ]
        : [],
    ),
  }),

  booking_reminder: (booking, role) => ({
    subject: `Reminder: ${booking.provider_name} in under 24 hours`,
    text: body(
      'This is a reminder for your upcoming appointment.',
      booking,
      role,
    ),
  }),
};
