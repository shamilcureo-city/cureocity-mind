import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  request: vi.fn(),
  refresh: vi.fn(),
}));

// Execute the real component controls and hook transitions. This is not browser
// focus/layout testing; the parent release check covers the rendered journey.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (next: T | ((previous: T) => T)) => {
        harness.states[index] =
          typeof next === 'function'
            ? (next as (previous: T) => T)(harness.states[index] as T)
            : next;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
  useId: () => 'closeout-test',
  useEffect: () => undefined,
  useCallback: <T>(callback: T) => callback,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));

import { MindCloseoutDecisionActions } from '../components/app/MindCloseoutDecisionActions';
import { deriveMindSessionCloseout } from './mind-session-closeout';
import { confirmsMindCloseoutDecision } from './mind-closeout-decision-receipt';
import {
  MindCloseoutTaskBoundary,
  type MindCloseoutTaskReporter,
} from './mind-closeout-task-status';

type ElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  hidden?: boolean;
  id?: string;
  role?: string;
  'aria-expanded'?: boolean;
};
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<ElementProps>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function label(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<ElementProps>(child) ? label(child.props.children) : String(child),
    )
    .join('');
}
const work = React.createElement('textarea', { defaultValue: 'Unfinished work description' });
const agreements = React.createElement('textarea', { defaultValue: 'Unfinished agreement' });
const appointment = React.createElement('input', { defaultValue: '2100-01-02' });
const clinicalReview = React.createElement('textarea', { defaultValue: 'Clinical review draft' });
function render(overrides: Partial<Parameters<typeof MindCloseoutDecisionActions>[0]> = {}) {
  harness.stateIndex = harness.refIndex = 0;
  return MindCloseoutDecisionActions({
    sessionId: 'fictional-session',
    steps: deriveMindSessionCloseout({ draftStatus: 'COMPLETED', noteSigned: true }).steps,
    canShare: true,
    canRecordWork: true,
    work,
    agreements,
    appointment,
    clinicalReview,
    ...overrides,
  });
}
function click(prefix: string, occurrence = 0) {
  const button = elements(render()).filter(
    (node) => node.type === 'button' && label(node.props.children).startsWith(prefix),
  )[occurrence];
  expect(button, `Missing button ${prefix}`).toBeDefined();
  expect(button.props.disabled).not.toBe(true);
  button.props.onClick!();
}
function panel(key: string) {
  return elements(render()).find((element) => element.props.id === `closeout-test-${key}`)!;
}
function taskContent(key: string) {
  return (panel(key).props.children as ReactElement<{ children: ReactNode }>).props.children;
}
function reporter(): MindCloseoutTaskReporter {
  return (
    elements(render()).find((element) => element.type === MindCloseoutTaskBoundary)!
      .props as unknown as { onStatusChange: MindCloseoutTaskReporter }
  ).onStatusChange;
}
const timestamp = '2026-09-14T12:00:00.000Z';
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  harness.states = [];
  harness.refs = [];
  harness.request.mockReset();
  harness.refresh.mockReset();
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', harness.request);
});
afterEach(() => vi.unstubAllGlobals());

describe('Mind one-task closeout', () => {
  it('starts quiet, reveals one task, and never removes mounted draft editors on switches', () => {
    expect(panel('work').props.hidden).toBe(true);
    const workBefore = taskContent('work');
    const agreementsBefore = taskContent('agreements');
    click('Work done & client response');
    expect(panel('work').props.hidden).toBe(false);
    click('Agreements or homework');
    expect(panel('work').props.hidden).toBe(true);
    expect(panel('agreements').props.hidden).toBe(false);
    expect(taskContent('work')).toBe(workBefore);
    expect(taskContent('agreements')).toBe(agreementsBefore);
    click('The next appointment');
    expect(panel('agreements').props.hidden).toBe(true);
    expect(panel('appointment').props.hidden).toBe(false);
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('loads support only on request and keeps that same review mounted when hidden', () => {
    expect(elements(render()).some((element) => element === clinicalReview)).toBe(false);
    click('Session support');
    expect(label(panel('support').props.children)).toContain(
      'opening this panel does not mark it reviewed',
    );
    const clinicalBefore = panel('support').props.children;
    click('Agreements or homework');
    expect(panel('support').props.hidden).toBe(true);
    // The fragment is re-created, but its review child stays the same instance/key.
    expect(
      Children.toArray((clinicalBefore as ReactElement<{ children: ReactNode }>).props.children)
        .length,
    ).toBe(2);
    expect(
      Children.toArray(
        (panel('support').props.children as ReactElement<{ children: ReactNode }>).props.children,
      ).length,
    ).toBe(2);
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('opens legacy clinical support without changing any clinical decision', () => {
    const view = render({ initialReviewOpen: true });
    expect(
      elements(view).find((element) => element.props.id === 'closeout-test-support')?.props.hidden,
    ).toBe(false);
    expect(label(view)).toContain('No decision recorded');
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('omits clinical and decision routes for a documentation-only account but preserves its other tasks', () => {
    const view = render({
      canReviewClinical: false,
      canRecordWork: false,
      initialReviewOpen: true,
    });
    expect(label(view)).not.toContain('Session support');
    expect(label(view)).not.toContain('Record as reviewed');
    expect(label(view)).not.toContain('Record no sharing');
    expect(label(view)).toContain('Agreements or homework');
    expect(label(view)).toContain('The next appointment');
    expect(harness.request).not.toHaveBeenCalled();
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    'gates work and analysis independently (work=%s, analysis=%s)',
    (canRecordWork, canReviewClinical) => {
      const view = render({ canRecordWork, canReviewClinical });
      expect(elements(view).some((element) => element.props.id === 'closeout-test-work')).toBe(
        canRecordWork,
      );
      expect(elements(view).some((element) => element.props.id === 'closeout-test-support')).toBe(
        canReviewClinical,
      );
      expect(harness.request).not.toHaveBeenCalled();
    },
  );

  it('keeps a pending work save and a returned error visible after switching tasks', () => {
    reporter()('work', 'work-editor', { dirty: true, busy: true, needsAttention: false });
    click('Agreements or homework');
    expect(panel('work').props.hidden).toBe(true);
    expect(
      elements(render()).some(
        (element) =>
          element.props.role === 'status' &&
          label(element.props.children).includes('A save is in progress'),
      ),
    ).toBe(true);
    reporter()('work', 'work-editor', {
      dirty: true,
      busy: false,
      needsAttention: true,
      uncertain: true,
    });
    const alert = elements(render()).find((element) => element.props.role === 'alert');
    expect(label(alert)).toContain('A save could not be confirmed');
    expect(label(alert)).toContain('Open this task');
    expect(taskContent('work')).toBe(work);
  });

  it('retains an agreement error until that editor clears it, independently of homework saves', () => {
    reporter()('agreements', 'agreement-editor', {
      dirty: true,
      busy: false,
      needsAttention: true,
    });
    reporter()('agreements', 'homework-editor', { dirty: true, busy: true, needsAttention: false });
    click('The next appointment');
    reporter()('agreements', 'homework-editor', null);
    expect(label(render())).toContain('This task needs attention');
    expect(label(render())).toContain('Other saved work is unchanged');
    reporter()('agreements', 'agreement-editor', {
      dirty: false,
      busy: false,
      needsAttention: false,
    });
    expect(label(render())).not.toContain('This task needs attention');
    expect(harness.request).not.toHaveBeenCalled();
  });

  it.each([
    ['agreements', 'agreementsSkippedAt', 'Agreements or homework', 1],
    ['nextSessionQuestions', 'nextQuestionsSkippedAt', 'Next-session questions', 2],
    ['shared', 'shareSkippedAt', 'Client sharing', 0],
  ] as const)(
    'fresh saved %s evidence outranks an earlier local skip',
    async (step, field, title, occurrence) => {
      harness.request.mockResolvedValueOnce(
        response({ sessionId: 'fictional-session', [field]: timestamp }),
      );
      click(step === 'shared' ? 'Record no sharing' : 'Record not needed', occurrence);
      await vi.waitFor(() => expect(harness.refresh).toHaveBeenCalledOnce());
      expect(label(render())).toContain(`${title} · Not needed this session`);
      const steps = deriveMindSessionCloseout({ draftStatus: 'COMPLETED', noteSigned: true }).steps;
      const refreshed = render({ steps: { ...steps, [step]: 'COMPLETE' } });
      expect(label(refreshed)).toContain(`${title} · Recorded`);
      expect(harness.request).toHaveBeenCalledOnce();
    },
  );

  it('omits sharing actions when that separate capability is absent', () => {
    expect(label(render({ canShare: false }))).not.toContain('Client sharing');
    expect(label(render({ canShare: false }))).not.toContain('Record no sharing');
  });

  it('keeps a confirmed decision when another optional save fails, with the error visible across tasks', async () => {
    harness.request.mockResolvedValueOnce(
      response({
        sessionId: 'fictional-session',
        clinicalSuggestionsResolvedAt: timestamp,
        clinicalSuggestionsSkippedAt: null,
      }),
    );
    click('Record as reviewed');
    await vi.waitFor(() => expect(harness.refresh).toHaveBeenCalledOnce());
    expect(label(render())).toContain('Clinical suggestions · Recorded');
    harness.request.mockRejectedValueOnce(new TypeError('Network interrupted'));
    click('Record no sharing');
    await vi.waitFor(() =>
      expect(label(render())).toContain('This decision could not be confirmed'),
    );
    click('Agreements or homework');
    expect(label(render())).toContain('Clinical suggestions · Recorded');
    expect(label(render())).toContain('Client sharing · No decision recorded');
    const alert = elements(render()).find((element) => element.props.role === 'alert');
    expect(alert?.props.hidden).not.toBe(true);
    expect(label(alert)).toContain('Other saved work is unchanged');
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(harness.request).toHaveBeenCalledTimes(2);
  });

  it('requires a matching receipt, not just a successful HTTP response', async () => {
    harness.request.mockResolvedValueOnce(
      response({ sessionId: 'another-session', shareSkippedAt: timestamp }),
    );
    click('Record no sharing');
    await vi.waitFor(() => expect(label(render())).toContain('could not be confirmed'));
    expect(label(render())).toContain('Client sharing · No decision recorded');
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  it('blocks repeated clicks even before React renders a busy state', async () => {
    let resolve!: (value: Response) => void;
    harness.request.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const button = elements(render()).find(
      (node) => node.type === 'button' && label(node.props.children) === 'Record no sharing',
    )!;
    button.props.onClick!();
    button.props.onClick!();
    expect(harness.request).toHaveBeenCalledOnce();
    resolve(response({ sessionId: 'fictional-session', shareSkippedAt: timestamp }));
    await vi.waitFor(() => expect(harness.refresh).toHaveBeenCalledOnce());
    expect(label(render())).toContain('Client sharing · Not needed this session');
  });
});

describe('Mind closeout receipt validation', () => {
  it.each([
    null,
    {},
    [],
    { sessionId: 'fictional-session' },
    { sessionId: 'fictional-session', shareSkippedAt: 'bad-date' },
  ])('rejects malformed receipt %j', (body) => {
    expect(
      confirmsMindCloseoutDecision(body, {
        sessionId: 'fictional-session',
        step: 'shared',
        outcome: 'SKIPPED',
      }),
    ).toBe(false);
  });
  it('does not turn an agreement skip receipt into a completed agreement', () => {
    expect(
      confirmsMindCloseoutDecision(
        { sessionId: 'fictional-session', agreementsSkippedAt: timestamp },
        { sessionId: 'fictional-session', step: 'agreements', outcome: 'COMPLETE' },
      ),
    ).toBe(false);
  });
  it('rejects a clinical receipt that simultaneously records opposite outcomes', () => {
    expect(
      confirmsMindCloseoutDecision(
        {
          sessionId: 'fictional-session',
          clinicalSuggestionsResolvedAt: timestamp,
          clinicalSuggestionsSkippedAt: timestamp,
        },
        { sessionId: 'fictional-session', step: 'clinicalSuggestions', outcome: 'COMPLETE' },
      ),
    ).toBe(false);
  });
});
