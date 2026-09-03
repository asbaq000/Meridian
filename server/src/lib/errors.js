/**
 * Domain errors carry an HTTP status and a stable machine-readable `code`, so
 * the frontend can branch on `SLOT_TAKEN` or `CANCELLATION_CUTOFF_PASSED`
 * without string-matching prose.
 */
export class AppError extends Error {
  constructor(message, { status = 400, code = 'BAD_REQUEST', details = undefined } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) =>
  new AppError(msg, { status: 400, code: 'BAD_REQUEST', details });
export const unauthorized = (msg = 'Authentication required') =>
  new AppError(msg, { status: 401, code: 'UNAUTHENTICATED' });
export const forbidden = (msg = 'You do not have access to this resource') =>
  new AppError(msg, { status: 403, code: 'FORBIDDEN' });
export const notFound = (msg = 'Not found') =>
  new AppError(msg, { status: 404, code: 'NOT_FOUND' });
export const conflict = (msg, code = 'CONFLICT', details) =>
  new AppError(msg, { status: 409, code, details });

/** Raised when the exclusion constraint rejects a booking. */
export const slotTaken = (details) =>
  new AppError('That time is no longer available. Someone just took it.', {
    status: 409,
    code: 'SLOT_TAKEN',
    details,
  });

export const outsideAvailability = () =>
  new AppError('The provider is not available at that time.', {
    status: 409,
    code: 'OUTSIDE_AVAILABILITY',
  });

export const cutoffPassed = (cutoffHours, startsAt) =>
  new AppError(
    `This booking starts in less than ${cutoffHours}h and can no longer be changed. Contact an admin to override.`,
    {
      status: 409,
      code: 'CANCELLATION_CUTOFF_PASSED',
      details: { cutoffHours, startsAt },
    },
  );
