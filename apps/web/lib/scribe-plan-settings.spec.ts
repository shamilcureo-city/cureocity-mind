import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  me: vi.fn(),
  entitlement: vi.fn(),
  payments: vi.fn(),
  account: vi.fn(),
  checkout: vi.fn(),
  manage: vi.fn(),
}));
vi.mock('./auth-page', () => ({ requireOnboardedPsychologist: h.me }));
vi.mock('./billing', () => ({
  ensureBillingAccount: vi.fn(),
  getEntitlement: h.entitlement,
  planAmountInr: () => 1234,
}));
vi.mock('./cost-guard', () => ({ getTherapistMonthlyTotalInr: async () => 0 }));
vi.mock('./prisma', () => ({
  prisma: { billingPayment: { findMany: h.payments }, billingAccount: { findUnique: h.account } },
}));
vi.mock('../components/app/PlanCheckoutButton', () => ({
  PlanCheckoutButton: (props: { label: string }) => {
    h.checkout(props);
    return React.createElement('button', null, props.label);
  },
}));
vi.mock('../components/app/PlanManageButtons', () => ({
  PlanManageButtons: (props: unknown) => {
    h.manage(props);
    return React.createElement('button', null, 'Manage current plan');
  },
}));
vi.mock('../components/app/ReferralCard', () => ({ ReferralCard: () => null }));
import PlanSettingsPage from '../app/app/settings/plan/page';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  h.me.mockResolvedValue({ id: 'fictional-owner', vertical: 'DOCTOR' });
  h.entitlement.mockResolvedValue({
    plan: 'FREE_TRIAL',
    trialUsed: 8,
    trialCap: 10,
    isPaidActive: false,
    status: 'TRIALING',
  });
  h.payments.mockResolvedValue([]);
  h.account.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());
describe('Scribe pricing alignment without financial activation', () => {
  it('renders AED monthly request-only offers while keeping actual trial usage', async () => {
    const html = renderToStaticMarkup(await PlanSettingsPage());
    expect(html).toContain('500');
    expect(html).toContain('750');
    expect(html).toContain('200 consultation credits');
    expect(html).toContain('500 consultation credits');
    expect(html).toContain('AED ');
    expect(html).toContain('8 of 10');
    expect(html).toContain('href="mailto:');
    expect(html).toContain('does not take payment');
    expect(h.checkout).not.toHaveBeenCalled();
  });
  it('preserves the current INR checkout ladder on Mind', async () => {
    h.me.mockResolvedValue({ id: 'fictional-owner', vertical: 'THERAPIST' });
    const html = renderToStaticMarkup(await PlanSettingsPage());
    expect(html).not.toContain('Scribe monthly plans');
    expect(html).toContain('₹1,234');
    expect(h.checkout).toHaveBeenCalled();
  });
  it('keeps an existing paid Scribe plan management and invoice history', async () => {
    h.entitlement.mockResolvedValue({
      plan: 'PRO_MONTHLY',
      trialUsed: 8,
      trialCap: 10,
      isPaidActive: true,
      status: 'ACTIVE',
      paidThroughAt: '2030-11-01T00:00:00Z',
    });
    h.payments.mockResolvedValue([
      {
        id: 'fictional-payment',
        plan: 'PRO_MONTHLY',
        amountInr: 1234,
        status: 'PAID',
        createdAt: new Date('2030-10-01'),
      },
    ]);
    const html = renderToStaticMarkup(await PlanSettingsPage());
    expect(html).toContain('Scribe monthly plans');
    expect(html).toContain('Manage current plan');
    expect(html).toContain('/api/v1/billing/payments/fictional-payment/invoice');
    expect(html).toContain('₹1,234');
    expect(h.manage).toHaveBeenCalled();
    expect(h.checkout).not.toHaveBeenCalled();
  });
});
