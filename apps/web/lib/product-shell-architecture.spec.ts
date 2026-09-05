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
    expect(login).toContain("needed to run{' '}\n              {copy.inviteProductName}");
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

  it('uses Today as the single canonical Mind home while preserving the doctor Clinic', () => {
    const app = read('app/app/page.tsx');
    const today = read('app/app/today/page.tsx');

    expect(app).toContain("redirect('/app/today')");
    expect(app).not.toContain('<RecordingShell');
    expect(today).toContain("therapist.vertical === 'DOCTOR'");
    expect(today).toContain("redirect('/app/clinic')");
  });

  it('finishes onboarding on the canonical home for the selected vertical', () => {
    const form = read('components/app/OnboardingForm.tsx');

    expect(form).toContain("vertical === 'DOCTOR' ? '/app/clinic' : '/app/today'");
    expect(form).not.toContain("router.replace('/app')");
  });

  it('labels every unsigned note-processing state explicitly on Today', () => {
    const today = read('app/app/today/page.tsx');

    expect(today).toContain(
      "noteDraft: { status: { in: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] } }",
    );
    expect(today).toContain('noteProcessingJourney(session.noteDraft!.status)');
    expect(today).toContain("journey.state === 'READY_TO_REVIEW'");
    expect(today).not.toMatch(/noteDraft: \{ status: \{ in:[\s\S]{0,500}take: 12/);
    expect(today).not.toContain("status: 'COMPLETED',\n        therapyNote: null,");
  });

  it('surfaces operational work on Today instead of duplicating it in Analytics', () => {
    const today = read('app/app/today/page.tsx');
    const workspace = read('components/app/MindTodayWorkspace.tsx');
    const dashboard = read('app/app/dashboard/page.tsx');

    expect(today).toContain('<MindTodayWorkspace');
    expect(today).toContain('attentionItems={attentionItems}');
    expect(workspace).toContain('<TodayAttentionQueue items={attentionItems} />');
    expect(dashboard).not.toContain('<FirstRunChecklist');
    expect(dashboard).not.toContain('<UpNextSection');
  });

  it('puts first-run choices on Today before empty scheduling surfaces', () => {
    const today = read('app/app/today/page.tsx');
    const workspace = read('components/app/MindTodayWorkspace.tsx');
    const layout = read('app/app/layout.tsx');

    expect(today).toContain('<FirstRunChecklist psychologistId={therapist.id} />');
    expect(today).toContain('firstRun={<FirstRunChecklist psychologistId={therapist.id} />}');
    expect(workspace.indexOf('{firstRun}')).toBeLessThan(workspace.lastIndexOf('{hero ?'));
    expect(layout).toContain("psy?.vertical === 'DOCTOR' && <WelcomeOverlay");
  });
});
