import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { MedicalEncounterNoteV1, RxPadDraft } from '@cureocity/contracts';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import { DEFAULT_SCRIBE_NOTE_STYLE } from './scribe-personalization-contracts';

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  save: vi.fn(),
  remove: vi.fn(),
  change: vi.fn(),
  records: [] as unknown[],
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: () => {},
  useState: <T>(initial: T) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [
      state.values[index],
      (next: T) => {
        state.values[index] = next;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = state.refIndex++;
    return state.refs[index] ?? (state.refs[index] = { current });
  },
}));
vi.mock('./use-scribe-personalization', () => ({
  useScribeShortcuts: () => ({
    records: state.records,
    error: null,
    loaded: true,
    busy: false,
    save: state.save,
    remove: state.remove,
  }),
  useScribeNoteStyle: () => ({
    style: {
      ...DEFAULT_SCRIBE_NOTE_STYLE,
      followUp: {
        ...DEFAULT_SCRIBE_NOTE_STYLE.followUp,
        order: [...DEFAULT_SCRIBE_NOTE_STYLE.followUp.order].reverse(),
        labels: { ...DEFAULT_SCRIBE_NOTE_STYLE.followUp.labels, hpi: 'Interval history' },
      },
    },
  }),
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
import { ScribeNoteTools } from '../components/app/ScribeNoteTools';
import { MedicalNoteView } from '../components/app/MedicalNoteView';
import { ScribeFavorites } from '../components/app/ScribeFavorites';

type Props = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  onKeyDown?: (event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    preventDefault: () => void;
  }) => void;
  placeholder?: string;
  disabled?: boolean;
  value?: string;
  label?: string;
  evidence?: unknown[];
  onToggle?: (event: { currentTarget: { open: boolean } }) => void;
};
function elements(node: ReactNode): Array<ReactElement<Props>> {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
}
let draft = { chiefComplaint: '', hpi: 'Initial wording', assessment: '', plan: '' };
function render() {
  state.index = 0;
  state.refIndex = 0;
  return ScribeNoteTools({ draft, onChange: state.change, editorRef: { current: null } });
}
function button(label: string) {
  return elements(render()).find(
    (item) => item.type === 'button' && text(item.props.children) === label,
  )!;
}
function command(value: string) {
  const input = elements(render()).find((item) => item.props.placeholder?.includes('old wording'))!;
  input.props.onChange!({ target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.values = [];
  state.refs = [];
  state.records = [];
  draft = { chiefComplaint: '', hpi: 'Initial wording', assessment: '', plan: '' };
  state.change.mockImplementation((field: keyof typeof draft, value: string) => {
    draft = { ...draft, [field]: value };
  });
  vi.stubGlobal('React', React);
});
afterEach(() => vi.unstubAllGlobals());

describe('quick note correction UI', () => {
  it('keyboard preview does not mutate until confirmation, and undo restores the original', () => {
    command('replace "Initial" with "Corrected"');
    elements(render()).find((item) => item.props.placeholder?.includes('old wording'))!.props
      .onKeyDown!({ key: 'Enter', ctrlKey: true, metaKey: false, preventDefault: vi.fn() });
    expect(text(render())).toContain('Corrected wording');
    expect(state.change).not.toHaveBeenCalled();
    button('Confirm correction').props.onClick!();
    expect(draft.hpi).toBe('Corrected wording');
    button('Undo last quick correction').props.onClick!();
    expect(draft.hpi).toBe('Initial wording');
    expect(state.save).not.toHaveBeenCalled();
  });
  it('disables a stale preview and stale undo after later manual edits', () => {
    command('append: Added');
    button('Preview correction').props.onClick!();
    draft.hpi = 'Later manual edit';
    expect(button('Confirm correction').props.disabled).toBe(true);
    command('append: Added');
    button('Preview correction').props.onClick!();
    button('Confirm correction').props.onClick!();
    draft.hpi += '\nAnother edit';
    expect(button('Undo last quick correction').props.disabled).toBe(true);
  });
  it('inserting a saved phrase requires the same before/after confirmation', () => {
    state.records = [
      {
        id: 'phrase-1',
        revision: 1,
        body: { type: 'phrase', title: 'Review wording', field: 'hpi', text: 'Concerns reviewed.' },
      },
    ];
    button('Preview insertion').props.onClick!();
    expect(state.change).not.toHaveBeenCalled();
    expect(text(render())).toContain('Initial wording\nConcerns reviewed.');
    button('Confirm correction').props.onClick!();
    expect(draft.hpi).toBe('Initial wording\nConcerns reviewed.');
  });
});

describe('favorite confirmation UI', () => {
  it('edits and deletes a saved set only after explicit confirmation with its revision', async () => {
    const record = {
      id: 'set-1',
      revision: 4,
      body: {
        type: 'set',
        title: 'Review set',
        items: [
          { type: 'investigation', title: 'Example test', name: 'Example test' },
          { type: 'advice', title: 'Review', text: 'Review results with the doctor.' },
        ],
      },
    };
    state.records = [record];
    state.save.mockResolvedValue(true);
    state.remove.mockResolvedValue(true);
    const apply = vi.fn();
    function favorites() {
      state.index = 0;
      state.refIndex = 0;
      return ScribeFavorites({ pad: null, seed: null, disabled: false, onApply: apply });
    }
    const favoriteButton = (label: string) =>
      elements(favorites()).find(
        (item) => item.type === 'button' && text(item.props.children) === label,
      )!;
    elements(favorites()).find((item) => item.type === 'details')!.props.onToggle!({
      currentTarget: { open: true },
    });
    favoriteButton('Edit favorite').props.onClick!();
    elements(favorites()).find(
      (item) => item.type === 'input' && item.props.value === 'Review set',
    )!.props.onChange!({ target: { value: 'Investigation set' } });
    favoriteButton('Remove item 2').props.onClick!();
    expect(state.save).not.toHaveBeenCalled();
    favoriteButton('Confirm & save favorite').props.onClick!();
    await Promise.resolve();
    expect(state.save).toHaveBeenCalledWith(
      { ...record.body, title: 'Investigation set', items: [record.body.items[0]] },
      record,
    );
    expect(apply).not.toHaveBeenCalled();
    favoriteButton('Delete').props.onClick!();
    expect(state.remove).not.toHaveBeenCalled();
    favoriteButton('Delete favorite').props.onClick!();
    await Promise.resolve();
    expect(state.remove).toHaveBeenCalledWith(record);
    expect(apply).not.toHaveBeenCalled();
  });
  it('applies a reviewed set in one batch and rejects duplicate confirmed medicine', async () => {
    state.records = [
      {
        id: 'set-1',
        revision: 1,
        body: {
          type: 'set',
          title: 'Example set',
          items: [
            { type: 'medication', title: 'Example', med: { drug: 'Example drug' } },
            { type: 'investigation', title: 'Example test', name: 'Example test' },
          ],
        },
      },
    ];
    const apply = vi.fn().mockResolvedValue(true);
    let pad: RxPadDraft | null = null;
    function favorites() {
      state.index = 0;
      state.refIndex = 0;
      return ScribeFavorites({ pad, seed: null, disabled: false, onApply: apply });
    }
    const favoriteButton = (label: string) =>
      elements(favorites()).find(
        (item) => item.type === 'button' && text(item.props.children) === label,
      )!;
    elements(favorites()).find((item) => item.type === 'details')!.props.onToggle!({
      currentTarget: { open: true },
    });
    favoriteButton('Preview').props.onClick!();
    expect(apply).not.toHaveBeenCalled();
    expect(text(favorites())).toContain('pending confirmation');
    favoriteButton('Confirm & add to draft').props.onClick!();
    await Promise.resolve();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith([
      { op: 'addMed', source: 'manual', med: { drug: 'Example drug' } },
      { op: 'unconfirmMed', drug: 'Example drug' },
      { op: 'addInvestigation', source: 'manual', name: 'Example test' },
    ]);
    pad = {
      meds: [
        {
          drug: 'Example drug',
          status: 'confirmed',
          source: 'manual',
          continued: false,
          warnings: [],
        },
      ],
    };
    favoriteButton('Preview').props.onClick!();
    expect(text(favorites())).toContain('already on the plan');
    expect(apply).toHaveBeenCalledOnce();
  });
  it('previews without changing the plan and submits at most once while confirmation is pending', async () => {
    state.records = [
      {
        id: 'med-1',
        revision: 1,
        body: { type: 'medication', title: 'Example', med: { drug: 'Example drug' } },
      },
    ];
    let finish!: (ok: boolean) => void;
    const apply = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    let pad: RxPadDraft | null = null;
    function favorites() {
      state.index = 0;
      state.refIndex = 0;
      return ScribeFavorites({ pad, seed: null, disabled: false, onApply: apply });
    }
    const favoriteButton = (label: string) =>
      elements(favorites()).find(
        (item) => item.type === 'button' && text(item.props.children) === label,
      )!;
    elements(favorites()).find((item) => item.type === 'details')!.props.onToggle!({
      currentTarget: { open: true },
    });
    favoriteButton('Preview').props.onClick!();
    expect(apply).not.toHaveBeenCalled();
    pad = { adviceLines: ['Another manual change'] };
    expect(favoriteButton('Confirm & add to draft').props.disabled).toBe(true);
    favoriteButton('Preview').props.onClick!();
    const confirm = favoriteButton('Confirm & add to draft').props.onClick!;
    confirm();
    confirm();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0]).toEqual([
      [
        { op: 'addMed', source: 'manual', med: { drug: 'Example drug' } },
        { op: 'unconfirmMed', drug: 'Example drug' },
      ],
    ]);
    finish(true);
    await Promise.resolve();
  });
});

describe('personalized note rendering', () => {
  it('keeps all seven empty sections and their field-linked evidence visible', () => {
    const note = MedicalEncounterNoteV1Schema.parse({
      version: 'V1',
      linkedEvidence: [
        { field: 'reviewOfSystems', quote: 'ROS source without a recorded field' },
        { field: 'vitals', quote: 'Vitals source without a recorded value' },
      ],
    });
    const view = MedicalNoteView({ note });
    const sections = elements(view).filter((item) => item.props.label);
    expect(sections).toHaveLength(7);
    expect(
      sections.find((item) => item.props.label === 'Review of systems')!.props.evidence,
    ).toEqual([note.linkedEvidence[0]]);
    expect(sections.find((item) => item.props.label === 'Vitals')!.props.evidence).toEqual([
      note.linkedEvidence[1],
    ]);
    expect(text(sections.find((item) => item.props.label === 'Vitals')!)).toContain(
      'Not recorded.',
    );
    expect(text(sections.find((item) => item.props.label === 'Review of systems')!)).toContain(
      'Not recorded.',
    );
  });
  it.each([
    { bpSystolic: 120, expected: 'BP systolic 120' },
    { bpDiastolic: 80, expected: 'BP diastolic 80' },
  ])(
    'retains partial BP without inventing its missing counterpart: %j',
    ({ expected, ...vitals }) => {
      const note = MedicalEncounterNoteV1Schema.parse({ version: 'V1', vitals });
      expect(text(MedicalNoteView({ note }))).toContain(expected);
      expect(text(MedicalNoteView({ note }))).not.toContain('120/80');
    },
  );
  it('displays recorded zero vital values rather than treating them as absent', () => {
    const note = MedicalEncounterNoteV1Schema.parse({
      version: 'V1',
      vitals: { tempCelsius: 0, spo2Pct: 0 },
    });
    const view = MedicalNoteView({ note });
    expect(text(view)).toContain('Temp 0°C');
    expect(text(view)).toContain('SpO₂ 0%');
  });
  it('uses follow-up heading order without changing note content, exam guard or evidence', () => {
    const note: MedicalEncounterNoteV1 = {
      version: 'V1',
      encounterKind: 'FOLLOW_UP',
      chiefComplaint: 'Review',
      hpi: 'Original history.',
      assessment: 'Original assessment.',
      plan: 'Original plan.',
      physicalExam: { examined: false, findings: '' },
      vitals: { heartRateBpm: 80 },
      reviewOfSystems: ['No new concerns'],
      linkedEvidence: [{ field: 'hpi', quote: 'Original history.', startMs: 1000 }],
    };
    const view = MedicalNoteView({ note });
    const sections = elements(view).filter((item) => item.props.label);
    expect(sections.map((item) => item.props.label)).toEqual([
      'Plan',
      'Assessment',
      'Vitals',
      'Physical exam',
      'Review of systems',
      'Interval history',
      'Chief complaint',
    ]);
    expect(
      sections.find((item) => item.props.label === 'Interval history')!.props.evidence,
    ).toEqual(note.linkedEvidence);
    expect(text(view)).toContain('Original history.');
    expect(text(view)).toContain('Not examined this encounter.');
    expect(note.physicalExam.examined).toBe(false);
  });
});
