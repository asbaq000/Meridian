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
  CardHeader,
  Dialog,
  Empty,
  Field,
  Notice,
  Spinner,
  Textarea,
} from '@/components/ui';
import { clock, longLabel, offsetLabel, relative, zoneCity, isPast } from '@/lib/time';

function BookingsList() {
  const { user, ready, viewerTimezone } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const justBooked = search.get('just') === '1';

  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
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

  if (!ready || (user && !list && !error)) return <Spinner label="Loading your bookings" />;
  if (!user) return null;

  const upcoming = (list ?? []).filter((b) => b.status === 'confirmed' && !isPast(b.startsAt));
  const rest = (list ?? []).filter((b) => !(b.status === 'confirmed' && !isPast(b.startsAt)));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <p className="eyebrow">Your clock · {offsetLabel(viewerTimezone)} · {zoneCity(viewerTimezone)}</p>
        <h1 className="mt-2 text-3xl">My bookings</h1>
      </div>

      {justBooked ? (
        <div className="mb-6">
          <Notice tone="good" title="Booked">
            A confirmation is on its way, with the time in your zone and in the provider&rsquo;s.
          </Notice>
        </div>
      ) : null}

      {error ? (
        <Notice tone="error" title="Could not load your bookings">
          {error}
        </Notice>
      ) : null}

      <section className="mb-10">
        <h2 className="eyebrow mb-3">Upcoming</h2>
        {upcoming.length === 0 ? (
          <Card>
            <Empty
              title="Nothing booked yet"
              action={
                <Link href="/">
                  <Button variant="brass">Find a time</Button>
                </Link>
              }
            >
              When you book something, it appears here with both clocks and the deadline for
              changing it.
            </Empty>
          </Card>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((b) => (
              <li key={b.id}>
                <BookingRow booking={b} viewerTimezone={viewerTimezone} onCancel={() => setCancelling(b)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {rest.length > 0 ? (
        <section>
          <h2 className="eyebrow mb-3">Past and cancelled</h2>
          <ul className="space-y-3">
            {rest.map((b) => (
              <li key={b.id}>
                <BookingRow booking={b} viewerTimezone={viewerTimezone} muted />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog
        open={Boolean(cancelling)}
        onClose={() => !busy && setCancelling(null)}
        eyebrow="Cancel booking"
        title={cancelling ? longLabel(cancelling.startsAt, viewerTimezone) : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(null)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="danger" onClick={doCancel} disabled={busy}>
              {busy ? 'Cancelling…' : 'Cancel booking'}
            </Button>
          </>
        }
      >
        {cancelling ? (
          <div className="space-y-4">
            <p className="text-sm text-slate">
              The time goes back on {cancelling.providerName}&rsquo;s calendar straight away, and you
              both get an email.
            </p>
            <Field label="Reason" hint="Optional, included in the notification.">
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
      </Dialog>
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

function BookingRow({ booking: b, viewerTimezone, onCancel, muted = false }) {
  const dual = b.localTimes.provider.timezone !== viewerTimezone;
  const locked =
    b.status === 'confirmed' &&
    Date.parse(b.startsAt) - Date.now() < (b.cancellationCutoffHours ?? 0) * 3600 * 1000;

  return (
    <Card className={muted ? 'opacity-70' : undefined}>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4 p-5">
        {/* The time block: yours large, theirs beneath, always. */}
        <div className="min-w-[150px]">
          <p className="eyebrow">{longLabel(b.startsAt, viewerTimezone).split(',')[0]}</p>
          <p className="tabular mt-1 text-2xl leading-none font-medium">
            {clock(b.startsAt, viewerTimezone)}
            <span className="ml-1 text-base text-slate">–{clock(b.endsAt, viewerTimezone)}</span>
          </p>
          {dual ? (
            <p className="tabular mt-2 text-[12px] text-teal">
              {clock(b.startsAt, b.localTimes.provider.timezone)}
              <span className="ml-1.5 text-slate-soft">
                {zoneCity(b.localTimes.provider.timezone)}
              </span>
            </p>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={b.kind === 'block' ? 'block' : b.status}>{b.kind === 'block' ? 'blocked' : b.status}</Badge>
            {b.rescheduledFrom ? <Badge tone="brass">moved</Badge> : null}
            {b.cutoffOverridden ? <Badge tone="brass">admin override</Badge> : null}
          </div>
          <p className="text-[15px] font-medium">{b.providerName}</p>
          <p className="mt-0.5 text-[13px] text-slate">
            {b.durationMinutes} min · {b.status === 'confirmed' ? relative(b.startsAt) : ''}
          </p>
          {b.notes ? <p className="mt-2 text-[13px] text-slate italic">“{b.notes}”</p> : null}
          {b.cancellationReason ? (
            <p className="mt-2 text-[13px] text-rose">Cancelled: {b.cancellationReason}</p>
          ) : null}
        </div>

        {b.status === 'confirmed' && !isPast(b.startsAt) ? (
          <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
            <div className="flex gap-2">
              <Link href={`/book/${b.providerSlug}?reschedule=${b.id}`}>
                <Button size="sm" variant="outline" disabled={locked}>
                  Move
                </Button>
              </Link>
              <Button size="sm" variant="danger" onClick={onCancel} disabled={locked}>
                Cancel
              </Button>
            </div>
            {locked ? (
              <p className="text-right text-[11px] text-slate">
                Locked — starts within {b.cancellationCutoffHours}h. Ask an admin.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
