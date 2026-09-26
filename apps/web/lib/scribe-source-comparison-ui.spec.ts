import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { MedicalEncounterNoteV1Schema, type MedicalEvidenceField } from '@cureocity/contracts';
import type { ScribeSourceSnapshot } from './scribe-source-review';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  idIndex: 0,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [
      harness.states[index],
      (value: T) => {
        harness.states[index] = value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
  useId: () => `source-${harness.idIndex++}`,
  useEffect: (effect: () => (() => void) | void, deps?: readonly unknown[]) => {
    const index = harness.effectIndex++;
    const previous = harness.effects[index];
    if (!previous || !deps || deps.some((dep, i) => dep !== previous.deps?.[i]))
      harness.queued.push(() => {
        previous?.cleanup?.();
        harness.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
import { ScribeSourceComparison } from '../components/app/ScribeSourceComparison';

type Props = {
  children?: ReactNode;
  disabled?: boolean;
  value?: string;
  tabIndex?: number;
  ref?: { current: unknown };
  role?: string;
  'aria-label'?: string;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
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
function pathTo(node: ReactNode, target: ReactNode, path = 'root'): string | null {
  if (node === target) return path;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const result = pathTo(node[i], target, `${path}[${i}]`);
      if (result) return result;
    }
  } else if (isValidElement<Props>(node))
    return pathTo(node.props.children, target, `${path}.children`);
  return null;
}
const baseline = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  chiefComplaint: 'Fever for three days',
  hpi: 'No cough reported',
  linkedEvidence: [
    {
      field: 'chiefComplaint',
      quote: 'fever for three days',
      claim: 'Fever duration',
      startMs: 12345,
    },
  ],
});
const fullTranscript =
  'Patient: I have fever for three days.\nDoctor: Tell me more.\nPatient: fever for three days, no cough.\nEnd of source.';
function snapshot(overrides: Partial<ScribeSourceSnapshot> = {}): ScribeSourceSnapshot {
  return {
    draftId: 'draft-1',
    version: 'source-version-1',
    draftContent: baseline,
    transcript: fullTranscript,
    sourceState: 'available',
    sourceMessage: null,
    ...overrides,
  };
}
let input: Parameters<typeof ScribeSourceComparison>[0];
function render() {
  harness.stateIndex = harness.refIndex = harness.effectIndex = harness.idIndex = 0;
  const view = ScribeSourceComparison(input);
  harness.queued.splice(0).forEach((run) => run());
  return view;
}
function click(label: string) {
  const button = elements(render()).find(
    (item) => item.type === 'button' && text(item.props.children) === label,
  );
  expect(button, `Missing ${label}`).toBeDefined();
  expect(button!.props.disabled).toBeFalsy();
  button!.props.onClick!();
}
beforeEach(() => {
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.queued = [];
  vi.stubGlobal('React', React);
  input = {
    note: baseline,
    baseline,
    source: snapshot(),
    loading: false,
    error: null,
    onRetry: vi.fn(),
    onClose: vi.fn(),
    activeField: 'chiefComplaint',
    onSelectField: vi.fn((field: MedicalEvidenceField) => {
      input = { ...input, activeField: field };
    }),
    children: React.createElement('textarea', { defaultValue: 'Unsaved clinician correction' }),
  };
});
afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('Scribe source comparison UI', () => {
  it('offers all seven sections and distinguishes quote location from clinical correctness', () => {
    const view = render();
    expect(elements(view).filter((item) => item.type === 'option')).toHaveLength(7);
    expect(text(view)).toContain('Quoted text found');
    expect(text(view)).toContain(
      'Finding quoted words does not establish clinical correctness or transcription accuracy.',
    );
    expect(text(view)).toContain('model-provided reference, not a verified audio location');
    expect(text(view)).toContain('0:12');
    expect(text(view)).not.toContain('Clinically verified');
    expect(text(view)).not.toContain('Verified note');
  });

  it('shows full transcript and explicit repeated occurrences; highlights original offsets on selection', () => {
    let view = render();
    expect(text(view)).toContain('2 occurrences in the saved transcript');
    const source = elements(view).find(
      (item) => item.props['aria-label'] === 'Full saved transcript',
    )!;
    expect(text(source.props.children)).toBe(fullTranscript);
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    harness.refs[0].current = { scrollIntoView, focus };
    click('Show occurrence 2');
    view = render();
    const highlighted = elements(view).find((item) => item.type === 'mark')!;
    expect(text(highlighted.props.children)).toBe('fever for three days');
    expect(
      text(
        elements(view).find((item) => item.props['aria-label'] === 'Full saved transcript')!.props
          .children,
      ),
    ).toBe(fullTranscript);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('selects a section without inventing an association when no evidence is attached', () => {
    const select = elements(render()).find((item) => item.type === 'select')!;
    select.props.onChange!({ target: { value: 'hpi' } });
    expect(input.onSelectField).toHaveBeenCalledWith('hpi');
    expect(text(render())).toContain('No linked quote for this section');
    expect(text(render())).toContain('absence of a link does not prove the note is wrong');
    expect(text(render())).not.toContain('Quoted text found');
  });

  it('does not move focus on initial open or ordinary field and editor changes', () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    harness.refs[1] = { current: { scrollIntoView, focus } };
    render();
    input = { ...input, activeField: 'hpi', editing: true };
    render();
    input = { ...input, note: { ...baseline, hpi: 'Clinician correction' } };
    render();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('focuses the source pane only for an explicit request while comparison is open', () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    harness.refs[1] = { current: { scrollIntoView, focus } };
    input = { ...input, open: false, focusRequest: 1 };
    render();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    input = { ...input, open: true };
    const pane = elements(render()).find(
      (item) => item.props['aria-label'] === 'Saved source comparison',
    )!;
    expect(pane.props.ref).toBe(harness.refs[1]);
    expect(pane.props.tabIndex).toBe(-1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    input = { ...input, activeField: 'hpi', editing: true };
    render();
    expect(focus).toHaveBeenCalledOnce();
    input = { ...input, focusRequest: 2 };
    render();
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('keeps an available-source review warning visible above its quotes and transcript', () => {
    const warning = 'The saved transcript needs transcription review before clinical use.';
    input = { ...input, source: snapshot({ sourceMessage: warning }) };
    const view = render();
    const status = elements(view).find(
      (item) => item.props.role === 'status' && text(item.props.children) === warning,
    );
    expect(status).toBeDefined();
    expect(text(view)).toContain('Quoted text found');
    expect(text(view)).toContain(fullTranscript);
    expect(text(view).indexOf(warning)).toBeLessThan(text(view).indexOf('Quoted text found'));
    expect(text(view)).not.toContain('Clinically verified');
    expect(text(view)).not.toContain('Verified note');
  });

  it('reports missing quoted text without asserting that the clinical statement is false', () => {
    input = { ...input, source: snapshot({ transcript: 'A different saved consultation.' }) };
    const view = render();
    expect(text(view)).toContain('Quote not found in saved transcript');
    expect(text(view)).not.toContain('Show quoted text');
    expect(elements(view).some((item) => item.type === 'mark')).toBe(false);
  });

  it('warns that original references do not substantiate edited wording and invalidates selected highlights', () => {
    click('Show occurrence 1');
    expect(elements(render()).some((item) => item.type === 'mark')).toBe(true);
    input = {
      ...input,
      note: { ...baseline, chiefComplaint: 'Corrected duration from clinician review' },
    };
    const view = render();
    expect(text(view)).toContain('You changed this section.');
    expect(text(view)).toContain('This original reference does not verify your edited section.');
    expect(text(view)).toContain('Corrected duration from clinician review');
    expect(elements(view).some((item) => item.type === 'mark')).toBe(false);
  });

  it('hides matching results when saved draft identity differs while preserving the clinician editor', () => {
    const child = input.children;
    input = {
      ...input,
      source: snapshot({ draftContent: { ...baseline, plan: 'New server draft' } }),
    };
    const view = render();
    expect(text(view)).toContain('The saved draft changed after this note was opened.');
    expect(text(view)).not.toContain('Quoted text found');
    expect(pathTo(view, child)).not.toBeNull();
    expect(text(view)).toContain('End of source.');
  });

  it('clears quote highlight when the saved source version changes', () => {
    click('Show occurrence 1');
    expect(elements(render()).some((item) => item.type === 'mark')).toBe(true);
    input = { ...input, source: snapshot({ version: 'source-version-2' }) };
    expect(elements(render()).some((item) => item.type === 'mark')).toBe(false);
  });

  it.each(['empty', 'unavailable', 'quarantined'] as const)(
    'renders %s source honestly without exposing passed-through source text',
    (sourceState) => {
      input = {
        ...input,
        source: snapshot({ sourceState, transcript: 'MUST NOT RENDER FROM INVALID SOURCE' }),
      };
      const view = render();
      expect(text(view)).not.toContain('MUST NOT RENDER');
      expect(text(view)).not.toContain('Quoted text found');
      expect(text(view)).toContain(
        sourceState === 'empty'
          ? 'No saved transcript'
          : sourceState === 'quarantined'
            ? 'Source hidden for review'
            : 'Source unavailable',
      );
      click('Retry loading source');
      expect(input.onRetry).toHaveBeenCalledOnce();
    },
  );

  it('preserves edits during loading/error and offers explicit retry', () => {
    const child = input.children;
    input = { ...input, loading: true };
    let view = render();
    expect(pathTo(view, child)).not.toBeNull();
    expect(text(view)).toContain('Loading the saved source');
    expect(text(view)).not.toContain('End of source.');
    input = { ...input, loading: false, error: 'Source request failed. Retry.' };
    view = render();
    expect(pathTo(view, child)).not.toBeNull();
    expect(text(view)).not.toContain('End of source.');
    click('Retry loading source');
    expect(input.onRetry).toHaveBeenCalledOnce();
  });

  it('keeps the editor in the identical child position when comparison closes and never renders hidden source', () => {
    const child = input.children;
    const openPath = pathTo(render(), child);
    click('Close comparison');
    expect(input.onClose).toHaveBeenCalledOnce();
    input = { ...input, open: false };
    const closed = render();
    expect(pathTo(closed, child)).toBe(openPath);
    expect(text(closed)).not.toContain('End of source.');
    expect(text(closed)).not.toContain('fever for three days');
    expect(elements(closed).some((item) => item.type === 'select')).toBe(false);
    input = { ...input, open: true };
    expect(pathTo(render(), child)).toBe(openPath);
  });

  it('labels applied note text separately from unsaved typing', () => {
    input = { ...input, editing: true };
    expect(text(render())).toContain('Applied note text');
    expect(text(render())).toContain(
      'Text being typed in the editor is not reflected here until you apply your corrections.',
    );
    expect(text(render())).not.toContain('Current note section');
  });

  it('discloses bounded location matching without truncating the saved transcript', () => {
    const transcript = Array.from({ length: 55 }, () => 'fever for three days').join('\n');
    input = { ...input, source: snapshot({ transcript }) };
    const view = render();
    expect(text(view)).toContain('Only the first 50 locations are listed.');
    expect(
      text(
        elements(view).find((item) => item.props['aria-label'] === 'Full saved transcript')!.props
          .children,
      ),
    ).toBe(transcript);
  });
});
