'use client';

import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { offsetLabel, zoneCity, zoneGap, clock } from '@/lib/time';
import { cn } from './ui';

/**
 * ============================================================ the signature ==
 * The Overlap Ribbon.
 *
 * A slot grid is the default answer for a booking screen, and it answers the
 * wrong question first. The thing that actually makes cross-timezone booking
 * hard is that two people's days only *partly* overlap - and no grid shows you
 * that. This does: one 24-hour track for the day, your hours labelled along the
 * top, theirs along the bottom offset by the real difference, and the bookable
 * window drawn as a band across it.
 *
 * It is built from the same slot data the grid below it uses, so it can never
 * disagree with what is actually bookable.
 * ============================================================================
 */
export function OverlapRibbon({ slots = [], date, viewerZone, providerZone, className }) {
  // Position within the viewer's local day, 0-1. The track *is* the viewer's
  // day, which is why the ribbon reads correctly no matter whose zone you pick.
  const dayStart = DateTime.fromISO(date, { zone: viewerZone }).startOf('day');

  const bands = mergeBands(
    slots.map((s) => {
      const start = DateTime.fromISO(s.startsAt, { zone: 'utc' }).setZone(viewerZone);
      const end = DateTime.fromISO(s.endsAt, { zone: 'utc' }).setZone(viewerZone);
      return {
        from: clamp(start.diff(dayStart, 'minutes').minutes / 1440),
        to: clamp(end.diff(dayStart, 'minutes').minutes / 1440),
      };
    }),
  );

  // How far the provider's clock is shifted, as a fraction of the track.
  const offsetHours = (dayStart.setZone(providerZone).offset - dayStart.offset) / 60;
  const sameZone = viewerZone === providerZone;

  const ticks = [0, 6, 12, 18];
  const hourAt = (h, shift = 0) => ((h + shift) % 24 + 24) % 24;

  return (
    <div className={cn('select-none', className)}>
      {/* your hours */}
      <div className="relative mb-2 h-3">
        {ticks.map((h) => (
          <span
            key={h}
            className="clock absolute top-0 text-[10px] text-ash"
            style={{ left: `${(h / 24) * 100}%`, transform: h === 0 ? 'none' : 'translateX(-50%)' }}
          >
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>

      {/* the track */}
      <div className="relative h-11 overflow-hidden rounded-full well">
        {/* six-hour guides, so the eye can measure the band */}
        {ticks.slice(1).map((h) => (
          <span
            key={h}
            className="absolute top-0 bottom-0 w-px bg-[var(--c-guide)]"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}

        {bands.map((b, i) => (
          <span
            key={i}
            className="unfurl absolute top-0 bottom-0 bg-slate"
            style={{
              left: `${b.from * 100}%`,
              width: `${Math.max(b.to - b.from, 0.006) * 100}%`,
              animationDelay: `${140 + i * 90}ms`,
            }}
          />
        ))}

        {bands.length === 0 ? (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-mist">
            no shared hours this day
          </span>
        ) : null}
      </div>

      {/* their hours, shifted by the real offset */}
      <div className="relative mt-2 h-3">
        {ticks.map((h) => (
          <span
            key={h}
            className="clock absolute top-0 text-[10px] text-slate-deep"
            style={{ left: `${(h / 24) * 100}%`, transform: h === 0 ? 'none' : 'translateX(-50%)' }}
          >
            {String(hourAt(h, offsetHours)).padStart(2, '0')}
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1.5 text-ash">
          <span className="h-2 w-2 rounded-full bg-slate" />
          open to book
        </span>
        <span className="text-ash">
          top row <span className="text-ink">{zoneCity(viewerZone)}</span>
        </span>
        {!sameZone ? (
          <span className="text-ash">
            bottom row <span className="text-slate-deep">{zoneCity(providerZone)}</span>{' '}
            {zoneGap(providerZone, viewerZone)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const clamp = (v) => Math.min(Math.max(v, 0), 1);

/** Adjacent or touching slots become one continuous band. */
function mergeBands(raw) {
  const sorted = raw.filter((b) => b.to > b.from).sort((a, b) => a.from - b.from);
  const out = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    // 1/1440 of the track is one minute - anything closer is the same band.
    if (last && b.from <= last.to + 0.0008) last.to = Math.max(last.to, b.to);
    else out.push({ ...b });
  }
  return out;
}

/**
 * The two clocks, live. Kept from the previous design because it is the
 * product's thesis, but restated quietly: no panel, no chrome, just two
 * readings and the gap between them.
 */
export function DualClock({ you, them, className }) {
  // Null until mount. Reading the clock during render gives the server one
  // instant and the hydrating client another.
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(DateTime.utc());
    const id = setInterval(() => setNow(DateTime.utc()), 1000);
    return () => clearInterval(id);
  }, []);

  const read = (zone) => (now ? now.setZone(zone).toFormat('HH:mm') : '--:--');
  const sameZone = you === them;

  return (
    <div className={cn('flex items-center gap-5', className)}>
      <Reading label="Your time" value={read(you)} zone={you} />
      {!sameZone ? (
        <>
          <span className="text-[11px] text-mist">{zoneGap(them, you)}</span>
          <Reading label="Their time" value={read(them)} zone={them} accent />
        </>
      ) : null}
    </div>
  );
}

function Reading({ label, value, zone, accent = false }) {
  return (
    <div className="min-w-0">
      <p className="label mb-1">{label}</p>
      <p className={cn('clock text-2xl leading-none font-medium', accent ? 'text-slate-deep' : 'text-ink')}>
        {value}
      </p>
      <p className="mt-1.5 truncate text-[11px] text-ash">
        {zoneCity(zone)} <span className="text-mist">{offsetLabel(zone)}</span>
      </p>
    </div>
  );
}

/**
 * One instant, both names. The rule the whole app runs on: a time never
 * appears without the zone it belongs to, and the other party's reading sits
 * directly beneath in slate.
 */
export function StackedTime({ instant, primaryZone, secondaryZone, size = 'md', className }) {
  const dual = primaryZone !== secondaryZone;
  return (
    <span className={cn('flex flex-col items-start leading-none', className)}>
      <span
        className={cn(
          'clock font-medium text-ink',
          size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base',
        )}
      >
        {clock(instant, primaryZone)}
      </span>
      {dual ? (
        <span className="clock mt-1.5 text-[11px] text-slate-deep">{clock(instant, secondaryZone)}</span>
      ) : null}
    </span>
  );
}
