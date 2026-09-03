'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { providers as providerApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Empty,
  Field,
  Input,
  Notice,
  Select,
  Spinner,
} from '@/components/ui';
import { offsetLabel, zoneCity } from '@/lib/time';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export default function ProviderPage() {
  const { user, providers, ready, isAdmin } = useAuth();
  const router = useRouter();
  const [slug, setSlug] = useState(null);
  const [data, setData] = useState(null);
  const [provider, setProvider] = useState(null);
  const [rules, setRules] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exceptionDraft, setExceptionDraft] = useState({
    date: '',
    kind: 'blocked',
    startTime: '09:00',
    endTime: '13:00',
    note: '',
  });

  const [allProviders, setAllProviders] = useState([]);

  useEffect(() => {
    if (ready && !user) router.replace('/login?next=/provider');
  }, [ready, user, router]);

  useEffect(() => {
    if (isAdmin) providerApi.list().then((r) => setAllProviders(r.providers)).catch(() => {});
  }, [isAdmin]);

  const options = isAdmin ? allProviders : providers;

  useEffect(() => {
    if (!slug && options.length > 0) setSlug(options[0].slug);
  }, [options, slug]);

  const load = useCallback(async () => {
    if (!slug) return;
    const [av, p] = await Promise.all([providerApi.availability(slug), providerApi.get(slug)]);
    setData(av);
    setProvider(p.provider);
    setRules(av.rules.map((r) => ({ ...r })));
  }, [slug]);

  useEffect(() => {
    load().catch((e) => setStatus({ tone: 'error', text: e.message }));
  }, [load]);

  async function saveRules() {
    setBusy(true);
    setStatus(null);
    try {
      await providerApi.setRules(slug, rules.map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime })));
      await load();
      setStatus({ tone: 'good', text: 'Weekly hours saved. Slots regenerate immediately.' });
    } catch (e) {
      setStatus({ tone: 'error', text: e.details?.[0]?.message ?? e.message });
    } finally {
      setBusy(false);
    }
  }

  async function addException(e) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await providerApi.addException(slug, {
        date: exceptionDraft.date,
        kind: exceptionDraft.kind,
        note: exceptionDraft.note,
        ...(exceptionDraft.kind === 'custom_hours'
          ? { startTime: exceptionDraft.startTime, endTime: exceptionDraft.endTime }
          : {}),
      });
      setExceptionDraft((d) => ({ ...d, date: '', note: '' }));
      await load();
      setStatus({ tone: 'good', text: 'Exception added.' });
    } catch (err) {
      setStatus({ tone: 'error', text: err.details?.[0]?.message ?? err.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(patch) {
    setBusy(true);
    setStatus(null);
    try {
      await providerApi.update(slug, patch);
      await load();
      setStatus({ tone: 'good', text: 'Settings saved.' });
    } catch (e) {
      setStatus({
        tone: e.code === 'BUFFER_CONFLICTS_WITH_BOOKINGS' ? 'warn' : 'error',
        text: e.message,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <Spinner />;
  if (!user) return null;

  if (options.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Card>
          <Empty title="No provider assigned to you">
            An admin creates providers and links them to an account. Once yours exists, its weekly
            hours and one-off exceptions are edited here.
          </Empty>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">
            Hours are entered in the provider&rsquo;s own clock
            {provider ? ` · ${zoneCity(provider.timezone)} ${offsetLabel(provider.timezone)}` : ''}
          </p>
          <h1 className="mt-2 text-3xl">Availability</h1>
        </div>
        {options.length > 1 ? (
          <div className="w-full sm:w-64">
            <Field label="Provider">
              <Select value={slug ?? ''} onChange={(e) => setSlug(e.target.value)}>
                {options.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
      </div>

      {status ? (
        <div className="mb-6">
          <Notice tone={status.tone}>{status.text}</Notice>
        </div>
      ) : null}

      {!data ? (
        <Spinner label="Loading availability" />
      ) : (
        <div className="space-y-6">
          {/* -------------------------------------------- weekly pattern --- */}
          <Card>
            <CardHeader
              eyebrow="Recurring"
              title="Weekly hours"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setRules((r) => [...r, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }])
                  }
                >
                  Add a window
                </Button>
              }
            />
            <div className="p-5">
              {rules.length === 0 ? (
                <p className="py-4 text-sm text-slate">
                  No hours set, so nothing is bookable. Add a window to open the calendar.
                </p>
              ) : (
                <ul className="space-y-2">
                  {rules.map((r, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <Select
                        aria-label="Day"
                        className="w-28"
                        value={r.dayOfWeek}
                        onChange={(e) =>
                          setRules((all) =>
                            all.map((x, j) => (j === i ? { ...x, dayOfWeek: Number(e.target.value) } : x)),
                          )
                        }
                      >
                        {DAYS.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </Select>
                      <Input
                        type="time"
                        aria-label="Start"
                        className="w-32"
                        value={r.startTime}
                        onChange={(e) =>
                          setRules((all) => all.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))
                        }
                      />
                      <span className="text-slate">to</span>
                      <Input
                        type="time"
                        aria-label="End"
                        className="w-32"
                        value={r.endTime}
                        onChange={(e) =>
                          setRules((all) => all.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))
                        }
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-rose"
                        onClick={() => setRules((all) => all.filter((_, j) => j !== i))}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 flex items-center gap-3 border-t border-rule pt-4">
                <Button variant="brass" onClick={saveRules} disabled={busy}>
                  {busy ? 'Saving…' : 'Save weekly hours'}
                </Button>
                <p className="text-xs text-slate">
                  Two windows on one day become a lunch break. Overlapping windows merge.
                </p>
              </div>
            </div>
          </Card>

          {/* ------------------------------------------------ exceptions --- */}
          <Card>
            <CardHeader eyebrow="One-off" title="Holidays and short days" />
            <div className="p-5">
              <form onSubmit={addException} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Date">
                  <Input
                    type="date"
                    required
                    value={exceptionDraft.date}
                    onChange={(e) => setExceptionDraft((d) => ({ ...d, date: e.target.value }))}
                  />
                </Field>
                <Field label="What happens">
                  <Select
                    value={exceptionDraft.kind}
                    onChange={(e) => setExceptionDraft((d) => ({ ...d, kind: e.target.value }))}
                  >
                    <option value="blocked">Closed all day</option>
                    <option value="custom_hours">Different hours</option>
                  </Select>
                </Field>
                <Button type="submit" variant="outline" disabled={busy || !exceptionDraft.date}>
                  Add
                </Button>

                {exceptionDraft.kind === 'custom_hours' ? (
                  <>
                    <Field label="Open">
                      <Input
                        type="time"
                        value={exceptionDraft.startTime}
                        onChange={(e) => setExceptionDraft((d) => ({ ...d, startTime: e.target.value }))}
                      />
                    </Field>
                    <Field label="Close">
                      <Input
                        type="time"
                        value={exceptionDraft.endTime}
                        onChange={(e) => setExceptionDraft((d) => ({ ...d, endTime: e.target.value }))}
                      />
                    </Field>
                    <div />
                  </>
                ) : null}
              </form>

              <ul className="mt-5 divide-y divide-rule border-t border-rule">
                {data.exceptions.length === 0 ? (
                  <li className="py-4 text-sm text-slate">
                    No exceptions. The weekly pattern applies every week.
                  </li>
                ) : (
                  data.exceptions.map((ex) => (
                    <li key={ex.id} className="flex items-center gap-3 py-3">
                      <span className="tabular text-sm">{ex.date}</span>
                      <Badge tone={ex.kind === 'blocked' ? 'cancelled' : 'brass'}>
                        {ex.kind === 'blocked' ? 'closed' : `${ex.startTime}–${ex.endTime}`}
                      </Badge>
                      {ex.note ? <span className="truncate text-[13px] text-slate">{ex.note}</span> : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-rose"
                        onClick={() =>
                          providerApi.removeException(slug, ex.id).then(load).catch((e) =>
                            setStatus({ tone: 'error', text: e.message }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </Card>

          {/* -------------------------------------------------- settings --- */}
          {provider ? <BookingRules provider={provider} onSave={saveSettings} busy={busy} /> : null}
        </div>
      )}
    </div>
  );
}

function BookingRules({ provider, onSave, busy }) {
  const [form, setForm] = useState({
    slotMinutes: provider.slotMinutes,
    bufferMinutes: provider.bufferMinutes,
    minNoticeMinutes: provider.minNoticeMinutes,
    cancellationCutoffHours: provider.cancellationCutoffHours,
    bookingHorizonDays: provider.bookingHorizonDays,
  });
  const num = (k) => (e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));

  return (
    <Card>
      <CardHeader eyebrow="Policy" title="Booking rules" />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Appointment length" hint="Also the spacing of offered start times.">
          <Input type="number" min={5} max={1440} value={form.slotMinutes} onChange={num('slotMinutes')} />
        </Field>
        <Field label="Gap between appointments" hint="Minutes kept clear after each one.">
          <Input type="number" min={0} max={480} value={form.bufferMinutes} onChange={num('bufferMinutes')} />
        </Field>
        <Field label="Minimum notice (minutes)" hint="How soon someone can book you.">
          <Input type="number" min={0} value={form.minNoticeMinutes} onChange={num('minNoticeMinutes')} />
        </Field>
        <Field label="Cancellation cutoff (hours)" hint="After this, only an admin can change it.">
          <Input
            type="number"
            min={0}
            value={form.cancellationCutoffHours}
            onChange={num('cancellationCutoffHours')}
          />
        </Field>
        <Field label="Book up to (days ahead)">
          <Input
            type="number"
            min={1}
            max={730}
            value={form.bookingHorizonDays}
            onChange={num('bookingHorizonDays')}
          />
        </Field>
        <div className="flex items-end">
          <Button variant="brass" onClick={() => onSave(form)} disabled={busy}>
            {busy ? 'Saving…' : 'Save rules'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
