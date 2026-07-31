import { describe, expect, it } from 'vitest';
import { CreateClientInputSchema } from '@cureocity/contracts';
import {
  buildCreateClientBody,
  EMPTY_CLIENT_DRAFT,
  isClientDraftReady,
  type ClientDraft,
} from './client-draft';

function draft(over: Partial<ClientDraft> = {}): ClientDraft {
  return { ...EMPTY_CLIENT_DRAFT, fullName: 'Ananya R', contactPhone: '+919876543210', ...over };
}

describe('isClientDraftReady', () => {
  it('needs a name and a usable phone', () => {
    expect(isClientDraftReady(draft())).toBe(true);
    expect(isClientDraftReady(draft({ fullName: '  ' }))).toBe(false);
    expect(isClientDraftReady(draft({ contactPhone: '+9198765' }))).toBe(false);
  });

  it('requires all three scribe consents, cross-border included', () => {
    // Not pedantry: /sessions/[id]/start 409s without CROSS_BORDER_PROCESSING,
    // so a client created without it cannot be recorded.
    expect(isClientDraftReady(draft({ audioOk: false }))).toBe(false);
    expect(isClientDraftReady(draft({ noteOk: false }))).toBe(false);
    expect(isClientDraftReady(draft({ crossBorderOk: false }))).toBe(false);
  });

  it('does not require the optional retention consent', () => {
    expect(isClientDraftReady(draft({ retentionExtended: false }))).toBe(true);
  });
});

describe('buildCreateClientBody', () => {
  it('produces a body the API schema accepts', () => {
    expect(CreateClientInputSchema.safeParse(buildCreateClientBody(draft())).success).toBe(true);
  });

  it('normalises however the phone was typed', () => {
    for (const typed of ['+91 98765 43210', '9876543210', '09876543210']) {
      const body = buildCreateClientBody(draft({ contactPhone: typed }));
      expect(body['contactPhone'], typed).toBe('+919876543210');
      expect(CreateClientInputSchema.safeParse(body).success, typed).toBe(true);
    }
  });

  it('grants the three scribe consents, plus retention when ticked', () => {
    const scopes = (d: ClientDraft) =>
      (buildCreateClientBody(d)['consents'] as Array<{ scope: string }>).map((c) => c.scope);
    expect(scopes(draft())).toEqual([
      'AUDIO_RECORDING',
      'AI_NOTE_GENERATION',
      'CROSS_BORDER_PROCESSING',
    ]);
    expect(scopes(draft({ retentionExtended: true }))).toContain('DATA_RETENTION_EXTENDED');
  });

  it('omits blank optional fields rather than sending empty strings', () => {
    const body = buildCreateClientBody(draft());
    for (const k of [
      'contactEmail',
      'dateOfBirth',
      'presentingConcerns',
      'preferredModality',
      'preferredLanguage',
      'spokenLanguages',
    ]) {
      expect(body, k).not.toHaveProperty(k);
    }
  });

  it('sends the optional fields once filled', () => {
    const body = buildCreateClientBody(
      draft({
        contactEmail: '  a@b.com ',
        dateOfBirth: '1996-04-02',
        presentingConcerns: ' sleep ',
        preferredModality: 'CBT',
        preferredLanguage: 'ml',
        spokenLanguages: ['ml', 'en'],
      }),
    );
    expect(body).toMatchObject({
      contactEmail: 'a@b.com',
      dateOfBirth: '1996-04-02',
      presentingConcerns: 'sleep',
      preferredModality: 'CBT',
      preferredLanguage: 'ml',
      spokenLanguages: ['ml', 'en'],
    });
    expect(CreateClientInputSchema.safeParse(body).success).toBe(true);
  });

  it('leaves the default language out — the DB already defaults to en', () => {
    expect(buildCreateClientBody(draft({ preferredLanguage: 'en' }))).not.toHaveProperty(
      'preferredLanguage',
    );
  });
});
