'use client';

import { fromNationalDigits, isValidIndianPhone, toNationalDigits } from '@/lib/phone';
import { Label } from '../ui/Field';

/**
 * The phone field, with `+91` rendered as a fixed prefix box.
 *
 * A pilot therapist hit "Validation failed" on Create client with no idea
 * which field was wrong: the API wants `+91` + exactly 10 digits, and the
 * input was a bare text box seeded with the string "+91", so it was entirely
 * unclear whether to type the country code, and every natural spacing failed.
 *
 * Splitting the prefix out removes the question. The therapist types the 10
 * digits they read off the form; `+91` is visibly not theirs to manage. A full
 * number pasted in still works — `toNationalDigits` strips a leading +91 / 91 /
 * 0 — and the field caps at 10 digits, so it cannot hold something unsendable.
 *
 * It is a FIXED prefix, not a country picker, on purpose: `IndianPhoneSchema`
 * accepts +91 only, so a dropdown offering +1 would just be a slower way to
 * fail. If the product ever takes non-Indian numbers, this is the one place
 * that has to change.
 *
 * `value` / `onChange` speak the canonical stored form (`+919876543210`), so
 * callers keep passing it straight to the API.
 */

interface Props {
  id: string;
  value: string;
  onChange: (canonical: string) => void;
  label?: string;
  required?: boolean;
  autoFocus?: boolean;
}

export function PhoneField({
  id,
  value,
  onChange,
  label = 'Their phone',
  required,
  autoFocus,
}: Props) {
  const digits = toNationalDigits(value);
  // Only complain once there is enough typed to be a real mistake — nagging
  // from the first keystroke is noise.
  const showError = digits.length > 0 && digits.length < 10 && !isValidIndianPhone(value);

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div
        className={`flex items-stretch overflow-hidden rounded-xl border bg-white shadow-[inset_0_2px_4px_rgba(35,45,95,0.06)] focus-within:ring-2 focus-within:ring-[var(--color-accent-soft)] ${
          showError ? 'border-[var(--color-warn-border)]' : 'border-[var(--color-line)]'
        } focus-within:border-[var(--color-accent)]`}
      >
        <span
          aria-hidden
          className="grid select-none place-items-center border-r border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3.5 text-[15px] font-medium text-[var(--color-ink-2)]"
        >
          +91
        </span>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          required={required}
          value={digits}
          onChange={(e) => onChange(fromNationalDigits(e.target.value))}
          placeholder="98765 43210"
          aria-describedby={`${id}-hint`}
          className="w-full bg-transparent px-4 py-3 text-[15px] tracking-[0.02em] text-[var(--color-ink)] placeholder:tracking-normal placeholder:text-[var(--color-ink-3)] focus:outline-none"
        />
      </div>
      <p
        id={`${id}-hint`}
        className={`mt-1 text-xs ${showError ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-3)]'}`}
      >
        {showError
          ? `${10 - digits.length} more digit${10 - digits.length === 1 ? '' : 's'}`
          : 'Just the 10 digits.'}
      </p>
    </div>
  );
}
