'use client';

import { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { providers as providerApi, bookings as bookingApi, ApiError } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { OverlapRibbon } from '@/components/DualClock';
import {
  Badge,
  Button,
  Card,
  CommitBar,
  Empty,
  Field,
  IconButton,
  Notice,
  SelectField,
  Sheet,
  Skeleton,
  Spinner,
  Textarea,
  ChevronLeft,
  ChevronRight,
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

  // Rescheduling reuses this whole screen: same slots, different verb.
  const rescheduleId = search.get('reschedule');

  const [viewTz, setViewTz] = useState(viewerTimezone);
  const [weekStart, setWeekStart] = useState(null);
  const [activeDate, setActiveDate] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (ready) {
      setViewTz(viewerTimezone);
      setWeekStart(today(viewerTimezone));
      setActiveDate(today(viewerTimezone));
    }
  }, [ready, viewerTimezone]);

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

  // Land on the first day that actually has something, rather than on an
  // empty today.
  useEffect(() => {
    if (!data || !activeDate) return;
    if ((byDate[activeDate] ?? []).length === 0) {
      const firstOpen = data.days.find((d) => d.slots.length > 0);
      if (firstOpen) setActiveDate(firstOpen.date);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const daySlots = byDate[activeDate] ?? [];

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
      // SLOT_TAKEN means someone won the race between this page rendering and
      // this click. Say so plainly and refresh, so the gone slot disappears
      // rather than sitting there still looking bookable.
      setSubmitError(e instanceof ApiError ? e : new ApiError(e.message));
      if (e.code === 'SLOT_TAKEN' || e.code === 'OUTSIDE_AVAILABILITY') {
        setReviewing(false);
        setSelected(null);
        load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Notice tone="error" title="Could not load this provider">
          {error}
        </Notice>
      </div>
    );
  }

  if (!weekStart) return <Spinner label="Finding open times" />;

  const nameParts = provider ? provider.name.split(/\s+[-–]\s+/) : [];

  return (
    <div
      className={cn(
        'mx-auto max-w-3xl px-4 pt-8 sm:px-6',
        // 160px of gutter exists only to clear the floating commit bar; without
        // it the page just ended in dead space.
        selected && !reviewing ? 'pb-40' : 'pb-24 md:pb-10',
      )}
    >
      {/* ----------------------------------------------------------- head --- */}
      <div className="settle mb-8 flex items-start gap-4">
        <Link href="/">
          <IconButton label="Back to providers">
            <ChevronLeft />
          </IconButton>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="label mb-2">{rescheduleId ? 'Moving a booking' : 'Choose a time'}</p>
          {provider ? (
            <h1 className="display text-[34px] sm:text-[44px]">
              {nameParts[0]}
              {nameParts[1] ? (
                <>
                  <br />
                  <strong>{nameParts[1]}</strong>
                </>
              ) : null}
            </h1>
          ) : (
            <Skeleton className="h-12 w-64" />
          )}
          {provider ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge tone="accent">{data.durationMinutes} min</Badge>
              {provider.bufferMinutes > 0 ? <Badge>{provider.bufferMinutes} min gap after</Badge> : null}
              <Badge>cancel {provider.cancellationCutoffHours}h ahead</Badge>
            </div>
          ) : null}
        </div>
      </div>

      {rescheduleId ? (
        <Notice tone="warn" title="Pick a new time" className="settle mb-6">
          Your old slot is released only once the new one is confirmed. If someone takes your new
          choice first, your original booking stays exactly where it is.
        </Notice>
      ) : null}

      {/* ------------------------------------------------ the overlap ribbon --- */}
      <Card className="settle settle-1 mb-6 p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label mb-2">When your days overlap</p>
            <p className="text-[15px] font-medium">
              {activeDate ? longLabel(`${activeDate}T12:00:00.000Z`, 'UTC').split(',')[0] : '—'}
            </p>
          </div>
          <div className="w-full sm:w-56">
            <SelectField
              aria-label="Show times in"
              value={viewTz}
              onChange={(e) => setViewTz(e.target.value)}
              className="py-2.5 text-[13px]"
            >
              {timezoneOptions([viewerTimezone, provider?.timezone]).map((tz) => (
                <option key={tz} value={tz}>
                  {zoneCity(tz)} · {offsetLabel(tz)}
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        {provider && activeDate ? (
          <OverlapRibbon
            key={`${activeDate}-${viewTz}`}
            slots={daySlots}
            date={activeDate}
            viewerZone={viewTz}
            providerZone={provider.timezone}
          />
        ) : (
          <Skeleton className="h-11 rounded-full" />
        )}
      </Card>

      {/* ------------------------------------------------------------ days --- */}
      <div className="settle settle-2 mb-4 flex items-center gap-2">
        <IconButton
          label="Earlier week"
          onClick={() => setWeekStart(shift(weekStart, -7))}
          disabled={weekStart <= today(viewTz)}
        >
          <ChevronLeft />
        </IconButton>
        <div className="rail flex flex-1 gap-2">
          {days.map((d) => {
            const count = byDate[d.date]?.length ?? 0;
            const active = d.date === activeDate;
            return (
              <button
                key={d.date}
                onClick={() => setActiveDate(d.date)}
                disabled={count === 0}
                className={cn(
                  'flex min-w-[62px] shrink-0 flex-col items-center rounded-[var(--radius-inner)] px-3 py-3',
                  'transition-colors duration-200',
                  active
                    ? 'bg-ink text-on-ink'
                    : count > 0
                      ? 'bg-card text-ink well-hover'
                      : 'bg-transparent text-mist',
                )}
              >
                <span
                  className={cn(
                    'text-[10px] tracking-[0.1em] uppercase',
                    active ? 'text-on-ink/50' : 'text-mist',
                  )}
                >
                  {d.weekday}
                </span>
                <span className="clock mt-1 text-lg leading-none font-medium">{d.day}</span>
                <span
                  className={cn(
                    'mt-1.5 text-[10px]',
                    active ? 'text-on-ink/60' : count > 0 ? 'text-slate-deep' : 'text-mist',
                  )}
                >
                  {count > 0 ? count : '—'}
                </span>
              </button>
            );
          })}
        </div>
        <IconButton label="Later week" onClick={() => setWeekStart(shift(weekStart, 7))}>
          <ChevronRight />
        </IconButton>
      </div>

      {/* ----------------------------------------------------------- slots --- */}
      <Card className="settle settle-3 p-6">
        {loading ? (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[68px]" />
            ))}
          </div>
        ) : daySlots.length === 0 ? (
          <Empty
            title="Nothing open on this day"
            action={
              <Button variant="outline" onClick={() => setWeekStart(shift(weekStart, 7))}>
                Try next week
              </Button>
            }
          >
            {provider?.name} has no free time here in {zoneCity(viewTz)}. Days with openings are
            marked above.
          </Empty>
        ) : (
          <>
            <div className="mb-4 flex items-baseline justify-between">
              <p className="label">
                {daySlots.length} time{daySlots.length === 1 ? '' : 's'} open
              </p>
              {viewTz !== provider.timezone ? (
                <p className="text-[11px] text-ash">
                  yours <span className="text-mist">/</span>{' '}
                  <span className="text-slate-deep">{zoneCity(provider.timezone)}</span>
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {daySlots.map((slot) => {
                const active = selected?.startsAt === slot.startsAt;
                return (
                  <button
                    key={slot.startsAt}
                    onClick={() => {
                      setSelected(active ? null : slot);
                      setSubmitError(null);
                    }}
                    className={cn(
                      'rounded-[var(--radius-inner)] px-3 py-3 text-left transition-colors duration-200',
                      active ? 'bg-accent text-on-accent' : 'well well-hover',
                    )}
                  >
                    <span className="clock block text-base leading-none font-medium">
                      {clock(slot.startsAt, viewTz)}
                    </span>
                    {viewTz !== provider.timezone ? (
                      <span
                        className={cn(
                          'clock mt-1.5 block text-[11px]',
                          active ? 'text-on-accent/70' : 'text-slate-deep',
                        )}
                      >
                        {clock(slot.startsAt, provider.timezone)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* ------------------------------------------------------ commit bar --- */}
      {selected && provider && !reviewing ? (
        <CommitBar
          label={rescheduleId ? 'Move to' : `${data.durationMinutes} minutes`}
          value={
            viewTz === provider.timezone
              ? `${clock(selected.startsAt, viewTz)} ${zoneCity(viewTz)}`
              : `${clock(selected.startsAt, viewTz)} ${zoneCity(viewTz)} · ${clock(
                  selected.startsAt,
                  provider.timezone,
                )} ${zoneCity(provider.timezone)}`
          }
          action={
            user ? (
              <Button className="shrink-0 bg-on-ink text-ink hover:opacity-90" onClick={() => setReviewing(true)}>
                Review
              </Button>
            ) : (
              <Link href={`/login?next=/book/${slug}`}>
                <Button className="shrink-0 bg-on-ink text-ink hover:opacity-90">Sign in</Button>
              </Link>
            )
          }
        />
      ) : null}

      {/* ------------------------------------------------------ the review --- */}
      <Sheet
        open={reviewing && Boolean(selected) && Boolean(user)}
        onClose={() => !submitting && setReviewing(false)}
        label={rescheduleId ? 'Move this booking' : 'Confirm this time'}
        title={selected ? longLabel(selected.startsAt, viewTz).split(',')[0] : ''}
        footer={
          <div className="flex gap-3">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setReviewing(false)}
              disabled={submitting}
            >
              Back
            </Button>
            <Button className="flex-[2]" onClick={confirm} disabled={submitting}>
              {submitting ? 'Confirming…' : rescheduleId ? 'Move it here' : 'Confirm booking'}
            </Button>
          </div>
        }
      >
        {selected && provider ? (
          <div className="space-y-5">
            {/* Both clocks, at the moment of commitment - the point where a
                timezone mistake actually costs something. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[var(--radius-inner)] well px-4 py-4">
                <p className="label mb-2">You · {offsetLabel(viewTz)}</p>
                <p className="clock text-2xl leading-none font-medium">
                  {clock(selected.startsAt, viewTz)}
                </p>
                <p className="mt-2 text-[12px] text-ash">
                  {longLabel(selected.startsAt, viewTz).split(',')[0]}
                </p>
                <p className="text-[12px] text-mist">{zoneCity(viewTz)}</p>
              </div>
              <div className="rounded-[var(--radius-inner)] bg-slate-tint px-4 py-4">
                <p className="label mb-2">Them · {offsetLabel(provider.timezone)}</p>
                <p className="clock text-2xl leading-none font-medium text-slate-deep">
                  {clock(selected.startsAt, provider.timezone)}
                </p>
                <p className="mt-2 text-[12px] text-slate-deep">
                  {longLabel(selected.startsAt, provider.timezone).split(',')[0]}
                </p>
                <p className="text-[12px] text-slate-deep/70">{zoneCity(provider.timezone)}</p>
              </div>
            </div>

            {!rescheduleId ? (
              <Field label="Anything they should know" hint="Optional. The provider sees this.">
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

            <p className="text-xs leading-relaxed text-ash">
              Cancel or move this up to {provider.cancellationCutoffHours}h before it starts. Your
              confirmation email carries both times.
            </p>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
