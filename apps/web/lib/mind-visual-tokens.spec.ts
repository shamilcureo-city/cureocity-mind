import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '../app/app/mind-workspace.css'), 'utf8');
const shell = css.slice(css.indexOf('.mind-workspace-shell {'), css.indexOf('\n}'));
const token = (name: string): string => {
  const value = shell.match(new RegExp(`--${name}:\\s*(#[a-fA-F0-9]+);`))?.[1];
  if (!value) throw new Error(`Missing Mind token ${name}`);
  return value;
};
function luminance(hex: string): number {
  const digits = hex.slice(1);
  const rgb = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return [0, 2, 4].reduce((total, offset, index) => {
    const s = parseInt(rgb.slice(offset, offset + 2), 16) / 255;
    const linear = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    return total + linear * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
}
function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe('Mind core design tokens (not a full rendered accessibility audit)', () => {
  for (const foreground of ['color-ink', 'color-ink-2', 'color-ink-3', 'color-accent']) {
    for (const background of ['color-bg', 'color-surface', 'color-surface-soft']) {
      it(`${foreground} meets normal-text contrast on ${background}`, () => {
        expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('keeps semantic warning/success text readable on their own surfaces', () => {
    expect(contrast(token('color-warn'), token('color-warn-soft'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('color-good'), token('color-good-soft'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#fff', token('color-accent'))).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps this colour system scoped to Mind with reduced-motion support', () => {
    expect(shell).toContain('.mind-workspace-shell {');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation: none !important');
  });
});
