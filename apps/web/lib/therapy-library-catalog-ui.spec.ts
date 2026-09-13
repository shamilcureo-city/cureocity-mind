import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TherapyScriptSchema, type ClinicalRecommendedTherapy } from '@cureocity/contracts';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  request: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (value: T) => {
        harness.states[index] = value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(compute: () => T) => compute(),
  useEffect: () => {},
}));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
vi.mock('../components/ui/Badge', () => ({ Badge: 'span' }));
vi.mock('../components/app/ShareModal', () => ({ ShareModal: () => null }));
vi.mock('../components/app/MindTherapyGuide', () => ({ MindTherapyGuide: 'mind-guide' }));
import {
  TherapyLibrary,
  TherapyList,
  TherapyGuideClassification,
} from '../components/app/TherapyLibrary';
import { MIND_THERAPY_GUIDE_CATALOG, EMDR_GUIDE_TRAINING_NOTICE } from './mind-therapy-catalog';

const clientId = 'c' + '1'.repeat(24);
const scriptId = 'c' + '2'.repeat(24);
const props = (recommendedTherapies: ClinicalRecommendedTherapy[] = []) => ({
  clientId,
  recommendedTherapies,
  libraryTherapies: MIND_THERAPY_GUIDE_CATALOG,
  defaultLanguage: 'en' as const,
  activeTreatmentPlanId: null,
  clientHasContactPhone: false,
  clientHasContactEmail: false,
  canShare: false,
});
const script = (name: string) =>
  TherapyScriptSchema.parse({
    id: scriptId,
    clientId,
    psychologistId: 'c' + '3'.repeat(24),
    therapyName: name,
    language: 'en',
    cacheKey: 'a'.repeat(64),
    sourceTreatmentPlanId: null,
    sourcePrimaryDiagnosisId: null,
    totalCostInr: '0',
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    body: {
      version: 'V1',
      therapyName: name,
      language: 'en',
      openingScript: 'Fictional opening.',
      mainExercise: {
        steps: [
          {
            id: 'one',
            purpose: 'Fictional step',
            therapistSays: 'Fictional prompt',
            listenFor: 'Fictional response',
            branches: [],
          },
        ],
      },
      closingScript: 'Fictional closing.',
      homework: { description: 'Fictional proposed next step', deliveryNotes: 'Discuss first.' },
      riskWatchpoints: [],
      adaptationCues: [],
      estimatedDurationMin: 20,
    },
  });
type TreeProps = {
  children?: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
  href?: string;
};
function elements(node: ReactNode): ReactElement<TreeProps>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<TreeProps>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function render(recommended: ClinicalRecommendedTherapy[] = []) {
  harness.stateIndex = harness.refIndex = 0;
  return TherapyLibrary(props(recommended));
}
function lists(recommended: ClinicalRecommendedTherapy[] = []) {
  return elements(render(recommended))
    .filter((element) => element.type === TherapyList)
    .map((element) => element.props as React.ComponentProps<typeof TherapyList>);
}

beforeEach(() => {
  harness.states = [];
  harness.refs = [];
  harness.stateIndex = harness.refIndex = 0;
  vi.resetAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', harness.request);
  harness.request.mockImplementation(async (url: string) => {
    const name = new URL(url, 'https://mind.test').searchParams.get('therapy')!;
    return Response.json({ script: script(name), source: 'cache' });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('guide catalog display', () => {
  it('shows categories and honest draft status without an approval claim', () => {
    const html = renderToStaticMarkup(
      React.createElement(TherapyList, {
        title: 'Explore the library',
        empty: 'Empty',
        therapies: MIND_THERAPY_GUIDE_CATALOG,
        onPick: vi.fn(),
      }),
    );
    for (const label of [
      'Approach',
      'Technique',
      'Protocol stage',
      'AI-drafted guide',
      'Not a reviewed protocol.',
    ])
      expect(html).toContain(label);
    expect(html).toContain('One stage, not a complete course of therapy.');
    expect(html).toContain(EMDR_GUIDE_TRAINING_NOTICE);
    expect(html).not.toContain('Approved protocol');
    expect(html).not.toContain('disabled');
  });

  it('keeps new AI-recommended names selectable without an invented category', () => {
    const name = 'Fictional new recommendation';
    const html = renderToStaticMarkup(React.createElement(TherapyGuideClassification, { name }));
    expect(html).toContain('AI-suggested guide');
    expect(html).toContain('Not a reviewed protocol.');
    expect(html).not.toContain('Protocol stage');
    const pick = vi.fn();
    const view = TherapyList({
      title: 'Suggestions',
      empty: 'Empty',
      therapies: [{ name }],
      onPick: pick,
    });
    elements(view).find(
      (element) => element.props['aria-label'] === `Prepare draft guide: ${name}`,
    )!.props.onClick!();
    expect(pick).toHaveBeenCalledWith(name);
  });

  it('keeps recommendation rationale and exact-name deduplication', () => {
    const recommendation = {
      name: 'Behavioural Activation',
      rationale: 'Fictional case rationale',
      evidenceSummary: 'Fictional evidence',
      whenInPlan: 'For clinician review',
    };
    const [recommended, library] = lists([recommendation]);
    expect(recommended!.therapies).toEqual([recommendation]);
    expect(library!.therapies).toHaveLength(9);
    expect(library!.therapies.some((entry) => entry.name === recommendation.name)).toBe(false);
  });
});

describe('existing guide selection compatibility', () => {
  it.each(MIND_THERAPY_GUIDE_CATALOG)(
    'preserves the exact generation request for $name',
    async ({ name }) => {
      const library = lists()[1]!;
      const view = TherapyList(library);
      elements(view).find(
        (element) => element.props['aria-label'] === `Prepare draft guide: ${name}`,
      )!.props.onClick!();
      await vi.waitFor(() =>
        expect(elements(render()).some((element) => element.type === 'mind-guide')).toBe(true),
      );
      expect(harness.request).toHaveBeenCalledOnce();
      const [url, options] = harness.request.mock.calls[0]!;
      const request = new URL(url, 'https://mind.test');
      expect(request.pathname).toBe(`/api/v1/clients/${clientId}/therapy-scripts`);
      expect(request.searchParams.get('therapy')).toBe(name);
      expect(request.searchParams.get('language')).toBe('en');
      expect(options).toEqual({ method: 'POST', cache: 'no-store' });
      const active = elements(render());
      expect(active.some((element) => element.type === TherapyGuideClassification)).toBe(true);
      expect(active.find((element) => element.type === 'a')?.props.href).toBe(
        `/app?record=${clientId}&capture=LIVE&guide=${scriptId}`,
      );
      // Preparing a guide must not create a workflow, confirm diagnosis, assign
      // homework or advance a phase; only the existing script endpoint is called.
    },
  );
});
