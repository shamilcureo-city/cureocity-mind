'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select } from '../ui/Field';
import { Button } from '../ui/Button';

interface Facets {
  specialties: string[];
  languages: string[];
  modalities: string[];
  cities: string[];
}

export function DirectoryFilters({ facets }: { facets: Facets }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => {
      router.push(`/therapists${next.toString() ? `?${next}` : ''}`);
    });
  }

  function clearAll(): void {
    startTransition(() => router.push('/therapists'));
  }

  const active =
    Array.from(params.entries()).filter(([k]) => k !== 'page' && params.get(k)).length;

  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Group label="Specialty">
          <Select
            value={params.get('specialty') ?? ''}
            onChange={(e) => apply('specialty', e.target.value)}
          >
            <option value="">Any specialty</option>
            {facets.specialties.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Group>
        <Group label="Language">
          <Select
            value={params.get('language') ?? ''}
            onChange={(e) => apply('language', e.target.value)}
          >
            <option value="">Any language</option>
            {facets.languages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Group>
        <Group label="Modality">
          <Select
            value={params.get('modality') ?? ''}
            onChange={(e) => apply('modality', e.target.value)}
          >
            <option value="">Any approach</option>
            {facets.modalities.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Group>
        <Group label="City">
          <Select
            value={params.get('city') ?? ''}
            onChange={(e) => apply('city', e.target.value)}
          >
            <option value="">Anywhere</option>
            {facets.cities.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Group>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-[var(--color-ink-2)]">
          <input
            type="checkbox"
            checked={params.get('accepting') === '1'}
            onChange={(e) => apply('accepting', e.target.checked ? '1' : '')}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          Accepting new clients
        </label>
        <div className="flex items-center gap-3 text-sm text-[var(--color-ink-3)]">
          {pending && <span>Updating…</span>}
          {active > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-3)]">{label}</span>
      {children}
    </label>
  );
}
