'use client';

import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { offsetLabel, zoneCity, zoneGap, clock } from '@/lib/time';
import { cn } from './ui';

/**
 * The signature element.
 *
 * Most booking tools hide the other party's clock, which is exactly the
 * information that goes wrong when two people are in different places. Here it
 * is permanent chrome: two live instruments, side by side, visibly disagreeing.
 * The colon ticks so it reads as a running clock rather than a static label.
 */
export function DualClockStrip({ you, them, themLabel = 'Provider', className }) {
  // Starts null rather than at DateTime.utc(): reading the clock during render
  // gives the server one instant and the hydrating client another, so the
  // digits disagree across any minute boundary. The clock starts ticking on
  // mount and shows a stable placeholder until then.
  const [now, setNow] = useState(null);

  useEffect(() => {
    setNow(DateTime.utc());
    const id = setInterval(() => setNow(DateTime.utc()), 1000);
    return () => clearInterval(id);
  }, []);

  const face = (zone, role, accent) => {
    const dt = now?.setZone(zone);
    return (
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="eyebrow shrink-0 text-white/45">{role}</span>
        <span className={cn('tabular text-[22px] leading-none font-medium tracking-tight', accent)}>
          {dt ? dt.toFormat('HH') : '--'}
          <span className={dt ? 'tick px-[1px]' : 'px-[1px]'}>:</span>
          {dt ? dt.toFormat('mm') : '--'}
        </span>
        <span className="min-w-0 truncate text-[13px] text-white/70">
          {zoneCity(zone)}
          <span className="tabular ml-2 text-[11px] text-white/40">{offsetLabel(zone)}</span>
        </span>
      </div>
    );
  };

  const sameZone = you === them;

  return (
    <div className={cn('ruled border-b border-white/10 bg-ink', className)}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
        {face(you, 'You', 'text-brass-lit')}
        {!sameZone ? (
          <>
            <span className="tabular hidden text-[11px] text-white/25 sm:inline">
              {zoneGap(them, you)}
            </span>
            {face(them, themLabel, 'text-white')}
          </>
        ) : (
          <span className="text-[13px] text-white/40">Same timezone as the {themLabel.toLowerCase()}</span>
        )}
      </div>
    </div>
  );
}

/**
 * One instant, both names, stacked. Used on every slot button and every
 * booking row - the rule is that a time never appears in this app without the
 * zone it belongs to.
 */
export function StackedTime({ instant, primaryZone, secondaryZone, size = 'md', className }) {
  const dual = primaryZone !== secondaryZone;
  return (
    <span className={cn('flex flex-col items-start leading-none', className)}>
      <span
        className={cn(
          'tabular font-medium text-ink',
          size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-[13px]' : 'text-[15px]',
        )}
      >
        {clock(instant, primaryZone)}
      </span>
      {dual ? (
        <span className="tabular mt-[3px] text-[11px] text-teal">
          {clock(instant, secondaryZone)}
          <span className="ml-1 text-slate-soft">{zoneCity(secondaryZone)}</span>
        </span>
      ) : null}
    </span>
  );
}
