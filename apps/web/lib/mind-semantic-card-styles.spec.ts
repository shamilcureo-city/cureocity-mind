import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8');
const css = read('app/app/mind-workspace.css');

describe('Mind paper Cards preserve semantic safety and recovery colours', () => {
  it('restores every red and amber fill/border used by the live session after the neutral default', () => {
    const live = read('components/app/TherapistLiveSession.tsx');
    const variants = new Set(live.match(/(?:bg|border)-(?:red|amber)-(?:50|100|200|300)\b/g));
    expect(variants.size).toBeGreaterThan(0);
    const base = css.indexOf('.mind-workspace-shell .u-glass {');
    expect(base).toBeGreaterThanOrEqual(0);
    for (const variant of variants) {
      const selector = `.mind-workspace-shell .u-glass.${variant} {`;
      expect(css.indexOf(selector), variant).toBeGreaterThan(base);
      const body = css.slice(css.indexOf(selector) + selector.length).split('}')[0];
      const colourToken = `--color-${variant.replace(/^(?:bg|border)-/, '')}`;
      expect(body).toContain(
        `${variant.startsWith('bg-') ? 'background' : 'border-color'}: var(${colourToken},`,
      );
    }
  });

  it('preserves token-based warnings and transcript-recovery Cards without changing Doctor styles', () => {
    for (const [utility, value] of [
      ['bg-[var(--color-crit-soft,#fbe4e0)]', 'background: var(--color-crit-soft, #fbe4e0)'],
      ['bg-[var(--color-warn-bg)]', 'background: var(--color-warn-bg)'],
      ['bg-[var(--color-warn-soft)]', 'background: var(--color-warn-soft)'],
      ['border-[var(--color-warn)]', 'border-color: var(--color-warn)'],
      ['border-[var(--color-warn-border)]', 'border-color: var(--color-warn-border)'],
      ['bg-[var(--color-accent-soft)]', 'background: var(--color-accent-soft)'],
      ['border-[var(--color-accent)]', 'border-color: var(--color-accent)'],
    ]) {
      const selector = `.mind-workspace-shell .u-glass[class~='${utility}'] {`;
      expect(css).toContain(selector);
      expect(css.slice(css.indexOf(selector) + selector.length).split('}')[0]).toContain(value);
    }
    const cardSelectors = css.split('\n').filter((line) => line.includes('.u-glass'));
    expect(cardSelectors.every((line) => line.startsWith('.mind-workspace-shell .u-glass'))).toBe(
      true,
    );
    expect(css).toContain('background: var(--color-surface);');
  });
});
