import { describe, it, expect } from 'vitest';
import {
  BillingPlanSchema,
  PLAN_CATALOG,
  PURCHASABLE_PLANS,
  PurchasablePlanSchema,
  TIER_COPY,
  TIER_ORDER,
  intervalMonths,
  isPaidPlan,
  planTierLabel,
  purchasablePlansByTier,
  type BillingPlan,
} from './billing';

describe('PLAN_CATALOG', () => {
  const allPlans = BillingPlanSchema.options as BillingPlan[];

  it('has a catalog entry for every BillingPlan enum value', () => {
    for (const plan of allPlans) {
      expect(PLAN_CATALOG[plan], plan).toBeDefined();
    }
    // and no stray entries
    expect(Object.keys(PLAN_CATALOG).sort()).toEqual([...allPlans].sort());
  });

  it('purchasable set matches PurchasablePlanSchema exactly', () => {
    expect([...PURCHASABLE_PLANS].sort()).toEqual([...PurchasablePlanSchema.options].sort());
  });

  it('every purchasable plan is priced, periodised, and env-overridable', () => {
    for (const plan of PURCHASABLE_PLANS) {
      const spec = PLAN_CATALOG[plan];
      expect(spec.defaultPriceInr, plan).toBeGreaterThan(0);
      expect(spec.periodDays, plan).toBeGreaterThan(0);
      expect(spec.envKey, plan).toMatch(/^BILLING_PRICE_/);
    }
  });

  it('FREE_TRIAL and legacy SOLO are not purchasable', () => {
    expect(PLAN_CATALOG.FREE_TRIAL.purchasable).toBe(false);
    expect(PLAN_CATALOG.SOLO_MONTHLY.purchasable).toBe(false);
    expect(PLAN_CATALOG.SOLO_ANNUAL.purchasable).toBe(false);
    // ...but legacy plans stay priced so renewals/grandfathering work.
    expect(PLAN_CATALOG.SOLO_MONTHLY.defaultPriceInr).toBe(999);
    expect(PLAN_CATALOG.SOLO_ANNUAL.defaultPriceInr).toBe(9990);
  });

  it('exactly one purchasable tier is highlighted (the anchor)', () => {
    const highlighted = PURCHASABLE_PLANS.filter((p) => PLAN_CATALOG[p].highlight);
    expect(highlighted).toEqual(['PRO_MONTHLY']);
  });

  it('capped tiers carry their advertised monthly cap; Pro/Premium are unlimited', () => {
    expect(PLAN_CATALOG.TRAINEE_MONTHLY.monthlySessionCap).toBe(15);
    expect(PLAN_CATALOG.STARTER_MONTHLY.monthlySessionCap).toBe(30);
    expect(PLAN_CATALOG.STARTER_ANNUAL.monthlySessionCap).toBe(30);
    expect(PLAN_CATALOG.PRO_MONTHLY.monthlySessionCap).toBeNull();
    expect(PLAN_CATALOG.PREMIUM_MONTHLY.monthlySessionCap).toBeNull();
  });

  it('longer intervals beat the monthly effective price (real discount)', () => {
    for (const tier of TIER_ORDER) {
      const plans = PURCHASABLE_PLANS.filter((p) => PLAN_CATALOG[p].tier === tier);
      const monthly = plans.find((p) => PLAN_CATALOG[p].interval === 'MONTHLY');
      if (!monthly) continue;
      const monthlyInr = PLAN_CATALOG[monthly].defaultPriceInr;
      for (const p of plans) {
        const spec = PLAN_CATALOG[p];
        const effectiveMonthly = spec.defaultPriceInr / intervalMonths(spec.interval);
        expect(effectiveMonthly, `${p} effective monthly`).toBeLessThanOrEqual(monthlyInr);
      }
    }
  });
});

describe('helpers', () => {
  it('isPaidPlan is false only for FREE_TRIAL', () => {
    expect(isPaidPlan('FREE_TRIAL')).toBe(false);
    expect(isPaidPlan('PRO_MONTHLY')).toBe(true);
    expect(isPaidPlan('SOLO_ANNUAL')).toBe(true);
  });

  it('planTierLabel resolves through TIER_COPY', () => {
    expect(planTierLabel('PRO_QUARTERLY')).toBe('Pro');
    expect(planTierLabel('TRAINEE_MONTHLY')).toBe('Trainee');
  });

  it('purchasablePlansByTier returns every ladder tier with at least one plan', () => {
    const groups = purchasablePlansByTier();
    expect(groups.map((g) => g.tier)).toEqual(TIER_ORDER);
    for (const g of groups) {
      expect(g.plans.length).toBeGreaterThan(0);
      // monthly first within a tier
      expect(PLAN_CATALOG[g.plans[0]!].interval).toBe('MONTHLY');
      expect(g.tierLabel).toBe(TIER_COPY[g.tier].tierLabel);
    }
  });
});
