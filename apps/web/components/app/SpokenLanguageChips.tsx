'use client';

/**
 * Multi-select chip picker for a client's typical spoken languages.
 * Extracted (Sprint 44) so the create modal and the client edit panel
 * share one control. Code-mixing is normal — pick more than one for a
 * Manglish (ml + en) or Hinglish (hi + en) speaker.
 */

export const SPOKEN_LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'bn', label: 'Bengali' },
  { code: 'kn', label: 'Kannada' },
  { code: 'te', label: 'Telugu' },
  { code: 'mr', label: 'Marathi' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'pa', label: 'Punjabi' },
];

export function SpokenLanguageChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(code: string) {
    if (value.includes(code)) {
      onChange(value.filter((c) => c !== code));
    } else {
      onChange([...value, code]);
    }
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {SPOKEN_LANGUAGE_OPTIONS.map((o) => {
        const active = value.includes(o.code);
        return (
          <button
            key={o.code}
            type="button"
            onClick={() => toggle(o.code)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              active
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
                : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink)]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
