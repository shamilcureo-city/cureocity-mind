import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceptionSettingsForm } from '@/components/reception/ReceptionSettingsForm';
import { defaultReceptionSettings, type ReceptionSettings } from '@/lib/reception';

const settings = (overrides: Partial<ReceptionSettings> = {}): ReceptionSettings => ({
  ...defaultReceptionSettings('Fictional reception clinic'),
  slug: 'fictional-reception-clinic',
  hours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  faqs: [{ id: 'clinic-location', question: 'Where is the clinic?', answer: 'Fictional address.' }],
  ...overrides,
});

function render(initial = settings(), busy = false) {
  return renderToStaticMarkup(
    React.createElement(ReceptionSettingsForm, { initial, busy, onSave: vi.fn() }),
  );
}

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

describe('reception settings presentation boundaries', () => {
  it('groups configuration in three correctly linked accordion sections', () => {
    const html = render();
    for (const id of ['publication', 'hours', 'answers']) {
      expect(html).toContain(`id="settings-${id}-title"`);
      expect(html).toContain(`aria-controls="settings-${id}-panel"`);
      expect(html).toContain(`id="settings-${id}-panel"`);
    }
    expect(html.match(/aria-expanded=/g)).toHaveLength(3);
  });

  it('opens publication for a new desk and retains collapsed inputs in the form', () => {
    const html = render();
    expect(html).toMatch(/id="settings-publication-title" aria-expanded="true"/);
    expect(html).toMatch(/id="settings-hours-panel" hidden=""/);
    expect(html).toMatch(/id="settings-answers-panel" hidden=""/);
    expect(html).toContain('Fictional address.');
    expect(html).toContain('Opening time for window 1');
  });

  it('opens appointment hours for an enabled desk', () => {
    const html = render(settings({ enabled: true }));
    expect(html).toMatch(/id="settings-hours-title" aria-expanded="true"/);
    expect(html).toMatch(/id="settings-publication-panel" hidden=""/);
    expect(html).toContain('Public page is on');
  });

  it('does not pretend the initial data needs saving', () => {
    const html = render();
    expect(html).toContain('No unsaved changes');
    expect(html).not.toContain('Discard changes');
    expect(html).toMatch(/type="submit" disabled="">Save changes/);
    expect(html).not.toMatch(/<fieldset[^>]*disabled=/);
  });

  it('disables the entire editable fieldset during saving', () => {
    const html = render(settings(), true);
    expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*aria-label="Reception settings"/);
    expect(html).toContain('Saving your changes');
    expect(html).toMatch(/type="submit" disabled="">Saving/);
  });

  it('uses schema validation so invalid collapsed fields can be surfaced by the form', () => {
    expect(render()).toMatch(/<form[^>]*noValidate=""/);
  });

  it('keeps timezone, booking review and approved-answer boundaries explicit', () => {
    const html = render(settings({ timezone: 'Asia/Kolkata' }));
    expect(html).toContain('India time');
    expect(html).toContain('Every appointment request waits for your');
    expect(html).toContain('Reception shows these exact answers');
    expect(html).toContain('Keep clinical advice and personal information out');
  });
});
