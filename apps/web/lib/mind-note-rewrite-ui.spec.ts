import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactNode, type ReactElement } from 'react';
import { TherapyNoteV1Schema } from '@cureocity/contracts';
const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  si: 0,
  ri: 0,
  transport: vi.fn(),
  busy: vi.fn(),
  modified: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'rewrite',
  useEffect: () => undefined,
  useState: <T>(initial: T) => {
    const i = h.si++;
    if (!(i in h.states)) h.states[i] = initial;
    return [
      h.states[i],
      (value: T) => {
        h.states[i] = value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const i = h.ri++;
    return h.refs[i] ?? (h.refs[i] = { current });
  },
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
import { MindNoteRewrite } from '../components/app/MindNoteRewrite';
const current = TherapyNoteV1Schema.parse({
  version: 'V1',
  modality: 'SUPPORTIVE',
  subjective: 'Fictional account',
  objective: 'Observations',
  assessment: 'Further information needed',
  plan: 'Review the agreed focus at the next visit',
  riskFlags: { severity: 'medium', indicators: [] },
});
const updated = { ...current, plan: 'Review agreed focus next visit' };
const base = '2026-09-14T10:00:00.000Z';
let currentVersion = base;
let blocked = false;
type Props = {
  children?: ReactNode;
  onClick?: () => void | Promise<void>;
  onSubmit?: (event: { preventDefault: () => void }) => void;
  onChange?: (event: { target: { value?: string; checked?: boolean } }) => void;
  disabled?: boolean;
  type?: string;
  href?: string;
};
const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
const elements = (node: ReactNode): ReactElement<Props>[] =>
  Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
function render() {
  h.si = h.ri = 0;
  return MindNoteRewrite({
    sessionId: 'fictional-session',
    currentDraft: { content: current, updatedAt: currentVersion },
    blocked,
    onModified: h.modified,
    onBusyChange: h.busy,
    transport: h.transport as typeof fetch,
  });
}
const button = (label: string) =>
  elements(render()).find((el) => el.type === 'button' && text(el.props.children) === label);
async function preview() {
  elements(render()).find((el) => el.type === 'textarea')!.props.onChange!({
    target: { value: 'Make plan concise' },
  });
  elements(render()).find((el) => el.type === 'form')!.props.onSubmit!({
    preventDefault: () => undefined,
  });
  await vi.waitFor(() => expect(button('Apply reviewed changes')).toBeDefined());
}
function review() {
  elements(render()).find((el) => el.type === 'input' && el.props.type === 'checkbox')!.props
    .onChange!({ target: { checked: true } });
}
beforeEach(() => {
  vi.clearAllMocks();
  h.states = [];
  h.refs = [];
  currentVersion = base;
  blocked = false;
  vi.stubGlobal('React', React);
  h.transport.mockImplementation(async (_url, init) =>
    init.method === 'POST'
      ? Response.json({ applied: false, kind: 'TREATMENT', note: updated, baseUpdatedAt: base })
      : Response.json({ note: updated, updatedAt: '2026-09-14T10:01:00.000Z' }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('Mind explicit AI edit review', () => {
  it('does not write on opening or previewing; requires review then explicit apply', async () => {
    render();
    expect(h.transport).not.toHaveBeenCalled();
    await preview();
    expect(h.modified).not.toHaveBeenCalled();
    expect(JSON.parse(h.transport.mock.calls[0][1].body)).toMatchObject({
      mode: 'PREVIEW',
      expectedUpdatedAt: base,
    });
    expect(button('Apply reviewed changes')!.props.disabled).toBe(true);
    review();
    button('Apply reviewed changes')!.props.onClick!();
    await vi.waitFor(() =>
      expect(h.modified).toHaveBeenCalledWith(updated, '2026-09-14T10:01:00.000Z'),
    );
    expect(JSON.parse(h.transport.mock.calls[1][1].body).expectedUpdatedAt).toBe(base);
    expect(text(render())).toContain('Signing and sharing are separate');
  });
  it('keeping the current note sends no apply request', async () => {
    await preview();
    button('Keep current note')!.props.onClick!();
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.modified).not.toHaveBeenCalled();
  });
  it('refuses apply after the displayed draft version changes or another action blocks it', async () => {
    await preview();
    review();
    currentVersion = '2026-09-14T10:02:00.000Z';
    expect(button('Apply reviewed changes')!.props.disabled).toBe(true);
    button('Apply reviewed changes')!.props.onClick!();
    expect(h.transport).toHaveBeenCalledTimes(1);
    currentVersion = base;
    blocked = true;
    button('Apply reviewed changes')!.props.onClick!();
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('does not claim not-applied or allow discard/retry after an uncertain save', async () => {
    await preview();
    review();
    h.transport.mockRejectedValueOnce(new Error('Lost save receipt'));
    button('Apply reviewed changes')!.props.onClick!();
    await vi.waitFor(() => expect(text(render())).toContain('Save status unknown'));
    expect(text(render())).not.toContain('Proposed changes — not applied');
    expect(button('Keep current note')).toBeUndefined();
    expect(button('Apply reviewed changes')).toBeUndefined();
    expect(elements(render()).find((el) => el.props.href)?.props.href).toBe(
      '/app/sessions/fictional-session?tab=note',
    );
    expect(h.busy).toHaveBeenLastCalledWith(true);
    expect(h.modified).not.toHaveBeenCalled();
  });
  it('prevents same-frame duplicate requests', async () => {
    await preview();
    review();
    const apply = button('Apply reviewed changes')!;
    apply.props.onClick!();
    apply.props.onClick!();
    await vi.waitFor(() => expect(h.modified).toHaveBeenCalledOnce());
    expect(h.transport).toHaveBeenCalledTimes(2);
  });
  it.each(['response', 'body'] as const)(
    'keeps apply uncertain when a successful %s arrives after abort',
    async (lateStage) => {
      await preview();
      review();
      vi.useFakeTimers();
      let settle!: () => void;
      const receipt = { note: updated, updatedAt: '2026-09-14T10:01:00.000Z' };
      if (lateStage === 'response') {
        h.transport.mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              settle = () => resolve(Response.json(receipt));
            }),
        );
      } else {
        const response = Response.json({});
        vi.spyOn(response, 'json').mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              settle = () => resolve(receipt);
            }),
        );
        h.transport.mockResolvedValueOnce(response);
      }
      button('Apply reviewed changes')!.props.onClick!();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(h.transport.mock.calls.at(-1)![1].signal.aborted).toBe(true);
      settle();
      await vi.advanceTimersByTimeAsync(0);
      expect(text(render())).toContain('Save status unknown');
      expect(text(render())).not.toContain('Proposed changes — not applied');
      expect(button('Keep current note')).toBeUndefined();
      expect(button('Apply reviewed changes')).toBeUndefined();
      expect(h.busy).toHaveBeenLastCalledWith(true);
      expect(h.modified).not.toHaveBeenCalled();
    },
  );
});
