'use client';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...args) => twMerge(clsx(args));

// ------------------------------------------------------------------ Button --
const VARIANTS = {
  primary: 'bg-ink text-white hover:bg-ink-soft disabled:bg-slate-soft',
  brass: 'bg-brass text-white hover:bg-[#8d5409] disabled:bg-slate-soft',
  outline: 'bg-white text-ink border border-rule hover:border-ink hover:bg-paper',
  ghost: 'bg-transparent text-slate hover:text-ink hover:bg-white',
  danger: 'bg-white text-rose border border-rose/35 hover:bg-rose-wash',
};

const SIZES = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
};

export function Button({ variant = 'primary', size = 'md', className, ...props }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[3px] font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-70',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

// -------------------------------------------------------------------- Card --
export function Card({ className, ...props }) {
  return <div className={cn('card rounded-[3px]', className)} {...props} />;
}

export function CardHeader({ eyebrow, title, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-rule px-5 py-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h2 className="truncate text-[17px] font-semibold text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------- Field --
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cn('block', className)}>
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-slate">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-rose">{error}</span> : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-[3px] border border-rule bg-white px-3 py-2 text-sm text-ink ' +
  'placeholder:text-slate-soft focus:border-brass focus:outline-none focus-visible:outline-none';

export const Input = ({ className, ...props }) => <input className={cn(CONTROL, className)} {...props} />;
export const Select = ({ className, ...props }) => (
  <select className={cn(CONTROL, 'appearance-none pr-8', className)} {...props} />
);
export const Textarea = ({ className, ...props }) => (
  <textarea className={cn(CONTROL, 'min-h-20 resize-y', className)} {...props} />
);

// ------------------------------------------------------------------- Badge --
const BADGE = {
  confirmed: 'bg-teal-wash text-teal',
  cancelled: 'bg-rose-wash text-rose',
  completed: 'bg-paper text-slate',
  block: 'bg-ink text-white',
  brass: 'bg-brass-wash text-brass',
};

export function Badge({ tone = 'confirmed', children, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em]',
        BADGE[tone] ?? BADGE.completed,
        className,
      )}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ States --
export function Notice({ tone = 'info', title, children, action }) {
  const tones = {
    info: 'border-rule bg-white text-slate',
    warn: 'border-brass/30 bg-brass-wash text-[#7a4a08]',
    error: 'border-rose/30 bg-rose-wash text-rose',
    good: 'border-teal/25 bg-teal-wash text-teal',
  };
  return (
    <div className={cn('rounded-[3px] border px-4 py-3 text-sm', tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Empty states are an invitation to act, so each one takes an action. */
export function Empty({ title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 h-px w-10 bg-rule" />
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {children ? <p className="mt-1 max-w-sm text-sm text-slate">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-sm text-slate">
      <span className="tabular text-brass">···</span>
      {label}
    </div>
  );
}

// ------------------------------------------------------------------ Dialog --
export function Dialog({ open, onClose, title, eyebrow, children, footer }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flap-in w-full max-w-lg rounded-t-[6px] border border-rule bg-white shadow-2xl sm:rounded-[3px]"
      >
        <div className="border-b border-rule px-5 py-4">
          {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
          <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-rule bg-paper/60 px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
