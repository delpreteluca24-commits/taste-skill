import React from 'react';

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger';

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }> = ({
  variant = 'subtle', size = 'md', className = '', ...props
}) => {
  const v: Record<Variant, string> = {
    primary: 'bg-accent text-accent-ink hover:brightness-105 font-semibold',
    ghost: 'text-ink-300 hover:text-ink-100 hover:bg-ink-800',
    subtle: 'bg-ink-800 text-ink-100 hover:bg-ink-700 border border-ink-700',
    danger: 'text-red-300 hover:bg-red-500/10 border border-red-500/20',
  };
  const s = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1.5' : 'h-9 px-3.5 text-sm gap-2';
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-lg transition active:translate-y-px disabled:opacity-40 disabled:pointer-events-none ${v[variant]} ${s} ${className}`}
    />
  );
};

export const Pill: React.FC<{ children: React.ReactNode; tone?: 'accent' | 'muted' | 'good' | 'warn' | 'bad'; className?: string }> = ({ children, tone = 'muted', className = '' }) => {
  const t = {
    accent: 'bg-accent/15 text-accent border-accent/25',
    muted: 'bg-ink-800 text-ink-300 border-ink-700',
    good: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    warn: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    bad: 'bg-red-500/10 text-red-300 border-red-500/20',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-none ${t} ${className}`}>{children}</span>;
};

export const Progress: React.FC<{ value: number }> = ({ value }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
    <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
  </div>
);

export const SectionTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <div className="flex items-center justify-between px-3 pt-3 pb-2">
    <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">{children}</h3>
    {right}
  </div>
);

export const scoreTone = (s: number) => (s >= 75 ? 'good' : s >= 50 ? 'warn' : 'bad') as 'good' | 'warn' | 'bad';
