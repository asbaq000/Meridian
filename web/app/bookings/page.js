'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { bookings as bookingApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import {
  Badge,
  Button,
  Card,
  Chip,
  Empty,
  Field,
  Notice,
  Sheet,
  Skeleton,
  Spinner,
  Textarea,
  cn,
} from '@/components/ui';
import { clock, longLabel, offsetLabel, relative, zoneCity, isPast } from '@/lib/time';

function BookingsList() {
  const { user, ready, viewerTimezone } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const justBooked = search.get('just') === '1';

  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('upcoming');
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await bookingApi.list({ timezone: viewerTimezone });
      setList(res.bookings);
    } catch (e) {
      setError(e.message);
    }
  }, [viewerTimezone]);

  useEffect(() => {
    if (ready && !user) router.replace('/login?next=/bookings');
  }, [ready, user, router]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function doCancel() {
    setBusy(true);
    setCancelError(null);
    try {
      await bookingApi.cancel(cancelling.id, { reason });
      setCancelling(null);
      setReason('');
      load();
    } catch (e) {
      setCancelError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <Spinner label="Loading your bookings" />;
  if (!user) return null;

  const upcoming = (list ?? []).filter((b) => b.status === 'confirmed' && !isPast(b.startsAt));
  const past = (list ?? []).filter((b) => !(b.status === 'confirmed' && !isPast(b.startsAt)));
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 pb-24 sm:px-6 md:pb-10">
      <div className="settle mb-8">
        <p className="label mb-3">
          Your clock · {offsetLabel(viewerTimezone)} · {zoneCity(viewerTimezone)}
        </p>
        <h1 className="display text-[38px] sm:text-[48px]">
          Your
          <br />
          <strong>bookings.</strong>
        </h1>
      </div>

      {justBooked ? (
        <Notice tone="good" title="Booked" className="settle mb-6">
          A confirmation is on its way, with the time in your zone and in the provider&rsquo;s.
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="error" title="Could not load your bookings" className="mb-6">
          {error}
        </Notice>
      ) : null}

      <div className="settle settle-1 mb-5 flex gap-2">
        <Chip as="button" active={tab === 'upcoming'} onClick={() => setTab('upcoming')}>
          Upcoming
          <span className={tab === 'upcoming' ? 'text-on-ink/50' : 'text-mist'}>{upcoming.length}</span>
        </Chip>
        <Chip as="button" active={tab === 'past'} onClick={() => setTab('past')}>
          Past &amp; cancelled
          <span className={tab === 'past' ? 'text-on-ink/50' : 'text-mist'}>{past.length}</span>
        </Chip>
      </div>

      {!list ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Card className="settle settle-2">
          <Empty
            title={tab === 'upcoming' ? 'Nothing booked yet' : 'Nothing here yet'}
            action={
              tab === 'upcoming' ? (
                <Link href="/">
                  <Button>Find a time</Button>
                </Link>
              ) : null
            }
          >
            {tab === 'upcoming'
              ? 'When you book something it appears here, with both clocks and the deadline for changing it.'
              : 'Bookings move here once they have happened or been cancelled.'}
          </Empty>
        </Card>
      ) : (
        <ul className="space-y-4">
          {shown.map((b, i) => (
            <li key={b.id} className="settle" style={{ animationDelay: `${120 + i * 70}ms` }}>
              <BookingCard
                booking={b}
                viewerTimezone={viewerTimezone}
                onCancel={() => setCancelling(b)}
                muted={tab === 'past'}
              />
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={Boolean(cancelling)}
        onClose={() => !busy && setCancelling(null)}
        label="Cancel booking"
        title={cancelling ? longLabel(cancelling.startsAt, viewerTimezone).split(',')[0] : ''}
        footer={
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setCancelling(null)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="danger" className="flex-[2]" onClick={doCancel} disabled={busy}>
              {busy ? 'Cancelling…' : 'Cancel booking'}
            </Button>
          </div>
        }
      >
        {cancelling ? (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-ash">
              The time goes back on {cancelling.providerName}&rsquo;s calendar straight away, and you
              both get an email.
            </p>
            {Date.parse(cancelling.startsAt) - Date.now() <
            (cancelling.cancellationCutoffHours ?? 0) * 3600 * 1000 ? (
              <Notice tone="warn" title="This is short notice">
                It starts within {cancelling.cancellationCutoffHours}h, so {cancelling.providerName}
                &rsquo;s copy will say the cancellation was late. It still goes through.
              </Notice>
            ) : null}
            <Field label="Reason" hint="Optional. Included in the notification.">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Something came up"
              />
            </Field>
            {cancelError ? (
              <Notice
                tone="warn"
                title={
                  cancelError.code === 'CANCELLATION_CUTOFF_PASSED'
                    ? 'Too close to the start'
                    : 'Could not cancel'
                }
              >
                {cancelError.message}
              </Notice>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

/* useSearchParams needs a Suspense boundary so the shell can prerender while
   the query string is resolved on the client. */
export default function BookingsPage() {
  return (
    <Suspense fallback={<Spinner label="Loading your bookings" />}>
      <BookingsList />
    </Suspense>
  );
}

function BookingCard({ booking: b, viewerTimezone, onCancel, muted = false }) {
  const providerZone = b.localTimes.provider.timezone;
  const dual = providerZone !== viewerTimezone;
  // Inside the notice window you can still cancel - it is just recorded as
  // late. Only moving the booking is refused, because that asks the provider
  // to take a different time rather than simply handing the slot back.
  const insideNotice =
    b.status === 'confirmed' &&
    Date.parse(b.startsAt) - Date.now() < (b.cancellationCutoffHours ?? 0) * 3600 * 1000;
  const live = b.status === 'confirmed' && !isPast(b.startsAt);

  return (
    <Card className={cn('overflow-hidden', muted && 'opacity-75')}>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5 p-6">
        {/* Yours large, theirs beneath in slate. Always both. */}
        <div className="min-w-[132px]">
          <p className="label mb-2">{longLabel(b.startsAt, viewerTimezone).split(',')[0]}</p>
          <p className="clock text-[28px] leading-none font-medium">
            {clock(b.startsAt, viewerTimezone)}
            <span className="text-lg text-mist">–{clock(b.endsAt, viewerTimezone)}</span>
          </p>
          {dual ? (
            <p className="clock mt-2.5 text-[12px] text-slate-deep">
              {clock(b.startsAt, providerZone)}
              <span className="ml-2 text-mist">{zoneCity(providerZone)}</span>
            </p>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone={b.kind === 'block' ? 'block' : b.status}>
              {b.kind === 'block' ? 'blocked' : b.status}
            </Badge>
            {b.rescheduledFrom ? <Badge tone="accent">moved</Badge> : null}
            {b.cancelledLate ? <Badge tone="cancelled">late notice</Badge> : null}
            {b.cutoffOverridden ? <Badge tone="accent">admin override</Badge> : null}
          </div>
          <p className="text-base font-medium">{b.providerName}</p>
          <p className="mt-1 text-[13px] text-ash">
            {b.durationMinutes} min{live ? ` · ${relative(b.startsAt)}` : ''}
          </p>
          {b.notes ? <p className="mt-3 text-[13px] leading-relaxed text-ash">“{b.notes}”</p> : null}
          {b.cancellationReason ? (
            <p className="mt-3 text-[13px] text-clay">Cancelled: {b.cancellationReason}</p>
          ) : null}
        </div>
      </div>

      {live ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4">
          {insideNotice ? (
            <span title={`Moving needs ${b.cancellationCutoffHours}h notice`}>
              <Button size="sm" variant="outline" disabled>
                Move
              </Button>
            </span>
          ) : (
            <Link href={`/book/${b.providerSlug}?reschedule=${b.id}`}>
              <Button size="sm" variant="outline">
                Move
              </Button>
            </Link>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {insideNotice ? (
            <p className="text-[12px] text-ash">
              Starts within {b.cancellationCutoffHours}h, so it can no longer be moved — but you
              can still cancel.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
