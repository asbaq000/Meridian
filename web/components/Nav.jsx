'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { cn, IconButton, Button, Calendar, Clock, User, Sliders } from './ui';
import { ThemeToggle } from './ThemeToggle';
import { offsetLabel, zoneCity } from '@/lib/time';

/**
 * Top bar on desktop, floating pill on mobile - the pattern both references
 * use. The identity mark carries the viewer's UTC offset, because in this
 * product "who you are" and "what time it is for you" are the same fact.
 */

const ITEMS = [
  { href: '/', label: 'Book', Icon: Calendar },
  { href: '/bookings', label: 'Bookings', Icon: Clock, auth: true },
  { href: '/provider', label: 'Hours', Icon: Sliders, provider: true },
  { href: '/admin', label: 'Admin', Icon: User, admin: true },
];

export function Nav() {
  const { user, ready, logout, isAdmin, isProvider, providers, viewerTimezone } = useAuth();
  const pathname = usePathname();

  const visible = ITEMS.filter((i) => {
    if (i.admin) return isAdmin;
    if (i.provider) return isProvider && providers.length > 0;
    if (i.auth) return Boolean(user);
    return true;
  });

  const isActive = (href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      {/* ------------------------------------------------------- desktop --- */}
      <header className="px-4 pt-5 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-on-ink">
              M
            </span>
            <span className="hidden sm:block">
              <span className="block text-[15px] leading-none font-semibold">Meridian</span>
              <span className="clock mt-1 block text-[10px] leading-none text-mist">
                {offsetLabel(viewerTimezone)} {zoneCity(viewerTimezone)}
              </span>
            </span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {visible.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={cn(
                  'rounded-full px-4 py-2 text-sm transition-colors duration-200',
                  isActive(i.href) ? 'bg-ink text-on-ink' : 'text-ash well-hover hover:text-ink',
                )}
              >
                {i.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <>
                <span className="hidden text-sm text-ash lg:block">{user.name}</span>
                <IconButton label="Sign out" onClick={logout}>
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                    <path
                      d="M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h3M12 7l3 3-3 3M15 10H8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </IconButton>
              </>
            ) : ready ? (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="sm">Create account</Button>
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {/* -------------------------------------------------------- mobile --- */}
      {visible.length > 1 ? (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 md:hidden">
          <div className="flex items-center gap-1 rounded-full bg-card p-1.5 shadow-[var(--shadow-lift)]">
            {visible.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                aria-label={i.label}
                className={cn(
                  'flex h-11 items-center gap-2 rounded-full px-4 transition-colors duration-200',
                  isActive(i.href) ? 'bg-ink text-on-ink' : 'text-ash',
                )}
              >
                <i.Icon />
                {isActive(i.href) ? <span className="text-[13px] font-medium">{i.label}</span> : null}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </>
  );
}
