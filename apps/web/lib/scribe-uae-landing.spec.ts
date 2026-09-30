import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForDoctorsLanding, { metadata } from '../app/for-doctors/page';
import { DirhamSymbol } from '../app/for-doctors/DirhamSymbol';
import { SCRIBE_UAE_PLANS, scribeEnquiryHref } from '../app/for-doctors/pricing';
import { PRODUCTS, practitionerProductCopy } from './product';

const h = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error('NOT_FOUND');
  }),
  fetch: vi.fn(),
}));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));

import ScribeLandingPreview, { metadata as previewMetadata } from '../app/dev/scribe-landing/page';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8');
const markup = () => renderToStaticMarkup(React.createElement(ForDoctorsLanding));
const visibleText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function planMarkup(html: string, id: string): string {
  const article = html.match(
    new RegExp(`<article[^>]*aria-labelledby="plan-${id}"[^>]*>([\\s\\S]*?)</article>`),
  );
  expect(article, `Missing pricing card: ${id}`).not.toBeNull();
  return article![1]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', h.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Scribe UAE landing pricing and enquiry boundary', () => {
  it('keeps the two requested monthly offers paired with their exact credit allowances', () => {
    expect(
      SCRIBE_UAE_PLANS.map(({ priceAed, credits, periodMonths }) => ({
        priceAed,
        credits,
        periodMonths,
      })),
    ).toEqual([
      { priceAed: 500, credits: 200, periodMonths: 1 },
      { priceAed: 750, credits: 500, periodMonths: 1 },
    ]);
    const html = markup();
    for (const plan of SCRIBE_UAE_PLANS) {
      const card = visibleText(planMarkup(html, plan.id));
      expect(card).toContain(`${plan.name}`);
      expect(card).toContain(`AED ${plan.priceAed} / month`);
      expect(card).toContain(`${plan.credits} credits`);
      expect(card).toContain(`${plan.credits} consultations for 1 month`);
    }
    expect(html).not.toMatch(/₹|\bINR\b/);
  });

  it('defines the confirmed credit unit without promising unresolved tax or rollover terms', () => {
    const text = visibleText(markup());
    expect(text).toContain('1 credit = 1 consultation.');
    expect(text).toContain('One credit is one consultation.');
    expect(text).toContain('unused credits');
    expect(text).toContain('any applicable taxes');
    expect(text).toContain('confirmed before activation');
    expect(text).not.toMatch(/VAT (?:included|excluded|exempt)|tax[- ]free|credits never expire/i);
  });

  it.each(SCRIBE_UAE_PLANS)('opens a correctly priced $name email enquiry, not payment', (plan) => {
    const href = scribeEnquiryHref(plan);
    const enquiry = new URL(href);
    expect(enquiry.protocol).toBe('mailto:');
    expect(enquiry.pathname).toBe('shamil@cureo.city');
    expect(enquiry.searchParams.get('subject')).toContain(`Scribe UAE — ${plan.name} plan enquiry`);
    const body = enquiry.searchParams.get('body')!;
    expect(body).toContain(
      `AED ${plan.priceAed} for ${plan.credits} consultation credits for 1 month`,
    );
    expect(body).toContain('1 credit = 1 consultation');
    expect(body).toContain('confirm activation, usage terms and any applicable taxes');
    expect(body).not.toMatch(/patient name|medical record|diagnosis|card number/i);
    const card = planMarkup(markup(), plan.id);
    expect(card).toContain(`href="${href.replace(/&/g, '&amp;')}"`);
    expect(visibleText(card)).toContain(`Request ${plan.name}`);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('keeps general clinic enquiries separate from either plan selection', () => {
    const enquiry = new URL(scribeEnquiryHref());
    expect(enquiry.protocol).toBe('mailto:');
    expect(enquiry.searchParams.get('subject')).toContain('UAE practice enquiry');
    expect(enquiry.searchParams.get('body')).toContain('Consultation languages:');
    expect(enquiry.searchParams.get('body')).not.toMatch(/AED 500|AED 750/);
  });

  it('discloses activation by contact and does not expose the legacy INR checkout', () => {
    const html = markup();
    const text = visibleText(html);
    expect(text).toContain('Plan requests open an email to our team.');
    expect(text).toContain('No payment is taken on this page.');
    expect(text).toContain('does not take payment or change an existing subscription');
    expect(html).not.toMatch(/checkout\.razorpay|\/api\/v1\/billing|\/app\/settings\/plan/);
    expect(html).not.toContain('<form');
    expect(text).not.toMatch(/buy now|subscribe now|activate instantly/i);
    for (const path of [
      'app/for-doctors/page.tsx',
      'app/for-doctors/pricing.ts',
      'app/for-doctors/ScribeWorkflowPreview.tsx',
    ]) {
      expect(read(path), path).not.toMatch(
        /PlanCheckoutButton|PLAN_CATALOG|@cureocity\/billing|\/api\/v1\/billing|Razorpay/,
      );
    }
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('Scribe UAE identity, currency and product isolation', () => {
  it('uses UAE-specific Scribe metadata on the Scribe canonical address', () => {
    expect(metadata.title).toContain('Cureocity Scribe');
    expect(metadata.title).toContain('UAE doctors');
    expect(metadata.description).toContain('AED 500 for 200 consultations');
    expect(metadata.description).toContain('AED 750 for 500 consultations');
    expect(metadata.alternates).toMatchObject({ canonical: 'https://scribe.cureocity.in/' });
    expect(metadata.openGraph).toMatchObject({
      url: 'https://scribe.cureocity.in/',
      siteName: 'Cureocity Scribe',
      locale: 'en_AE',
      type: 'website',
    });
    expect(JSON.stringify(metadata)).not.toMatch(/Cureocity Mind|Indian doctors|Indian OPD/);
  });

  it('includes the supplied dirham vector while keeping AED available to assistive technology', () => {
    const symbol = renderToStaticMarkup(React.createElement(DirhamSymbol));
    expect(symbol).toContain('<svg');
    expect(symbol).toContain('viewBox="769.761719 383.386719 384.53125 334.4375"');
    expect(symbol).toContain('<path');
    expect(symbol).toContain('fill="currentColor"');
    expect(symbol).toContain('aria-hidden="true"');
    expect(symbol).toContain('focusable="false"');
    const html = markup();
    for (const plan of SCRIBE_UAE_PLANS) {
      const card = planMarkup(html, plan.id);
      expect(card).toContain('viewBox="769.761719 383.386719 384.53125 334.4375"');
      expect(card).toMatch(/<span[^>]*>AED <\/span>/);
      expect(visibleText(card)).toContain(`AED ${plan.priceAed} / month`);
    }
  });

  it('keeps sign-in and legal links on Scribe even when shown in a local preview', () => {
    const html = markup();
    expect(html).toContain('href="https://scribe.cureocity.in/login"');
    expect(html).toContain('href="https://scribe.cureocity.in/privacy"');
    expect(html).toContain('href="https://scribe.cureocity.in/terms"');
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/"');
  });

  it('keeps the preview fictional and clinical outputs explicitly doctor-reviewed', () => {
    const text = visibleText(markup());
    expect(text).toContain('Illustrative preview · No real patient data');
    expect(text).toContain('Example patient');
    expect(text).toContain('AI-assisted documentation. Doctor-led care.');
    expect(text).toContain('Consent before capture');
    expect(text).toContain('Review before approval');
    expect(text).toContain('does not claim UAE data residency or regulatory approval');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('preserves Mind pilot acquisition policy independently of the Scribe offers', () => {
    expect(PRODUCTS.mind).toMatchObject({
      host: 'mind.cureocity.in',
      vertical: 'THERAPIST',
      landingPath: '/',
    });
    expect(PRODUCTS.scribe).toMatchObject({
      host: 'scribe.cureocity.in',
      vertical: 'DOCTOR',
      landingPath: '/for-doctors',
    });
    const mind = practitionerProductCopy(PRODUCTS.mind);
    expect(mind.brandSuffix).toBe('Mind');
    expect(mind.acquisition).toEqual({
      primaryCta: 'Apply to join the pilot',
      memberCta: 'Sign in',
      eligibility: 'For practising therapists and counsellors in India',
      pricing: 'Free through the pilot; pricing will be announced before it ends',
      helpHref: 'mailto:shamil@cureo.city?subject=Cureocity%20Mind%20pilot%20access',
    });
    expect(read('app/page.tsx')).not.toMatch(
      /SCRIBE_UAE_PLANS|scribe-landing\.module\.css|DirhamSymbol/,
    );
    expect(read('app/layout.tsx')).not.toMatch(/scribe-landing\.module\.css|SCRIBE_UAE_PLANS/);
    expect(read('app/for-doctors/scribe-landing.module.css')).not.toContain(':global(');
  });

  it('exposes all section anchors and a keyboard skip link without requiring JavaScript', () => {
    const html = markup();
    expect(html).toContain('href="#main"');
    expect(html).toContain('Skip to content');
    expect(html).toContain('<main id="main">');
    for (const id of ['top', 'workflow', 'pricing', 'questions'])
      expect(html).toContain(`id="${id}"`);
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('<summary>');
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
  });
});

describe('isolated Scribe landing preview', () => {
  it.each([
    ['production', 'true'],
    ['test', 'true'],
    ['development', 'false'],
    ['development', undefined],
  ])('does not expose the dev route in %s with preview flag %s', (environment, flag) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('SCRIBE_WORKSPACE_PREVIEW', flag);
    expect(() => ScribeLandingPreview()).toThrow('NOT_FOUND');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('renders the same landing only in explicitly opted-in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SCRIBE_WORKSPACE_PREVIEW', 'true');
    const html = renderToStaticMarkup(ScribeLandingPreview());
    expect(html).toEqual(markup());
    expect(previewMetadata.robots).toEqual({ index: false, follow: false });
    expect(h.notFound).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
