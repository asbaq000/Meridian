/**
 * Vercel serverless entry point for the API.
 *
 * This is a catch-all function: the filename `[...path].js` inside `api/`
 * makes Vercel route every `/api/*` request here, and - unlike a vercel.json
 * rewrite to a fixed `/api` destination - the function still receives the
 * original request URL. That matters because Express does its own routing:
 * it needs to see `/api/bookings/123/cancel`, not `/api`.
 *
 * Note what this file does NOT do, compared with src/server.js:
 *
 *  - It never calls `app.listen`. A serverless function is handed a request
 *    and a response; there is no port to bind.
 *  - It never starts the reminder scheduler. A `setInterval` inside a function
 *    that is frozen between invocations would simply never fire. Reminders run
 *    from Vercel Cron instead, hitting GET /api/cron/reminders (see
 *    vercel.json), which is why that route exists.
 *
 * src/server.js remains the entry point for running locally, where a
 * persistent process is the right shape and the in-process sweep works.
 */
import { createApp } from '../src/app.js';

// Built once per cold start and reused across invocations on the same
// instance, so the pg pool and route table are not rebuilt per request.
const app = createApp();

export default app;
