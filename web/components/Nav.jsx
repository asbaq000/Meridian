'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { Button, cn, Select } from './ui';
import { timezoneOptions, zoneCity, offsetLabel } from '@/lib/time';

function NavLink({ href, children }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        'relative px-1 py-1 text-sm transition-colors',
        active ? 'text-white' : 'text-white/55 hover:text-white/85',
      )}
    >
      {children}
      {active ? <span className="absolute -bottom-[9px] left-0 right-0 h-[2px] bg-brass-lit" /> : null}
    </Link>
  );
}

export function Nav() {
  const { user, ready, logout, isAdmin, isProvider, providers, setTimezone } = useAuth();

  return (
    <header className="bg-ink">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-2">
          <span className="text-[19px] font-semibold tracking-tight text-white">Meridian</span>
          <span className="tabular hidden text-[10px] tracking-[0.18em] text-brass-lit sm:inline">
            {offsetLabel(user?.timezone ?? 'UTC')}
          </span>
        </Link>

        <nav className="flex items-center gap-5">
          <NavLink href="/">Book</NavLink>
          {user ? <NavLink href="/bookings">My bookings</NavLink> : null}
          {isProvider && providers.length > 0 ? <NavLink href="/provider">Availability</NavLink> : null}
          {isAdmin ? <NavLink href="/admin">Admin</NavLink> : null}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              {/* Changing your timezone here changes it everywhere, because it
                  is a property of you, not of this page. */}
              <Select
                aria-label="Your timezone"
                value={user.timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="hidden h-8 w-44 border-white/15 bg-white/5 py-0 font-mono text-[12px] text-white/80 focus:border-brass-lit md:block"
              >
                {timezoneOptions([user.timezone]).map((tz) => (
                  <option key={tz} value={tz} className="text-ink">
                    {zoneCity(tz)} · {offsetLabel(tz)}
                  </option>
                ))}
              </Select>
              <span className="hidden text-sm text-white/60 lg:inline">{user.name}</span>
              <Button size="sm" variant="ghost" className="text-white/60 hover:bg-white/10 hover:text-white" onClick={logout}>
                Sign out
              </Button>
            </>
          ) : ready ? (
            <>
              <Link href="/login" className="text-sm text-white/60 transition-colors hover:text-white">
                Sign in
              </Link>
              <Link href="/register">
                <Button size="sm" variant="brass">
                  Create account
                </Button>
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
