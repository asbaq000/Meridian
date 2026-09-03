'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { admin as adminApi, providers as providerApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  Empty,
  Field,
  Input,
  Notice,
  Select,
  Spinner,
  cn,
} from '@/components/ui';
import { clock, localDate, offsetLabel, shift, today, weekFrom, zoneCity } from '@/lib/time';

const TABS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'block', label: 'Block time' },
  { id: 'people', label: 'People' },
  { id: 'notifications', label: 'Notifications' },
];

export default function AdminPage() {
  const { user, ready, isAdmin, viewerTimezone } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState('calendar');

  useEffect(() => {
    if (ready && !isAdmin) router.replace(user ? '/' : '/login?next=/admin');
  }, [ready, isAdmin, user, router]);

  if (!ready) return <Spinner />;
  if (!isAdmin) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6">
        <p className="eyebrow">
          Everything, in your clock · {zoneCity(viewerTimezone)} {offsetLabel(viewerTimezone)}
        </p>
        <h1 className="mt-2 text-3xl">Admin</h1>
      </div>

      <div className="mb-6 flex gap-1 border-b border-rule">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'relative px-3 py-2 text-sm transition-colors',
              tab === t.id ? 'text-ink' : 'text-slate hover:text-ink',
            )}
          >
            {t.label}
            {tab === t.id ? <span className="absolute right-0 -bottom-px left-0 h-[2px] bg-brass" /> : null}
          </button>
        ))}
      </div>

      {tab === 'calendar' ? <CalendarTab viewerTimezone={viewerTimezone} /> : null}
      {tab === 'block' ? <BlockTab viewerTimezone={viewerTimezone} /> : null}
      {tab === 'people' ? <PeopleTab /> : null}
      {tab === 'notifications' ? <NotificationsTab /> : null}
    </div>
  );
}

// ------------------------------------------------------------- calendar ---
function CalendarTab({ viewerTimezone }) {
  const [weekStart, setWeekStart] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  // Anchored after mount, not during render: `today()` reads the clock, and
  // the server's answer need not match the browser's.
  useEffect(() => {
    setWeekStart((current) => current ?? today(viewerTimezone));
  }, [viewerTimezone]);

  const days = useMemo(() => (weekStart ? weekFrom(weekStart, 7) : []), [weekStart]);

  const load = useCallback(async () => {
    if (!weekStart) return;
    setError(null);
    try {
      const res = await adminApi.calendar({
        from: weekStart,
        to: shift(weekStart, 6),
        timezone: viewerTimezone,
        providerId: filter || undefined,
      });
      setData(res);
    } catch (e) {
      setError(e.message);
    }
  }, [weekStart, viewerTimezone, filter]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = Object.fromEntries(days.map((d) => [d.date, []]));
    for (const b of data?.bookings ?? []) {
      const date = localDate(b.startsAt, viewerTimezone);
      if (map[date]) map[date].push(b);
    }
    return map;
  }, [data, days, viewerTimezone]);

  async function overrideCancel() {
    setBusy(true);
    try {
      await adminApi.overrideCancel(selected.id, { reason: 'Cancelled by admin' });
      setSelected(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeBlock() {
    setBusy(true);
    try {
      await adminApi.unblock(selected.id);
      setSelected(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!weekStart) return <Spinner label="Loading calendar" />;

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(shift(weekStart, -7))}>
            ← Previous
          </Button>
          <span className="tabular text-[12px] tracking-[0.1em] text-slate uppercase">
            {days[0].day} {days[0].month} — {days[6].day} {days[6].month}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(shift(weekStart, 7))}>
            Next →
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(today(viewerTimezone))}>
            Today
          </Button>
          <Select
            aria-label="Filter by provider"
            className="ml-auto h-8 w-52 py-0 text-[13px]"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All providers</option>
            {(data?.providers ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Seven columns, one per day, in the admin's own zone. Each entry
            still carries the provider's clock so a global view never hides
            whose morning it actually is. */}
        <div className="grid grid-cols-1 divide-y divide-rule sm:grid-cols-7 sm:divide-x sm:divide-y-0">
          {days.map((d) => (
            <div key={d.date} className="min-h-[220px]">
              <div className="ruled sticky top-0 border-b border-rule bg-ink px-2 py-2 text-center">
                <p className="eyebrow text-white/45">{d.weekday}</p>
                <p className="tabular mt-0.5 text-[15px] leading-none font-medium text-white">{d.day}</p>
              </div>
              <div className="space-y-1 p-1.5">
                {byDay[d.date]?.length ? (
                  byDay[d.date]
                    .filter((b) => b.status !== 'cancelled')
                    .map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setSelected(b)}
                        className={cn(
                          'block w-full rounded-[2px] border-l-2 px-1.5 py-1 text-left transition-colors',
                          b.kind === 'block'
                            ? 'border-ink bg-ink/5 hover:bg-ink/10'
                            : 'border-brass bg-brass-wash hover:bg-brass-lit/25',
                        )}
                      >
                        <span className="tabular block text-[12px] font-medium">
                          {clock(b.startsAt, viewerTimezone)}
                        </span>
                        <span className="block truncate text-[11px] text-slate">
                          {b.kind === 'block' ? (b.notes || 'Blocked') : b.customerName}
                        </span>
                        <span className="block truncate text-[10px] text-slate-soft">
                          {b.providerName}
                        </span>
                      </button>
                    ))
                ) : (
                  <p className="px-1.5 py-3 text-center text-[11px] text-slate-soft">—</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Dialog
        open={Boolean(selected)}
        onClose={() => !busy && setSelected(null)}
        eyebrow={selected?.kind === 'block' ? 'Blocked time' : 'Booking'}
        title={selected ? `${clock(selected.startsAt, viewerTimezone)}–${clock(selected.endsAt, viewerTimezone)} ${zoneCity(viewerTimezone)}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={busy}>
              Close
            </Button>
            {selected?.kind === 'block' ? (
              <Button variant="danger" onClick={removeBlock} disabled={busy}>
                Remove block
              </Button>
            ) : (
              <Button variant="danger" onClick={overrideCancel} disabled={busy}>
                Cancel (override cutoff)
              </Button>
            )}
          </>
        }
      >
        {selected ? (
          <dl className="space-y-3 text-sm">
            <Row label="Provider">
              {selected.providerName}
              <span className="tabular ml-2 text-[12px] text-teal">
                {clock(selected.startsAt, selected.localTimes.provider.timezone)}{' '}
                {zoneCity(selected.localTimes.provider.timezone)}
              </span>
            </Row>
            {selected.customerName ? (
              <Row label="Customer">
                {selected.customerName}
                <span className="tabular ml-2 text-[12px] text-teal">
                  {clock(selected.startsAt, selected.localTimes.customer.timezone)}{' '}
                  {zoneCity(selected.localTimes.customer.timezone)}
                </span>
              </Row>
            ) : null}
            <Row label="UTC">
              <span className="tabular text-[12px]">{selected.startsAt}</span>
            </Row>
            <Row label="Status">
              <Badge tone={selected.kind === 'block' ? 'block' : selected.status}>
                {selected.kind === 'block' ? 'blocked' : selected.status}
              </Badge>
            </Row>
            {selected.notes ? <Row label="Notes">{selected.notes}</Row> : null}
          </dl>
        ) : null}
      </Dialog>
    </div>
  );
}

const Row = ({ label, children }) => (
  <div className="flex gap-4">
    <dt className="eyebrow w-20 shrink-0 pt-0.5">{label}</dt>
    <dd className="min-w-0 flex-1">{children}</dd>
  </div>
);

// ---------------------------------------------------------- block time ---
function BlockTab({ viewerTimezone }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ providerId: '', date: '', startTime: '09:00', endTime: '12:00', note: '' });
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    providerApi.list().then((r) => {
      setList(r.providers);
      setForm((f) => ({ ...f, providerId: f.providerId || r.providers[0]?.id || '' }));
    });
  }, []);

  const provider = list.find((p) => p.id === form.providerId);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      // The window is entered in the PROVIDER's clock, because that is whose
      // day is being taken out of service.
      const { DateTime } = await import('luxon');
      const mk = (t) =>
        DateTime.fromISO(`${form.date}T${t}`, { zone: provider.timezone }).toUTC().toISO();
      await adminApi.block({
        providerId: form.providerId,
        startsAt: mk(form.startTime),
        endsAt: mk(form.endTime),
        note: form.note,
      });
      setStatus({ tone: 'good', text: 'Time blocked. Nothing can be booked into it.' });
      setForm((f) => ({ ...f, note: '' }));
    } catch (err) {
      setStatus({
        tone: 'warn',
        text:
          err.code === 'SLOT_TAKEN'
            ? 'Something is already booked in that window. Cancel it first, then block the time.'
            : err.message,
      });
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card>
      <CardHeader
        eyebrow="Takes the time off the calendar"
        title="Block a window"
        action={
          provider ? (
            <span className="tabular text-[11px] text-slate">
              entered in {zoneCity(provider.timezone)} {offsetLabel(provider.timezone)}
            </span>
          ) : null
        }
      />
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Provider" className="sm:col-span-2">
          <Select value={form.providerId} onChange={set('providerId')}>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {zoneCity(p.timezone)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" required value={form.date} onChange={set('date')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <Input type="time" required value={form.startTime} onChange={set('startTime')} />
          </Field>
          <Field label="To">
            <Input type="time" required value={form.endTime} onChange={set('endTime')} />
          </Field>
        </div>
        <Field label="Reason" className="sm:col-span-2" hint="Shown on the calendar entry.">
          <Input value={form.note} onChange={set('note')} placeholder="Team offsite" />
        </Field>
        {status ? (
          <div className="sm:col-span-2">
            <Notice tone={status.tone}>{status.text}</Notice>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit" variant="brass" disabled={busy || !form.date || !form.providerId}>
            {busy ? 'Blocking…' : 'Block this window'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// -------------------------------------------------------------- people ---
function PeopleTab() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    adminApi.users().then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!users) return <Spinner />;

  return (
    <Card>
      <CardHeader eyebrow="Roles decide what each account can reach" title="People" />
      <ul className="divide-y divide-rule">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{u.name}</p>
              <p className="truncate text-[13px] text-slate">{u.email}</p>
            </div>
            <span className="tabular text-[11px] text-slate">
              {zoneCity(u.timezone)} {offsetLabel(u.timezone)}
            </span>
            <Select
              aria-label={`Role for ${u.name}`}
              className="h-8 w-32 py-0 text-[13px]"
              value={u.role}
              onChange={(e) => adminApi.setRole(u.id, e.target.value).then(load)}
            >
              <option value="customer">customer</option>
              <option value="provider">provider</option>
              <option value="admin">admin</option>
            </Select>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------- notifications ---
function NotificationsTab() {
  const [emails, setEmails] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminApi.emails().then((r) => setEmails(r.emails)).catch(() => setEmails([]));
  }, []);
  useEffect(load, [load]);

  async function sweep() {
    setBusy(true);
    try {
      const r = await adminApi.runReminders();
      setStatus(
        r.flagged === 0
          ? 'Nothing starting in the next 24 hours needs a reminder.'
          : `Flagged ${r.flagged} booking${r.flagged === 1 ? '' : 's'}, sent ${r.sent}.`,
      );
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        eyebrow="Every notification is recorded, delivered or not"
        title="Notifications"
        action={
          <Button size="sm" variant="outline" onClick={sweep} disabled={busy}>
            {busy ? 'Running…' : 'Run reminder sweep'}
          </Button>
        }
      />
      {status ? (
        <div className="px-5 pt-4">
          <Notice tone="good">{status}</Notice>
        </div>
      ) : null}
      {!emails ? (
        <Spinner />
      ) : emails.length === 0 ? (
        <Empty title="No notifications yet">
          Confirmations, cancellations, reschedules and reminders all land here once bookings start
          happening.
        </Empty>
      ) : (
        <ul className="divide-y divide-rule">
          {emails.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Badge tone={e.status === 'sent' ? 'confirmed' : 'cancelled'}>{e.transport}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{e.subject}</p>
                <p className="truncate text-[12px] text-slate">
                  {e.to_email} · {e.template}
                </p>
              </div>
              {e.error ? <span className="text-[12px] text-rose">{e.error}</span> : null}
              <span className="tabular text-[11px] text-slate-soft">
                {new Date(e.created_at).toISOString().slice(11, 16)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
