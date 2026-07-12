'use client';

/** 0–10 mood dial — used at pre-flight, after sessions, and on home. */
export function MoodDial({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        {label}
      </div>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            onClick={() => onChange(i)}
            className={`h-9 flex-1 rounded-lg text-xs font-semibold transition-colors ${
              value === i
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface-soft)] text-[var(--color-ink-3)] hover:bg-[var(--color-accent-soft)]'
            }`}
          >
            {i}
          </button>
        ))}
      </div>
    </div>
  );
}
