/**
 * Three products, one platform — the host → product map.
 *
 * Each product fronts the same Next.js app on its own domain; the
 * middleware rewrites the landing route per host and everything else
 * (auth, app, api) is shared. This module is the ONE place that knows
 * which domain is which product — middleware, layouts, and onboarding
 * all read from here.
 *
 * Unknown hosts (localhost, *.vercel.app previews, the bare project
 * domain) fall back to MIND so nothing changes for existing URLs.
 */

export type ProductKey = 'mind' | 'scribe' | 'care';

export interface Product {
  key: ProductKey;
  /** Public product name, used in titles + chrome. */
  name: string;
  /** The canonical production host for this product. */
  host: string;
  /** The practitioner vertical this product onboards into (null = D2C). */
  vertical: 'THERAPIST' | 'DOCTOR' | null;
  /** Path (in the shared app) that serves this product's landing page. */
  landingPath: string;
}

export interface PractitionerProductCopy {
  brandSuffix: 'Mind' | 'Scribe';
  metadataTitle: string;
  metadataDescription: string;
  headline: string;
  description: string;
  proof: string;
  onboardingTitle: string;
  onboardingDescription: string;
  inviteProductName: string;
  acquisition: {
    primaryCta: string;
    memberCta: string;
    eligibility: string;
    pricing: string;
    helpHref: string;
  };
  features: Array<{ title: string; body: string }>;
}

export const PRODUCTS: Record<ProductKey, Product> = {
  mind: {
    key: 'mind',
    name: 'Cureocity Mind',
    host: 'mind.cureocity.in',
    vertical: 'THERAPIST',
    landingPath: '/',
  },
  scribe: {
    key: 'scribe',
    name: 'Cureocity Scribe',
    host: 'scribe.cureocity.in',
    vertical: 'DOCTOR',
    landingPath: '/for-doctors',
  },
  care: {
    key: 'care',
    name: 'Cureocity Care',
    host: 'care.cureocity.in',
    vertical: null,
    landingPath: '/care',
  },
};

const HOST_TO_PRODUCT: Record<string, ProductKey> = Object.fromEntries(
  Object.values(PRODUCTS).map((p) => [p.host, p.key]),
) as Record<string, ProductKey>;

/**
 * The internal operator console's production host. Deliberately NOT a
 * `Product` (it has no landing / marketing / onboarding vertical) — it's
 * the platform-admin surface, host-gated here and route-gated by
 * `requirePageAdmin` at `/console`. The middleware rewrites this host's
 * `/` to `/console`; everything else on the host serves normally.
 *
 * Reaching it over the subdomain in prod additionally needs (a) DNS + a
 * Vercel domain for this host, and (b) `SESSION_COOKIE_DOMAIN=.cureocity.in`
 * so the practitioner login cookie is shared across subdomains. Until then
 * the console is always reachable at the `/console` path on any host.
 */
export const ADMIN_CONSOLE_HOST = 'admin.cureocity.in';

export function isAdminConsoleHost(host: string | null | undefined): boolean {
  const bare = (host ?? '').toLowerCase().split(':')[0] ?? '';
  return bare === ADMIN_CONSOLE_HOST;
}

/**
 * Resolve the product for a request host. Ports are stripped; unknown
 * hosts resolve to MIND (the original product — previews, localhost, and
 * the bare vercel.app domain keep today's behaviour exactly).
 */
export function productFromHost(host: string | null | undefined): Product {
  const bare = (host ?? '').toLowerCase().split(':')[0] ?? '';
  return PRODUCTS[HOST_TO_PRODUCT[bare] ?? 'mind'];
}

export function canonicalPractitionerProduct(vertical: 'THERAPIST' | 'DOCTOR'): Product {
  return vertical === 'DOCTOR' ? PRODUCTS.scribe : PRODUCTS.mind;
}

/**
 * Redirect authenticated practitioners only when they are on one of the
 * canonical production product hosts. Localhost and preview hosts deliberately
 * remain neutral so both verticals can be tested on one deployment.
 */
export function practitionerHostRedirect(
  host: string | null | undefined,
  vertical: 'THERAPIST' | 'DOCTOR',
  sessionDomain?: string,
): string | null {
  const bare = (host ?? '').toLowerCase().split(':')[0] ?? '';
  if (!(bare in HOST_TO_PRODUCT)) return null;
  // A host-only cookie would be discarded by the cross-domain hop, sending a
  // signed-in user back to login. Redirect only when production is explicitly
  // configured to share the practitioner session across Cureocity subdomains.
  if ((sessionDomain ?? '').toLowerCase().replace(/^\./, '') !== 'cureocity.in') return null;
  const canonical = canonicalPractitionerProduct(vertical);
  return bare === canonical.host ? null : `https://${canonical.host}/app`;
}

export function practitionerProductCopy(product: Product): PractitionerProductCopy {
  if (product.key === 'scribe') {
    return {
      brandSuffix: 'Scribe',
      metadataTitle: 'Cureocity Scribe — live AI copilot for Indian doctors',
      metadataDescription:
        'Live clinical notes, prescription drafts, and evidence-linked prompts for Indian doctors.',
      headline: 'Your consult stays with the patient.',
      description:
        'The live clinical copilot that drafts the note and prescription while you focus on your patients.',
      proof: 'Built for doctors running Indian OPDs.',
      onboardingTitle: 'Set up your clinic.',
      onboardingDescription:
        'A few details before your first patient encounter. Takes less than a minute.',
      inviteProductName: 'Cureocity Scribe',
      acquisition: {
        primaryCta: 'Request Scribe pilot access',
        memberCta: 'Sign in',
        eligibility: 'For registered doctors and selected Indian clinics',
        pricing: 'Pilot terms are shared directly with selected clinics',
        helpHref: 'mailto:shamil@cureo.city?subject=Cureocity%20Scribe%20pilot%20access',
      },
      features: [
        {
          title: 'Live note and Rx draft',
          body: 'The medical note and prescription pad build during the consult, ready for your review and signature.',
        },
        {
          title: 'Built for Indian OPD',
          body: 'Hinglish, Manglish, and Tanglish transcription designed for fast, code-mixed consultations.',
        },
        {
          title: 'Prompts while they still matter',
          body: 'Unasked questions, red flags, interactions, examination prompts, and orders surface before the patient leaves.',
        },
      ],
    };
  }

  return {
    brandSuffix: 'Mind',
    metadataTitle: 'Cureocity Mind — AI scribe for your therapy practice',
    metadataDescription:
      'Record sessions, generate clinical notes, edit by chat, and sign off — without leaving the room.',
    headline: 'Your attention stays in the room.',
    description:
      'The clinical copilot that writes your notes and tracks your clients’ progress while you focus on the work.',
    proof: 'Built with practising therapists for the Cureocity Mind pilot.',
    onboardingTitle: 'Set up your practice.',
    onboardingDescription:
      'A few details for the Mind pilot before you meet your first client. Takes less than a minute.',
    inviteProductName: 'Cureocity Mind',
    acquisition: {
      primaryCta: 'Apply to join the pilot',
      memberCta: 'Sign in',
      eligibility: 'For practising therapists and counsellors in India',
      pricing: 'Free through the pilot; pricing will be announced before it ends',
      helpHref: 'mailto:shamil@cureo.city?subject=Cureocity%20Mind%20pilot%20access',
    },
    features: [
      {
        title: 'AI scribe in your sessions',
        body: 'SOAP + intake notes auto-drafted from the recording. You modify, accept, sign.',
      },
      {
        title: 'Built for Indian practice',
        body: 'Manglish, Hinglish, Tanglish — code-mix-first transcription that other tools choke on.',
      },
      {
        title: 'The full clinical arc',
        body: 'Risk, formulation, treatment planning, homework, and measured progress stay connected across sessions.',
      },
    ],
  };
}
