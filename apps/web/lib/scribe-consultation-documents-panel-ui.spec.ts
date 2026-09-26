import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  ScribeConsultationDocumentsResponseSchema,
  type ScribeConsultationDocument,
  type ScribeConsultationDocumentPacket,
  type ScribeConsultationDocumentsResponse,
  type ScribeConsultationDocumentType,
} from './scribe-consultation-documents';

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
  confirm: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (value: T | ((previous: T) => T)) => {
        harness.states[index] =
          typeof value === 'function'
            ? (value as (previous: T) => T)(harness.states[index] as T)
            : value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
  useId: () => `documents-${harness.idIndex++}`,
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
vi.mock('../components/app/ScribeDocumentTemplatePicker', () => ({
  ScribeDocumentTemplatePicker: 'document-template-picker',
}));
import { ScribeConsultationDocumentsPanel } from '../components/app/ScribeConsultationDocumentsPanel';

type Props = {
  children?: ReactNode;
  id?: string;
  type?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  role?: string;
  'aria-label'?: string;
  onClick?: () => void;
  onChange?: (event: { target: { value: string; checked?: boolean } }) => void;
  onAppend?: (text: string) => void;
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
let input: Parameters<typeof ScribeConsultationDocumentsPanel>[0];
function render() {
  harness.stateIndex = harness.refIndex = harness.effectIndex = harness.idIndex = 0;
  const result = ScribeConsultationDocumentsPanel(input);
  harness.queued.splice(0).forEach((run) => run());
  return result;
}
function button(label: string) {
  const result = elements(render()).find(
    (item) => item.type === 'button' && text(item.props.children) === label,
  );
  expect(result, `Missing action ${label}`).toBeDefined();
  return result!;
}
function click(label: string) {
  const result = button(label);
  expect(result.props.disabled).toBeFalsy();
  result.props.onClick!();
}
function field(name: string) {
  const result = elements(render()).find((item) => item.props.id === `documents-0-${name}`);
  expect(result, `Missing field ${name}`).toBeDefined();
  return result!;
}
function edit(value: string) {
  field('additions').props.onChange!({ target: { value } });
}
function acknowledge() {
  const control = elements(render())
    .filter((item) => item.type === 'input' && item.props.type === 'checkbox')
    .at(-1)!;
  expect(control.props.disabled).toBeFalsy();
  control.props.onChange!({ target: { value: '', checked: true } });
}
async function settle() {
  for (let n = 0; n < 6; n++) await Promise.resolve();
  render();
}
const hash = 'a'.repeat(64),
  otherHash = 'b'.repeat(64),
  signedAt = '2026-09-26T10:00:00.000Z';
const allTypes: ScribeConsultationDocumentType[] = [
  'referral',
  'patient_summary',
  'medical_certificate',
];
function document(
  type: ScribeConsultationDocumentType,
  status: 'draft' | 'reviewed' = 'draft',
): ScribeConsultationDocument {
  return {
    id: type,
    type,
    sourceSections: [{ label: 'Assessment', text: `Fictional signed-source text for ${type}.` }],
    additions: '',
    status,
    reviewedAt: status === 'reviewed' ? signedAt : null,
    reviewedBy: status === 'reviewed' ? 'doctor-1' : null,
  };
}
function packet(
  id = 'packet-1',
  types = allTypes,
  status: 'draft' | 'reviewed' = 'draft',
): ScribeConsultationDocumentPacket {
  return {
    id,
    revision: 1,
    body: {
      version: 1,
      operationId: '00000000-0000-4000-8000-000000000001',
      sourceHash: hash,
      noteId: 'note-1',
      signedAt,
      requestHash: hash,
      documents: types.map((type) => document(type, status)),
    },
    clientId: 'client-1',
    sessionId: 'session-1',
    createdAt: signedAt,
    updatedAt: signedAt,
    sourceCurrent: true,
  };
}
function response(
  packets: ScribeConsultationDocumentPacket[] = [packet()],
): ScribeConsultationDocumentsResponse {
  return ScribeConsultationDocumentsResponseSchema.parse({
    source: { state: 'ready', hash, noteId: 'note-1', signedAt },
    packets,
  });
}
function confirmedSave() {
  input.onSave = vi.fn<typeof input.onSave>(
    async (packetId, revision, documentId, additions, reviewed) => {
      const next = structuredClone(input.state!);
      const saved = next.packets.find((item) => item.id === packetId)!;
      saved.revision = revision + 1;
      const doc = saved.body.documents.find((item) => item.id === documentId)!;
      Object.assign(doc, {
        additions,
        status: reviewed ? 'reviewed' : 'draft',
        reviewedAt: reviewed ? signedAt : null,
        reviewedBy: reviewed ? 'doctor-1' : null,
      });
      input = { ...input, state: next };
      return next;
    },
  );
}
beforeEach(() => {
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.queued = [];
  harness.guard.mockReset();
  harness.confirm.mockReset().mockReturnValue(false);
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', { confirm: harness.confirm });
  input = {
    state: response(),
    loading: false,
    busy: false,
    error: null,
    onReload: vi.fn(),
    onCreate: vi.fn(async () => null),
    onSave: vi.fn(async () => null),
    onDownload: vi.fn(async () => true),
    onWorkChange: vi.fn(),
  };
});
afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('Scribe consultation document panel', () => {
  it('defaults to all three draft types and never implies issuance or sharing', () => {
    const view = render();
    expect(
      elements(view)
        .filter((item) => item.type === 'input' && item.props.type === 'checkbox')
        .slice(0, 3)
        .map((item) => item.props.checked),
    ).toEqual([true, true, true]);
    expect(text(view)).toContain('Nothing is issued, signed or shared here.');
    expect(text(view)).toContain('Draft — not issued');
    expect(button('Download reviewed draft').props.disabled).toBe(true);
  });
  it.each(['unsigned', 'unavailable'] as const)(
    'explains %s source and retains owned document history as read-only',
    (state) => {
      const history = response([packet('packet-1', allTypes, 'reviewed')]);
      history.packets[0].sourceCurrent = false;
      history.packets[0].body.documents[0].additions = 'Previously saved doctor additions';
      input = {
        ...input,
        state: { ...history, source: { state, hash: null, noteId: null, signedAt: null } },
      };
      const view = render();
      expect(button('Prepare selected drafts').props.disabled).toBe(true);
      expect(text(view)).toContain(
        state === 'unsigned'
          ? 'Sign the clinical note first'
          : 'saved signed source is unavailable',
      );
      expect(text(view)).toContain('Fictional signed-source');
      expect(text(view)).toContain('retained as read-only history');
      expect(field('additions').props.value).toBe('Previously saved doctor additions');
      expect(field('additions').props.disabled).toBe(true);
      expect(button('Save draft additions').props.disabled).toBe(true);
      expect(button('Review current wording and save').props.disabled).toBe(true);
      expect(button('Download reviewed draft').props.disabled).toBe(true);
      edit('Disallowed history edit');
      expect(field('additions').props.value).toBe('Previously saved doctor additions');
      click('Patient summary');
      expect(text(render())).toContain('Fictional signed-source text for patient_summary.');
    },
  );
  it('hides all prior document content when scoped state becomes null', () => {
    edit('Local doctor additions from previous scope');
    input = { ...input, state: null, loading: true };
    const view = render();
    expect(text(view)).not.toContain('Fictional signed-source');
    expect(text(view)).not.toContain('Local doctor additions from previous scope');
    expect(elements(view).some((item) => item.type === 'textarea')).toBe(false);
    expect(elements(view).some((item) => item.props.id === 'documents-0-packet')).toBe(false);
  });
  it('prepares exactly the selected document types after confirmed completion', async () => {
    input = {
      ...input,
      state: response([]),
      onCreate: vi.fn<typeof input.onCreate>(async (types) => {
        const next = response([packet('packet-new', types)]);
        input = { ...input, state: next };
        return next;
      }),
    };
    const checks = elements(render()).filter((item) => item.type === 'input');
    checks[2].props.onChange!({ target: { value: '', checked: false } });
    click('Prepare selected drafts');
    await settle();
    expect(input.onCreate).toHaveBeenCalledWith(['referral', 'patient_summary']);
    expect(text(render())).toContain('Selected document drafts prepared');
    expect(text(render())).toContain('Nothing has been issued or sent.');
  });
  it('requires at least one type to prepare', () => {
    for (let index = 0; index < 3; index++)
      elements(render()).filter((item) => item.type === 'input')[index].props.onChange!({
        target: { value: '', checked: false },
      });
    expect(button('Prepare selected drafts').props.disabled).toBe(true);
    expect(input.onCreate).not.toHaveBeenCalled();
  });
  it('renders signed-source sections as read-only and changes only doctor additions', () => {
    const original = structuredClone(input.state);
    const view = render();
    expect(text(view)).toContain('These source sections are read-only');
    expect(elements(view).filter((item) => item.type === 'textarea')).toHaveLength(1);
    edit('Doctor-specific referral details');
    expect(field('additions').props.value).toBe('Doctor-specific referral details');
    expect(input.state).toEqual(original);
    expect(input.onWorkChange).toHaveBeenLastCalledWith(true);
    expect(harness.guard).toHaveBeenLastCalledWith(true, expect.any(String), false);
  });
  it('requires explicit current-wording review before enabling a draft download', async () => {
    confirmedSave();
    edit('Reviewed addition');
    expect(button('Review current wording and save').props.disabled).toBe(true);
    acknowledge();
    click('Review current wording and save');
    await settle();
    expect(input.onSave).toHaveBeenCalledWith('packet-1', 1, 'referral', 'Reviewed addition', true);
    expect(text(render())).toContain('Current wording reviewed');
    expect(text(render())).toContain('This remains a draft, not issued.');
    expect(button('Download reviewed draft').props.disabled).toBe(false);
    click('Download reviewed draft');
    await settle();
    expect(input.onDownload).toHaveBeenCalledWith(
      input.state!.packets[0],
      input.state!.packets[0].body.documents[0],
    );
  });
  it('resets review and blocks download immediately when reviewed wording changes', () => {
    input = { ...input, state: response([packet('packet-1', allTypes, 'reviewed')]) };
    expect(button('Download reviewed draft').props.disabled).toBe(false);
    acknowledge();
    edit('Changed after review');
    expect(text(render())).toContain('Unsaved additions · review required');
    expect(button('Download reviewed draft').props.disabled).toBe(true);
    expect(button('Review current wording and save').props.disabled).toBe(true);
  });
  it('clears a review success receipt when the signed source becomes stale', async () => {
    confirmedSave();
    acknowledge();
    click('Review current wording and save');
    await settle();
    expect(text(render())).toContain('Current wording reviewed and saved.');
    const next = structuredClone(input.state!);
    next.source.hash = otherHash;
    next.packets[0].sourceCurrent = false;
    input = { ...input, state: next };
    render();
    expect(text(render())).not.toContain('Current wording reviewed and saved.');
    expect(button('Download reviewed draft').props.disabled).toBe(true);
  });
  it('appends completion fields without changing existing wording or immutable signed source', () => {
    const before = structuredClone(input.state!);
    edit('Doctor wording already entered.');
    const picker = elements(render()).find((item) => item.type === 'document-template-picker')!;
    picker.props.onAppend!('Referral recipient\n[[Complete: Referral recipient]]');
    expect(field('additions').props.value).toBe(
      'Doctor wording already entered.\n\nReferral recipient\n[[Complete: Referral recipient]]',
    );
    expect(input.state).toEqual(before);
    expect(input.onSave).not.toHaveBeenCalled();
    expect(button('Review current wording and save').props.disabled).toBe(true);
    expect(button('Download reviewed draft').props.disabled).toBe(true);
    expect(button('Save draft additions').props.disabled).toBeFalsy();
    expect(text(render())).toContain('Complete or remove every');
  });
  it('blocks legacy reviewed unfinished templates, then requires a fresh review after completion', () => {
    input = { ...input, state: response([packet('packet-1', allTypes, 'reviewed')]) };
    input.state!.packets[0].body.documents[0].additions = '[[Complete: Recipient]]';
    expect(button('Download reviewed draft').props.disabled).toBe(true);
    expect(button('Review current wording and save').props.disabled).toBe(true);
    edit('Fictional recipient for this consultation');
    expect(button('Review current wording and save').props.disabled).toBe(true);
    acknowledge();
    expect(button('Review current wording and save').props.disabled).toBe(false);
  });
  it('does not append fields to stale documents or overflow the additions limit', () => {
    edit('x'.repeat(12_000));
    let picker = elements(render()).find((item) => item.type === 'document-template-picker')!;
    picker.props.onAppend!('[[Complete: Recipient]]');
    expect(field('additions').props.value).toHaveLength(12_000);
    expect(text(render())).toContain('exceed the document limit');
    input.state!.packets[0].sourceCurrent = false;
    picker = elements(render()).find((item) => item.type === 'document-template-picker')!;
    expect(picker.props.disabled).toBe(true);
    picker.props.onAppend!('Extra');
    expect(field('additions').props.value).toHaveLength(12_000);
  });
  it('saves additions as an explicitly unreviewed draft', async () => {
    confirmedSave();
    edit('Draft-only addition');
    click('Save draft additions');
    await settle();
    expect(input.onSave).toHaveBeenCalledWith(
      'packet-1',
      1,
      'referral',
      'Draft-only addition',
      false,
    );
    expect(button('Download reviewed draft').props.disabled).toBe(true);
    expect(text(render())).toContain('Doctor additions saved as a draft');
    expect(input.onWorkChange).toHaveBeenLastCalledWith(false);
  });
  it.each(['null', 'reject', 'wrong-additions'] as const)(
    'preserves local additions after %s save failure',
    async (kind) => {
      input.onSave =
        kind === 'reject'
          ? vi.fn(async () => {
              throw new Error('network');
            })
          : kind === 'wrong-additions'
            ? vi.fn(async () => {
                const next = response();
                next.packets[0].revision = 2;
                return next;
              })
            : vi.fn(async () => null);
      edit('Keep these additions');
      acknowledge();
      click('Review current wording and save');
      await settle();
      expect(field('additions').props.value).toBe('Keep these additions');
      expect(input.onWorkChange).toHaveBeenLastCalledWith(true);
      expect(button('Download reviewed draft').props.disabled).toBe(true);
      expect(text(render())).toContain('still here');
    },
  );
  it('requires confirmation before switching documents and can retain the current wording', () => {
    edit('Unsaved referral wording');
    click('Patient summary');
    expect(harness.confirm).toHaveBeenCalledOnce();
    expect(field('additions').props.value).toBe('Unsaved referral wording');
    expect(text(render())).toContain('Fictional signed-source text for referral.');
    harness.confirm.mockReturnValue(true);
    click('Patient summary');
    expect(field('additions').props.value).toBe('');
    expect(text(render())).toContain('Fictional signed-source text for patient_summary.');
  });
  it('requires confirmation before switching packets or reloading dirty work', () => {
    input = { ...input, state: response([packet(), packet('packet-2')]) };
    edit('Keep until confirmed');
    field('packet').props.onChange!({ target: { value: 'packet-2' } });
    expect(field('packet').props.value).toBe('packet-1');
    click('Reload documents');
    expect(input.onReload).not.toHaveBeenCalled();
    expect(field('additions').props.value).toBe('Keep until confirmed');
    harness.confirm.mockReturnValue(true);
    click('Reload documents');
    expect(input.onReload).toHaveBeenCalledOnce();
    expect(field('additions').props.value).toBe('');
  });
  it('keeps dirty wording after an explicitly approved preparation fails', async () => {
    edit('Existing unfinished wording');
    click('Prepare selected drafts');
    expect(input.onCreate).not.toHaveBeenCalled();
    harness.confirm.mockReturnValue(true);
    click('Prepare selected drafts');
    await settle();
    expect(input.onCreate).toHaveBeenCalledOnce();
    expect(field('additions').props.value).toBe('Existing unfinished wording');
    expect(text(render())).toContain('Existing work is unchanged.');
  });
  it('preserves edits across reload errors and concurrently changed packet versions', () => {
    edit('Unsaved against revision one');
    input = { ...input, error: 'Reload failed. Retry.' };
    expect(field('additions').props.value).toBe('Unsaved against revision one');
    const next = response();
    next.packets[0].revision = 2;
    next.packets[0].body.documents[0].additions = 'Another saved edit';
    input = { ...input, state: next, error: null };
    expect(field('additions').props.value).toBe('Unsaved against revision one');
    expect(text(render())).toContain('saving is paused');
    expect(button('Save draft additions').props.disabled).toBe(true);
    expect(button('Download reviewed draft').props.disabled).toBe(true);
  });
  it('blocks stale-source review and download even if an inconsistent current flag remains true', () => {
    const state = response([packet('packet-1', allTypes, 'reviewed')]);
    state.source.hash = otherHash;
    input = { ...input, state };
    expect(button('Download reviewed draft').props.disabled).toBe(true);
    expect(button('Save draft additions').props.disabled).toBe(true);
    expect(text(render())).toContain('older signed source');
  });
  it('clears attestation when the signed source changes', () => {
    acknowledge();
    const state = response();
    state.source.hash = otherHash;
    input = { ...input, state };
    render();
    expect(
      elements(render())
        .filter((item) => item.type === 'input')
        .at(-1)!.props.checked,
    ).toBe(false);
  });
  it('keeps a reviewed certificate explicitly non-issued without inferred fitness or leave', async () => {
    input = {
      ...input,
      state: response([packet('packet-1', ['medical_certificate'], 'reviewed')]),
    };
    const view = render();
    expect(text(view)).toContain('Not valid for issue.');
    expect(text(view)).toContain('does not infer fitness, leave dates or recovery');
    expect(text(view)).toContain('does not issue a certificate');
    expect(button('Download reviewed draft').props.disabled).toBe(false);
    expect(
      elements(view).some(
        (item) => item.type === 'button' && /^Issue|^Sign|^Send/.test(text(item.props.children)),
      ),
    ).toBe(false);
  });
  it('explains an empty certificate source without fabricating a certification statement', () => {
    const state = response([packet('packet-1', ['medical_certificate'])]);
    state.packets[0].body.documents[0].sourceSections = [];
    input = { ...input, state };
    expect(text(render())).toContain(
      'No certification statement has been generated. Complete any certificate particulars separately.',
    );
    expect(text(render())).toContain('Not valid for issue.');
    expect(field('additions').props.value).toBe('');
  });
  it('does not send duplicate requests while waiting for a save acknowledgement', async () => {
    type SaveResult = Awaited<ReturnType<typeof input.onSave>>;
    let resolve!: (value: SaveResult) => void;
    input.onSave = vi.fn<typeof input.onSave>(
      () =>
        new Promise<SaveResult>((done) => {
          resolve = done;
        }),
    );
    edit('Pending save');
    const action = button('Save draft additions').props.onClick!;
    action();
    action();
    expect(input.onSave).toHaveBeenCalledOnce();
    expect(button('Save draft additions').props.disabled).toBe(true);
    resolve(null);
    await settle();
    expect(button('Save draft additions').props.disabled).toBe(false);
  });
  it('ignores late save completion after unmount', async () => {
    type SaveResult = Awaited<ReturnType<typeof input.onSave>>;
    let resolve!: (value: SaveResult) => void;
    input.onSave = vi.fn<typeof input.onSave>(
      () =>
        new Promise<SaveResult>((done) => {
          resolve = done;
        }),
    );
    edit('Pending local wording');
    click('Save draft additions');
    render();
    harness.effects.forEach((effect) => effect.cleanup?.());
    const before = JSON.stringify(harness.states);
    resolve(response());
    for (let n = 0; n < 6; n++) await Promise.resolve();
    expect(JSON.stringify(harness.states)).toBe(before);
    expect(input.onWorkChange).toHaveBeenLastCalledWith(false);
  });
  it('shows download failure without claiming the draft was issued or delivered', async () => {
    input = {
      ...input,
      state: response([packet('packet-1', ['referral'], 'reviewed')]),
      onDownload: vi.fn(async () => false),
    };
    click('Download reviewed draft');
    await settle();
    expect(text(render())).toContain('download could not be confirmed');
    expect(text(render())).toContain('Draft — not issued');
  });
  it('shows an explicit packet limit instead of hiding history or allowing more preparation', () => {
    input = {
      ...input,
      state: response(Array.from({ length: 10 }, (_, index) => packet(`packet-${index}`))),
    };
    expect(button('Prepare selected drafts').props.disabled).toBe(true);
    expect(text(render())).toContain('10-packet limit');
    expect(elements(render()).filter((item) => item.type === 'option')).toHaveLength(10);
  });
});
