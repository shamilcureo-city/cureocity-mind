'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { DraftPostResponse, ProfilePost } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

/**
 * MK5 — the studio's Content card: list posts, draft one with AI from a
 * topic, edit, publish/unpublish. Every AI draft lands as an editable
 * DRAFT — nothing reaches the public page unreviewed.
 */
export function MarketingPosts({ profileSlug }: { profileSlug: string | null }) {
  const [posts, setPosts] = useState<ProfilePost[] | null>(null);
  const [topic, setTopic] = useState('');
  const [editing, setEditing] = useState<{ id?: string; title: string; body: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/psychologists/me/posts', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { items: ProfilePost[] };
      setPosts(body.items);
    } catch {
      setPosts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const draftFromTopic = useCallback(
    () =>
      act('draft', async () => {
        const res = await fetch('/api/v1/psychologists/me/posts/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: topic.trim() }),
        });
        const body = (await res.json().catch(() => ({}))) as DraftPostResponse | { error?: string };
        if (!res.ok) {
          throw new Error((body as { error?: string }).error ?? 'Could not draft — try again.');
        }
        const draft = body as DraftPostResponse;
        setEditing({ title: draft.title, body: draft.body });
        setTopic('');
      }),
    [act, topic],
  );

  const save = useCallback(
    () =>
      act('save', async () => {
        if (!editing) return;
        const res = await fetch('/api/v1/psychologists/me/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(editing.id && { id: editing.id }),
            title: editing.title.trim(),
            body: editing.body.trim(),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not save the post.');
        }
        setEditing(null);
        setNotice('Saved as a draft — publish it when you have read every word.');
        await load();
      }),
    [act, editing, load],
  );

  const togglePublish = useCallback(
    (post: ProfilePost) =>
      act(post.id, async () => {
        const res = await fetch(`/api/v1/psychologists/me/posts/${post.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publish: post.status !== 'PUBLISHED' }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Could not update the post.');
        }
        await load();
      }),
    [act, load],
  );

  return (
    <Card className="p-7">
      <h2 className="font-serif text-2xl">Writing</h2>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">
        Short articles on topics you work with — each one is another page search engines and AI
        assistants can cite when someone looks for help. Drafted from your declared expertise, never
        from session content. You approve every word.
      </p>
      {notice && (
        <p className="mt-3 rounded-xl bg-[var(--color-surface-soft)] px-4 py-2 text-sm">{notice}</p>
      )}

      {editing ? (
        <div className="mt-5 space-y-3 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-5">
          <input
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            placeholder="Title"
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-4 py-2.5 text-sm font-medium"
          />
          <textarea
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            rows={12}
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-4 py-2.5 text-sm leading-relaxed"
          />
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Discard
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic — e.g. sleep and anxiety, exam stress, burnout"
            className="min-w-[240px] flex-1 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-bg)] px-4 py-2.5 text-sm"
          />
          <Button
            onClick={() => void draftFromTopic()}
            disabled={busy === 'draft' || topic.trim().length < 3}
          >
            {busy === 'draft' ? 'Drafting…' : 'Draft with AI'}
          </Button>
          <Button variant="secondary" onClick={() => setEditing({ title: '', body: '' })}>
            Blank post
          </Button>
        </div>
      )}

      {posts !== null && posts.length > 0 && (
        <ul className="mt-6 space-y-2">
          {posts.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div className="min-w-0">
                <span className="font-medium">{p.title}</span>
                <Badge tone={p.status === 'PUBLISHED' ? 'accent' : 'muted'} className="ml-2">
                  {p.status === 'PUBLISHED' ? 'Live' : 'Draft'}
                </Badge>
                {p.status === 'PUBLISHED' && profileSlug && (
                  <Link
                    href={`/therapists/${profileSlug}/posts/${p.slug}`}
                    target="_blank"
                    className="ml-2 text-xs text-[var(--color-accent)] hover:underline"
                  >
                    View →
                  </Link>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing({ id: p.id, title: p.title, body: p.body })}
                  className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void togglePublish(p)}
                  disabled={busy === p.id}
                  className="text-xs font-medium text-[var(--color-ink-2)] hover:underline"
                >
                  {p.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
