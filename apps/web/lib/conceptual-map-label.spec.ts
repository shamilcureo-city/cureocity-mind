import { describe, expect, it } from 'vitest';
import {
  EDGE_LABEL_CHARS_PER_LINE,
  EDGE_LABEL_MAX_LINES,
  edgeLabelBox,
  wrapEdgeLabel,
} from './conceptual-map-label';

describe('wrapEdgeLabel', () => {
  it('leaves a short label on one line', () => {
    expect(wrapEdgeLabel('reinforces')).toEqual(['reinforces']);
  });

  it('returns nothing for blank input', () => {
    expect(wrapEdgeLabel('')).toEqual([]);
    expect(wrapEdgeLabel('   ')).toEqual([]);
  });

  it('collapses runs of whitespace', () => {
    expect(wrapEdgeLabel('  triggers   the   loop ')).toEqual(['triggers the loop']);
  });

  it('never exceeds the line budget', () => {
    const sentence =
      "She has learned that 'cancelling plans twice' is a key relapse signature, directly referencing her old pattern of withdrawal.";
    const lines = wrapEdgeLabel(sentence);
    expect(lines.length).toBeLessThanOrEqual(EDGE_LABEL_MAX_LINES);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(EDGE_LABEL_CHARS_PER_LINE);
    }
  });

  it('marks elision when text was dropped', () => {
    const lines = wrapEdgeLabel(
      'She identifies the return of Sunday evening dread as a primary warning sign, showing her awareness of this specific trigger.',
    );
    expect(lines[lines.length - 1].endsWith('…')).toBe(true);
  });

  it('does not mark elision when everything fitted', () => {
    const lines = wrapEdgeLabel('triggers avoidance');
    expect(lines.join('')).not.toContain('…');
  });

  it('breaks on word boundaries rather than mid-word', () => {
    const lines = wrapEdgeLabel('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda');
    // Every line is made of whole words from the input (last may carry an ellipsis).
    const source = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda'.split(' ');
    for (const line of lines) {
      for (const word of line.replace('…', '').trim().split(' ')) {
        if (word !== '') expect(source).toContain(word);
      }
    }
  });

  it('hard-cuts a single word wider than the chip instead of overflowing', () => {
    const giant = 'x'.repeat(200);
    const lines = wrapEdgeLabel(giant);
    expect(lines.length).toBe(1);
    expect(lines[0].length).toBeLessThanOrEqual(EDGE_LABEL_CHARS_PER_LINE);
  });

  it('handles a long word arriving after a full first line', () => {
    const lines = wrapEdgeLabel(`short words here then ${'y'.repeat(120)}`);
    expect(lines.length).toBeLessThanOrEqual(EDGE_LABEL_MAX_LINES);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(EDGE_LABEL_CHARS_PER_LINE);
    }
  });

  it('survives the contract maximum of 280 characters', () => {
    const lines = wrapEdgeLabel('word '.repeat(56).trim());
    expect(lines.length).toBeLessThanOrEqual(EDGE_LABEL_MAX_LINES);
  });
});

describe('edgeLabelBox', () => {
  it('grows with the widest line, not the line count alone', () => {
    const narrow = edgeLabelBox(['ab', 'cd']);
    const wide = edgeLabelBox(['abcdefghijklmnop', 'cd']);
    expect(wide.width).toBeGreaterThan(narrow.width);
    expect(wide.height).toBe(narrow.height);
  });

  it('grows in height with each line', () => {
    expect(edgeLabelBox(['a', 'b']).height).toBeGreaterThan(edgeLabelBox(['a']).height);
  });

  it('is non-negative for an empty label', () => {
    const box = edgeLabelBox([]);
    expect(box.width).toBeGreaterThanOrEqual(0);
    expect(box.height).toBeGreaterThanOrEqual(0);
  });
});
