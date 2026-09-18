import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mindStartEntryHref, type MindCaptureMode } from './mind-session-start';

const h = vi.hoisted(() => ({
  stateIndex: 0,
  states: [] as unknown[],
}));

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = h.stateIndex++;
    if (!(index in h.states))
      h.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [h.states[index] as T, vi.fn()] as const;
  },
  useEffect: vi.fn(),
  useRef: <T>(current: T) => ({ current }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('../components/ui/Card', () => ({ Card: 'section' }));
vi.mock('../components/ui/Badge', () => ({ Badge: 'span' }));
vi.mock('../components/app/PreparePanel', () => ({ PreparePanel: 'div' }));
vi.mock('../components/app/SessionPreparationPanel', () => ({
  SessionPreparationPanel: 'div',
}));
vi.mock('../components/app/RescheduleModal', () => ({ RescheduleModal: 'div' }));

import { TodaySessionCard } from '../components/app/TodaySessionCard';

type ElementProps = {
  children?: ReactNode;
  href?: string;
  disabled?: boolean;
  role?: string;
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  'aria-describedby'?: string;
};

const all = (node: ReactNode): ReactElement<ElementProps>[] =>
  Children.toArray(node).flatMap((child) =>
    isValidElement<ElementProps>(child) ? [child, ...all(child.props.children)] : [],
  );

const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) =>
      isValidElement<ElementProps>(child) ? text(child.props.children) : String(child),
    )
    .join('');

const session = {
  id: 'fictional-session',
  status: 'SCHEDULED' as const,
  scheduledAt: '2026-09-18T09:00:00.000Z',
  modality: 'IN_PERSON',
  kind: 'TREATMENT' as const,
  clientId: 'fictional-client',
  clientName: 'Ananya (fictional)',
  hasSignedNote: false,
  draftStatus: null,
};

function render(input?: {
  pending?: boolean;
  dirty?: boolean;
  variant?: 'hero' | 'row';
  capture?: MindCaptureMode;
}) {
  h.states = [
    null,
    null,
    input?.pending ?? false,
    input?.dirty ?? false,
    false,
    false,
    false,
    false,
  ];
  h.stateIndex = 0;
  return TodaySessionCard({
    session,
    defaultCapture: input?.capture ?? 'LIVE',
    variant: input?.variant ?? 'hero',
    sessionPreparationEnabled: true,
  });
}

function exactControl(node: ReactNode, label: string) {
  return all(node).find((element) => text(element.props.children) === label);
}

describe('Today preparation entry CTA', () => {
  beforeAll(() => vi.stubGlobal('React', React));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => vi.clearAllMocks());

  it.each(['LIVE', 'BATCH'] as const)(
    'names the scheduled %s entry for the preparation step without changing its destination',
    (capture) => {
      const rendered = render({ capture });
      const action = exactControl(rendered, 'Prepare & start');

      expect(action?.type).toBe('a');
      expect(action?.props.href).toBe(
        mindStartEntryHref({
          source: 'TODAY',
          clientId: session.clientId,
          sessionId: session.id,
          captureMode: capture,
        }),
      );
      expect(text(rendered)).not.toContain('Start session');
    },
  );

  it('uses the same truthful preparation label for a scheduled timeline row', () => {
    const action = exactControl(render({ variant: 'row' }), 'Prepare & start');

    expect(action?.type).toBe('a');
    expect(action?.props.href).toBe(
      mindStartEntryHref({
        source: 'TODAY',
        clientId: session.clientId,
        sessionId: session.id,
        captureMode: 'LIVE',
      }),
    );
  });

  it('makes both start controls non-interactive and explains an in-flight save', () => {
    const rendered = render({ pending: true });
    const action = exactControl(rendered, 'Prepare & start');
    const more = all(rendered).find(
      (element) => element.props['aria-label'] === 'More ways to start',
    );

    expect(action?.type).toBe('button');
    expect(action?.props.disabled).toBe(true);
    expect(action?.props['aria-describedby']).toBe(
      'session-fictional-session-prepare-start-status',
    );
    expect(more?.props.disabled).toBe(true);
    expect(more?.props['aria-expanded']).toBe(false);
    expect(text(rendered)).toContain('Saving preparation… You can continue when it finishes.');
  });

  it('keeps unsaved preparation on the page until the clinician saves or discards it', () => {
    const rendered = render({ dirty: true });
    const action = exactControl(rendered, 'Prepare & start');
    const status = all(rendered).find(
      (element) =>
        element.props.role === 'status' &&
        text(element.props.children) ===
          'Save or discard your preparation edits before you continue.',
    );

    expect(action?.type).toBe('button');
    expect(action?.props.disabled).toBe(true);
    expect(
      all(rendered).some(
        (element) => element.type === 'a' && text(element.props.children) === 'Prepare & start',
      ),
    ).toBe(false);
    expect(text(rendered)).toContain('Save or discard your preparation edits before you continue.');
    expect(status).toBeDefined();
  });
});
