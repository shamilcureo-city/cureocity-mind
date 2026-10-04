import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicReception as PublicData } from '@/lib/reception';

const harness = vi.hoisted(() => ({
  stateIndex: 0,
  data: null as PublicData | null,
  request: vi.fn(),
}));

// Seed only the loaded GET response. SSR does not run effects or simulate
// interaction: these assertions cover rendered structure/copy, not browser flows.
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return {
    ...actual,
    useState: <T>(initial: T | (() => T)) => {
      const index = harness.stateIndex++;
      return actual.useState(index === 0 ? (harness.data as T) : initial);
    },
  };
});
vi.mock('@/components/reception/ReceptionWorkspace', () => ({
  receptionFetch: harness.request,
}));

import { PublicReception } from '@/components/reception/PublicReception';

function practice(overrides: Partial<PublicData> = {}): PublicData {
  return {
    practiceName: 'Fictional reception clinic',
    practitionerName: 'Dr. Fictional Example',
    vertical: 'DOCTOR',
    slug: 'fictional-reception-clinic',
    timezone: 'Asia/Dubai',
    mode: 'IN_PERSON',
    slotMinutes: 30,
    faqs: [
      {
        id: 'location',
        question: 'Where is the practice?',
        answer: 'Fictional address, ground floor.',
      },
      {
        id: 'parking',
        question: 'Is parking available?',
        answer: 'Fictional visitor parking is available.',
      },
    ],
    slots: [
      {
        startAt: '2026-10-04T05:00:00.000Z',
        endAt: '2026-10-04T05:30:00.000Z',
        minutes: 30,
        mode: 'IN_PERSON',
      },
      {
        startAt: '2026-10-04T05:30:00.000Z',
        endAt: '2026-10-04T06:00:00.000Z',
        minutes: 30,
        mode: 'IN_PERSON',
      },
    ],
    ...overrides,
  };
}

function render(data: PublicData | null = practice()) {
  harness.stateIndex = 0;
  harness.data = data;
  return renderToStaticMarkup(
    React.createElement(PublicReception, { slug: 'fictional-reception-clinic' }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
});
afterEach(() => vi.unstubAllGlobals());

describe('public reception initial presentation', () => {
  it('places the appointment workflow before supporting FAQs in the DOM', () => {
    const html = render();
    expect(html.indexOf('id="public-request-title"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="public-request-title"')).toBeLessThan(
      html.indexOf('id="approved-answers-title"'),
    );
    expect(html).toContain('aria-labelledby="public-request-title"');
    expect(html).toContain('aria-labelledby="approved-answers-title"');
  });

  it('names the three steps and identifies only the current step', () => {
    const html = render();
    expect(html).toContain('aria-label="Request progress"');
    expect(html).toContain('Choose a time');
    expect(html).toContain('Contact details');
    expect(html).toContain('Review');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('Continue to contact details');
    expect(html).not.toContain('Send appointment request');
  });

  it('asks for the visit before asking for personal contact details', () => {
    const html = render();
    expect(html).toContain('Choose a day');
    expect(html).toContain('Available times');
    expect(html).not.toContain('autoComplete="name"');
    expect(html).not.toContain('autoComplete="tel"');
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain('type="checkbox"');
  });

  it('does not preselect a time or imply that displaying it reserves it', () => {
    const html = render();
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain('Times are not reserved until the practice approves.');
    expect(html).toContain('The practice reviews every request before confirming.');
    expect(html).not.toContain('Appointment confirmed');
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('keeps clinic timezone and visit format next to time selection', () => {
    const html = render();
    expect(html).toContain('UAE time (UTC+4)');
    expect(html).toContain('30-minute appointment');
    expect(html).toContain('In-person visit');
    expect(html).toContain('9:00 am');
  });

  it('renders the Mind identity and India timezone from the public practice DTO', () => {
    const html = render(
      practice({ vertical: 'THERAPIST', timezone: 'Asia/Kolkata', mode: 'ONLINE' }),
    );
    expect(html).toContain('Cureocity Mind reception');
    expect(html).toContain('India time (UTC+5:30)');
    expect(html).toContain('Online consultation');
    expect(html).not.toContain('Cureocity Scribe');
  });

  it('uses native accessible FAQ disclosure with exact approved answers', () => {
    const html = render();
    expect(html.match(/<details\b/g)).toHaveLength(2);
    expect(html.match(/<summary\b/g)).toHaveLength(2);
    expect(html).toContain('Fictional address, ground floor.');
    expect(html).toContain('Fictional visitor parking is available.');
    expect(html).toContain('Useful answers, approved by the practice.');
    expect(html).not.toContain('AI assistant');
  });

  it('limits intake to administrative details and makes emergency limits visible', () => {
    const html = render();
    expect(html).toContain(
      'Appointment details only. Please don’t include symptoms or medical records.',
    );
    expect(html).toContain(
      'For medical or mental health advice, speak with your practitioner during a consultation.',
    );
    expect(html).toContain('This form is not monitored for emergencies.');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('Describe your symptoms');
  });

  it('provides an alternative and disables booking continuation when no times are available', () => {
    const html = render(practice({ slots: [] }));
    expect(html).toContain('No available times in the next two weeks');
    expect(html).toContain('Ask about availability');
    expect(html).toMatch(/type="submit" disabled="">Continue to contact details/);
    expect(html).not.toContain('aria-pressed=');
  });

  it('shows a loading status rather than empty booking controls before GET data arrives', () => {
    const html = render(null);
    expect(html).toContain('role="status"');
    expect(html).toContain('Opening reception…');
    expect(html).not.toContain('<form');
    expect(harness.request).not.toHaveBeenCalled();
  });
});
