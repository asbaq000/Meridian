'use client';

import { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { providers as providerApi, bookings as bookingApi, ApiError } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { DualClockStrip, StackedTime } from '@/components/DualClock';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Empty,
  Field,
  Notice,
  Select,
  Spinner,
  Textarea,
  cn,
} from '@/components/ui';
import {
  clock,
  longLabel,
  offsetLabel,
  shift,
  today,
  weekFrom,
  zoneCity,
  timezoneOptions,
} from '@/lib/time';

/* useSearchParams needs a Suspense boundary so the shell can prerender while
   the ?reschedule= query is resolved on the client. */
export default function BookPage({ params }) {
  const { slug } = use(params);
  return (
    <Suspense fallback={<Spinner label="Loading" />}>
      <BookScreen slug={slug} />
    </Suspense>
  );
}

function BookScreen({ slug }) {
  const router = useRouter();
  const search = useSearchParams();
  const { user, viewerTimezone, ready } = useAuth();

  // Rescheduling reuses this whole screen: same slot grid, different verb.
  const rescheduleId = search.get('reschedule');

  const [viewTz, setViewTz] = useState(viewerTimezone);
  const [weekStart, setWeekStart] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (ready) {
      setViewTz(viewerTimezone);
      setWeekStart(today(viewerTimezone));
    }
  }, [ready, viewerTimezone]);

  // The week anchor depends on the viewer's zone, which is only known after
  // mount, so it starts null and the screen holds a spinner until it is set.
  const days = useMemo(() => (weekStart ? weekFrom(weekStart, 7) : []), [weekStart]);

  const load = useCallback(async () => {
    if (!weekStart) return;
    setLoading(true);
    setError(null);
    try {
      const res = await providerApi.slots(slug, {
        from: weekStart,
        to: shift(weekStart, 6),
        timezone: viewTz,
        excludeBookingId: rescheduleId ?? undefined,
      });
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [slug, weekStart, viewTz, rescheduleId]);

  useEffect(() => {
    load();
  }, [load]);

  const provider = data?.provider;
  const byDate = useMemo(
    () => Object.fromEntries((data?.days ?? []).map((d) => [d.date, d.slots])),
    [data],
  );

  async function confirm() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (rescheduleId) {
        await bookingApi.reschedule(rescheduleId, { startsAt: selected.startsAt });
      } else {
        await bookingApi.create({
          providerId: provider.id,
          startsAt: selected.startsAt,
          durationMinutes: data.durationMinutes,
          notes,
        });
      }
      router.push('/bookings?just=1');
    } catch (e) {
      // SLOT_TAKEN is the interesting one: someone won the race between this
      // page rendering and this click. Say so plainly and refresh the grid so
      // the taken slot disappears rather than sitting there looking bookable.
      setSubmitError(e instanceof ApiError ? e : new ApiError(e.message));
      if (e.code === 'SLOT_TAKEN' || e.code === 'OUTSIDE_AVAILABILITY') {
        setSelected(null);
        load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Notice tone="error" title="Could not load this provider">
          {error}
        </Notice>
      </div>
    );
  }

  if (!weekStart) return <Spinner label="Finding open times" />;

  return (
    <div>
      {provider ? (
        <DualClockStrip you={viewTz} them={provider.timezone} themLabel={zoneCity(provider.name)} />
      ) : null}

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* ------------------------------------------------------- header --- */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">
              {rescheduleId ? 'Moving an existing booking' : 'Choose a time'}
            </p>
            <h1 className="mt-2 text-3xl leading-tight sm:text-4xl">{provider?.name ?? '—'}</h1>
            {provider ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="brass">{data.durationMinutes} min</Badge>
                {provider.bufferMinutes > 0 ? (
                  <Badge>{provider.bufferMinutes} min gap after each</Badge>
                ) : null}
                <Badge>cancel {provider.cancellationCutoffHours}h ahead</Badge>
              </div>
            ) : null}
          </div>

          <div className="w-full sm:w-64">
            <Field label="Showing times in">
              <Select value={viewTz} onChange={(e) => setViewTz(e.target.value)}>
                {timezoneOptions([viewerTimezone, provider?.timezone]).map((tz) => (
                  <option key={tz} value={tz}>
                    {zoneCity(tz)} · {offsetLabel(tz)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        {rescheduleId ? (
          <div className="mb-6">
            <Notice tone="warn" title="Pick a new time">
              The old slot is released only once the new one is confirmed. If someone takes your new
              choice first, your original booking stays exactly where it is.
            </Notice>
          </div>
        ) : null}

        {/* --------------------------------------------------- week rail --- */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setWeekStart(shift(weekStart, -7))}
              disabled={weekStart <= today(viewTz)}
            >
              ← Earlier
            </Button>
            <span className="tabular flex-1 text-center text-[12px] tracking-[0.1em] text-slate uppercase">
              {days[0].day} {days[0].month} — {days[6].day} {days[6].month}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setWeekStart(shift(weekStart, 7))}>
              Later →
            </Button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] divide-x divide-rule border-b border-rule sm:grid-cols-7">
            {days.map((d) => {
              const count = byDate[d.date]?.length ?? 0;
              return (
                <div key={d.date} className="px-2 py-3 text-center">
                  <p className="eyebrow">{d.weekday}</p>
                  <p className="tabular mt-1 text-lg leading-none font-medium">{d.day}</p>
                  <p
                    className={cn(
                      'tabular mt-1.5 text-[10px] tracking-[0.08em] uppercase',
                      count > 0 ? 'text-brass' : 'text-slate-soft',
                    )}
                  >
                    {count > 0 ? `${count} free` : '—'}
                  </p>
                </div>
              );
            })}
          </div>

          {/* ----------------------------------------------- slot grid --- */}
          <div className="divide-y divide-rule">
            {loading ? (
              <Spinner label="Finding open times" />
            ) : (data?.days ?? []).length === 0 ? (
              <Empty
                title="Nothing open this week"
                action={
                  <Button variant="outline" onClick={() => setWeekStart(shift(weekStart, 7))}>
                    Look at next week
                  </Button>
                }
              >
                {provider?.name} has no free time between {days[0].day} {days[0].month} and{' '}
                {days[6].day} {days[6].month} in {zoneCity(viewTz)}.
              </Empty>
            ) : (
              data.days.map((day) => (
                <div key={day.date} className="flap-in px-4 py-4 sm:px-5">
                  <div className="mb-3 flex items-baseline gap-3">
                    <h3 className="text-[15px]">{longLabel(day.slots[0].startsAt, viewTz).split(',')[0]}</h3>
                    <span className="tabular text-[11px] text-slate">
                      {day.slots.length} slot{day.slots.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
                    {day.slots.map((slot) => (
                      <button
                        key={slot.startsAt}
                        type="button"
                        onClick={() => {
                          setSelected(slot);
                          setSubmitError(null);
                        }}
                        className={cn(
                          'rounded-[3px] border px-2.5 py-2 text-left transition-colors',
                          'border-rule bg-white hover:border-brass hover:bg-brass-wash',
                          'focus-visible:border-brass',
                        )}
                      >
                        <StackedTime
                          instant={slot.startsAt}
                          primaryZone={viewTz}
                          secondaryZone={provider.timezone}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <p className="mt-4 text-xs text-slate">
          Times in <span className="tabular text-teal">teal</span> are {provider?.name ?? 'the provider'}
          &rsquo;s local clock. Slots are derived from their working hours, minus anything already
          booked or blocked.
        </p>
      </div>

      {/* -------------------------------------------------- confirmation --- */}
      <Dialog
        open={Boolean(selected)}
        onClose={() => !submitting && setSelected(null)}
        eyebrow={rescheduleId ? 'Move this booking' : 'Confirm this time'}
        title={selected ? longLabel(selected.startsAt, viewTz) : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={submitting}>
              Back
            </Button>
            {user ? (
              <Button variant="brass" onClick={confirm} disabled={submitting}>
                {submitting ? 'Confirming…' : rescheduleId ? 'Move it here' : 'Confirm booking'}
              </Button>
            ) : (
              <Link href={`/login?next=/book/${slug}`}>
                <Button variant="brass">Sign in to book</Button>
              </Link>
            )}
          </>
        }
      >
        {selected && provider ? (
          <div className="space-y-4">
            {/* The dual clock again, at the moment of commitment - this is the
                point where getting a timezone wrong actually costs something. */}
            <div className="grid gap-px overflow-hidden rounded-[3px] border border-rule bg-rule sm:grid-cols-2">
              <div className="bg-white px-4 py-3">
                <p className="eyebrow">Your time · {offsetLabel(viewTz)}</p>
                <p className="tabular mt-1 text-2xl font-medium">
                  {clock(selected.startsAt, viewTz)}
                  <span className="ml-1 text-base text-slate">–{clock(selected.endsAt, viewTz)}</span>
                </p>
                <p className="mt-1 text-[13px] text-slate">
                  {longLabel(selected.startsAt, viewTz).split(',')[0]} · {zoneCity(viewTz)}
                </p>
              </div>
              <div className="bg-teal-wash px-4 py-3">
                <p className="eyebrow text-teal">
                  Their time · {offsetLabel(provider.timezone)}
                </p>
                <p className="tabular mt-1 text-2xl font-medium text-teal">
                  {clock(selected.startsAt, provider.timezone)}
                  <span className="ml-1 text-base opacity-70">
                    –{clock(selected.endsAt, provider.timezone)}
                  </span>
                </p>
                <p className="mt-1 text-[13px] text-teal/80">
                  {longLabel(selected.startsAt, provider.timezone).split(',')[0]} ·{' '}
                  {zoneCity(provider.timezone)}
                </p>
              </div>
            </div>

            {!rescheduleId && user ? (
              <Field label="Anything they should know" hint="Optional, shown to the provider.">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What you'd like to cover"
                  maxLength={2000}
                />
              </Field>
            ) : null}

            {submitError ? (
              <Notice
                tone={submitError.code === 'SLOT_TAKEN' ? 'warn' : 'error'}
                title={submitError.code === 'SLOT_TAKEN' ? 'Someone just took it' : 'Could not book'}
              >
                {submitError.message}
              </Notice>
            ) : null}

            <p className="text-xs text-slate">
              Cancel or move it up to {provider.cancellationCutoffHours}h before it starts. You will
              get a confirmation by email with both times.
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
