'use client';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...args) => twMerge(clsx(args));

// ------------------------------------------------------------------ Button --
const VARIANTS = {
  // The commit action, borrowed from the reference's charcoal bar.
  ink: 'bg-ink text-on-ink hover:bg-ink-soft disabled:bg-mist',
  slate: 'bg-slate text-on-ink hover:bg-slate-deep disabled:bg-mist',
  outline: 'bg-card text-ink border border-line hover:border-ink/30',
  ghost: 'bg-transparent text-ash hover:text-ink well-hover',
  danger: 'bg-clay-tint text-clay hover:bg-clay hover:text-on-ink',
};

const SIZES = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-14 px-7 text-[15px]',
};

export function Button({ variant = 'ink', size = 'md', className, ...props }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium',
        'transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/**
 * The circular hairline button both references use for a secondary action -
 * top-right of a card, or beside a heading.
 */
export function IconButton({ className, label, children, ...props }) {
  return (
    <button
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-card',
        'h-10 w-10 text-ink transition-colors duration-200',
        'hover:border-ink/25 disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// -------------------------------------------------------------------- Card --
export function Card({ className, ...props }) {
  return (
    <div
      className={cn('rounded-[var(--radius-card)] bg-card shadow-[var(--shadow-card)]', className)}
      {...props}
    />
  );
}

export function CardHeader({ label, title, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-6 pt-6 pb-4', className)}>
      <div className="min-w-0">
        {label ? <p className="label mb-2">{label}</p> : null}
        <h2 className="truncate text-lg font-semibold">{title}</h2>
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------- Chip --
/** Pill filter/metadata chip. Active state is a dark fill, as in the reference. */
export function Chip({ active = false, as: Tag = 'span', className, ...props }) {
  return (
    <Tag
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] whitespace-nowrap',
        'transition-colors duration-200',
        active ? 'bg-ink text-on-ink' : 'border border-line bg-card text-ash hover:border-ink/25',
        className,
      )}
      {...props}
    />
  );
}

/** Small status marker. Only three states exist, so only three tones do. */
const TONE = {
  confirmed: 'bg-slate-tint text-slate-deep',
  cancelled: 'bg-clay-tint text-clay',
  completed: 'well text-ash',
  block: 'bg-ink text-on-ink',
  accent: 'bg-slate-tint text-slate-deep',
};

export function Badge({ tone = 'confirmed', className, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium tracking-[0.1em] uppercase',
        TONE[tone] ?? TONE.completed,
        className,
      )}
      {...props}
    />
  );
}

// ------------------------------------------------------------------ Field --
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cn('block', className)}>
      <span className="label mb-2 block">{label}</span>
      {children}
      {hint && !error ? <span className="mt-2 block text-xs text-ash">{hint}</span> : null}
      {error ? <span className="mt-2 block text-xs text-clay">{error}</span> : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-[var(--radius-inner)] border border-line bg-card px-4 py-3 text-sm text-ink ' +
  'placeholder:text-mist transition-colors duration-200 focus:border-slate focus:outline-none ' +
  'focus-visible:outline-none';

export const Input = ({ className, ...props }) => <input className={cn(CONTROL, className)} {...props} />;
export const Textarea = ({ className, ...props }) => (
  <textarea className={cn(CONTROL, 'min-h-24 resize-y', className)} {...props} />
);
export const Select = ({ className, ...props }) => (
  <select className={cn(CONTROL, 'cursor-pointer appearance-none pr-10', className)} {...props} />
);

/** Select wrapper that draws its own chevron, since we strip the native one. */
export function SelectField({ className, children, ...props }) {
  return (
    <div className="relative">
      <Select className={className} {...props}>
        {children}
      </Select>
      <svg
        aria-hidden
        viewBox="0 0 12 8"
        className="pointer-events-none absolute top-1/2 right-4 h-2 w-3 -translate-y-1/2 text-ash"
      >
        <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ----------------------------------------------------------------- States --
export function Notice({ tone = 'info', title, children, className }) {
  const tones = {
    info: 'bg-card text-ash',
    warn: 'bg-slate-tint text-slate-deep',
    error: 'bg-clay-tint text-clay',
    good: 'bg-slate-tint text-slate-deep',
  };
  return (
    <div className={cn('rounded-[var(--radius-inner)] px-5 py-4 text-sm', tones[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn('leading-relaxed', title && 'mt-1')}>{children}</div> : null}
    </div>
  );
}

/** An empty screen is an invitation to act, so it always carries the action. */
export function Empty({ title, children, action }) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <div className="mb-5 h-8 w-8 rounded-full border border-line" />
      <p className="text-base font-medium">{title}</p>
      {children ? <p className="mt-2 max-w-xs text-sm leading-relaxed text-ash">{children}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-ash">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-slate"
            style={{ animation: `settle 900ms ${i * 140}ms ease-in-out infinite alternate` }}
          />
        ))}
      </span>
      {label}
    </div>
  );
}

/** Skeleton block for content whose shape we already know. */
export const Skeleton = ({ className }) => (
  <div className={cn('animate-pulse rounded-[var(--radius-inner)] well', className)} />
);

// ----------------------------------------------------------------- Sheet --
/**
 * Rises from the bottom on mobile, centres on desktop - the reference's
 * detail sheet rather than a desktop modal.
 */
export function Sheet({ open, onClose, label, title, children, footer }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--c-scrim)] backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'settle w-full max-w-lg bg-card shadow-[var(--shadow-lift)]',
          'rounded-t-[var(--radius-card)] sm:rounded-[var(--radius-card)]',
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            {label ? <p className="label mb-2">{label}</p> : null}
            <h2 className="text-xl font-semibold">{title}</h2>
          </div>
          <IconButton label="Close" onClick={onClose} className="-mt-1">
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
              <path d="M1 1l12 12M13 1L1 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </IconButton>
        </div>
        <div className="max-h-[62vh] overflow-y-auto px-6 pb-2">{children}</div>
        {footer ? <div className="px-6 pt-4 pb-6">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * The charcoal commit bar from the resort reference: the consequence on the
 * left, the action on the right, pinned to the bottom of the screen.
 */
export function CommitBar({ label, value, action, className }) {
  return (
    <div className={cn('fixed inset-x-0 bottom-0 z-30 px-4 pb-4 sm:px-6 sm:pb-6', className)}>
      <div className="mx-auto flex max-w-lg items-center gap-4 rounded-full bg-ink py-2.5 pr-2.5 pl-6 shadow-[var(--shadow-lift)]">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] tracking-[0.14em] text-on-ink/45 uppercase">{label}</p>
          <p className="truncate text-sm font-medium text-on-ink">{value}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Icons --
/* Hairline, 1.5px, matching the reference's circular buttons. */
const svg = (d, viewBox = '0 0 20 20') =>
  function Icon({ className }) {
    return (
      <svg viewBox={viewBox} className={cn('h-4 w-4', className)} fill="none" aria-hidden>
        <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };

export const ArrowUpRight = svg('M6 14L14 6M14 6H7M14 6v7');
export const ChevronLeft = svg('M12 4L6 10l6 6');
export const ChevronRight = svg('M8 4l6 6-6 6');
export const Calendar = svg('M4 7h12M6 3v2m8-2v2M4.5 5h11a1 1 0 011 1v9a1 1 0 01-1 1h-11a1 1 0 01-1-1V6a1 1 0 011-1z');
export const Clock = svg('M10 5v5l3 2M10 17a7 7 0 100-14 7 7 0 000 14z');
export const User = svg('M10 10a3 3 0 100-6 3 3 0 000 6zM4 16a6 6 0 0112 0');
export const Sliders = svg('M4 6h12M4 14h12M8 4v4M13 12v4');
export const Bell = svg('M10 4a4 4 0 014 4v3l1.5 2h-11L6 11V8a4 4 0 014-4zM8.5 16a1.5 1.5 0 003 0');
export const Check = svg('M4 10.5l4 4 8-8');
