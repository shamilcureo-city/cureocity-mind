import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCRIBE_BUILTIN_DOCTOR_TEMPLATES,
  renderScribeDocumentTemplate,
  type ScribeDoctorTemplate,
  type ScribeDoctorTemplateRecord,
} from './scribe-doctor-templates';
import { DEFAULT_SCRIBE_NOTE_STYLE } from './scribe-personalization-contracts';

const h = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  enabled: vi.fn(),
  reload: vi.fn(),
  records: [] as unknown[],
  loading: false,
  busy: false,
  error: null as string | null,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'document-template-picker',
  useState: <T>(initial: T) => {
    const index = h.index++;
    if (!(index in h.values)) h.values[index] = initial;
    return [
      h.values[index],
      (next: T) => {
        h.values[index] = next;
      },
    ];
  },
}));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('./use-scribe-doctor-templates', () => ({
  useScribeDoctorTemplates: (enabled: boolean) => {
    h.enabled(enabled);
    return {
      records: h.records,
      loading: h.loading,
      busy: h.busy,
      error: h.error,
      reload: h.reload,
    };
  },
}));
import { ScribeDocumentTemplatePicker } from '../components/app/ScribeDocumentTemplatePicker';

type Props = {
  children?: ReactNode;
  value?: string;
  disabled?: boolean;
  href?: string;
  role?: string;
  id?: string;
  htmlFor?: string;
  'aria-label'?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: () => void;
  onToggle?: (event: { currentTarget: { open: boolean } }) => void;
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
let props: Parameters<typeof ScribeDocumentTemplatePicker>[0];
function render() {
  h.index = 0;
  return ScribeDocumentTemplatePicker(props);
}
function open() {
  elements(render()).find((item) => item.type === 'details')!.props.onToggle!({
    currentTarget: { open: true },
  });
  return render();
}
function choose(value: string) {
  elements(render()).find((item) => item.type === 'select')!.props.onChange!({ target: { value } });
  return render();
}
function button(label: string) {
  const match = elements(render()).find(
    (item) => item.type === 'button' && text(item.props.children) === label,
  );
  expect(match, `Missing ${label}`).toBeDefined();
  return match!;
}
function starterKey(type: 'referral' | 'patient_summary' | 'medical_certificate') {
  return `starter-${SCRIBE_BUILTIN_DOCTOR_TEMPLATES.findIndex(
    (template) => template.kind === 'document_skeleton' && template.documentType === type,
  )}`;
}
function record(id: string, template: ScribeDoctorTemplate): ScribeDoctorTemplateRecord {
  return {
    id,
    revision: 1,
    clientId: null,
    sessionId: null,
    createdAt: '2026-09-26T10:00:00.000Z',
    updatedAt: '2026-09-26T10:00:00.000Z',
    body: {
      version: 1,
      operationId: '76e2c960-52eb-4996-8c7e-de63872a3170',
      createHash: 'a'.repeat(64),
      template,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.values = [];
  h.records = [];
  h.loading = false;
  h.busy = false;
  h.error = null;
  props = { documentType: 'referral', disabled: false, onAppend: vi.fn() };
  vi.stubGlobal('React', React);
});
afterEach(() => vi.unstubAllGlobals());

describe('document template picker', () => {
  it('loads private templates only after expansion and never automatically applies them', () => {
    expect(text(render())).toBe('Use a document template');
    expect(h.enabled).toHaveBeenLastCalledWith(false);
    expect(elements(render()).some((item) => item.type === 'select')).toBe(false);
    open();
    expect(h.enabled).toHaveBeenLastCalledWith(true);
    expect(props.onAppend).not.toHaveBeenCalled();
    expect(button('Append completion fields').props.disabled).toBe(true);
    elements(render()).find((item) => item.type === 'details')!.props.onToggle!({
      currentTarget: { open: false },
    });
    render();
    expect(h.enabled).toHaveBeenLastCalledWith(true);
  });

  it.each(['referral', 'patient_summary', 'medical_certificate'] as const)(
    'filters starter and private choices to %s document skeletons',
    (documentType) => {
      props = { ...props, documentType };
      h.records = [
        record('private-referral', {
          kind: 'document_skeleton',
          name: 'My referral',
          documentType: 'referral',
          prompts: ['recipient'],
        }),
        record('private-summary', {
          kind: 'document_skeleton',
          name: 'My summary',
          documentType: 'patient_summary',
          prompts: ['patient_questions'],
        }),
        record('private-certificate', {
          kind: 'document_skeleton',
          name: 'My certificate',
          documentType: 'medical_certificate',
          prompts: ['relevant_dates'],
        }),
        record('private-style', {
          kind: 'note_presentation',
          name: 'My note layout',
          style: DEFAULT_SCRIBE_NOTE_STYLE,
        }),
      ];
      const labels = elements(open())
        .filter((item) => item.type === 'option')
        .map((item) => text(item.props.children));
      expect(labels).toHaveLength(3);
      expect(labels[0]).toBe('Choose a template');
      expect(labels[1]).toContain('(starter)');
      expect(labels[2]).toBe(
        {
          referral: 'My referral',
          patient_summary: 'My summary',
          medical_certificate: 'My certificate',
        }[documentType],
      );
      expect(labels).not.toContain('My note layout');
    },
  );

  it('shows exact fixed blank fields in a labelled preview before explicit append', () => {
    const template = {
      kind: 'document_skeleton',
      name: 'My handover',
      documentType: 'referral',
      prompts: ['clinical_question', 'recipient'],
    } as const;
    const saved = { ...template, prompts: [...template.prompts] };
    h.records = [record('private-handover', saved)];
    open();
    const tree = choose('private-handover');
    const preview = elements(tree).find(
      (item) => item.props['aria-label'] === 'Template completion fields preview',
    );
    const expected = renderScribeDocumentTemplate(saved);
    expect(text(preview)).toContain(expected);
    expect(expected).toContain('[[Complete: Clinical question for the recipient]]');
    expect(props.onAppend).not.toHaveBeenCalled();
    expect(button('Append completion fields').props.disabled).toBe(false);
    button('Append completion fields').props.onClick!();
    expect(props.onAppend).toHaveBeenCalledExactlyOnceWith(expected);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('never appends a stale selection after changing document type', () => {
    open();
    choose(starterKey('referral'));
    props = { ...props, documentType: 'medical_certificate' };
    expect(button('Append completion fields').props.disabled).toBe(true);
    button('Append completion fields').props.onClick!();
    expect(props.onAppend).not.toHaveBeenCalled();
    expect(
      elements(render()).some(
        (item) => item.props['aria-label'] === 'Template completion fields preview',
      ),
    ).toBe(false);
  });

  it('requires a new choice if a selected private template disappears on explicit reload', () => {
    h.records = [
      record('private-referral', {
        kind: 'document_skeleton',
        name: 'My referral',
        documentType: 'referral',
        prompts: ['recipient'],
      }),
    ];
    open();
    choose('private-referral');
    button('Reload templates').props.onClick!();
    expect(h.reload).toHaveBeenCalledOnce();
    h.records = [];
    expect(button('Append completion fields').props.disabled).toBe(true);
    expect(props.onAppend).not.toHaveBeenCalled();
  });

  it('disables editing and appending when the document is not editable', () => {
    open();
    choose(starterKey('referral'));
    props = { ...props, disabled: true };
    expect(elements(render()).find((item) => item.type === 'select')!.props.disabled).toBe(true);
    expect(button('Append completion fields').props.disabled).toBe(true);
    button('Append completion fields').props.onClick!();
    expect(props.onAppend).not.toHaveBeenCalled();
  });

  it('disables picker changes and refresh during an active library mutation', () => {
    open();
    choose(starterKey('referral'));
    h.busy = true;
    expect(elements(render()).find((item) => item.type === 'select')!.props.disabled).toBe(true);
    expect(button('Append completion fields').props.disabled).toBe(true);
    expect(button('Reload templates').props.disabled).toBe(true);
  });

  it('keeps starters available while private templates are loading or unavailable', () => {
    h.loading = true;
    open();
    expect(text(render())).toContain('Loading your saved templates');
    expect(button('Reload templates').props.disabled).toBe(true);
    choose(starterKey('referral'));
    expect(button('Append completion fields').props.disabled).toBe(false);
    h.loading = false;
    h.error = 'Offline';
    expect(text(render())).toContain('Built-in starters remain available');
    expect(elements(render()).find((item) => item.props.role === 'alert')).toBeDefined();
    expect(button('Append completion fields').props.disabled).toBe(false);
  });

  it('has an explicit labelled selection, reload action and private-library destination', () => {
    open();
    const controls = elements(render());
    const select = controls.find((item) => item.type === 'select')!;
    expect(
      controls.some((item) => item.type === 'label' && item.props.htmlFor === select.props.id),
    ).toBe(true);
    const manage = controls.find(
      (item) => item.type === 'a' && text(item.props.children) === 'Manage my templates',
    )!;
    expect(manage.props.href).toBe('/app/clinic/templates');
    expect(text(render())).toContain('Existing wording stays unchanged');
    expect(h.reload).not.toHaveBeenCalled();
    button('Reload templates').props.onClick!();
    expect(h.reload).toHaveBeenCalledOnce();
    expect(props.onAppend).not.toHaveBeenCalled();
  });
});
