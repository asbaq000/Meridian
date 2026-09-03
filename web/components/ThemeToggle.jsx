'use client';

import { useEffect, useState } from 'react';
import { cn } from './ui';

const KEY = 'meridian.theme';

/**
 * Light / dark toggle.
 *
 * Light is the default. The OS preference is deliberately not consulted: an
 * unset theme means light, and dark applies only once the viewer asks for it.
 *
 * The theme itself is applied by the inline script in app/layout.js, which
 * runs before first paint. This component only reads and writes it, so there
 * is no flash of the wrong theme on load.
 */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: the choice just does not persist */
    }
  } else {
    delete root.dataset.theme;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignored */
    }
  }
}

export function ThemeToggle({ className }) {
  // Null until mount. The current theme lives in the DOM and localStorage,
  // neither of which exists during SSR - reading either while rendering would
  // make the server and client disagree.
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        const next = isDark ? 'light' : 'dark';
        applyTheme(next);
        setTheme(next);
      }}
      className={cn(
        'relative inline-flex h-10 w-[68px] shrink-0 items-center rounded-full border border-line',
        'bg-card transition-colors duration-300',
        className,
      )}
    >
      {/* The knob slides; the two glyphs stay put and dim. Rendering the knob
          only once the theme is known avoids it jumping on hydration. */}
      <span
        aria-hidden
        className={cn(
          'absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-ink',
          'transition-[left,opacity] duration-300 ease-out',
          theme === null ? 'opacity-0' : 'opacity-100',
          isDark ? 'left-[34px]' : 'left-[2px]',
        )}
      />
      <span
        aria-hidden
        className={cn(
          'relative z-10 flex h-8 w-8 items-center justify-center transition-colors duration-300',
          'ml-[2px]',
          !isDark && theme ? 'text-on-ink' : 'text-mist',
        )}
      >
        <Sun />
      </span>
      <span
        aria-hidden
        className={cn(
          'relative z-10 flex h-8 w-8 items-center justify-center transition-colors duration-300',
          'ml-[2px]',
          isDark ? 'text-on-ink' : 'text-mist',
        )}
      >
        <Moon />
      </span>
    </button>
  );
}

const Sun = () => (
  <svg viewBox="0 0 20 20" className="h-[15px] w-[15px]" fill="none">
    <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M10 2.6v1.6M10 15.8v1.6M17.4 10h-1.6M4.2 10H2.6M15.2 4.8l-1.1 1.1M5.9 14.1l-1.1 1.1M15.2 15.2l-1.1-1.1M5.9 5.9L4.8 4.8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const Moon = () => (
  <svg viewBox="0 0 20 20" className="h-[15px] w-[15px]" fill="none">
    <path
      d="M16 11.6A6.5 6.5 0 018.4 4a6.5 6.5 0 107.6 7.6z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);
