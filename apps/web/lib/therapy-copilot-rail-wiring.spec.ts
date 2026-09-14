import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TherapyReasoningV1Schema } from '@cureocity/contracts';

const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  nextRef: 0,
  effects: [] as (() => void)[],
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof React>('react');
  return {
    ...actual,
    useCallback: <T>(callback: T) => callback,
    useRef: (initial: unknown) => {
      const index = hooks.nextRef++;
      return (hooks.refs[index] ??= { current: initial });
    },
    useEffect: (effect: () => void) => hooks.effects.push(effect),
  };
});

import { TherapyCopilotRail } from '../components/app/TherapyCopilotRail';

const reasoning = TherapyReasoningV1Schema.parse({
  riskWatch: [
    {
      id: 'risk',
      label: 'Synthetic safety cue',
      why: 'Synthetic evidence',
      severity: 'high',
      source: 'LIVE',
    },
    {
      id: 'carried-risk',
      label: 'Synthetic carried cue',
      why: 'Earlier evidence',
      severity: 'high',
      source: 'CARRIED_RISK',
    },
  ],
  askNext: [
    {
      id: 'prepared',
      question: 'Synthetic prepared question',
      why: 'Prepared reason',
      source: 'CARRIED',
    },
    { id: 'live-1', question: 'Synthetic first live question', why: 'Live reason', source: 'LIVE' },
    {
      id: 'live-2',
      question: 'Synthetic second live question',
      why: 'Live reason',
      source: 'LIVE',
    },
  ],
  threads: [{ id: 'topic', topic: 'Synthetic topic', note: 'Synthetic context' }],
});

type Element = React.ReactElement<{
  children?: React.ReactNode;
  ref?: { current: { open: boolean } | null };
  onToggle?: () => void;
  disabled?: boolean;
}>;
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

beforeEach(() => {
  vi.stubGlobal('React', React);
  hooks.refs = [];
  hooks.nextRef = 0;
  hooks.effects = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('live session optional support wiring', () => {
  const onShown = vi.fn();
  const onResolve = vi.fn();
  function render(overrides: Partial<React.ComponentProps<typeof TherapyCopilotRail>> = {}) {
    hooks.nextRef = 0;
    hooks.effects = [];
    const tree = TherapyCopilotRail({ reasoning, onShown, onResolve, ...overrides });
    const disclosure = elements(tree).find(
      (element) => element.type === 'details' && element.props.ref,
    );
    if (!disclosure && hooks.refs[0]) hooks.refs[0].current = null;
    for (const effect of hooks.effects) effect();
    return { tree, disclosure };
  }
  const lastShownIds = () => onShown.mock.calls.at(-1)?.[0].map((item: { id: string }) => item.id);

  beforeEach(() => {
    onShown.mockClear();
    onResolve.mockClear();
  });

  it('logs only the primary question and safety cue until optional support is opened', () => {
    const { disclosure } = render();
    expect(lastShownIds()).toEqual(['risk', 'live-1']);
    expect(disclosure).toBeDefined();
    disclosure!.props.ref!.current = { open: true };
    disclosure!.props.onToggle!();
    expect(lastShownIds()).toEqual(['risk', 'live-1', 'live-2', 'topic']);
    disclosure!.props.ref!.current!.open = false;
    disclosure!.props.onToggle!();
    expect(lastShownIds()).toEqual(['risk', 'live-1']);
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('uses the real disclosure state when updated suggestions arrive', () => {
    const { disclosure } = render();
    disclosure!.props.ref!.current = { open: true };
    const updated = TherapyReasoningV1Schema.parse({
      ...reasoning,
      threads: [
        ...reasoning.threads,
        { id: 'new-topic', topic: 'Another synthetic topic', note: 'New context' },
      ],
    });
    render({ reasoning: updated });
    expect(lastShownIds()).toEqual(['risk', 'live-1', 'live-2', 'topic', 'new-topic']);
    disclosure!.props.ref!.current!.open = false;
    render({ reasoning: updated });
    expect(lastShownIds()).toEqual(['risk', 'live-1']);
  });

  it('keeps guide-hidden suggestions unlogged and resets disclosure when Quiet removes it', () => {
    const { disclosure } = render({ guideActive: true });
    expect(lastShownIds()).toEqual(['risk']);
    disclosure!.props.ref!.current = { open: true };
    disclosure!.props.onToggle!();
    expect(lastShownIds()).toEqual(['risk', 'live-1', 'live-2', 'topic']);
    const quiet = render({ mode: 'quiet', guideActive: true });
    expect(quiet.disclosure).toBeUndefined();
    expect(lastShownIds()).toEqual(['risk']);
    render({ guideActive: true });
    expect(lastShownIds()).toEqual(['risk']);
  });

  it('keeps acknowledgement controls disabled while prior reviews are loading or saving', () => {
    for (const overrides of [{ reviewBlocked: true }, { pendingId: 'risk' }]) {
      const { tree } = render(overrides);
      expect(elements(tree).find((element) => element.type === 'fieldset')?.props.disabled).toBe(
        true,
      );
      expect(lastShownIds()).toEqual(['risk', 'live-1']);
      expect(onResolve).not.toHaveBeenCalled();
    }
  });
});
