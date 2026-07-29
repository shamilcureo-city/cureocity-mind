'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type {
  Appointment,
  AvailabilityRuleInput,
  DraftMarketingResponse,
  ListAppointmentsResponse,
  MarketingState,
  MarketingStatsResponse,
} from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MarketingPosts } from './MarketingPosts';

/**
 * MK7.2 — the marketing studio, visually reworked from a screenshot-
 * driven design pass (scratchpad/studio-mock v3):
 *
 * One calm 880px column. A hero card owns identity + Edit|Preview +
 * Publish (locked style, not disabled-washed, while to-dos remain); an
 * amber banner narrates exactly what's missing; underline tabs; the
 * nine page sections live in ONE card as dividable rows — green check
 * circles when done, amber "Required to publish" chips when not —
 * each expanding to a soft inline panel with white inputs.
 *
 * Green success pair (#1d7a53 / #e2f3ea) is local to marketing, same
 * precedent as PublicAvatar's palette.
 */

interface Profile {
  headline: string | null;
  bio: string | null;
  locationCity: string | null;
  locationProvince: string | null;
  specialties: string[];
  languages: string[];
  modalities: string[];
  yearsOfExperience: number | null;
  sessionFeeInr: number | null;
  isAcceptingNewClients: boolean;
  credentialsLine: string | null;
  pronouns: string | null;
  officeAddress: string | null;
  videoCallLink: string | null;
  hasPhoto: boolean;
}

interface Props {
  initialState: MarketingState;
  initialRules: AvailabilityRuleInput[];
  initialProfile: Profile;
  contentEntitled: boolean;
}

type Tab = 'page' | 'content' | 'inquiries' | 'stats';

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

const inputCls =
  'w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm';
const selectCls =
  'rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5';
const labelCls =
  'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--color-ink-3)]';
const GOOD = '#1d7a53';
const GOOD_SOFT = '#e2f3ea';

/** "a, b, c" ⇄ ["a","b","c"] for the list fields. */
function toList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// One numbered row of the My-page section list (lives inside one Card)
// ---------------------------------------------------------------------------

function Section({
  n,
  title,
  desc,
  done,
  required,
  open,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  desc: string;
  done: boolean;
  required: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-7 py-5 text-left"
        aria-expanded={open}
      >
        <span
          className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full text-[15px] font-semibold"
          style={
            done
              ? { background: GOOD_SOFT, color: GOOD }
              : { background: 'var(--color-surface-soft)', color: 'var(--color-ink-2)' }
          }
        >
          {done ? '✓' : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-lg font-semibold leading-snug">{title}</span>
          <span className="mt-0.5 block text-[13px] text-[var(--color-ink-3)]">{desc}</span>
        </span>
        {!done && required && (
          <span className="hidden whitespace-nowrap rounded-full border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-warn)] sm:inline">
            Required to publish
          </span>
        )}
        <span className="flex-shrink-0 text-sm font-medium text-[var(--color-accent)]">
          {open ? 'Close' : 'Edit'}
        </span>
      </button>
      {open && (
        <div className="px-7 pb-7 sm:pl-[84px]">
          <div className="rounded-2xl bg-[var(--color-surface-soft)] p-5">{children}</div>
        </div>
      )}
    </div>
  );
}

/** Right-aligned save row inside a section panel. */
function SaveRow({
  label,
  saving,
  onClick,
}: {
  label: string;
  saving: boolean;
  onClick: () => void;
}) {
  return (
    <div className="mt-4 flex justify-end">
      <Button onClick={onClick} disabled={saving}>
        {saving ? 'Saving…' : label}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The studio
// ---------------------------------------------------------------------------

export function MarketingStudio({
  initialState,
  initialRules,
  initialProfile,
  contentEntitled,
}: Props) {
  const [tab, setTab] = useState<Tab>('page');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [photoVersion, setPhotoVersion] = useState(0);
  const [state, setState] = useState<MarketingState>(initialState);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [rules, setRules] = useState<AvailabilityRuleInput[]>(initialRules);
  const [slugInput, setSlugInput] = useState(initialState.publicSlug ?? '');
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [stats, setStats] = useState<MarketingStatsResponse | null>(null);
  const [draft, setDraft] = useState<DraftMarketingResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    const res = await fetch('/api/v1/psychologists/me/marketing', { cache: 'no-store' });
    if (res.ok) {
      const s = (await res.json()) as MarketingState;
      setState(s);
      if (s.publicSlug) setSlugInput(s.publicSlug);
    }
  }, []);

  const loadAppointments = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/appointments', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setAppointments(((await res.json()) as ListAppointmentsResponse).items);
    } catch {
      setAppointments([]);
    }
  }, []);

  useEffect(() => {
    void refreshState();
    void loadAppointments();
    void fetch('/api/v1/psychologists/me/marketing/stats', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<MarketingStatsResponse>) : null))
      .then((sr) => sr && setStats(sr));
  }, [refreshState, loadAppointments]);

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

  /** PATCH the account profile fields, then refresh the checklist. */
  const saveProfile = useCallback(
    (label: string, patch: Record<string, unknown>, done?: string) =>
      act(label, async () => {
        const res = await fetch('/api/v1/psychologists/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not save.');
        }
        await refreshState();
        setNotice(done ?? 'Saved.');
      }),
    [act, refreshState],
  );

  /** PATCH the marketing-owned fields (slug, FAQs, identity extras). */
  const saveMarketing = useCallback(
    (label: string, patch: Record<string, unknown>, done?: string) =>
      act(label, async () => {
        const res = await fetch('/api/v1/psychologists/me/marketing', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not save.');
        }
        setState((await res.json()) as MarketingState);
        setNotice(done ?? 'Saved.');
      }),
    [act],
  );

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
        await refreshState();
        setNotice(publishNow ? 'Your page is live.' : 'Page unpublished.');
      }),
    [act, refreshState],
  );

  const saveRules = useCallback(
    () =>
      act('rules', async () => {
        const res = await fetch('/api/v1/psychologists/me/availability', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not save availability.');
        }
        setNotice('Availability saved — these windows are now bookable.');
      }),
    [act, rules],
  );

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
        setProfile((p) => ({ ...p, hasPhoto: true }));
        setPhotoVersion((v) => v + 1);
        setNotice('Photo uploaded.');
      }),
    [act],
  );

  const removePhoto = useCallback(
    () =>
      act('photo', async () => {
        const res = await fetch('/api/v1/psychologists/me/photo', { method: 'DELETE' });
        if (!res.ok) throw new Error('Could not remove the photo.');
        setProfile((p) => ({ ...p, hasPhoto: false }));
        setNotice('Photo removed.');
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

  const applyDraft = useCallback(
    () =>
      act('apply-draft', async () => {
        if (!draft) return;
        const res = await fetch('/api/v1/psychologists/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ headline: draft.headline.slice(0, 160), bio: draft.bio }),
        });
        if (!res.ok) throw new Error('Could not save the headline and bio.');
        setProfile((p) => ({ ...p, headline: draft.headline.slice(0, 160), bio: draft.bio }));
        if (draft.faqs.length > 0) {
          const faqRes = await fetch('/api/v1/psychologists/me/marketing', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ faqs: draft.faqs }),
          });
          if (faqRes.ok) setState((await faqRes.json()) as MarketingState);
        }
        setDraft(null);
        await refreshState();
        setNotice('Draft applied — review each section, then publish.');
      }),
    [act, draft, refreshState],
  );

  const resolveAppointment = useCallback(
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
  const todos = state.checklist.filter((c) => !c.done);
  const requested = (appointments ?? []).filter((a) => a.status === 'REQUESTED');
  const upcoming = (appointments ?? []).filter(
    (a) => a.status === 'CONFIRMED' && new Date(a.startAt) > new Date(),
  );

  const sectionDone = {
    identity: !!profile.headline?.trim(),
    about: !!profile.bio?.trim(),
    where: !!profile.locationCity?.trim(),
    url: !!state.publicSlug,
    practice: profile.specialties.length > 0,
    fees: profile.sessionFeeInr !== null,
    clinic: !!profile.officeAddress?.trim(),
    availability: rules.length > 0,
    faqs: state.faqs.length > 0,
  };

  const toggle = (key: string) => setOpenSection((cur) => (cur === key ? null : key));

  const practiceSummary =
    profile.specialties.length > 0
      ? [
          profile.specialties.slice(0, 3).join(', '),
          profile.modalities.slice(0, 2).join(', '),
          profile.languages.slice(0, 3).join(', '),
        ]
          .filter(Boolean)
          .join(' · ')
      : 'What you specialize in, the approaches you use, and the languages you work in.';

  return (
    <div className="mx-auto max-w-[880px] space-y-4">
      {/* ------------------------------------------------ hero ---------- */}
      <Card className="flex flex-wrap items-center justify-between gap-5 p-6 sm:px-7">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-serif text-2xl font-semibold">Your public page</h2>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={
                published
                  ? { background: GOOD_SOFT, color: GOOD }
                  : { background: 'var(--color-surface-soft)', color: 'var(--color-ink-3)' }
              }
            >
              <span className="h-[7px] w-[7px] rounded-full bg-current" />
              {published ? 'Live' : 'Not published'}
            </span>
          </div>
          {state.publicSlug && (
            <Link
              href={`/therapists/${state.publicSlug}`}
              target="_blank"
              className="mt-1 inline-block text-sm font-medium text-[var(--color-accent)] hover:underline"
            >
              mind.cureocity.in/therapists/{state.publicSlug} ↗
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex rounded-full bg-[var(--color-surface-soft)] p-[3px]"
            role="tablist"
            aria-label="Edit or preview"
          >
            {(['edit', 'preview'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={m === 'preview' && !state.publicSlug}
                className={`rounded-full px-[18px] py-[7px] text-sm font-medium capitalize transition-colors ${
                  mode === m
                    ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm'
                    : 'text-[var(--color-ink-3)]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {!published && todos.length > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-5 py-2.5 text-sm font-semibold text-[var(--color-ink-3)]">
              <svg
                aria-hidden
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Publish page
            </span>
          ) : (
            <Button onClick={() => void publish(!published)} disabled={busy === 'publish'}>
              {published ? 'Unpublish' : 'Publish page'}
            </Button>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------ to-dos -------- */}
      {!published && todos.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] py-3 pl-4 pr-5 text-sm text-[var(--color-warn)]">
          <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-[var(--color-warn)] text-xs font-bold text-white">
            {todos.length}
          </span>
          <span>
            <b className="font-semibold">
              {todos.length} step{todos.length > 1 ? 's' : ''} before you can publish
            </b>{' '}
            — add {todos.map((t) => t.label.toLowerCase()).join(' and ')}. Everything else can come
            later.
          </span>
        </div>
      )}

      {notice && (
        <p className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] px-5 py-3 text-sm">
          {notice}
        </p>
      )}

      {/* ------------------------------------------------ preview ------- */}
      {mode === 'preview' && state.publicSlug ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-3">
            <p className="text-sm text-[var(--color-ink-2)]">
              This is exactly what visitors see
              {!published && ' once you publish — right now only you can open it'}.
            </p>
            <Link
              href={`/therapists/${state.publicSlug}`}
              target="_blank"
              className="text-sm font-medium text-[var(--color-accent)] hover:underline"
            >
              Open in a new tab →
            </Link>
          </div>
          <iframe
            src={`/therapists/${state.publicSlug}`}
            title="Preview of your public page"
            className="h-[80vh] w-full bg-[var(--color-bg)]"
          />
        </Card>
      ) : (
        <>
          {/* -------------------------------------------- tab bar ------- */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] px-1">
            <nav className="flex gap-6">
              {(
                [
                  ['page', 'My page', 0],
                  ['content', 'My content', 0],
                  ['inquiries', 'Inquiries', requested.length],
                  ['stats', 'Stats', 0],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`relative pb-3 pt-2 text-[14.5px] transition-colors ${
                    tab === key
                      ? 'font-semibold text-[var(--color-ink)]'
                      : 'font-medium text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]'
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className="ml-1.5 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--color-accent)]">
                      {count}
                    </span>
                  )}
                  {tab === key && (
                    <span className="absolute inset-x-0 -bottom-px h-[2.5px] rounded-t bg-[var(--color-accent)]" />
                  )}
                </button>
              ))}
            </nav>
            {tab === 'page' && (
              <button
                type="button"
                onClick={() => void requestDraft()}
                disabled={busy === 'draft'}
                className="pb-2 text-sm font-medium text-[var(--color-accent)] hover:underline disabled:opacity-50"
              >
                {busy === 'draft' ? 'Drafting…' : '✦ Auto-fill with AI'}
              </button>
            )}
          </div>

          {/* -------------------------------------------- AI draft ------ */}
          {draft && tab === 'page' && (
            <Card className="border-[var(--color-accent)] p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-serif text-xl">Suggested copy</h3>
                <span className="text-xs font-semibold text-[var(--color-ink-3)]">
                  {draft.source === 'vertex' ? 'AI draft' : 'Mock draft'}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                Drafted from your practice facts only — never client data. Nothing is saved until
                you approve it.
              </p>
              <div className="mt-4 space-y-3 text-sm">
                <p className="font-medium">{draft.headline}</p>
                <p className="whitespace-pre-line text-[var(--color-ink-2)]">{draft.bio}</p>
              </div>
              <div className="mt-4 flex gap-2">
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
            </Card>
          )}

          {/* ============================================ MY PAGE ======= */}
          {tab === 'page' && (
            <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
              <Section
                n={1}
                title="Identity"
                desc="Your headshot, credentials, and the one-liner at the top of your profile."
                done={sectionDone.identity}
                required
                open={openSection === 'identity'}
                onToggle={() => toggle('identity')}
              >
                <span className={labelCls}>Headshot</span>
                <div className="flex flex-wrap items-center gap-5">
                  <label
                    className={`group relative grid h-[104px] w-[104px] flex-shrink-0 cursor-pointer place-items-center overflow-hidden rounded-[18px] transition-colors ${
                      profile.hasPhoto
                        ? 'border border-[var(--color-line-soft)]'
                        : 'border-2 border-dashed border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]'
                    }`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) void uploadPhoto(f);
                    }}
                  >
                    {profile.hasPhoto ? (
                      <>
                        {/* Plain <img>: same-origin API bytes; next/image adds nothing here. */}
                        <img
                          src={`/api/v1/psychologists/me/photo?v=${photoVersion}`}
                          alt="Your headshot"
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute inset-0 grid place-items-center bg-black/50 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                          Replace
                        </span>
                      </>
                    ) : (
                      <span className="px-2 text-center text-[11.5px] text-[var(--color-ink-3)]">
                        <svg
                          aria-hidden
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="mx-auto mb-1.5 h-6 w-6"
                        >
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                        No photo yet
                      </span>
                    )}
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
                  <div className="text-sm">
                    <p className="font-semibold">
                      {busy === 'photo'
                        ? 'Uploading…'
                        : profile.hasPhoto
                          ? 'Looking good.'
                          : 'Click the box or drop a photo on it.'}
                    </p>
                    <p className="mt-1 max-w-[34ch] text-xs leading-relaxed text-[var(--color-ink-3)]">
                      PNG, JPG or WebP. We crop it to a square automatically. Profiles with photos
                      get roughly 3× the requests.
                    </p>
                    {profile.hasPhoto && (
                      <button
                        type="button"
                        onClick={() => void removePhoto()}
                        disabled={busy === 'photo'}
                        className="mt-1.5 text-xs text-[var(--color-ink-3)] underline hover:text-[var(--color-warn)]"
                      >
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <span className={labelCls}>Tagline</span>
                  <input
                    value={profile.headline ?? ''}
                    onChange={(e) => setProfile({ ...profile, headline: e.target.value })}
                    placeholder="Helping anxious adults reclaim their lives"
                    maxLength={160}
                    className={inputCls}
                  />
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className={labelCls}>Credentials</span>
                    <input
                      value={profile.credentialsLine ?? ''}
                      onChange={(e) => setProfile({ ...profile, credentialsLine: e.target.value })}
                      placeholder="RP, MA (Clinical Psychology)"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <span className={labelCls}>Pronouns (optional)</span>
                    <input
                      value={profile.pronouns ?? ''}
                      onChange={(e) => setProfile({ ...profile, pronouns: e.target.value })}
                      placeholder="she/her"
                      className={inputCls}
                    />
                  </div>
                </div>
                <SaveRow
                  label="Save identity"
                  saving={busy === 'identity' || busy === 'identity2'}
                  onClick={() =>
                    void (async () => {
                      await saveProfile('identity', { headline: profile.headline?.trim() || null });
                      await saveMarketing(
                        'identity2',
                        {
                          credentialsLine: profile.credentialsLine?.trim() || null,
                          pronouns: profile.pronouns?.trim() || null,
                        },
                        'Identity saved.',
                      );
                    })()
                  }
                />
              </Section>

              <Section
                n={2}
                title="About"
                desc="Tell prospective clients about your approach, who you work with, and what to expect."
                done={sectionDone.about}
                required
                open={openSection === 'about'}
                onToggle={() => toggle('about')}
              >
                <textarea
                  value={profile.bio ?? ''}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                  rows={7}
                  maxLength={4000}
                  placeholder="I work with adults whose minds won't switch off…"
                  className={inputCls}
                />
                <SaveRow
                  label="Save about"
                  saving={busy === 'about'}
                  onClick={() => void saveProfile('about', { bio: profile.bio?.trim() || null })}
                />
              </Section>

              <Section
                n={3}
                title="Where you work"
                desc={
                  sectionDone.where
                    ? [profile.locationCity, profile.locationProvince].filter(Boolean).join(', ')
                    : 'The city clients search by.'
                }
                done={sectionDone.where}
                required
                open={openSection === 'where'}
                onToggle={() => toggle('where')}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className={labelCls}>City</span>
                    <input
                      value={profile.locationCity ?? ''}
                      onChange={(e) => setProfile({ ...profile, locationCity: e.target.value })}
                      placeholder="Kochi"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <span className={labelCls}>State (optional)</span>
                    <input
                      value={profile.locationProvince ?? ''}
                      onChange={(e) => setProfile({ ...profile, locationProvince: e.target.value })}
                      placeholder="Kerala"
                      className={inputCls}
                    />
                  </div>
                </div>
                <SaveRow
                  label="Save location"
                  saving={busy === 'where'}
                  onClick={() =>
                    void saveProfile('where', {
                      locationCity: profile.locationCity?.trim() || null,
                      locationProvince: profile.locationProvince?.trim() || null,
                    })
                  }
                />
              </Section>

              <Section
                n={4}
                title="URL"
                desc={
                  state.publicSlug
                    ? `mind.cureocity.in/therapists/${state.publicSlug}`
                    : 'Your page address on the directory.'
                }
                done={sectionDone.url}
                required={false}
                open={openSection === 'url'}
                onToggle={() => toggle('url')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-[var(--color-ink-3)]">…/therapists/</span>
                  <input
                    value={slugInput}
                    onChange={(e) => setSlugInput(e.target.value.toLowerCase())}
                    className={`${inputCls} max-w-[240px]`}
                  />
                  <Button
                    onClick={() =>
                      void saveMarketing('slug', { publicSlug: slugInput.trim() }, 'URL saved.')
                    }
                    disabled={busy === 'slug' || slugInput.trim().length < 3}
                  >
                    Save URL
                  </Button>
                </div>
                <p className="mt-2 text-xs text-[var(--color-ink-3)]">
                  Lowercase words separated by hyphens. Changing it breaks links you&rsquo;ve
                  already shared.
                </p>
              </Section>

              <Section
                n={5}
                title="Practice"
                desc={practiceSummary}
                done={sectionDone.practice}
                required
                open={openSection === 'practice'}
                onToggle={() => toggle('practice')}
              >
                <div>
                  <span className={labelCls}>Specialties (comma-separated)</span>
                  <input
                    defaultValue={profile.specialties.join(', ')}
                    onBlur={(e) => setProfile({ ...profile, specialties: toList(e.target.value) })}
                    placeholder="Anxiety, Panic, Workplace stress"
                    className={inputCls}
                  />
                </div>
                <div className="mt-4">
                  <span className={labelCls}>Approaches (comma-separated)</span>
                  <input
                    defaultValue={profile.modalities.join(', ')}
                    onBlur={(e) => setProfile({ ...profile, modalities: toList(e.target.value) })}
                    placeholder="CBT, Mindfulness"
                    className={inputCls}
                  />
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className={labelCls}>Languages (comma-separated)</span>
                    <input
                      defaultValue={profile.languages.join(', ')}
                      onBlur={(e) => setProfile({ ...profile, languages: toList(e.target.value) })}
                      placeholder="ml, en"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <span className={labelCls}>Years of experience</span>
                    <input
                      type="number"
                      min={0}
                      max={80}
                      value={profile.yearsOfExperience ?? ''}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          yearsOfExperience: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className={inputCls}
                    />
                  </div>
                </div>
                <SaveRow
                  label="Save practice"
                  saving={busy === 'practice'}
                  onClick={() =>
                    void saveProfile('practice', {
                      specialties: profile.specialties,
                      modalities: profile.modalities,
                      languages: profile.languages,
                      yearsOfExperience: profile.yearsOfExperience,
                    })
                  }
                />
              </Section>

              <Section
                n={6}
                title="Fees"
                desc="What you charge, and whether you're taking new clients."
                done={sectionDone.fees}
                required={false}
                open={openSection === 'fees'}
                onToggle={() => toggle('fees')}
              >
                <div className="flex flex-wrap items-end gap-5">
                  <div>
                    <span className={labelCls}>Fee per session (₹)</span>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      value={profile.sessionFeeInr ?? ''}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          sessionFeeInr: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className={`${inputCls} max-w-[160px]`}
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={profile.isAcceptingNewClients}
                      onChange={(e) =>
                        setProfile({ ...profile, isAcceptingNewClients: e.target.checked })
                      }
                    />
                    Accepting new clients
                  </label>
                </div>
                <SaveRow
                  label="Save fees"
                  saving={busy === 'fees'}
                  onClick={() =>
                    void saveProfile('fees', {
                      sessionFeeInr: profile.sessionFeeInr,
                      isAcceptingNewClients: profile.isAcceptingNewClients,
                    })
                  }
                />
              </Section>

              <Section
                n={7}
                title="Office location"
                desc="Where clients can meet you in person. Shown when a booking window is in-person."
                done={sectionDone.clinic}
                required={false}
                open={openSection === 'clinic'}
                onToggle={() => toggle('clinic')}
              >
                <input
                  value={profile.officeAddress ?? ''}
                  onChange={(e) => setProfile({ ...profile, officeAddress: e.target.value })}
                  placeholder="2nd floor, Wellness Centre, Panampilly Nagar, Kochi"
                  className={inputCls}
                />
                <SaveRow
                  label="Save address"
                  saving={busy === 'clinic'}
                  onClick={() =>
                    void saveMarketing('clinic', {
                      officeAddress: profile.officeAddress?.trim() || null,
                    })
                  }
                />
              </Section>

              <Section
                n={8}
                title="Availability"
                desc="Weekly windows that become bookable slots on your page. All times IST."
                done={sectionDone.availability}
                required={false}
                open={openSection === 'availability'}
                onToggle={() => toggle('availability')}
              >
                <div className="mb-5 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
                  <span className={labelCls}>Video call link — for online sessions</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={profile.videoCallLink ?? ''}
                      onChange={(e) => setProfile({ ...profile, videoCallLink: e.target.value })}
                      placeholder="https://meet.google.com/abc-defg-hij"
                      className={`${inputCls} flex-1`}
                      style={{ minWidth: '220px' }}
                    />
                    <Button
                      onClick={() =>
                        void saveMarketing(
                          'video-link',
                          { videoCallLink: profile.videoCallLink?.trim() || null },
                          'Video link saved — it rides every online confirmation automatically.',
                        )
                      }
                      disabled={busy === 'video-link'}
                    >
                      {busy === 'video-link' ? 'Saving…' : 'Save link'}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-ink-3)]">
                    Your personal Google Meet or Zoom room. When you confirm an online booking, the
                    patient gets this link automatically — confirmation email, reminders, and their
                    calendar invite. Never shown on your public page.
                  </p>
                </div>
                <div className="space-y-2">
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
                        className={selectCls}
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
                        className={selectCls}
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
                        className={selectCls}
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
                        className={selectCls}
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
                            slotMinutes: Number(
                              e.target.value,
                            ) as AvailabilityRuleInput['slotMinutes'],
                          };
                          setRules(next);
                        }}
                        className={selectCls}
                      >
                        {[30, 45, 60, 90].map((m) => (
                          <option key={m} value={m}>
                            {m}-min
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
                <div className="mt-4 flex justify-between gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setRules([
                        ...rules,
                        {
                          weekday: 1,
                          startMinute: 600,
                          endMinute: 780,
                          slotMinutes: 60,
                          mode: 'ONLINE',
                        },
                      ])
                    }
                  >
                    Add window
                  </Button>
                  <Button onClick={() => void saveRules()} disabled={busy === 'rules'}>
                    {busy === 'rules' ? 'Saving…' : 'Save availability'}
                  </Button>
                </div>
              </Section>

              <Section
                n={9}
                title="Frequently asked questions"
                desc="Served as structured data to ChatGPT, Claude, Google AI Overviews, and Perplexity."
                done={sectionDone.faqs}
                required={false}
                open={openSection === 'faqs'}
                onToggle={() => toggle('faqs')}
              >
                <div className="space-y-3">
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
                        className={`${inputCls} font-medium`}
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
                        className={inputCls}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setState({ ...state, faqs: state.faqs.filter((_, fi) => fi !== i) })
                        }
                        className="text-xs text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-between gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setState({ ...state, faqs: [...state.faqs, { q: '', a: '' }] })}
                    disabled={state.faqs.length >= 10}
                  >
                    Add question
                  </Button>
                  <Button
                    onClick={() =>
                      void saveMarketing(
                        'faqs',
                        { faqs: state.faqs.filter((f) => f.q.trim() && f.a.trim()) },
                        'FAQs saved.',
                      )
                    }
                    disabled={busy === 'faqs'}
                  >
                    {busy === 'faqs' ? 'Saving…' : 'Save FAQs'}
                  </Button>
                </div>
              </Section>
            </Card>
          )}

          {/* ============================================ MY CONTENT ==== */}
          {tab === 'content' &&
            (contentEntitled ? (
              <MarketingPosts profileSlug={state.publicSlug} />
            ) : (
              <Card className="p-10 text-center sm:p-12">
                <svg
                  aria-hidden
                  width="120"
                  height="88"
                  viewBox="0 0 120 88"
                  fill="none"
                  className="mx-auto"
                >
                  <ellipse cx="60" cy="80" rx="44" ry="6" fill="var(--color-surface-soft)" />
                  <rect
                    x="34"
                    y="26"
                    width="52"
                    height="40"
                    rx="9"
                    fill="var(--color-accent-soft)"
                  />
                  <rect
                    x="42"
                    y="36"
                    width="36"
                    height="4"
                    rx="2"
                    fill="var(--color-data)"
                    opacity=".55"
                  />
                  <rect
                    x="42"
                    y="45"
                    width="28"
                    height="4"
                    rx="2"
                    fill="var(--color-data)"
                    opacity=".35"
                  />
                  <rect
                    x="42"
                    y="54"
                    width="32"
                    height="4"
                    rx="2"
                    fill="var(--color-data)"
                    opacity=".35"
                  />
                  <g transform="rotate(38 78 30)">
                    <rect x="72" y="8" width="11" height="34" rx="2.5" fill={GOOD} opacity=".8" />
                    <rect x="72" y="8" width="11" height="7" rx="2.5" fill={GOOD_SOFT} />
                    <path d="M72 42 L77.5 52 L83 42 Z" fill="#f0c987" />
                    <path d="M75.5 48 L77.5 52 L79.5 48 Z" fill="var(--color-ink)" />
                  </g>
                  <circle cx="88" cy="22" r="3.5" fill="var(--color-data)" opacity=".3" />
                  <circle cx="28" cy="34" r="2.5" fill="var(--color-warn)" opacity=".35" />
                  <circle cx="96" cy="52" r="2" fill={GOOD} opacity=".4" />
                </svg>
                <h2 className="mt-5 font-serif text-2xl">Your content lives here</h2>
                <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[var(--color-ink-2)]">
                  Publish short articles that give ChatGPT and Google more reasons to recommend you.
                  AI drafts them from your declared expertise — never your sessions — and you
                  approve every word. Writing is part of the paid plan.
                </p>
                <div className="mt-6">
                  <Link href="/app/settings/plan">
                    <Button>Upgrade to write</Button>
                  </Link>
                </div>
                <p className="mt-4 text-xs text-[var(--color-ink-3)]">
                  Your page, bookings, and inquiries stay free while you&rsquo;re on the trial.
                </p>
              </Card>
            ))}

          {/* ============================================ INQUIRIES ===== */}
          {tab === 'inquiries' && (
            <Card className="p-7">
              <h2 className="font-serif text-2xl">Appointment requests</h2>
              {appointments === null ? (
                <p className="mt-4 text-sm text-[var(--color-ink-3)]">Loading…</p>
              ) : requested.length === 0 && upcoming.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--color-ink-2)]">
                  No open requests. When someone books from your public page, it appears here — the
                  slot is held until you confirm or decline.
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
                        <Button
                          onClick={() => void resolveAppointment(a.id, 'confirm')}
                          disabled={busy === a.id}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void resolveAppointment(a.id, 'decline')}
                          disabled={busy === a.id}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                  ))}
                  {upcoming.length > 0 && (
                    <div className="pt-2">
                      <h3 className={labelCls}>Confirmed &amp; upcoming</h3>
                      <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-ink-2)]">
                        {upcoming.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center gap-2">
                            <span>
                              {a.patientName} · {IST_FULL.format(new Date(a.startAt))} IST
                              {a.mode === 'IN_PERSON' && (
                                <span className="ml-1 text-xs text-[var(--color-ink-3)]">
                                  · in person
                                </span>
                              )}
                            </span>
                            {a.mode !== 'IN_PERSON' && (
                              <Link
                                href={`/app/video/${a.id}`}
                                className="font-medium text-[var(--color-accent)] hover:underline"
                              >
                                Join video →
                              </Link>
                            )}
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
          )}

          {/* ============================================ STATS ========= */}
          {tab === 'stats' && (
            <Card className="p-7">
              <h2 className="font-serif text-2xl">This week</h2>
              {stats === null ? (
                <p className="mt-4 text-sm text-[var(--color-ink-3)]">Loading…</p>
              ) : (
                <>
                  <div className="mt-5 flex items-stretch">
                    {(
                      [
                        ['Page views', stats.week.pageViews, false],
                        ['Slot views', stats.week.slotViews, false],
                        ['Requests', stats.week.requests, false],
                        ['Confirmed', stats.week.confirms, true],
                      ] as const
                    ).map(([label, value, hot], i) => (
                      <div key={label} className="contents">
                        {i > 0 && (
                          <span className="grid place-items-center px-1.5 text-[var(--color-ink-3)] sm:px-2.5">
                            →
                          </span>
                        )}
                        <div
                          className="flex-1 rounded-2xl px-1 py-4 text-center"
                          style={
                            hot
                              ? { background: GOOD_SOFT }
                              : { background: 'var(--color-surface-soft)' }
                          }
                        >
                          <div
                            className="font-serif text-3xl font-semibold"
                            style={hot ? { color: GOOD } : undefined}
                          >
                            {value}
                          </div>
                          <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                            {label}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-[var(--color-ink-3)]">
                    The funnel reads left to right: people who saw your page, opened the times,
                    asked for one, and got confirmed.
                    {stats.medianTimeToConfirmMinutes != null && (
                      <>
                        {' '}
                        Median time to confirm:{' '}
                        {stats.medianTimeToConfirmMinutes >= 60
                          ? `${Math.round(stats.medianTimeToConfirmMinutes / 60)}h`
                          : `${stats.medianTimeToConfirmMinutes}m`}
                        .
                      </>
                    )}
                  </p>
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
