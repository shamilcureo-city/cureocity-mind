'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  Appointment,
  AvailabilityRuleInput,
  DraftMarketingResponse,
  ListAppointmentsResponse,
  MarketingState,
  ProfileFaq,
} from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

/**
 * Marketing V1 — the studio's client surface: publish header +
 * checklist, public URL, weekly availability editor, FAQ editor, and
 * the appointment inbox (confirm → Client + INTAKE Session).
 */

interface Identity {
  credentialsLine: string | null;
  pronouns: string | null;
  officeAddress: string | null;
  hasPhoto: boolean;
}

interface Props {
  initialState: MarketingState;
  initialRules: AvailabilityRuleInput[];
  initialIdentity: Identity;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const IST_FULL = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function minuteLabel(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h < 12 ? 'am' : 'pm';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(mm).padStart(2, '0')} ${ampm}`;
}

/** 06:00–21:00 in 30-min steps — sane pick-list for a clinic day. */
const MINUTE_OPTIONS = Array.from({ length: 31 }, (_, i) => 360 + i * 30);

export function MarketingStudio({ initialState, initialRules, initialIdentity }: Props) {
  const [state, setState] = useState<MarketingState>(initialState);
  const [rules, setRules] = useState<AvailabilityRuleInput[]>(initialRules);
  const [identity, setIdentity] = useState<Identity>(initialIdentity);
  const [draft, setDraft] = useState<DraftMarketingResponse | null>(null);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAppointments = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/appointments', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as ListAppointmentsResponse;
      setAppointments(body.items);
    } catch {
      setAppointments([]);
    }
  }, []);

  useEffect(() => {
    void loadAppointments();
    // Ensure the slug exists server-side (auto-generated on first GET).
    void fetch('/api/v1/psychologists/me/marketing', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<MarketingState>) : null))
      .then((s) => s && setState(s));
  }, [loadAppointments]);

  const act = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  const publish = useCallback(
    (publishNow: boolean) =>
      act('publish', async () => {
        const res = await fetch('/api/v1/psychologists/me/marketing/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publish: publishNow }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? 'Could not update publish state.');
        const fresh = await fetch('/api/v1/psychologists/me/marketing', { cache: 'no-store' });
        if (fresh.ok) setState((await fresh.json()) as MarketingState);
      }),
    [act],
  );

  const saveRules = useCallback(
    (next: AvailabilityRuleInput[]) =>
      act('rules', async () => {
        const res = await fetch('/api/v1/psychologists/me/availability', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not save availability.');
        }
        setRules(next);
      }),
    [act],
  );

  const saveFaqs = useCallback(
    (faqs: ProfileFaq[]) =>
      act('faqs', async () => {
        const res = await fetch('/api/v1/psychologists/me/marketing', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ faqs }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not save FAQs.');
        }
        setState((await res.json()) as MarketingState);
      }),
    [act],
  );

  const requestDraft = useCallback(
    () =>
      act('draft', async () => {
        const res = await fetch('/api/v1/psychologists/me/marketing/draft', { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as
          | DraftMarketingResponse
          | { error?: string };
        if (!res.ok) {
          throw new Error((body as { error?: string }).error ?? 'Could not draft — try again.');
        }
        setDraft(body as DraftMarketingResponse);
      }),
    [act],
  );

  /**
   * Apply = the therapist approved the draft. Headline + bio persist via
   * the account profile route; FAQs via the marketing route.
   */
  const applyDraft = useCallback(
    () =>
      act('apply-draft', async () => {
        if (!draft) return;
        const profileRes = await fetch('/api/v1/psychologists/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ headline: draft.headline.slice(0, 160), bio: draft.bio }),
        });
        if (!profileRes.ok) {
          const body = (await profileRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not save the headline and bio.');
        }
        if (draft.faqs.length > 0) {
          const faqRes = await fetch('/api/v1/psychologists/me/marketing', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ faqs: draft.faqs }),
          });
          if (!faqRes.ok) {
            const body = (await faqRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? 'Could not save the FAQs.');
          }
          setState((await faqRes.json()) as MarketingState);
        }
        setDraft(null);
        setNotice('Draft applied — review it on your page, then publish when ready.');
        const fresh = await fetch('/api/v1/psychologists/me/marketing', { cache: 'no-store' });
        if (fresh.ok) setState((await fresh.json()) as MarketingState);
      }),
    [act, draft],
  );

  const saveIdentity = useCallback(
    () =>
      act('identity', async () => {
        const res = await fetch('/api/v1/psychologists/me/marketing', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credentialsLine: identity.credentialsLine?.trim() || null,
            pronouns: identity.pronouns?.trim() || null,
            officeAddress: identity.officeAddress?.trim() || null,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not save identity details.');
        }
        setNotice('Identity details saved.');
      }),
    [act, identity],
  );

  /**
   * Client-side crop + downscale to a 512px square JPEG so the upload
   * stays small enough for the inline (bytea) store.
   */
  const uploadPhoto = useCallback(
    (file: File) =>
      act('photo', async () => {
        const dataUrl = await new Promise<string>((resolvePromise, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => {
            const side = Math.min(img.width, img.height);
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Could not read the image.'));
            ctx.drawImage(
              img,
              (img.width - side) / 2,
              (img.height - side) / 2,
              side,
              side,
              0,
              0,
              512,
              512,
            );
            URL.revokeObjectURL(url);
            resolvePromise(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('That file is not a readable image.'));
          };
          img.src = url;
        });
        const res = await fetch('/api/v1/psychologists/me/photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not upload the photo.');
        }
        setIdentity((i) => ({ ...i, hasPhoto: true }));
        setNotice('Photo uploaded — it appears on your page once published.');
      }),
    [act],
  );

  const resolve = useCallback(
    (id: string, action: 'confirm' | 'decline') =>
      act(id, async () => {
        const res = await fetch(`/api/v1/appointments/${id}/${action}`, { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `Could not ${action}.`);
        await loadAppointments();
        if (action === 'confirm') {
          setNotice('Confirmed — the client and their intake session are ready.');
        }
      }),
    [act, loadAppointments],
  );

  const published = state.publishedAt !== null;
  const checklistDone = state.checklist.every((c) => c.done);
  const requested = (appointments ?? []).filter((a) => a.status === 'REQUESTED');
  const upcoming = (appointments ?? []).filter(
    (a) => a.status === 'CONFIRMED' && new Date(a.startAt) > new Date(),
  );

  return (
    <div className="space-y-6">
      {notice && (
        <p className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-5 py-3 text-sm">
          {notice}
        </p>
      )}

      {/* Publish header */}
      <Card className="p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-serif text-2xl">Your public page</h2>
              <Badge tone={published ? 'accent' : 'muted'}>
                {published ? 'Live' : 'Not published'}
              </Badge>
            </div>
            {state.publicSlug && (
              <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                {published && state.publicUrl ? (
                  <Link
                    href={state.publicUrl}
                    target="_blank"
                    className="font-medium text-[var(--color-accent)] hover:underline"
                  >
                    mind.cureocity.in/therapists/{state.publicSlug} →
                  </Link>
                ) : (
                  <>
                    Will publish at mind.cureocity.in/therapists/{state.publicSlug} ·{' '}
                    <Link
                      href={`/therapists/${state.publicSlug}`}
                      target="_blank"
                      className="font-medium text-[var(--color-accent)] hover:underline"
                    >
                      Preview as a patient →
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
          <Button
            onClick={() => void publish(!published)}
            disabled={busy === 'publish' || (!published && !checklistDone)}
          >
            {published ? 'Unpublish' : 'Publish page'}
          </Button>
        </div>

        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {state.checklist.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-sm">
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                  item.done
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'border border-[var(--color-line-soft)] text-[var(--color-ink-3)]'
                }`}
              >
                {item.done ? '✓' : '·'}
              </span>
              <span className={item.done ? 'text-[var(--color-ink-2)]' : ''}>{item.label}</span>
            </li>
          ))}
        </ul>
        {!identity.hasPhoto && (
          <p className="mt-3 text-sm text-[var(--color-ink-2)]">
            ○ Add a photo below — profiles with photos get roughly 3× the requests.
          </p>
        )}
        <p className="mt-4 text-xs text-[var(--color-ink-3)]">
          Headline, bio, city, specialties and fee are edited in{' '}
          <Link href="/app/settings/account" className="text-[var(--color-accent)] hover:underline">
            Settings → Account
          </Link>
          .
        </p>
      </Card>

      {/* Identity & photo */}
      <Card className="p-7">
        <h2 className="font-serif text-2xl">Identity</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          The line under your name, and the headshot patients see first.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              Credentials line
            </span>
            <input
              value={identity.credentialsLine ?? ''}
              onChange={(e) => setIdentity({ ...identity, credentialsLine: e.target.value })}
              placeholder="RP, MA (Clinical Psychology)"
              className="mt-1 w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              Pronouns (optional)
            </span>
            <input
              value={identity.pronouns ?? ''}
              onChange={(e) => setIdentity({ ...identity, pronouns: e.target.value })}
              placeholder="she/her"
              className="mt-1 w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              Clinic address (shown when you offer in-person windows)
            </span>
            <input
              value={identity.officeAddress ?? ''}
              onChange={(e) => setIdentity({ ...identity, officeAddress: e.target.value })}
              placeholder="2nd floor, Wellness Centre, Panampilly Nagar, Kochi"
              className="mt-1 w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void saveIdentity()} disabled={busy === 'identity'}>
            {busy === 'identity' ? 'Saving…' : 'Save identity'}
          </Button>
          <label className="cursor-pointer text-sm font-medium text-[var(--color-accent)] hover:underline">
            {identity.hasPhoto ? 'Replace photo' : 'Upload photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadPhoto(f);
                e.target.value = '';
              }}
            />
          </label>
          {identity.hasPhoto && (
            <span className="text-xs text-[var(--color-ink-3)]">Photo on file ✓</span>
          )}
        </div>
      </Card>

      {/* AI auto-fill */}
      <Card className="p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">Write it for me</h2>
          {draft && (
            <Badge tone={draft.source === 'vertex' ? 'accent' : 'muted'}>
              {draft.source === 'vertex' ? 'AI draft' : 'Mock draft'}
            </Badge>
          )}
        </div>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          Drafts a headline, About section, and FAQs from what your practice data already shows —
          your specialties, approaches, and languages. It never invents credentials or outcomes, and
          nothing about your clients is used. You approve every word before it appears.
        </p>
        {draft ? (
          <div className="mt-5 space-y-4 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-5">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                Headline
              </span>
              <p className="mt-1 font-medium">{draft.headline}</p>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                About
              </span>
              <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-ink-2)]">
                {draft.bio}
              </p>
            </div>
            {draft.faqs.length > 0 && (
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                  FAQs
                </span>
                <ul className="mt-1 space-y-2 text-sm">
                  {draft.faqs.map((f, i) => (
                    <li key={i}>
                      <b>{f.q}</b>
                      <span className="block text-[var(--color-ink-2)]">{f.a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button onClick={() => void applyDraft()} disabled={busy === 'apply-draft'}>
                {busy === 'apply-draft' ? 'Applying…' : 'Use this draft'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void requestDraft()}
                disabled={busy === 'draft'}
              >
                Redraft
              </Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Discard
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <Button onClick={() => void requestDraft()} disabled={busy === 'draft'}>
              {busy === 'draft' ? 'Drafting…' : 'Draft my page'}
            </Button>
          </div>
        )}
      </Card>

      {/* Appointment inbox */}
      <Card className="p-7">
        <h2 className="font-serif text-2xl">Appointment requests</h2>
        {appointments === null ? (
          <p className="mt-4 text-sm text-[var(--color-ink-3)]">Loading…</p>
        ) : requested.length === 0 && upcoming.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-ink-2)]">
            No open requests. When someone books from your public page, it appears here — the slot
            is held until you confirm or decline.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {requested.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4"
              >
                <div>
                  <p className="font-medium">
                    {a.patientName}{' '}
                    <span className="text-sm font-normal text-[var(--color-ink-2)]">
                      · {IST_FULL.format(new Date(a.startAt))} IST
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--color-ink-2)]">
                    {a.patientPhone}
                    {a.patientEmail ? ` · ${a.patientEmail}` : ''}
                  </p>
                  {a.concern && (
                    <p className="mt-1 max-w-xl text-sm italic text-[var(--color-ink-2)]">
                      &ldquo;{a.concern}&rdquo;
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void resolve(a.id, 'confirm')} disabled={busy === a.id}>
                    Confirm
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void resolve(a.id, 'decline')}
                    disabled={busy === a.id}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
            {upcoming.length > 0 && (
              <div className="pt-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
                  Confirmed &amp; upcoming
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-ink-2)]">
                  {upcoming.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <span>
                        {a.patientName} · {IST_FULL.format(new Date(a.startAt))} IST
                      </span>
                      {a.sessionId && (
                        <Link
                          href={`/app/sessions/${a.sessionId}`}
                          className="text-[var(--color-accent)] hover:underline"
                        >
                          Open session →
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Availability editor */}
      <Card className="p-7">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">Weekly availability</h2>
          <span className="text-xs text-[var(--color-ink-3)]">All times IST</span>
        </div>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          The windows below become bookable slots on your public page. Booked times disappear from
          the page automatically — including sessions you schedule yourself.
        </p>
        <div className="mt-5 space-y-2">
          {rules.map((r, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] px-4 py-2.5 text-sm"
            >
              <select
                value={r.weekday}
                onChange={(e) => {
                  const next = [...rules];
                  next[i] = { ...r, weekday: Number(e.target.value) };
                  setRules(next);
                }}
                className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-2 py-1.5"
              >
                {WEEKDAYS.map((d, wi) => (
                  <option key={d} value={wi}>
                    {d}
                  </option>
                ))}
              </select>
              <select
                value={r.startMinute}
                onChange={(e) => {
                  const next = [...rules];
                  next[i] = { ...r, startMinute: Number(e.target.value) };
                  setRules(next);
                }}
                className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-2 py-1.5"
              >
                {MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {minuteLabel(m)}
                  </option>
                ))}
              </select>
              <span className="text-[var(--color-ink-3)]">to</span>
              <select
                value={r.endMinute}
                onChange={(e) => {
                  const next = [...rules];
                  next[i] = { ...r, endMinute: Number(e.target.value) };
                  setRules(next);
                }}
                className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-2 py-1.5"
              >
                {MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {minuteLabel(m)}
                  </option>
                ))}
              </select>
              <select
                value={r.mode ?? 'ONLINE'}
                onChange={(e) => {
                  const next = [...rules];
                  next[i] = { ...r, mode: e.target.value as AvailabilityRuleInput['mode'] };
                  setRules(next);
                }}
                className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-2 py-1.5"
              >
                <option value="ONLINE">Online</option>
                <option value="IN_PERSON">In person</option>
              </select>
              <select
                value={r.slotMinutes}
                onChange={(e) => {
                  const next = [...rules];
                  next[i] = {
                    ...r,
                    slotMinutes: Number(e.target.value) as AvailabilityRuleInput['slotMinutes'],
                  };
                  setRules(next);
                }}
                className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-2 py-1.5"
              >
                {[30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m}-min sessions
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setRules(rules.filter((_, ri) => ri !== i))}
                className="ml-auto text-xs text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              setRules([
                ...rules,
                { weekday: 1, startMinute: 600, endMinute: 780, slotMinutes: 60, mode: 'ONLINE' },
              ])
            }
          >
            Add window
          </Button>
          <Button onClick={() => void saveRules(rules)} disabled={busy === 'rules'}>
            {busy === 'rules' ? 'Saving…' : 'Save availability'}
          </Button>
        </div>
      </Card>

      {/* FAQ editor */}
      <Card className="p-7">
        <h2 className="font-serif text-2xl">Frequently asked questions</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          Shown on your page and served as structured data — the answers AI assistants and Google
          cite when someone asks about you.
        </p>
        <div className="mt-5 space-y-3">
          {state.faqs.map((f, i) => (
            <div
              key={i}
              className="space-y-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4"
            >
              <input
                value={f.q}
                onChange={(e) => {
                  const faqs = [...state.faqs];
                  faqs[i] = { ...f, q: e.target.value };
                  setState({ ...state, faqs });
                }}
                placeholder="Question — e.g. Do you offer online sessions?"
                className="w-full rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-3 py-2 text-sm font-medium"
              />
              <textarea
                value={f.a}
                onChange={(e) => {
                  const faqs = [...state.faqs];
                  faqs[i] = { ...f, a: e.target.value };
                  setState({ ...state, faqs });
                }}
                rows={2}
                placeholder="Answer"
                className="w-full rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => setState({ ...state, faqs: state.faqs.filter((_, fi) => fi !== i) })}
                className="text-xs text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setState({ ...state, faqs: [...state.faqs, { q: '', a: '' }] })}
            disabled={state.faqs.length >= 10}
          >
            Add question
          </Button>
          <Button
            onClick={() => void saveFaqs(state.faqs.filter((f) => f.q.trim() && f.a.trim()))}
            disabled={busy === 'faqs'}
          >
            {busy === 'faqs' ? 'Saving…' : 'Save FAQs'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
