import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TherapyScriptV1 } from '@cureocity/contracts';
import { mindGuideSteps } from './mind-guidance';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  activeIndex: 0,
  reviewed: new Set<string>(),
  saveStatus: 'local' as string,
  canEdit: true,
  navigate: vi.fn(),
  mark: vi.fn(),
  retry: vi.fn(),
  reload: vi.fn(),
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
  useMemo: <T>(compute: () => T) => compute(),
  useRef: <T>(current: T) => ({ current }),
  useId: () => 'test-id',
  useEffect: () => {},
}));
vi.mock('./use-mind-guide-review', () => ({
  useMindGuideReview: () => ({
    activeIndex: harness.activeIndex,
    reviewed: harness.reviewed,
    setActiveIndex: harness.navigate,
    toggleReviewed: harness.mark,
    saveStatus: harness.saveStatus,
    canEdit: harness.canEdit,
    retry: harness.retry,
    reload: harness.reload,
  }),
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
import { MindTherapyGuide } from '../components/app/MindTherapyGuide';

const script: TherapyScriptV1 = {
  version: 'V1',
  therapyName: 'Fictional guide',
  language: 'en',
  openingScript: 'FICTIONAL opening wording.',
  mainExercise: {
    steps: [
      {
        id: 'one',
        purpose: 'Fictional middle section',
        therapistSays: 'FICTIONAL middle wording.',
        listenFor: 'FICTIONAL response cue.',
        branches: [{ ifClientSays: 'FICTIONAL branch cue', thenDo: 'FICTIONAL adaptation' }],
      },
    ],
  },
  closingScript: 'FICTIONAL closing wording.',
  homework: {
    description: 'FICTIONAL proposed next step.',
    deliveryNotes: 'Only if discussed and agreed.',
  },
  riskWatchpoints: ['FICTIONAL watchpoint, not clinical advice.'],
  adaptationCues: [],
  estimatedDurationMin: 20,
};
const target = {
  clientId: 'test-client',
  scriptId: 'test-script',
  scriptUpdatedAt: '2026-09-14T00:00:00.000Z',
};
type Props = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { target: { checked: boolean } }) => void;
  disabled?: boolean;
  type?: string;
  'aria-label'?: string;
  'aria-current'?: string;
  'aria-hidden'?: boolean;
  open?: boolean;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function content(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<Props>(child)
        ? child.props['aria-hidden']
          ? ''
          : content(child.props.children)
        : String(child),
    )
    .join('');
}
function render(persisted = false) {
  harness.stateIndex = 0;
  return MindTherapyGuide({ script, ...(persisted ? { reviewTarget: target } : {}) });
}
function button(label: string, persisted = false) {
  const match = elements(render(persisted)).find(
    (element) => element.type === 'button' && content(element) === label,
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}
function reviewSuitability(persisted = false) {
  elements(render(persisted)).find((element) => element.type === 'input')!.props.onChange!({
    target: { checked: true },
  });
}
function enterGuide(persisted = false) {
  reviewSuitability(persisted);
  button('Step by step', persisted).props.onClick!();
}

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.clearAllMocks();
  harness.states = [];
  harness.activeIndex = 0;
  harness.reviewed = new Set();
  harness.saveStatus = 'local';
  harness.canEdit = true;
  harness.navigate.mockImplementation((index: number) => {
    harness.activeIndex = index;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('one-section therapy draft navigation', () => {
  it('restores orientation but never restores suitability approval', () => {
    harness.activeIndex = 2;
    harness.saveStatus = 'saved';
    harness.reviewed.add('opening');
    const html = renderToStaticMarkup(render(true));
    expect(html).toContain('Saved place');
    expect(html).toContain('Section 3 of 4: Reflect &amp; close');
    expect(html).toContain('1 of 4 guide sections reviewed');
    expect(button('Step by step', true).props.disabled).toBe(true);
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.mark).not.toHaveBeenCalled();
    reviewSuitability(true);
    button('Continue at section 3', true).props.onClick!();
    const guided = renderToStaticMarkup(render(true));
    expect(guided).toContain(script.closingScript);
    expect(guided).not.toContain(script.openingScript);
    expect(guided).not.toContain(script.mainExercise.steps[0]!.therapistSays);
  });

  it('uses one primary next action and keeps the optional jump list collapsed', () => {
    enterGuide();
    const view = render();
    const jump = elements(view).find(
      (element) =>
        element.type === 'details' && elements(element).some((child) => child.type === 'nav'),
    )!;
    expect(jump.props.open).toBeUndefined();
    expect(content(jump)).toContain('Jump to a section');
    expect(
      elements(view).filter((element) => element.props['aria-current'] === 'step'),
    ).toHaveLength(1);
    expect(button('Previous section').props.disabled).toBe(true);
    button('Next section').props.onClick!();
    expect(harness.navigate).toHaveBeenCalledWith(1);
    expect(harness.mark).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(render());
    expect(html).toContain(script.mainExercise.steps[0]!.therapistSays);
    expect(html).not.toContain(script.openingScript);
    expect(html).toContain(
      'Moving between sections does not mark them reviewed or record therapy delivery.',
    );
  });

  it('jumping and moving back do not mark any section reviewed', () => {
    enterGuide();
    button('Reflect & close').props.onClick!();
    expect(harness.navigate).toHaveBeenLastCalledWith(2);
    button('Previous section').props.onClick!();
    expect(harness.navigate).toHaveBeenLastCalledWith(1);
    expect(harness.mark).not.toHaveBeenCalled();
    button('Mark section reviewed').props.onClick!();
    expect(harness.mark).toHaveBeenCalledOnce();
  });

  it('ends navigation with an overview action, not a treatment-completed action', () => {
    harness.activeIndex = 3;
    enterGuide();
    const html = renderToStaticMarkup(render());
    expect(html).toContain(script.homework.description);
    expect(html).toContain('Only if agreed with the client');
    expect(html).not.toContain('Next section');
    button('Return to overview').props.onClick!();
    expect(renderToStaticMarkup(render())).toContain(script.openingScript);
    expect(harness.mark).not.toHaveBeenCalled();
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it('pauses navigation when suitability is unchecked and keeps all watchpoints visible', () => {
    enterGuide();
    elements(render()).find((element) => element.type === 'input')!.props.onChange!({
      target: { checked: false },
    });
    const html = renderToStaticMarkup(render());
    for (const step of mindGuideSteps(script)) expect(html).toContain(step.text);
    expect(html).toContain(script.riskWatchpoints[0]);
    expect(html).not.toContain('aria-label="Guide sections"');
    expect(html).not.toContain('Next section');
  });
});

describe('truthful guide save status and recovery', () => {
  it.each(['loading', 'saving', 'load-error', 'save-error', 'conflict', 'stale'])(
    'keeps %s status visible before content and prevents review-marker writes',
    (status) => {
      harness.saveStatus = status;
      harness.canEdit = false;
      enterGuide(true);
      const html = renderToStaticMarkup(render(true));
      expect(html).not.toContain('Saved place');
      expect(button('Mark section reviewed', true).props.disabled).toBe(true);
      expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf(script.openingScript));
      expect(html).toContain(script.riskWatchpoints[0]);
      // Reading remains available even while persistence needs recovery.
      button('Next section', true).props.onClick!();
      expect(harness.navigate).toHaveBeenCalledWith(1);
      expect(harness.mark).not.toHaveBeenCalled();
    },
  );

  it('retries or reloads only on explicit user action, without claiming a successful save', () => {
    harness.saveStatus = 'save-error';
    harness.canEdit = false;
    expect(renderToStaticMarkup(render(true))).toContain('The last save could not be confirmed');
    expect(harness.retry).not.toHaveBeenCalled();
    expect(harness.reload).not.toHaveBeenCalled();
    button('Retry save', true).props.onClick!();
    button('Reload saved progress', true).props.onClick!();
    expect(harness.retry).toHaveBeenCalledOnce();
    expect(harness.reload).toHaveBeenCalledOnce();
  });

  it('labels local-only review honestly and never treats reviewed sections as delivered therapy', () => {
    harness.reviewed = new Set(mindGuideSteps(script).map((step) => step.id));
    const html = renderToStaticMarkup(render());
    expect(html).toContain('Your place and review markers stay in this open guide only.');
    expect(html).toContain('Your guide review is complete.');
    expect(html).toContain('Record only the work actually delivered');
    expect(html).not.toContain('Saved place');
    expect(button('Step by step').props.disabled).toBe(true);
  });
});
