import { describe, expect, it } from 'vitest';
import { requiredMedicalCapabilities } from './regulated-actions';

describe('mixed medical action capability planning', () => {
  it('gates each requested optional action independently', () => {
    expect(
      requiredMedicalCapabilities({
        medications: 1,
        clinicalOrders: 0,
        hasVitals: false,
        hasRxPad: false,
      }),
    ).toEqual(['PRESCRIPTION_DRAFTING']);
    expect(
      requiredMedicalCapabilities({
        medications: 0,
        clinicalOrders: 1,
        hasVitals: false,
        hasRxPad: false,
      }),
    ).toEqual(['CLINICAL_ORDERS']);
    expect(
      requiredMedicalCapabilities({
        medications: 0,
        clinicalOrders: 0,
        hasVitals: true,
        hasRxPad: false,
      }),
    ).toEqual(['CHRONIC_CARE']);
    expect(
      requiredMedicalCapabilities({
        medications: 0,
        clinicalOrders: 0,
        hasVitals: false,
        hasRxPad: true,
      }),
    ).toEqual(['PRESCRIPTION_DRAFTING']);
  });

  it('requires nothing for a medical note without regulated optional actions', () => {
    expect(
      requiredMedicalCapabilities({
        medications: 0,
        clinicalOrders: 0,
        hasVitals: false,
        hasRxPad: false,
      }),
    ).toEqual([]);
  });
});
