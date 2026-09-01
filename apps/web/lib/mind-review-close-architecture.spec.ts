import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Mind Review & Close architecture', () => {
  it('lands a ready Mind note in one Review & Close surface', () => {
    const page = read('app/app/sessions/[id]/page.tsx');
    const tabs = read('components/app/SessionWorkspaceTabs.tsx');
    const closeout = read('components/app/MindSessionCloseout.tsx');

    expect(page).toContain('<MindSessionCloseout');
    expect(page).toContain('deriveMindSessionCloseout');
    expect(tabs).toContain("{ key: 'note', label: 'Note' }");
    expect(closeout).toContain('Open full session record');
  });

  it('keeps signing in Review & Close instead of duplicating it in Copilot', () => {
    const copilot = read('components/app/CopilotDecisionBoard.tsx');

    expect(copilot).not.toContain("import { postSignNote } from '@/lib/sign-note'");
    expect(copilot).not.toContain("'Sign and close'");
    expect(copilot).toContain('Continue to Review &amp; Close');
  });

  it('makes processing and completion return states explicit', () => {
    const notes = read('components/app/NotesTab.tsx');
    const today = read('app/app/today/page.tsx');

    expect(notes).toContain('you may safely return to');
    expect(notes).toContain('<CloseoutReceipt clientId={clientId} />');
    expect(notes).toContain('Note signed');
    expect(notes).not.toContain('Session closed');
    expect(today).toContain('noteProcessingJourney(session.noteDraft!.status)');
    expect(today).toContain("'Resume generation'");
    expect(today).toContain("'Review & Close'");
  });

  it('refreshes the authoritative server checklist after signing', () => {
    const notes = read('components/app/NotesTab.tsx');
    expect(notes).toContain('router.refresh()');
  });

  it('keeps reopened unsigned notes visible in Today', () => {
    const today = read('app/app/today/page.tsx');
    expect(today).toContain('therapyNote: { is: { locked: false } }');
  });

  it('guards and audits durable closeout writes after completion', () => {
    const policy = read('lib/regulated-route-capabilities.ts');
    const discovery = read('lib/regulated-route-discovery.ts');
    const route = read('app/api/v1/sessions/[id]/mind-closeout/route.ts');
    const page = read('app/app/sessions/[id]/page.tsx');

    expect(policy).toContain("'api/v1/sessions/[id]/mind-closeout'");
    expect(policy).toContain("policy('api/v1/sessions', ['POST'], ['VERTICAL_DOCUMENTATION']");
    const sessionsRoute = read('app/api/v1/sessions/route.ts');
    expect(sessionsRoute).toContain(
      "requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', auth)",
    );
    expect(sessionsRoute).toContain(
      "dto.value.sourceSessionId && auth.value.user.vertical === 'DOCTOR'",
    );
    expect(sessionsRoute.indexOf("auth.value.user.vertical === 'DOCTOR'")).toBeLessThan(
      sessionsRoute.indexOf('prisma.client.findUnique'),
    );
    expect(discovery).toContain('mindSessionCloseoutState');
    expect(route).toContain("status: 'COMPLETED'");
    expect(route).toContain('pg_advisory_xact_lock');
    expect(route).toContain("action: 'MIND_CLOSEOUT_DECISION_RECORDED'");
    expect(page).toContain("sessionCompleted={sessionStatus === 'COMPLETED'}");
  });

  it('persists closeout decisions and ties one follow-up to its source session', () => {
    const closeout = read('components/app/MindSessionCloseout.tsx');
    const schedule = read('components/app/ScheduleSessionPanel.tsx');
    const createRoute = read('app/api/v1/sessions/route.ts');
    const closeoutRoute = read('app/api/v1/sessions/[id]/mind-closeout/route.ts');

    expect(schedule).toContain('sourceSessionId');
    expect(createRoute).toContain('mindSessionCloseoutState');
    expect(closeoutRoute).toContain('followUpSkippedAt');
    expect(closeout).toContain('<MindCloseoutDecisionActions');
    expect(closeout).toContain('followUpState={closeout.steps.followUp}');
  });

  it('preselects the current client and offers editable schedule or explicit skip', () => {
    const closeout = read('components/app/MindSessionCloseout.tsx');
    const schedule = read('components/app/ScheduleSessionPanel.tsx');

    expect(closeout).toContain('<ScheduleSessionPanel');
    expect(closeout).toContain('initialClientId={client.id}');
    expect(closeout).toContain('initialDate={suggestedFollowUp.date}');
    expect(schedule).toContain("closeoutMode ? 'Schedule next session' : 'Schedule session'");
    expect(schedule).toContain('Skip follow-up');
    expect(schedule).toContain('Follow-up intentionally skipped');
  });

  it('preserves legacy session deep links and doctor Review & Sign', () => {
    const page = read('app/app/sessions/[id]/page.tsx');
    const doctor = read('components/app/DoctorEncounterPanel.tsx');

    expect(page).toContain("raw === 'notes' || raw === 'reflection'");
    expect(page).toContain("rawTab === 'copilot' && rawSub === 'progress'");
    expect(page).toContain("therapist.vertical === 'DOCTOR'");
    expect(page).toContain("redirect('/app/clinic')");
    expect(doctor).toContain('<ReviewAndSign');
  });
});
