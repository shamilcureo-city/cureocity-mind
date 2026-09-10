import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { partitionMindTodayQueue } from './mind-today-queue';
import { prepareIntentKey } from './prepare-intent';
import { buildMindClientOverview } from './mind-client-overview';
import type { TodayAttentionItem, TodayAttentionKind } from './today-priority';
import { TodayAttentionQueue, TodayRecoveryQueue } from '../components/app/TodayAttentionQueue';
import { MindClientRosterRows } from '../components/app/MindClientRosterRows';

const item = (id: string, kind: TodayAttentionKind): TodayAttentionItem => ({
  id,
  kind,
  occurredAt: '2026-07-11T04:00:00Z',
  title: id,
  href: `/app/sessions/${id}`,
  ctaLabel: 'Open',
});

describe('quiet Today without lost work', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retains every failure and unfinished session beyond the ordinary preview limit', () => {
    const ordinary = Array.from({ length: 12 }, (_, i) => item(`note-${i}`, 'NOTE_REVIEW'));
    const items = [
      ...ordinary,
      item('failed-note', 'NOTE_NEEDS_ATTENTION'),
      item('failed-delivery', 'SHARE_FAILURE'),
      item('unfinished', 'ACTIVE_SESSION'),
      item('opened-link', 'RECENT_ACTIVITY'),
    ];
    const groups = partitionMindTodayQueue(items);
    expect(groups.preview).toHaveLength(4);
    expect(groups.remaining).toHaveLength(8);
    expect(groups.failures.map((row) => row.id)).toEqual(['failed-note', 'failed-delivery']);
    expect(groups.recovery.map((row) => row.id)).toEqual(['unfinished']);
    expect(groups.activity.map((row) => row.id)).toEqual(['opened-link']);
    expect(groups.actionCount).toBe(14);
    expect([
      ...groups.preview,
      ...groups.remaining,
      ...groups.failures,
      ...groups.recovery,
      ...groups.activity,
    ]).toHaveLength(items.length);
  });

  it('renders dated recovery without a collapse or unsupported live-now claim', () => {
    vi.stubGlobal('React', React);
    const html = renderToStaticMarkup(
      createElement(TodayRecoveryQueue, {
        items: [{ ...item('historic', 'ACTIVE_SESSION'), dateLabel: 'Booked' }],
      }),
    );
    expect(html).toContain('Unfinished sessions');
    expect(html).toContain('Booked 11 Jul 2026');
    expect(html).toContain('do not mean a microphone is recording now');
    expect(html).not.toContain('<details');
    expect(html).toContain('/app/sessions/historic');
  });

  it('keeps failed delivery outside the expandable ordinary work and separates activity', () => {
    vi.stubGlobal('React', React);
    const items = [
      ...Array.from({ length: 7 }, (_, i) => item(`note-${i}`, 'NOTE_REVIEW')),
      item('failed', 'SHARE_FAILURE'),
      item('opened', 'RECENT_ACTIVITY'),
    ];
    const html = renderToStaticMarkup(createElement(TodayAttentionQueue, { items }));
    expect(html.indexOf('href="/app/sessions/failed"')).toBeLessThan(html.indexOf('<details'));
    expect(html).toContain('View all shown actions (8)');
    expect(html).toContain('Recent activity · 1 shown');
    expect(html).toContain('/app/sessions/note-6');
    expect(html).toContain('All unsigned notes');
  });
});

describe('dated local preparation intention', () => {
  it('isolates clients and turns over at IST midnight, not UTC midnight', () => {
    expect(prepareIntentKey('client-a', new Date('2026-09-08T18:29:59Z'))).toBe(
      'prepare-intent-v2-client-a-2026-09-08',
    );
    expect(prepareIntentKey('client-a', new Date('2026-09-08T18:30:00Z'))).toBe(
      'prepare-intent-v2-client-a-2026-09-09',
    );
    expect(prepareIntentKey('client-b', new Date('2026-09-08T18:30:00Z'))).toBe(
      'prepare-intent-v2-client-b-2026-09-09',
    );
    expect(prepareIntentKey('client-a')).not.toBe('prepare-intent-client-a');
  });
});

describe('next-session client Overview', () => {
  it('counts completed sessions separately and keeps only three recents, without treating bookings as recordings', () => {
    const sessions = [
      { id: 'future-later', status: 'SCHEDULED', scheduledAt: new Date('2026-09-12') },
      { id: 'completed-1', status: 'COMPLETED', scheduledAt: new Date('2026-09-07') },
      { id: 'next', status: 'SCHEDULED', scheduledAt: new Date('2026-09-10') },
      { id: 'cancelled', status: 'CANCELLED', scheduledAt: new Date('2026-09-08') },
      { id: 'unfinished', status: 'IN_PROGRESS', scheduledAt: new Date('2026-09-09') },
      { id: 'completed-2', status: 'COMPLETED', scheduledAt: new Date('2026-09-06') },
      { id: 'old-booking', status: 'SCHEDULED', scheduledAt: new Date('2026-09-01') },
    ];
    const view = buildMindClientOverview(sessions, new Date('2026-09-09T12:00:00Z'));
    expect(view.completedCount).toBe(2);
    expect(view.totalRecordCount).toBe(7);
    expect(view.nextAppointment?.id).toBe('next');
    expect(view.recentSessions.map((session) => session.id)).toEqual([
      'unfinished',
      'cancelled',
      'completed-1',
    ]);
    expect(view.latestCompletedSession?.id).toBe('completed-1');
    expect(sessions).toHaveLength(7);
  });
});

describe('responsive client roster presentation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('renders the real rows with safe preview links, explicit counts and injected disabled actions', () => {
    vi.stubGlobal('React', React);
    const html = renderToStaticMarkup(
      createElement(MindClientRosterRows, {
        rows: [
          {
            id: 'fictional-client',
            name: 'Fictional client with a long name',
            status: 'ACTIVE',
            isDemo: true,
            clientSinceLabel: 'Sep 2026',
            totalRecords: 8,
            lastCompletedLabel: '8 Sep 2026, 10:00 am',
            nextAppointmentLabel: 'Not booked',
            href: '#preview-client',
            action: createElement('button', { disabled: true }, 'Example action'),
          },
        ],
      }),
    );
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('md:grid-cols-');
    expect(html).toContain('appointment / session records');
    expect(html).toContain('Next: Not booked');
    expect(html).toContain('href="#preview-client"');
    expect(html).not.toContain('/app/clients/fictional-client');
    expect(html).toContain('<button disabled="">Example action</button>');
    expect(html).toContain('Example');
  });
});
