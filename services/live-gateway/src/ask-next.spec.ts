import { describe, expect, it } from 'vitest';
import type { AskNextItem } from '@cureocity/contracts';
import { AskNextManager } from './ask-next';

function diff(id: string, over: Partial<AskNextItem> = {}): AskNextItem {
  return {
    id,
    question: `question ${id}`,
    why: 'because',
    targetDxIds: [],
    source: 'DIFFERENTIAL',
    priority: 'normal',
    status: 'open',
    ...over,
  };
}

function tmpl(id: string, question: string): AskNextItem {
  return {
    id,
    question,
    why: 'completes template',
    targetDxIds: [],
    source: 'TEMPLATE',
    priority: 'normal',
    status: 'open',
  };
}

const NO_DX = new Set<string>();

describe('AskNextManager', () => {
  it('re-derives the differential-driven open set each cycle', () => {
    const m = new AskNextManager();
    m.ingestDifferential([diff('q1'), diff('q2')], NO_DX);
    expect(m.openFeed().map((q) => q.id)).toEqual(['q1', 'q2']);
    m.ingestDifferential([diff('q3')], NO_DX);
    expect(m.openFeed().map((q) => q.id)).toEqual(['q3']);
  });

  it('caps open differential-driven questions at 3, high priority first', () => {
    const m = new AskNextManager();
    m.ingestDifferential(
      [diff('q1'), diff('q2'), diff('q3'), diff('q4', { priority: 'high' })],
      NO_DX,
    );
    const feed = m.openFeed();
    expect(feed).toHaveLength(3);
    expect(feed[0]!.id).toBe('q4'); // high priority surfaces first
  });

  it('filters targetDxIds to the kept differential ids', () => {
    const m = new AskNextManager();
    m.ingestDifferential([diff('q1', { targetDxIds: ['d1', 'd9'] })], new Set(['d1']));
    expect(m.openFeed()[0]!.targetDxIds).toEqual(['d1']);
  });

  it('auto-resolves an answered question (✓ once) and never re-adds it', () => {
    const m = new AskNextManager();
    m.ingestDifferential([diff('q1'), diff('q2')], NO_DX);
    m.resolveAnswered(['q1']);
    expect(m.hasJustAnswered()).toBe(true);
    const feed = m.feed();
    expect(feed.find((q) => q.id === 'q1')?.status).toBe('answered');
    expect(m.openFeed().map((q) => q.id)).toEqual(['q2']); // q1 no longer open
    m.markEmitted();
    expect(m.hasJustAnswered()).toBe(false);
    // The model re-produces q1 next cycle — but it's resolved, so it stays gone.
    m.ingestDifferential([diff('q1'), diff('q2')], NO_DX);
    expect(m.openFeed().map((q) => q.id)).toEqual(['q2']);
  });

  it('persists dismissals for the consult — never re-suggested', () => {
    const m = new AskNextManager();
    m.ingestDifferential([diff('q1'), diff('q2')], NO_DX);
    m.dismiss('q1');
    expect(m.openFeed().map((q) => q.id)).toEqual(['q2']);
    m.ingestDifferential([diff('q1'), diff('q2')], NO_DX);
    expect(m.openFeed().map((q) => q.id)).toEqual(['q2']);
  });

  it('dedups a template question that overlaps an open differential one', () => {
    const m = new AskNextManager();
    m.ingestDifferential([diff('q1', { question: 'Does the pain worsen on exertion?' })], NO_DX);
    m.ingestTemplate([
      tmpl('t-hpi-exertion', 'Ask about relation to exertion?'), // shares "exertion" → dropped
      tmpl('t-vitals-bp', 'Record blood pressure?'), // no overlap → kept
    ]);
    const ids = m.openFeed().map((q) => q.id);
    expect(ids).toContain('q1');
    expect(ids).toContain('t-vitals-bp');
    expect(ids).not.toContain('t-hpi-exertion');
  });

  it('drops a template question once its element is documented (re-derived empty)', () => {
    const m = new AskNextManager();
    m.ingestTemplate([tmpl('t-vitals-bp', 'Record blood pressure?')]);
    expect(m.openFeed().map((q) => q.id)).toEqual(['t-vitals-bp']);
    m.ingestTemplate([]); // BP now documented → gap gone
    expect(m.openFeed()).toHaveLength(0);
  });

  it('feeds only differential-driven open questions back to the model', () => {
    const m = new AskNextManager();
    m.ingestDifferential([diff('q1')], NO_DX);
    m.ingestTemplate([tmpl('t-vitals-bp', 'Record blood pressure?')]);
    expect(m.openForModel()).toEqual([{ id: 'q1', question: 'question q1' }]);
  });

  it('orders the feed: differential (≤3) before template, answered appended', () => {
    const m = new AskNextManager();
    m.ingestDifferential([diff('q1')], NO_DX);
    m.ingestTemplate([tmpl('t-vitals-bp', 'Record blood pressure?')]);
    m.ingestDifferential([diff('q1'), diff('q2')], NO_DX);
    m.resolveAnswered(['q2']);
    const feed = m.feed();
    expect(feed[0]!.source).toBe('DIFFERENTIAL');
    expect(feed.some((q) => q.source === 'TEMPLATE')).toBe(true);
    expect(feed[feed.length - 1]!.status).toBe('answered');
  });
});
