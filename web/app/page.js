'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { providers as providerApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { DualClock } from '@/components/DualClock';
import {
  ArrowUpRight,
  Badge,
  Button,
  Card,
  Chip,
  Empty,
  Notice,
  Skeleton,
  cn,
} from '@/components/ui';
import { offsetLabel, zoneCity, zoneGap } from '@/lib/time';

export default function HomePage() {
  const { viewerTimezone, user, timezoneResolved } = useAuth();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    providerApi
      .list()
      .then((r) => setList(r.providers))
      .catch((e) => setError(e.message));
  }, []);

  const shown = (list ?? []).filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'yours') return p.timezone === viewerTimezone;
    return p.timezone !== viewerTimezone;
  });

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-6 md:pb-10">
      {/* ------------------------------------------------------------ hero --- */}
      <section className="settle mb-10">
        <p className="label mb-4">Scheduling across meridians</p>
        <h1 className="display max-w-2xl text-[42px] sm:text-[58px]">
          Pick a moment
          <br />
          <strong>you both agree on.</strong>
        </h1>
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-ash">
          Every time here is shown in yours and in theirs. Slots come from each provider&rsquo;s real
          working hours, and a slot can only ever be taken once.
        </p>

        {user ? (
          <div className="mt-8">
            <DualClock you={viewerTimezone} them={viewerTimezone} />
          </div>
        ) : (
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register">
              <Button size="lg">Create an account</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">
                Sign in
              </Button>
            </Link>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- providers --- */}
      <section className="settle settle-2">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">Who you can book</h2>
          {timezoneResolved ? (
            <span className="clock text-[11px] text-ash">
              your clock · {offsetLabel(viewerTimezone)}
            </span>
          ) : null}
        </div>

        <div className="rail mb-6 flex gap-2">
          {[
            { id: 'all', label: 'Everyone' },
            { id: 'yours', label: 'Your timezone' },
            { id: 'away', label: 'Elsewhere' },
          ].map((f) => (
            <Chip key={f.id} as="button" active={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {list ? (
                <span className={cn('text-[11px]', filter === f.id ? 'text-on-ink/50' : 'text-mist')}>
                  {f.id === 'all'
                    ? list.length
                    : list.filter((p) =>
                        f.id === 'yours' ? p.timezone === viewerTimezone : p.timezone !== viewerTimezone,
                      ).length}
                </span>
              ) : null}
            </Chip>
          ))}
        </div>

        {error ? (
          <Notice tone="error" title="Could not load providers">
            {error}
          </Notice>
        ) : !list ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-56 rounded-[var(--radius-card)]" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <Card>
            <Empty
              title={list.length === 0 ? 'No providers yet' : 'Nobody in that group'}
              action={
                list.length === 0 ? (
                  <Link href="/admin">
                    <Button variant="outline">Add one in Admin</Button>
                  </Link>
                ) : (
                  <Button variant="outline" onClick={() => setFilter('all')}>
                    Show everyone
                  </Button>
                )
              }
            >
              {list.length === 0
                ? 'An admin creates providers and sets their working hours. Once one exists, its bookable slots appear here.'
                : 'Try another filter.'}
            </Empty>
          </Card>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p, i) => (
              <li key={p.id} className="settle" style={{ animationDelay: `${160 + i * 70}ms` }}>
                <ProviderCard provider={p} viewerTimezone={viewerTimezone} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The reference card anatomy: a number with its unit top-left, a circular
 * action top-right, the name at the foot. Where the jet app puts "13 /
 * Passengers", the useful number here is how far their clock is from yours -
 * the first thing that decides whether booking them is practical.
 */
function ProviderCard({ provider: p, viewerTimezone }) {
  const away = p.timezone !== viewerTimezone;
  const gap = zoneGap(p.timezone, viewerTimezone);

  return (
    <Link href={`/book/${p.slug}`} className="group block h-full">
      <Card
        className={cn(
          'flex h-full flex-col p-6 transition-all duration-300',
          'group-hover:-translate-y-1 group-hover:shadow-[var(--shadow-lift)]',
        )}
      >
        <div className="mb-8 flex items-start justify-between gap-3">
          <div>
            <p className="clock text-[32px] leading-none font-medium">{away ? gap : '0h'}</p>
            <p className="label mt-2">{away ? 'from your clock' : 'same as you'}</p>
          </div>
          <span
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-300',
              'border border-line text-ink group-hover:border-transparent group-hover:bg-ink group-hover:text-on-ink',
            )}
          >
            <ArrowUpRight />
          </span>
        </div>

        <h3 className="text-[19px] leading-tight font-semibold">{p.name}</h3>
        <p className="mt-1.5 text-[13px] text-ash">
          {zoneCity(p.timezone)} <span className="clock text-mist">{offsetLabel(p.timezone)}</span>
        </p>

        {p.description ? (
          <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ash">{p.description}</p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
          <Badge tone="accent">{p.slotMinutes} min</Badge>
          {p.bufferMinutes > 0 ? <Badge>{p.bufferMinutes} min gap</Badge> : null}
          <Badge>cancel {p.cancellationCutoffHours}h ahead</Badge>
        </div>
      </Card>
    </Link>
  );
}
