import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  SCRIBE_BUILTIN_DOCTOR_TEMPLATES,
  ScribeDoctorTemplateRecordSchema,
  type ScribeDoctorTemplate,
  type ScribeDoctorTemplateRecord,
} from './scribe-doctor-templates';
import {
  DEFAULT_SCRIBE_NOTE_STYLE,
  type ScribeNoteStyle,
} from './scribe-personalization-contracts';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  idIndex: 0,
  guard: vi.fn(),
  confirm: vi.fn(),
  templates: undefined as unknown,
  enabled: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = h.stateIndex++;
    if (!(index in h.states))
      h.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[index],
      (value: T | ((old: T) => T)) => {
        h.states[index] =
          typeof value === 'function' ? (value as (old: T) => T)(h.states[index] as T) : value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current });
  },
  useId: () => `templates-${h.idIndex++}`,
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = h.effectIndex++,
      previous = h.effects[index];
    if (!previous || !deps || deps.some((value, i) => value !== previous.deps?.[i]))
      h.queued.push(() => {
        previous?.cleanup?.();
        h.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
vi.mock('@/lib/use-unsaved-work-guard', () => ({ useUnsavedWorkGuard: h.guard }));
vi.mock('@/lib/use-scribe-doctor-templates', () => ({
  useScribeDoctorTemplates: (enabled: boolean) => {
    h.enabled(enabled);
    return h.templates;
  },
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
import {
  ScribeDoctorTemplatesPanel,
  ScribeNoteStyleProfileEditor,
} from '../components/app/ScribeDoctorTemplatesPanel';
import { ScribeNoteStyleSettings } from '../components/app/ScribeNoteStyleSettings';

type Props = {
  children?: ReactNode;
  id?: string;
  type?: string;
  value?: string | number;
  checked?: boolean;
  disabled?: boolean;
  open?: boolean;
  href?: string;
  target?: string;
  rel?: string;
  role?: string;
  'aria-label'?: string;
  onClick?: () => void;
  onChange?: (event: { target: { value: string; checked?: boolean } }) => void;
  onToggle?: (event: { currentTarget: { open: boolean } }) => void;
};
function expanded(node: ReactElement<Props>): ReactNode {
  return node.type === ScribeNoteStyleProfileEditor
    ? ScribeNoteStyleProfileEditor(
        node.props as unknown as Parameters<typeof ScribeNoteStyleProfileEditor>[0],
      )
    : node.props.children;
}
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(expanded(child))] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(expanded(child)) : String(child)))
    .join('');
}
let input: Parameters<typeof ScribeDoctorTemplatesPanel>[0];
let styleInput: Parameters<typeof ScribeNoteStyleSettings>[0];
let mode: 'library' | 'style';
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = h.idIndex = 0;
  const result =
    mode === 'library' ? ScribeDoctorTemplatesPanel(input) : ScribeNoteStyleSettings(styleInput);
  h.queued.splice(0).forEach((run) => run());
  return result;
}
function button(label: string) {
  const node = elements(render()).find(
    (item) =>
      item.type === 'button' && (text(item) === label || item.props['aria-label'] === label),
  );
  expect(node, `Missing action ${label}`).toBeDefined();
  return node!;
}
function click(label: string) {
  const node = button(label);
  expect(node.props.disabled).toBeFalsy();
  node.props.onClick!();
}
function field(suffix: string) {
  const node = elements(render()).find((item) => item.props.id === `templates-0-${suffix}`);
  expect(node, `Missing field ${suffix}`).toBeDefined();
  return node!;
}
function change(suffix: string, value: string) {
  field(suffix).props.onChange!({ target: { value } });
}
function acknowledge() {
  const control = elements(render())
    .filter((item) => item.type === 'input' && item.props.type === 'checkbox')
    .at(-1)!;
  control.props.onChange!({ target: { value: '', checked: true } });
}
function openStyle() {
  mode = 'style';
  elements(render()).find((item) => item.type === 'details')!.props.onToggle!({
    currentTarget: { open: true },
  });
  render();
}
async function settle() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
  render();
}
function template(index = 0): ScribeDoctorTemplate {
  return structuredClone(SCRIBE_BUILTIN_DOCTOR_TEMPLATES[index]);
}
function record(body = template(), id = 'template-1', revision = 1): ScribeDoctorTemplateRecord {
  return ScribeDoctorTemplateRecordSchema.parse({
    id,
    revision,
    body: {
      version: 1,
      operationId: '00000000-0000-4000-8000-000000000001',
      createHash: 'a'.repeat(64),
      template: body,
    },
    clientId: null,
    sessionId: null,
    createdAt: '2026-09-26T10:00:00.000Z',
    updatedAt: '2026-09-26T10:00:00.000Z',
  });
}
function openRecord(name = 'OPD consultation') {
  click(`${name}Note presentation`);
}
function confirmedSave() {
  input.settings.save = vi.fn<typeof input.settings.save>(async (body, existing) => {
    const saved = record(body, existing?.id ?? 'created-template', (existing?.revision ?? 0) + 1);
    input.settings.records = [
      ...input.settings.records.filter((item) => item.id !== saved.id),
      saved,
    ];
    return saved;
  });
}
beforeEach(() => {
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.queued = [];
  h.guard.mockReset();
  h.confirm.mockReset().mockReturnValue(false);
  h.enabled.mockReset();
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', { confirm: h.confirm });
  mode = 'library';
  input = {
    settings: {
      records: [],
      loaded: true,
      loading: false,
      busy: false,
      error: null,
      reload: vi.fn(async () => {}),
      save: vi.fn(async () => null),
      remove: vi.fn(async () => false),
    },
    onWorkChange: vi.fn(),
  };
  h.templates = input.settings;
  styleInput = {
    settings: {
      style: structuredClone(DEFAULT_SCRIBE_NOTE_STYLE),
      revision: 0,
      loaded: true,
      busy: false,
      error: null,
      reload: vi.fn(async () => {}),
      save: vi.fn(async () => false),
    },
    followUp: false,
  };
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('personal doctor template library', () => {
  it('shows built-in starting points without automatically creating or applying anything', () => {
    expect(elements(render()).filter((item) => item.type === 'option')).toHaveLength(5);
    expect(text(render())).toContain('Never include patient details');
    expect(text(render())).toContain('not applied automatically');
    expect(text(render())).not.toContain('Templates contain no patient facts');
    expect(input.settings.save).not.toHaveBeenCalled();
  });
  it('requires an explicit no-patient-details acknowledgement and confirmed save', async () => {
    confirmedSave();
    click('Create from starting point');
    expect(button('Save personal template').props.disabled).toBe(true);
    change('name', 'My OPD presentation');
    acknowledge();
    click('Save personal template');
    await settle();
    expect(input.settings.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My OPD presentation', kind: 'note_presentation' }),
      undefined,
    );
    expect(text(render())).toContain('has not been applied to a note or document');
    expect(input.onWorkChange).toHaveBeenLastCalledWith(false);
  });
  it('retains every note field while changing labels, order and density', () => {
    click('Create from starting point');
    change('note-hpi', 'History in my clinic');
    change('note-density', 'concise');
    click('Move History of present illness up');
    const headings = elements(render()).filter(
      (item) => item.type === 'input' && item.props.id?.startsWith('templates-0-note-'),
    );
    expect(headings).toHaveLength(7);
    expect(headings[0].props.value).toBe('History in my clinic');
    expect(field('note-density').props.value).toBe('concise');
    expect(text(render())).toContain('source evidence remain unchanged');
    expect(input.settings.save).not.toHaveBeenCalled();
  });
  it('preserves both visit-profile previews when switching between them', () => {
    click('Create from starting point');
    change('note-hpi', 'First visit history');
    change('note-profile', 'followUp');
    change('note-hpi', 'Interval history');
    change('note-profile', 'firstVisit');
    expect(field('note-hpi').props.value).toBe('First visit history');
    change('note-profile', 'followUp');
    expect(field('note-hpi').props.value).toBe('Interval history');
  });
  it('resets acknowledgement after any template edit', () => {
    click('Create from starting point');
    acknowledge();
    expect(button('Save personal template').props.disabled).toBe(false);
    change('name', 'Another name');
    expect(button('Save personal template').props.disabled).toBe(true);
  });
  it('uses only fixed document prompts with explicit unfinished placeholders', () => {
    change('starter', '2');
    click('Create from starting point');
    expect(text(render())).toContain('[[Complete:');
    expect(elements(render()).some((item) => item.type === 'textarea')).toBe(false);
    expect(text(render())).toContain('enter patient details only in the encounter document');
    click('Move Referral recipient down');
    const preview = elements(render()).find(
      (item) => item.props['aria-label'] === 'Document prompt preview',
    )!;
    expect(text(preview).indexOf('Reason for referral')).toBeLessThan(
      text(preview).indexOf('Referral recipient'),
    );
  });
  it('does not crash the prompt preview while the template name is temporarily blank', () => {
    change('starter', '2');
    click('Create from starting point');
    change('name', '');
    expect(text(render())).toContain('[[Complete:');
    acknowledge();
    click('Save personal template');
    expect(input.settings.save).not.toHaveBeenCalled();
    expect(text(render())).toContain('Enter a template name');
  });
  it.each(['reject', 'null'] as const)(
    'retains unsaved template changes after %s save',
    async (kind) => {
      input.settings.save =
        kind === 'reject'
          ? vi.fn(async () => {
              throw new Error('network');
            })
          : vi.fn(async () => null);
      click('Create from starting point');
      change('name', 'Keep my template');
      acknowledge();
      click('Save personal template');
      await settle();
      expect(field('name').props.value).toBe('Keep my template');
      expect(text(render())).toContain('still here');
      expect(input.onWorkChange).toHaveBeenLastCalledWith(true);
    },
  );
  it('confirms an ambiguous create replay using the returned newer saved version, without another creation', async () => {
    input.settings.save = vi.fn(async () => {
      const next = record({ ...template(), name: 'Newer saved template' }, 'created-template', 3);
      input.settings.records = [next];
      return next;
    });
    click('Create from starting point');
    acknowledge();
    click('Save personal template');
    await settle();
    expect(field('name').props.value).toBe('Newer saved template');
    expect(text(render())).toContain('newer saved version was returned');
    expect(input.settings.save).toHaveBeenCalledOnce();
  });
  it('duplicates a saved template as a new unsaved draft', () => {
    input.settings.records = [record()];
    openRecord();
    click('Duplicate saved template');
    expect(field('name').props.value).toBe('OPD consultation copy');
    expect(text(render())).toContain('New personal template');
    expect(input.settings.save).not.toHaveBeenCalled();
    expect(button('Save personal template').props.disabled).toBe(true);
  });
  it('requires confirmation before deleting and waits for server success', async () => {
    input.settings.records = [record()];
    openRecord();
    click('Delete saved template');
    expect(input.settings.remove).not.toHaveBeenCalled();
    h.confirm.mockReturnValue(true);
    input.settings.remove = vi.fn(async () => {
      input.settings.records = [];
      return true;
    });
    click('Delete saved template');
    await settle();
    expect(input.settings.remove).toHaveBeenCalledOnce();
    expect(text(render())).toContain('Existing notes and document drafts are unchanged');
  });
  it('does not discard dirty edits when a different template is selected without confirmation', () => {
    input.settings.records = [record(), record({ ...template(), name: 'Second' }, 'template-2')];
    openRecord();
    change('name', 'Unsaved clinic style');
    click('SecondNote presentation');
    expect(field('name').props.value).toBe('Unsaved clinic style');
    h.confirm.mockReturnValue(true);
    click('SecondNote presentation');
    expect(field('name').props.value).toBe('Second');
  });
  it('preserves dirty edits on refresh and blocks overwriting a newer revision', () => {
    input.settings.records = [record()];
    openRecord();
    change('name', 'Local changes');
    input.settings.records = [record({ ...template(), name: 'Remote changed' }, 'template-1', 2)];
    expect(field('name').props.value).toBe('Local changes');
    expect(text(render())).toContain('changed elsewhere');
    acknowledge();
    expect(button('Save personal template').props.disabled).toBe(true);
    click('Reload templates');
    expect(input.settings.reload).not.toHaveBeenCalled();
  });
  it('permits retry after an initial library load failure', () => {
    input.settings.loaded = false;
    input.settings.error = 'Could not load templates';
    click('Reload templates');
    expect(input.settings.reload).toHaveBeenCalledOnce();
    expect(button('Create from starting point').props.disabled).toBe(true);
  });
  it('hides and clears private draft data when the hook loses its loaded scope', () => {
    click('Create from starting point');
    change('name', 'Private template name');
    input.settings.loaded = false;
    input.settings.records = [];
    expect(text(render())).not.toContain('Private template name');
    expect(elements(render()).some((item) => item.props.id === 'templates-0-name')).toBe(false);
    input.settings.loaded = true;
    expect(elements(render()).some((item) => item.props.id === 'templates-0-name')).toBe(false);
  });
  it('does not send two saves while acknowledgement is pending', async () => {
    type Result = Awaited<ReturnType<typeof input.settings.save>>;
    let resolve!: (value: Result) => void;
    input.settings.save = vi.fn<typeof input.settings.save>(
      () =>
        new Promise<Result>((done) => {
          resolve = done;
        }),
    );
    click('Create from starting point');
    acknowledge();
    const action = button('Save personal template').props.onClick!;
    action();
    action();
    expect(input.settings.save).toHaveBeenCalledOnce();
    expect(button('Saving template…').props.disabled).toBe(true);
    resolve(null);
    await settle();
  });
});

describe('named template note-style integration', () => {
  it('loads template records only when style details are opened', () => {
    mode = 'style';
    render();
    expect(h.enabled).toHaveBeenLastCalledWith(false);
    openStyle();
    expect(h.enabled).toHaveBeenLastCalledWith(true);
  });
  it('loads a named note template into local preview only until explicit style save', async () => {
    const named = template(1);
    input.settings.records = [record(named), record(template(2), 'doc-template')];
    openStyle();
    change('template', 'template-1');
    click('Load template into preview');
    expect(styleInput.settings.save).not.toHaveBeenCalled();
    expect(text(render())).toContain('local presentation preview only');
    expect(
      elements(render()).filter(
        (item) => item.type === 'option' && text(item).includes('Referral'),
      ),
    ).toHaveLength(0);
    styleInput.settings.save = vi.fn(async (style: ScribeNoteStyle) => {
      styleInput.settings.style = style;
      styleInput.settings.revision++;
      return true;
    });
    click('Save my note style');
    await settle();
    expect(styleInput.settings.save).toHaveBeenCalledWith(
      named.kind === 'note_presentation' ? named.style : undefined,
    );
    expect(text(render())).toContain('Clinical text and source evidence are unchanged');
  });
  it('preserves dirty previews when closing details or reloading is cancelled', () => {
    openStyle();
    change('style-hpi', 'Unsaved heading');
    const target = { open: false };
    elements(render()).find((item) => item.type === 'details')!.props.onToggle!({
      currentTarget: target,
    });
    expect(target.open).toBe(true);
    expect(field('style-hpi').props.value).toBe('Unsaved heading');
    click('Reload saved style');
    expect(styleInput.settings.reload).not.toHaveBeenCalled();
    expect(field('style-hpi').props.value).toBe('Unsaved heading');
  });
  it('does not lose either visit profile when switching the preview tab', () => {
    openStyle();
    change('style-hpi', 'First preview');
    change('style-profile', 'followUp');
    change('style-hpi', 'Follow-up preview');
    change('style-profile', 'firstVisit');
    expect(field('style-hpi').props.value).toBe('First preview');
    change('style-profile', 'followUp');
    expect(field('style-hpi').props.value).toBe('Follow-up preview');
  });
  it('keeps a failed-save preview open and retryable', async () => {
    openStyle();
    change('style-hpi', 'Retained heading');
    click('Save my note style');
    await settle();
    expect(field('style-hpi').props.value).toBe('Retained heading');
    expect(text(render())).toContain('preview is still here');
    expect(button('Save my note style').props.disabled).toBe(false);
  });
  it('does not replace an edited preview when a saved-style refresh arrives', () => {
    openStyle();
    change('style-hpi', 'My local heading');
    const next = structuredClone(DEFAULT_SCRIBE_NOTE_STYLE);
    next.firstVisit.labels.hpi = 'Changed elsewhere';
    styleInput.settings.style = next;
    expect(field('style-hpi').props.value).toBe('My local heading');
    expect(text(render())).toContain('saved style changed');
    expect(button('Save my note style').props.disabled).toBe(true);
  });
  it('links to the private template manager and does not auto-apply on template selection', () => {
    input.settings.records = [record(template(1))];
    openStyle();
    change('template', 'template-1');
    expect(field('style-hpi').props.value).toBe(DEFAULT_SCRIBE_NOTE_STYLE.firstVisit.labels.hpi);
    expect(styleInput.settings.save).not.toHaveBeenCalled();
    expect(elements(render()).find((item) => item.type === 'a')!.props.href).toBe(
      '/app/clinic/templates',
    );
    expect(elements(render()).find((item) => item.type === 'a')!.props.target).toBe('_blank');
    expect(elements(render()).find((item) => item.type === 'a')!.props.rel).toBe(
      'noopener noreferrer',
    );
  });
});
