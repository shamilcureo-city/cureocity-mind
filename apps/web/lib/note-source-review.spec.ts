import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NoteEditingLayout } from '../components/app/NoteEditingLayout';
import { TranscriptTab } from '../components/app/TranscriptTab';
import { TRANSCRIPT_UNAVAILABLE_MESSAGE } from './note-transcript-view';

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

describe('source-aware review', () => {
  it('offers comparison without requiring edit mode, keeping the pane collapsed by default', () => {
    const html = renderToStaticMarkup(
      createElement(NoteEditingLayout, {
        mode: 'review',
        reference: 'Private fictional source',
        children: 'Fictional note',
      }),
    );
    expect(html).toContain('Compare with transcript');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Fictional note');
    expect(html).not.toContain('Private fictional source');
  });
  it('preserves the existing edit-mode action', () => {
    const html = renderToStaticMarkup(
      createElement(NoteEditingLayout, {
        reference: 'Source',
        children: 'Editor',
      }),
    );
    expect(html).toContain('Show transcript reference');
  });
  it('explains an unreadable source instead of displaying stale plaintext', () => {
    const html = renderToStaticMarkup(
      createElement(TranscriptTab, {
        data: {
          status: 'COMPLETED',
          segments: null,
          transcript: null,
          totalCostInr: '0',
          backend: null,
          errorMessage: TRANSCRIPT_UNAVAILABLE_MESSAGE,
        },
      }),
    );
    expect(html).toContain('Transcript unavailable');
    expect(html).toContain('Reload to retry');
    expect(html).not.toContain('No transcript available');
  });
  it('wires one source mapper into initial page and polling, and separates the optional mindmap', () => {
    const page = readFileSync(
      join(import.meta.dirname, '../app/app/sessions/[id]/page.tsx'),
      'utf8',
    );
    const route = readFileSync(
      join(import.meta.dirname, '../app/api/v1/sessions/[id]/note-draft/route.ts'),
      'utf8',
    );
    expect(page).toContain('...noteTranscriptView(draftRow, source)');
    expect(route).toContain('...noteTranscriptView(draft, transcript)');
    expect(page).toContain('Explore the note as a mindmap');
    expect(page).toContain('not a');
    expect(page).toContain('transcript or independent clinical evidence.');
    expect(page).not.toContain('<details open');
    const layout = readFileSync(
      join(import.meta.dirname, '../components/app/NoteEditingLayout.tsx'),
      'utf8',
    );
    expect(layout).toContain('tabIndex={0}');
    expect(layout).toContain('aria-label="Scrollable saved transcript"');
    expect(layout).toContain('focus-visible:outline');
  });
});
