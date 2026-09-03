'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { providers as providerApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { Button, Card, Empty, Notice, Spinner, Badge } from '@/components/ui';
import { offsetLabel, zoneCity, zoneGap } from '@/lib/time';

export default function HomePage() {
  const { viewerTimezone, user } = useAuth();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    providerApi
      .list()
      .then((r) => setList(r.providers))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      {/* The hero states the thesis rather than selling: one instant, two names. */}
      <section className="ruled border-b border-rule bg-ink px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <p className="eyebrow text-brass-lit">Scheduling across meridians</p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.05] font-semibold text-white sm:text-6xl">
            One instant.
            <br />
            <span className="text-brass-lit">Two clocks.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-white/65">
            Every time here is shown in yours and in theirs, side by side. Slots come from each
            provider&rsquo;s real working hours, and a slot can only ever be taken once.
          </p>
          {!user ? (
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register">
                <Button variant="brass" size="lg">
                  Create an account
                </Button>
              </Link>
              <Link href="/login">
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/20 bg-transparent text-white hover:border-white/50 hover:bg-white/5"
                >
                  Sign in
                </Button>
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 className="text-xl">Who you can book</h2>
          <span className="tabular text-[11px] tracking-[0.14em] text-slate uppercase">
            Your clock · {offsetLabel(viewerTimezone)}
          </span>
        </div>

        {error ? (
          <Notice tone="error" title="Could not load providers">
            {error}
          </Notice>
        ) : !list ? (
          <Spinner label="Loading providers" />
        ) : list.length === 0 ? (
          <Card>
            <Empty
              title="No providers yet"
              action={
                <Link href="/admin">
                  <Button variant="outline">Add one in Admin</Button>
                </Link>
              }
            >
              An admin creates providers and sets their working hours. Once one exists, its bookable
              slots appear here.
            </Empty>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/book/${p.slug}`} className="group block h-full">
                  <Card className="flex h-full flex-col transition-colors group-hover:border-ink">
                    <div className="flex-1 p-5">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="tabular text-[11px] tracking-[0.12em] text-brass">
                          {offsetLabel(p.timezone)}
                        </span>
                        <span className="text-[11px] text-slate-soft">
                          {zoneCity(p.timezone)}
                          {p.timezone !== viewerTimezone
                            ? ` · ${zoneGap(p.timezone, viewerTimezone)} from you`
                            : ' · your zone'}
                        </span>
                      </div>
                      <h3 className="text-[17px] leading-snug">{p.name}</h3>
                      {p.description ? (
                        <p className="mt-2 text-sm leading-relaxed text-slate">{p.description}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-rule px-5 py-3">
                      <Badge tone="brass">{p.slotMinutes} min</Badge>
                      {p.bufferMinutes > 0 ? <Badge>{p.bufferMinutes} min gap</Badge> : null}
                      <span className="ml-auto text-[13px] font-medium text-ink group-hover:text-brass">
                        See times →
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
