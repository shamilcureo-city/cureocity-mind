import * as React from 'react';
import { Children, isValidElement, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  request: vi.fn(),
  created: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.index++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (value: T) => {
        harness.states[index] = value;
      },
    ];
  },
}));
vi.mock('../components/ui/Field', () => ({
  Label: 'label',
  Select: 'select',
  Textarea: 'textarea',
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
import { CreateWorkflowForm } from '../components/app/CreateWorkflowForm';
import { EmdrPrerequisiteNotice } from '../components/app/WorkflowSection';

type ControlProps = {
  id?: string;
  value?: string;
  disabled?: boolean;
  children?: ReactNode;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};
function elements(node: ReactNode): ReactElement<ControlProps>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<ControlProps>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<ControlProps>(child) ? text(child.props.children) : String(child),
    )
    .join('');
}
function render() {
  harness.index = 0;
  return CreateWorkflowForm({ clientId: 'fictional-client', onCreated: harness.created });
}
function field(id: string) {
  const found = elements(render()).find((element) => element.props.id === id);
  expect(found, `Missing ${id}`).toBeDefined();
  return found!;
}

beforeEach(() => {
  harness.states = [];
  harness.index = 0;
  vi.resetAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', harness.request);
});
afterEach(() => vi.unstubAllGlobals());

describe('EMDR creation controls', () => {
  it('offers only history taking for new EMDR workflows and explains prior-care limits', () => {
    field('wf-modality').props.onChange!({ target: { value: 'EMDR' } });
    const phase = field('wf-phase');
    expect(phase.props.disabled).toBe(true);
    expect(phase.props.value).toBe('history_taking');
    expect(
      elements(phase)
        .filter((element) => element.type === 'option')
        .map((element) => element.props.value),
    ).toEqual(['history_taking']);
    expect(text(render())).toContain('Starting from prior care is not available yet');
    expect(text(render())).toContain('Existing workflows and session records remain available');
  });

  it('resets a previous CBT phase and submits only the canonical EMDR start', async () => {
    field('wf-phase').props.onChange!({ target: { value: 'cognitive_restructuring' } });
    field('wf-modality').props.onChange!({ target: { value: 'EMDR' } });
    field('wf-goals').props.onChange!({ target: { value: 'Fictional goal' } });
    harness.request.mockResolvedValue(Response.json({ id: 'fictional-workflow' }, { status: 201 }));
    const form = elements(render()).find((element) => element.type === 'form')!;
    await form.props.onSubmit!({
      preventDefault: vi.fn(),
    } as unknown as FormEvent<HTMLFormElement>);
    expect(JSON.parse(harness.request.mock.calls[0]![1].body)).toMatchObject({
      modality: 'EMDR',
      initialPhase: 'history_taking',
    });
    expect(harness.created).toHaveBeenCalledOnce();
  });

  it('keeps the existing CBT options when switching back', () => {
    field('wf-modality').props.onChange!({ target: { value: 'EMDR' } });
    field('wf-modality').props.onChange!({ target: { value: 'CBT' } });
    const phase = field('wf-phase');
    expect(phase.props.disabled).toBe(false);
    expect(phase.props.value).toBe('engagement_assessment');
    expect(elements(phase).filter((element) => element.type === 'option')).toHaveLength(5);
  });

  it('shows a rejected start without reporting creation', async () => {
    field('wf-modality').props.onChange!({ target: { value: 'EMDR' } });
    field('wf-goals').props.onChange!({ target: { value: 'Fictional goal' } });
    harness.request.mockResolvedValue(
      Response.json({ error: 'Start a new EMDR workflow at history taking.' }, { status: 422 }),
    );
    const form = elements(render()).find((element) => element.type === 'form')!;
    await form.props.onSubmit!({
      preventDefault: vi.fn(),
    } as unknown as FormEvent<HTMLFormElement>);
    expect(text(render())).toContain('Start a new EMDR workflow at history taking.');
    expect(harness.created).not.toHaveBeenCalled();
  });
});

describe('existing EMDR prerequisite notice', () => {
  it('flags missing recorded prerequisites without changing a historical record', () => {
    const state = Object.freeze({});
    const workflow = Object.freeze({
      modality: 'EMDR' as const,
      currentPhase: 'desensitization',
      state,
    });
    const message = text(EmdrPrerequisiteNotice({ workflow }));
    expect(message).toContain('This workflow needs prerequisite review');
    expect(message).toContain('not recorded');
    expect(message).toContain('does not establish what happened in earlier care');
    expect(message).toContain('Existing records are unchanged and remain available');
    expect(workflow.state).toEqual({});
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('flags unrecorded targets and malformed flags rather than treating them as confirmations', () => {
    expect(
      text(
        EmdrPrerequisiteNotice({
          workflow: {
            modality: 'EMDR',
            currentPhase: 'desensitization',
            state: { preparationComplete: true },
          },
        }),
      ),
    ).toContain('target memory is not recorded');
    expect(
      text(
        EmdrPrerequisiteNotice({
          workflow: {
            modality: 'EMDR',
            currentPhase: 'desensitization',
            state: { preparationComplete: 'false', hasTargets: 'true' },
          },
        }),
      ),
    ).toContain('Preparation completion is not recorded');
  });

  it('does not warn on satisfied prerequisites, an ungated phase, or CBT', () => {
    for (const workflow of [
      {
        modality: 'EMDR' as const,
        currentPhase: 'desensitization',
        state: { preparationComplete: true, hasTargets: true },
      },
      { modality: 'EMDR' as const, currentPhase: 'history_taking', state: {} },
      { modality: 'EMDR' as const, currentPhase: 'closure', state: {} },
      { modality: 'CBT' as const, currentPhase: 'cognitive_restructuring', state: {} },
    ])
      expect(EmdrPrerequisiteNotice({ workflow })).toBeNull();
  });
});
