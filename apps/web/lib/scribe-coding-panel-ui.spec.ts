import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import {
  ScribeCodingResponseSchema,
  type ScribeCodingEntry,
  type ScribeCodingResponse,
  type ScribeCodingWorksheet,
} from './scribe-coding';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  idIndex: 0,
  guard: vi.fn(),
  uuid: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (next: T | ((value: T) => T)) => {
        harness.states[index] =
          typeof next === 'function' ? (next as (value: T) => T)(harness.states[index] as T) : next;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
  useId: () => `coding-${harness.idIndex++}`,
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = harness.effectIndex++,
      previous = harness.effects[index];
    if (!previous || !deps || deps.some((value, i) => value !== previous.deps?.[i]))
      harness.queued.push(() => {
        previous?.cleanup?.();
        harness.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
vi.mock('@/lib/use-unsaved-work-guard', () => ({ useUnsavedWorkGuard: harness.guard }));
import { ScribeCodingPanel } from '../components/app/ScribeCodingPanel';

type Props = {
  children?: ReactNode;
  id?: string;
  disabled?: boolean;
  value?: string;
  checked?: boolean;
  type?: string;
  role?: string;
  href?: string;
  target?: string;
  rel?: string;
  referrerPolicy?: string;
  'aria-label'?: string;
  onClick?: () => void;
  onChange?: (event: { target: { value: string; checked?: boolean } }) => void;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
}
let input: Parameters<typeof ScribeCodingPanel>[0];
function render() {
  harness.stateIndex = harness.refIndex = harness.effectIndex = harness.idIndex = 0;
  const result = ScribeCodingPanel(input);
  harness.queued.splice(0).forEach((run) => run());
  return result;
}
function button(label: string) {
  const result = elements(render()).find(
    (node) => node.type === 'button' && text(node.props.children) === label,
  );
  expect(result, `Missing action: ${label}`).toBeDefined();
  return result!;
}
function click(label: string) {
  const result = button(label);
  expect(result.props.disabled).toBeFalsy();
  result.props.onClick!();
}
function field(name: string) {
  const result = elements(render()).find((node) => node.props.id === `coding-0-${name}`);
  expect(result, `Missing field ${name}`).toBeDefined();
  return result!;
}
function change(name: string, value: string) {
  field(name).props.onChange!({ target: { value } });
}
function attest() {
  const result = elements(render()).find(
    (node) => node.type === 'input' && node.props.type === 'checkbox',
  )!;
  expect(result.props.disabled).toBeFalsy();
  result.props.onChange!({ target: { value: '', checked: true } });
}
async function settle() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
  render();
}
const note = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  assessment: 'Fictional clinician assessment',
});
const noteHash = 'a'.repeat(64),
  otherHash = 'b'.repeat(64);
function entry(overrides: Partial<ScribeCodingEntry> = {}): ScribeCodingEntry {
  return {
    id: 'manual-1',
    origin: 'manual',
    code: 'R50.9',
    label: 'Fever, unspecified',
    system: 'ICD10_WHO',
    release: '2019',
    decision: 'include',
    documentation: 'Fictional documented fever; review required.',
    ...overrides,
  };
}
function response(
  worksheet: ScribeCodingWorksheet | null = null,
  overrides: Partial<ScribeCodingResponse> = {},
): ScribeCodingResponse {
  return ScribeCodingResponseSchema.parse({
    draft: { id: 'draft-1', hash: noteHash, content: note },
    signed: false,
    signedNoteHash: null,
    sourceCurrent: worksheet ? true : null,
    record: worksheet
      ? {
          id: 'worksheet-1',
          revision: 1,
          body: {
            worksheet,
            draftId: 'draft-1',
            draftHash: noteHash,
            reviewedNoteHash: worksheet.status === 'reviewed' ? noteHash : null,
            reviewedAt: worksheet.status === 'reviewed' ? '2026-09-26T10:00:00.000Z' : null,
            reviewedBy: worksheet.status === 'reviewed' ? 'doctor-1' : null,
          },
          clientId: 'client-1',
          sessionId: 'session-1',
          createdAt: '2026-09-26T10:00:00.000Z',
          updatedAt: '2026-09-26T10:00:00.000Z',
        }
      : null,
    suggestions: [],
    ...overrides,
  });
}
function seed(worksheet: ScribeCodingWorksheet) {
  input = { ...input, state: response(worksheet) };
}
function confirmedSave() {
  input.onSave = vi.fn(async (worksheet: ScribeCodingWorksheet) => {
    const saved = response(worksheet);
    saved.record!.revision = (input.state?.record?.revision ?? 0) + 1;
    input = { ...input, state: saved };
    return saved;
  });
}
beforeEach(() => {
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.queued = [];
  harness.guard.mockReset();
  harness.uuid.mockReset();
  let n = 0;
  harness.uuid.mockImplementation(() => `manual-new-${++n}`);
  vi.stubGlobal('React', React);
  vi.stubGlobal('crypto', { randomUUID: harness.uuid });
  input = {
    note,
    state: response(),
    currentNoteHash: noteHash,
    loading: false,
    error: null,
    saving: false,
    signed: false,
    onSave: vi.fn(async () => null),
    onReload: vi.fn(),
    onReviewSource: vi.fn(),
    onWorkChange: vi.fn(),
  };
});
afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('Scribe coding worksheet UI', () => {
  it('keeps coding separate from the note and makes its validation limits explicit', () => {
    const view = render();
    expect(text(view)).toContain('not part of the signed clinical note');
    expect(text(view)).toContain('does not submit a claim');
    expect(text(view)).toContain('does not search a complete code catalog');
    expect(text(view)).toContain('No codes added.');
  });
  it('does not automatically import or include existing AI suggestions', () => {
    const suggestion = entry({
      id: 'ai-1',
      origin: 'ai_suggestion',
      sourceSuggestionId: 'ai-1',
      system: null,
      release: '',
      decision: 'pending',
      documentation: '',
    });
    input = { ...input, state: response(null, { suggestions: [suggestion] }) };
    expect(text(render())).toContain('No codes added.');
    expect(input.onSave).not.toHaveBeenCalled();
    click('Add suggestion to worksheet');
    expect(field('decision').props.value).toBe('pending');
    expect(field('system').props.value).toBe('');
    expect(field('release').props.value).toBe('');
    expect(text(render())).toContain('Imported AI suggestion, not a confirmed diagnosis');
    expect(text(render())).toContain('All existing suggestions have been added');
  });
  it('adds and edits a manual code without changing the clinical note', () => {
    click('Add code manually');
    change('code', 'R50.9');
    change('label', 'Fever, unspecified');
    change('system', 'ICD10_CM');
    change('release', 'FY2026, October release');
    change('documentation', 'Fictional rationale');
    change('decision', 'include');
    expect(field('code').props.value).toBe('R50.9');
    expect(field('system').props.value).toBe('ICD10_CM');
    expect(field('decision').props.value).toBe('include');
    expect(input.note).toBe(note);
    expect(input.note.assessment).toBe('Fictional clinician assessment');
    expect(harness.guard).toHaveBeenLastCalledWith(true, expect.any(String), false);
    expect(input.onWorkChange).toHaveBeenLastCalledWith(true);
  });
  it('saves a pending manual entry only as a draft with a confirmed receipt', async () => {
    confirmedSave();
    click('Add code manually');
    change('label', 'Still checking');
    click('Save draft worksheet');
    await settle();
    expect(input.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        entries: [expect.objectContaining({ decision: 'pending', label: 'Still checking' })],
      }),
    );
    expect(text(render())).toContain('Draft worksheet saved.');
    expect(harness.guard).toHaveBeenLastCalledWith(false, expect.any(String), false);
    expect(input.onWorkChange).toHaveBeenLastCalledWith(false);
  });
  it('requires explicit attestation and resolved decisions before saving reviewed status', async () => {
    seed({ version: 'V1', status: 'draft', entries: [entry({ decision: 'pending' })] });
    confirmedSave();
    expect(button('Mark reviewed and save').props.disabled).toBe(true);
    attest();
    expect(button('Mark reviewed and save').props.disabled).toBe(true);
    change('decision', 'include');
    expect(button('Mark reviewed and save').props.disabled).toBe(true);
    attest();
    click('Mark reviewed and save');
    await settle();
    expect(input.onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'reviewed' }));
    expect(text(render())).toContain('Reviewed for this note version');
    expect(text(render())).toContain('clinical note is unchanged');
  });
  it('blocks incomplete included entries and identifies the entry needing correction', () => {
    click('Add code manually');
    change('decision', 'include');
    click('Save draft worksheet');
    expect(input.onSave).not.toHaveBeenCalled();
    expect(text(render())).toContain('Entry 1: Included entries require system.');
    expect(field('decision').props.value).toBe('include');
  });
  it('permits an unsupported suggestion to be excluded without inventing a system or code label', async () => {
    seed({
      version: 'V1',
      status: 'draft',
      entries: [
        entry({
          origin: 'ai_suggestion',
          system: null,
          release: '',
          code: 'not-a-code',
          label: '',
          documentation: '',
          decision: 'pending',
        }),
      ],
    });
    confirmedSave();
    change('decision', 'exclude');
    attest();
    click('Mark reviewed and save');
    await settle();
    expect(input.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'reviewed',
        entries: [expect.objectContaining({ decision: 'exclude', system: null, label: '' })],
      }),
    );
  });
  it.each(['reject', 'null', 'wrong-receipt'] as const)(
    'preserves dirty work after a %s save',
    async (kind) => {
      click('Add code manually');
      change('label', 'Keep this local wording');
      input.onSave =
        kind === 'reject'
          ? vi.fn(async () => {
              throw new Error('network');
            })
          : kind === 'null'
            ? vi.fn(async () => null)
            : vi.fn(async () => response({ version: 'V1', status: 'draft', entries: [] }));
      click('Save draft worksheet');
      await settle();
      expect(field('label').props.value).toBe('Keep this local wording');
      expect(text(render())).toContain('save could not be confirmed');
      expect(input.onWorkChange).toHaveBeenLastCalledWith(true);
      expect(text(render())).not.toContain('Draft worksheet saved.');
    },
  );
  it('asks before discarding local changes on reload, and can keep editing', () => {
    click('Add code manually');
    change('label', 'Unsaved label');
    click('Reload worksheet');
    expect(input.onReload).not.toHaveBeenCalled();
    expect(text(render())).toContain('Discard your unsaved coding changes');
    click('Keep editing');
    expect(field('label').props.value).toBe('Unsaved label');
    click('Reload worksheet');
    click('Discard changes and reload');
    expect(input.onReload).toHaveBeenCalledOnce();
    expect(text(render())).toContain('No codes added.');
    expect(input.onWorkChange).toHaveBeenLastCalledWith(false);
  });
  it('preserves dirty work when a different saved revision arrives and blocks overwrite', () => {
    seed({ version: 'V1', status: 'draft', entries: [entry()] });
    change('label', 'My unsaved change');
    const remote = response({
      version: 'V1',
      status: 'draft',
      entries: [entry({ label: 'Other saved change' })],
    });
    remote.record!.revision = 2;
    input = { ...input, state: remote };
    expect(field('label').props.value).toBe('My unsaved change');
    expect(text(render())).toContain('saving is paused');
    expect(button('Save draft worksheet').props.disabled).toBe(true);
    click('Reload worksheet');
    click('Discard changes and reload');
    expect(field('label').props.value).toBe('Other saved change');
  });
  it('invalidates reviewed display and attestation when a note version changes', () => {
    seed({ version: 'V1', status: 'reviewed', entries: [entry()] });
    expect(text(render())).toContain('Reviewed for this note version');
    attest();
    input = {
      ...input,
      currentNoteHash: otherHash,
      note: { ...note, assessment: 'New assessment' },
    };
    render();
    expect(text(render())).not.toContain('Reviewed for this note version');
    expect(text(render())).toContain('earlier review does not cover these changes');
    expect(button('Mark reviewed and save').props.disabled).toBe(true);
  });
  it('invalidates reviewed display and attestation on a worksheet edit', () => {
    seed({ version: 'V1', status: 'reviewed', entries: [entry()] });
    attest();
    change('documentation', 'Changed supporting documentation');
    expect(text(render())).toContain('Unsaved worksheet changes');
    expect(text(render())).not.toContain('Reviewed for this note version');
    expect(button('Mark reviewed and save').props.disabled).toBe(true);
  });
  it('keeps signed encounters read-only and does not present the editable draft as the signed assessment', () => {
    const state = response(
      { version: 'V1', status: 'reviewed', entries: [entry()] },
      { signed: true, signedNoteHash: noteHash },
    );
    input = { ...input, state, signed: true };
    const view = render();
    expect(text(view)).toContain('worksheet is read-only');
    expect(text(view)).not.toContain('Fictional clinician assessment');
    expect(text(view)).toContain('Review status uses the saved signed note');
    expect(button('Add code manually').props.disabled).toBe(true);
    expect(button('Save draft worksheet').props.disabled).toBe(true);
    expect(button('Mark reviewed and save').props.disabled).toBe(true);
    expect(elements(view).find((node) => node.type === 'fieldset')!.props.disabled).toBe(true);
    change('label', 'Cannot mutate signed worksheet');
    expect(field('label').props.value).toBe('Fever, unspecified');
  });
  it.each([{ disabled: true }, { loading: true }, { currentNoteHash: null }] as const)(
    'blocks saving when not authorized to edit or hash is unresolved: %j',
    (override) => {
      seed({ version: 'V1', status: 'draft', entries: [entry()] });
      input = { ...input, ...override };
      expect(button('Save draft worksheet').props.disabled).toBe(true);
    },
  );
  it('does not permit duplicate save requests while acknowledgement is pending', async () => {
    seed({ version: 'V1', status: 'draft', entries: [entry()] });
    type SaveResult = Awaited<ReturnType<typeof input.onSave>>;
    let resolve!: (value: SaveResult) => void;
    input.onSave = vi.fn<typeof input.onSave>(
      () =>
        new Promise<SaveResult>((done) => {
          resolve = done;
        }),
    );
    const saveAction = button('Save draft worksheet').props.onClick!;
    saveAction();
    saveAction();
    expect(input.onSave).toHaveBeenCalledOnce();
    expect(button('Saving worksheet…').props.disabled).toBe(true);
    expect(input.onWorkChange).toHaveBeenLastCalledWith(true);
    resolve(null);
    await settle();
    expect(button('Save draft worksheet').props.disabled).toBe(false);
  });
  it('ignores a completed save after unmount and clears the parent blocking signal', async () => {
    click('Add code manually');
    type SaveResult = Awaited<ReturnType<typeof input.onSave>>;
    let resolve!: (value: SaveResult) => void;
    input.onSave = vi.fn<typeof input.onSave>(
      () =>
        new Promise<SaveResult>((done) => {
          resolve = done;
        }),
    );
    click('Save draft worksheet');
    render();
    harness.effects.forEach((effect) => effect.cleanup?.());
    const before = JSON.stringify(harness.states);
    resolve(response({ version: 'V1', status: 'draft', entries: [] }));
    for (let index = 0; index < 6; index++) await Promise.resolve();
    expect(JSON.stringify(harness.states)).toBe(before);
    expect(input.onWorkChange).toHaveBeenLastCalledWith(false);
  });
  it('keeps official reference URLs static and suppresses referrer data', () => {
    click('Add code manually');
    change('label', 'Patient-sensitive label');
    const links = elements(render()).filter((node) => node.type === 'a');
    expect(links.map((link) => link.props.href)).toEqual([
      'https://icd.who.int/browse10/2019/en',
      'https://www.cdc.gov/nchs/icd/icd-10-cm/',
    ]);
    for (const link of links) {
      expect(link.props.rel).toBe('noopener noreferrer');
      expect(link.props.referrerPolicy).toBe('no-referrer');
      expect(link.props.target).toBe('_blank');
    }
  });
  it('opens note-source review without clearing local coding edits', () => {
    click('Add code manually');
    change('label', 'Keep coding edit');
    click('Review note and source');
    expect(input.onReviewSource).toHaveBeenCalledOnce();
    expect(field('label').props.value).toBe('Keep coding edit');
  });
  it('honours the worksheet entry limit without silently truncating it', () => {
    seed({
      version: 'V1',
      status: 'draft',
      entries: Array.from({ length: 30 }, (_, index) =>
        entry({ id: `entry-${index}`, decision: 'pending' }),
      ),
    });
    expect(button('Add code manually').props.disabled).toBe(true);
    expect(text(render())).toContain('holds up to 30 entries');
    expect(
      elements(render()).find((node) => node.props['aria-label'] === 'Coding worksheet entries')!
        .props.children,
    ).toHaveLength(30);
    click('Remove entry');
    expect(button('Add code manually').props.disabled).toBe(false);
    expect(
      elements(render()).find((node) => node.props['aria-label'] === 'Coding worksheet entries')!
        .props.children,
    ).toHaveLength(29);
  });
});
