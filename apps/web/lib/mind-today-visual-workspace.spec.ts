import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  MindTodayWorkspace,
  type MindTodayWorkspaceProps,
} from '../components/app/MindTodayWorkspace';
import { TodayAttentionQueue } from '../components/app/TodayAttentionQueue';

vi.mock('../components/app/TodaySessionCard', () => ({
  TodaySessionCard: ({ session }: { session: { id: string; clientName: string } }) =>
    createElement('div', { 'data-session': session.id }, session.clientName),
}));

const session = {
  id: 'booked-test-session',
  status: 'SCHEDULED' as const,
  scheduledAt: '2026-10-12T04:30:00.000Z',
  modality: null,
  kind: 'TREATMENT' as const,
  clientId: 'test-client',
  clientName: 'Fictional client',
  hasSignedNote: false,
  draftStatus: null,
};

const props: MindTodayWorkspaceProps = {
  dateLabel: 'Monday, 12 October 2026',
  hero: session,
  agenda: [],
  upcoming: [],
  attentionItems: [],
  defaultCapture: 'LIVE',
  progress: { completed: 0, signed: 0, ready: 0, remaining: 0 },
};

describe('Today approved visual direction with live-data boundaries', () => {
  beforeAll(() => vi.stubGlobal('React', React));
  afterAll(() => vi.unstubAllGlobals());

  it('keeps first-run and dated recovery ahead of the wide appointment hero', () => {
    const html = renderToStaticMarkup(
      createElement(MindTodayWorkspace, {
        ...props,
        firstRun: createElement('p', {}, 'First-run choices'),
        attentionItems: [
          {
            id: 'unfinished',
            kind: 'ACTIVE_SESSION',
            title: 'Unfinished client',
            occurredAt: '2026-10-11T04:30:00.000Z',
            href: '/app/sessions/unfinished',
            ctaLabel: 'Review or resume',
          },
        ],
      }),
    );
    expect(html).toContain('mind-visual-workspace');
    expect(html).toContain('A little space for today.');
    expect(html.indexOf('First-run choices')).toBeLessThan(html.indexOf('data-session='));
    expect(html.indexOf('Unfinished sessions')).toBeLessThan(html.indexOf('data-session='));
    expect(html).toContain('0 sessions');
    expect(html).toContain('No other sessions on today’s agenda.');
    expect(html).not.toContain('Ananya');
    expect(html).not.toContain('50 minutes');
  });

  it('keeps no-booking, no-future and no-action states honest', () => {
    const html = renderToStaticMarkup(createElement(MindTodayWorkspace, { ...props, hero: null }));
    expect(html).toContain('No upcoming session is booked.');
    expect(html).toContain('No follow-ups booked in the next three days.');
    expect(html).toContain('No actions in this view.');
    expect(html).toContain('href="/app/clients"');
    expect(html).not.toContain('All caught up');
    expect(html).not.toContain('Everything is signed');
  });

  it('keeps failures visible and separate from optional activity, despite the calmer queue styling', () => {
    const items = [
      {
        id: 'failure',
        kind: 'NOTE_NEEDS_ATTENTION' as const,
        title: 'Note failed',
        occurredAt: '2026-10-12T04:30:00.000Z',
        href: '/app/sessions/failure',
        ctaLabel: 'Open note',
      },
      {
        id: 'activity',
        kind: 'RECENT_ACTIVITY' as const,
        title: 'Shared item opened',
        occurredAt: '2026-10-12T04:30:00.000Z',
        href: '/app/clients/test-client',
        ctaLabel: 'Open client',
      },
    ];
    const html = renderToStaticMarkup(createElement(TodayAttentionQueue, { items }));
    expect(html).toContain('data-urgent="true"');
    expect(html.indexOf('href="/app/sessions/failure"')).toBeLessThan(html.indexOf('<details'));
    expect(html).toContain('1 item shown');
    expect(html).toContain('Nothing is signed or shared automatically.');
    expect(html).toContain('An opening does not require a new action.');
  });

  it('uses the original local decorative art without remote scripts or patient content', () => {
    const source = readFileSync(
      new URL('../components/app/TodaySessionCard.tsx', import.meta.url),
      'utf8',
    );
    const art = readFileSync(
      new URL('../public/mind/conversation-room.svg', import.meta.url),
      'utf8',
    );
    expect(source).toContain('src="/mind/conversation-room.svg" alt=""');
    expect(source).toContain('className={styles.roomArt} aria-hidden="true"');
    expect(art).toContain('Room for a conversation');
    expect(art).not.toMatch(/<script|<foreignObject|https?:\/\/(?!www\.w3\.org)/);
  });
});
