import { describe, expect, it } from 'vitest';
import { ModifyNoteInputSchema } from './note-modify';

describe('version-bound note rewrite preview', () => {
  it('keeps existing direct callers compatible', () => {
    expect(ModifyNoteInputSchema.parse({ instruction: 'Make concise' }).mode).toBe('APPLY');
  });
  it('requires a valid draft timestamp for a preview', () => {
    expect(
      ModifyNoteInputSchema.safeParse({ instruction: 'Make concise', mode: 'PREVIEW' }).success,
    ).toBe(false);
    expect(
      ModifyNoteInputSchema.safeParse({
        instruction: 'Make concise',
        mode: 'PREVIEW',
        expectedUpdatedAt: 'yesterday',
      }).success,
    ).toBe(false);
    expect(
      ModifyNoteInputSchema.safeParse({
        instruction: 'Make concise',
        mode: 'PREVIEW',
        expectedUpdatedAt: '2026-09-14T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
  it.each(['  ', 'a', 'x'.repeat(1001)])('bounds instructions', (instruction) => {
    expect(ModifyNoteInputSchema.safeParse({ instruction }).success).toBe(false);
  });
});
