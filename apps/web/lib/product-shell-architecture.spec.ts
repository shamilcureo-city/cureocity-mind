import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('product-aware practitioner shell architecture', () => {
  it('resolves the login product on the server and supplies it to the client', () => {
    const layout = read('app/login/layout.tsx');
    const login = read('app/login/page.tsx');

    expect(layout).toContain("(await headers()).get('host')");
    expect(layout).toContain('productFromHost(host)');
    expect(layout).toContain('<PractitionerProductProvider productKey={product.key}>');
    expect(login).toContain('usePractitionerProduct()');
    expect(login).toContain('copy.brandSuffix');
    expect(login).toContain('copy.features');
    expect(login).toContain('copy.proof');
    expect(login).toContain('copy.inviteProductName');
  });

  it('brands onboarding from the request host', () => {
    const onboarding = read('app/onboarding/page.tsx');

    expect(onboarding).toContain('practitionerProductCopy(product)');
    expect(onboarding).toContain('copy.onboardingTitle');
    expect(onboarding).toContain('copy.onboardingDescription');
  });

  it('redirects authenticated accounts to the canonical vertical host', () => {
    const appLayout = read('app/app/layout.tsx');

    expect(appLayout).toContain(
      'practitionerHostRedirect(host, psy.vertical, sessionCookieDomain())',
    );
    expect(appLayout).toContain('redirect(canonicalUrl)');
  });
});
