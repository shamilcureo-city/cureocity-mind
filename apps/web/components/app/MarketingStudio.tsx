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
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { MarketingPosts } from './MarketingPosts';

/**
 * MK7 — the marketing studio, restructured to mirror the public page.
 *
 * Four tabs: **My page** (numbered sections in the exact order visitors
 * see them, each editable in place with its own done / required state),
 * **My content** (the paid-plan blog), **Inquiries** (the appointment
 * inbox), **Stats** (the funnel). One header owns publish state, the
 * to-dos count, and Preview.
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
  'w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-3.5 py-2.5 text-sm';
const labelCls = 'text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]';

/** "a, b, c" ⇄ ["a","b","c"] for the list fields. */
function toList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// One numbered, collapsible section of the My-page editor
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
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-6 py-5 text-left"
        aria-expanded={open}
      >
        <span
          className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-sm font-semibold ${
            done
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-surface-soft)] text-[var(--color-ink-2)]'
          }`}
        >
          {done ? '✓' : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-serif text-lg">{title}</span>
            {!done && required && (
              <span className="rounded-full border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-warn)]">
                Required to publish
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-sm text-[var(--color-ink-2)]">{desc}</span>
        </span>
        <span className="flex-shrink-0 text-sm font-medium text-[var(--color-accent)]">
          {open ? 'Close' : 'Edit'}
        </span>
      </button>
      {open && <div className="border-t border-[var(--color-line-soft)] px-6 py-5">{children}</div>}
    </Card>
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

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ header ------- */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-serif text-2xl">Your public page</h2>
              <Badge tone={published ? 'accent' : 'muted'}>
                {published ? 'Live' : 'Not published'}
              </Badge>
            </div>
            {state.publicSlug && (
              <p className="mt-1 text-sm">
                <Link
                  href={`/therapists/${state.publicSlug}`}
                  target="_blank"
                  className="font-medium text-[var(--color-accent)] hover:underline"
                >
                  mind.cureocity.in/therapists/{state.publicSlug} →
                </Link>
                <span className="ml-2 text-xs text-[var(--color-ink-3)]">
                  {published ? '' : '(preview — only you can see it)'}
                </span>
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-3">
              <div
                className="flex rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-0.5"
                role="tablist"
                aria-label="Edit or preview"
              >
                <button
                  type="button"
                  onClick={() => setMode('edit')}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                    mode === 'edit'
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-ink-2)]'
                  }`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setMode('preview')}
                  disabled={!state.publicSlug}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                    mode === 'preview'
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-ink-2)]'
                  }`}
                >
                  Preview
                </button>
              </div>
              {todos.length > 0 && (
                <span className="text-sm text-[var(--color-ink-2)]">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--color-warn)]" />
                  {todos.length} to-do{todos.length > 1 ? 's' : ''}
                </span>
              )}
              <Button
                onClick={() => void publish(!published)}
                disabled={busy === 'publish' || (!published && todos.length > 0)}
              >
                {published ? 'Unpublish' : 'Publish page'}
              </Button>
            </div>
            {!published && todos.length > 0 && (
              <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                Add {todos.map((t) => t.label.toLowerCase()).join(', ')} to publish.
              </p>
            )}
          </div>
        </div>
      </Card>

      {notice && (
        <p className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-5 py-3 text-sm">
          {notice}
        </p>
      )}

      {/* ------------------------------------------------ preview ------- */}
      {mode === 'preview' && state.publicSlug && (
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
      )}

      {mode === 'edit' && (
        <>
          {/* ------------------------------------------------ tab bar ------- */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav className="flex gap-1 rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-1">
              {(
                [
                  ['page', 'My page'],
                  ['content', 'My content'],
                  ['inquiries', `Inquiries${requested.length ? ` (${requested.length})` : ''}`],
                  ['stats', 'Stats'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    tab === key
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-ink-2)] hover:text-[var(--color-accent)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
            {tab === 'page' && (
              <Button
                variant="secondary"
                onClick={() => void requestDraft()}
                disabled={busy === 'draft'}
              >
                {busy === 'draft' ? 'Drafting…' : '✦ Auto-fill with AI'}
              </Button>
            )}
          </div>

          {/* ------------------------------------------------ AI draft ------ */}
          {draft && tab === 'page' && (
            <Card className="border-[var(--color-accent)] p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-serif text-xl">Suggested copy</h3>
                <Badge tone={draft.source === 'vertex' ? 'accent' : 'muted'}>
                  {draft.source === 'vertex' ? 'AI draft' : 'Mock draft'}
                </Badge>
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

          {/* ================================================ MY PAGE ======= */}
          {tab === 'page' && (
            <div className="space-y-3">
              <Section
                n={1}
                title="Identity"
                desc="Your headshot, credentials, and the one-liner at the top of your profile."
                done={sectionDone.identity}
                required
                open={openSection === 'identity'}
                onToggle={() => toggle('identity')}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <span className={labelCls}>Headshot</span>
                    <div className="mt-2 flex flex-wrap items-center gap-5">
                      <label
                        className={`group relative grid h-28 w-28 flex-shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl transition-colors ${
                          profile.hasPhoto
                            ? 'border border-[var(--color-line-soft)]'
                            : 'border-2 border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] hover:border-[var(--color-accent)]'
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
                          <span className="px-2 text-center text-xs text-[var(--color-ink-3)]">
                            <svg
                              aria-hidden
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              className="mx-auto mb-1.5 h-7 w-7"
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
                        <p className="font-medium">
                          {busy === 'photo'
                            ? 'Uploading…'
                            : profile.hasPhoto
                              ? 'Looking good.'
                              : 'Click the box or drop a photo on it.'}
                        </p>
                        <p className="mt-1 max-w-xs text-xs leading-relaxed text-[var(--color-ink-3)]">
                          PNG, JPG or WebP. We crop it to a square automatically. Profiles with
                          photos get roughly 3× the appointment requests.
                        </p>
                        {profile.hasPhoto && (
                          <button
                            type="button"
                            onClick={() => void removePhoto()}
                            disabled={busy === 'photo'}
                            className="mt-2 text-xs text-[var(--color-ink-3)] underline hover:text-[var(--color-warn)]"
                          >
                            Remove photo
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <label className="block sm:col-span-2">
                    <span className={labelCls}>Tagline (your headline)</span>
                    <input
                      value={profile.headline ?? ''}
                      onChange={(e) => setProfile({ ...profile, headline: e.target.value })}
                      placeholder="Helping anxious adults reclaim their lives"
                      maxLength={160}
                      className={`mt-1 ${inputCls}`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelCls}>Credentials</span>
                    <input
                      value={profile.credentialsLine ?? ''}
                      onChange={(e) => setProfile({ ...profile, credentialsLine: e.target.value })}
                      placeholder="RP, MA (Clinical Psychology)"
                      className={`mt-1 ${inputCls}`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelCls}>Pronouns (optional)</span>
                    <input
                      value={profile.pronouns ?? ''}
                      onChange={(e) => setProfile({ ...profile, pronouns: e.target.value })}
                      placeholder="she/her"
                      className={`mt-1 ${inputCls}`}
                    />
                  </label>
                </div>
                <div className="mt-4">
                  <Button
                    onClick={() =>
                      void (async () => {
                        await saveProfile('identity', {
                          headline: profile.headline?.trim() || null,
                        });
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
                    disabled={busy !== null}
                  >
                    Save identity
                  </Button>
                </div>
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
                <div className="mt-3">
                  <Button
                    onClick={() => void saveProfile('about', { bio: profile.bio?.trim() || null })}
                    disabled={busy === 'about'}
                  >
                    Save about
                  </Button>
                </div>
              </Section>

              <Section
                n={3}
                title="Where you work"
                desc="The city clients search by, and how far your practice reaches."
                done={sectionDone.where}
                required
                open={openSection === 'where'}
                onToggle={() => toggle('where')}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={labelCls}>City</span>
                    <input
                      value={profile.locationCity ?? ''}
                      onChange={(e) => setProfile({ ...profile, locationCity: e.target.value })}
                      placeholder="Kochi"
                      className={`mt-1 ${inputCls}`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelCls}>State (optional)</span>
                    <input
                      value={profile.locationProvince ?? ''}
                      onChange={(e) => setProfile({ ...profile, locationProvince: e.target.value })}
                      placeholder="Kerala"
                      className={`mt-1 ${inputCls}`}
                    />
                  </label>
                </div>
                <div className="mt-4">
                  <Button
                    onClick={() =>
                      void saveProfile('where', {
                        locationCity: profile.locationCity?.trim() || null,
                        locationProvince: profile.locationProvince?.trim() || null,
                      })
                    }
                    disabled={busy === 'where'}
                  >
                    Save location
                  </Button>
                </div>
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
                desc="What you specialize in, the approaches you use, and the languages you work in. Clients filter on these."
                done={sectionDone.practice}
                required
                open={openSection === 'practice'}
                onToggle={() => toggle('practice')}
              >
                <div className="grid gap-4">
                  <label className="block">
                    <span className={labelCls}>Specialties (comma-separated)</span>
                    <input
                      defaultValue={profile.specialties.join(', ')}
                      onBlur={(e) =>
                        setProfile({ ...profile, specialties: toList(e.target.value) })
                      }
                      placeholder="Anxiety, Panic, Workplace stress"
                      className={`mt-1 ${inputCls}`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelCls}>Approaches (comma-separated)</span>
                    <input
                      defaultValue={profile.modalities.join(', ')}
                      onBlur={(e) => setProfile({ ...profile, modalities: toList(e.target.value) })}
                      placeholder="CBT, Mindfulness"
                      className={`mt-1 ${inputCls}`}
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className={labelCls}>Languages (comma-separated)</span>
                      <input
                        defaultValue={profile.languages.join(', ')}
                        onBlur={(e) =>
                          setProfile({ ...profile, languages: toList(e.target.value) })
                        }
                        placeholder="ml, en"
                        className={`mt-1 ${inputCls}`}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>Years of experience</span>
                      <input
                        type="number"
                        min={0}
                        max={80}
                        value={profile.yearsOfExperience ?? ''}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            yearsOfExperience:
                              e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        className={`mt-1 ${inputCls}`}
                      />
                    </label>
                  </div>
                </div>
                <div className="mt-4">
                  <Button
                    onClick={() =>
                      void saveProfile('practice', {
                        specialties: profile.specialties,
                        modalities: profile.modalities,
                        languages: profile.languages,
                        yearsOfExperience: profile.yearsOfExperience,
                      })
                    }
                    disabled={busy === 'practice'}
                  >
                    Save practice
                  </Button>
                </div>
              </Section>

              <Section
                n={6}
                title="Fees"
                desc="What you charge, and whether you're taking new clients. A clear fee helps clients self-qualify."
                done={sectionDone.fees}
                required={false}
                open={openSection === 'fees'}
                onToggle={() => toggle('fees')}
              >
                <div className="flex flex-wrap items-end gap-4">
                  <label className="block">
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
                      className={`mt-1 ${inputCls} max-w-[160px]`}
                    />
                  </label>
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
                <div className="mt-4">
                  <Button
                    onClick={() =>
                      void saveProfile('fees', {
                        sessionFeeInr: profile.sessionFeeInr,
                        isAcceptingNewClients: profile.isAcceptingNewClients,
                      })
                    }
                    disabled={busy === 'fees'}
                  >
                    Save fees
                  </Button>
                </div>
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
                <div className="mt-4">
                  <Button
                    onClick={() =>
                      void saveMarketing('clinic', {
                        officeAddress: profile.officeAddress?.trim() || null,
                      })
                    }
                    disabled={busy === 'clinic'}
                  >
                    Save address
                  </Button>
                </div>
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
                            slotMinutes: Number(
                              e.target.value,
                            ) as AvailabilityRuleInput['slotMinutes'],
                          };
                          setRules(next);
                        }}
                        className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-2 py-1.5"
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
                <div className="mt-4 flex gap-2">
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
                desc="Q&As surfaced as structured data to ChatGPT, Claude, Google AI Overviews, and Perplexity."
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
                <div className="mt-4 flex gap-2">
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
                    Save FAQs
                  </Button>
                </div>
              </Section>
            </div>
          )}

          {/* ================================================ MY CONTENT ==== */}
          {tab === 'content' &&
            (contentEntitled ? (
              <MarketingPosts profileSlug={state.publicSlug} />
            ) : (
              <Card className="p-8 text-center">
                <h2 className="font-serif text-2xl">Your content lives here</h2>
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

          {/* ================================================ INQUIRIES ===== */}
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
          )}

          {/* ================================================ STATS ========= */}
          {tab === 'stats' && (
            <Card className="p-7">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-serif text-2xl">This week</h2>
                {stats?.medianTimeToConfirmMinutes != null && (
                  <span className="text-xs text-[var(--color-ink-3)]">
                    median time to confirm:{' '}
                    {stats.medianTimeToConfirmMinutes >= 60
                      ? `${Math.round(stats.medianTimeToConfirmMinutes / 60)}h`
                      : `${stats.medianTimeToConfirmMinutes}m`}
                  </span>
                )}
              </div>
              {stats === null ? (
                <p className="mt-4 text-sm text-[var(--color-ink-3)]">Loading…</p>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(
                      [
                        ['Page views', stats.week.pageViews],
                        ['Slot views', stats.week.slotViews],
                        ['Requests', stats.week.requests],
                        ['Confirmed', stats.week.confirms],
                      ] as const
                    ).map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4 text-center"
                      >
                        <div className="font-serif text-2xl">{value}</div>
                        <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-[var(--color-ink-3)]">
                    The funnel reads left to right: people who saw your page, opened the times,
                    asked for one, and got confirmed. No visitor tracking — just counters.
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
