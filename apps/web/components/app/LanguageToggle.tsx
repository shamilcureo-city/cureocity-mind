'use client';

import { LOCALES, LOCALE_LABELS, VALIDATED_LOCALES, setLocale, useLocale } from '../../lib/locale';

/**
 * Sprint 69 — language toggle for the education content.
 *
 * Only locales with clinician-validated copy are selectable; the rest show
 * "soon" (their copy is being validated — never machine-translated). When
 * more than English ships, the inline "What's this?" explainers re-resolve
 * live to the chosen language.
 */
export function LanguageToggle() {
  const current = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-[var(--color-ink-3)]">Language</span>
      {LOCALES.map((l) => {
        const validated = VALIDATED_LOCALES.includes(l);
        const active = current === l;
        return (
          <button
            key={l}
            type="button"
            disabled={!validated}
            onClick={() => validated && setLocale(l)}
            title={validated ? undefined : 'Validated translation in progress'}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              active
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : validated
                  ? 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)]'
                  : 'cursor-not-allowed border-[var(--color-line-soft)] bg-white text-[var(--color-ink-3)] opacity-70'
            }`}
          >
            {LOCALE_LABELS[l]}
            {!validated && ' · soon'}
          </button>
        );
      })}
    </div>
  );
}
