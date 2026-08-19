import { describe, expect, it } from 'vitest';
import {
  PRODUCTS,
  canonicalPractitionerProduct,
  practitionerHostRedirect,
  practitionerProductCopy,
} from './product';

describe('practitioner product presentation', () => {
  it('presents the doctor product on the Scribe host', () => {
    const copy = practitionerProductCopy(PRODUCTS.scribe);

    expect(copy.brandSuffix).toBe('Scribe');
    expect(copy.metadataTitle).toContain('Cureocity Scribe');
    expect(copy.description).toContain('patients');
    expect(copy.proof).toContain('doctors');
    expect(copy.onboardingTitle).toContain('clinic');
  });

  it('preserves the therapist product on the Mind host', () => {
    const copy = practitionerProductCopy(PRODUCTS.mind);

    expect(copy.brandSuffix).toBe('Mind');
    expect(copy.metadataTitle).toContain('Cureocity Mind');
    expect(copy.description).toContain('clients');
    expect(copy.proof).toContain('therapists');
    expect(copy.onboardingTitle).toContain('practice');
  });
});

describe('practitioner host routing', () => {
  it('maps each stored vertical to its canonical product', () => {
    expect(canonicalPractitionerProduct('DOCTOR')).toBe(PRODUCTS.scribe);
    expect(canonicalPractitionerProduct('THERAPIST')).toBe(PRODUCTS.mind);
  });

  it('redirects a practitioner away from a mismatched product host', () => {
    expect(practitionerHostRedirect('scribe.cureocity.in', 'THERAPIST', '.cureocity.in')).toBe(
      'https://mind.cureocity.in/app',
    );
    expect(practitionerHostRedirect('mind.cureocity.in', 'DOCTOR', 'cureocity.in')).toBe(
      'https://scribe.cureocity.in/app',
    );
    expect(practitionerHostRedirect('care.cureocity.in', 'DOCTOR', '.cureocity.in')).toBe(
      'https://scribe.cureocity.in/app',
    );
  });

  it('does not redirect when the session cookie cannot cross product hosts', () => {
    expect(practitionerHostRedirect('scribe.cureocity.in', 'THERAPIST')).toBeNull();
    expect(
      practitionerHostRedirect('scribe.cureocity.in', 'THERAPIST', 'scribe.cureocity.in'),
    ).toBeNull();
  });

  it('does not redirect matching or non-production hosts', () => {
    expect(practitionerHostRedirect('scribe.cureocity.in', 'DOCTOR', '.cureocity.in')).toBeNull();
    expect(
      practitionerHostRedirect('mind.cureocity.in:443', 'THERAPIST', '.cureocity.in'),
    ).toBeNull();
    expect(practitionerHostRedirect('localhost:3000', 'DOCTOR', '.cureocity.in')).toBeNull();
    expect(practitionerHostRedirect('branch.vercel.app', 'THERAPIST', '.cureocity.in')).toBeNull();
  });
});
