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
    expect(tabs).toContain("{ key: 'note', label: 'Review & finish' }");
    expect(tabs).not.toContain("{ key: 'review'");
    expect(page.match(/<AICopilotTab/g)).toHaveLength(1);
    // The note is now the primary surface; the clinical record remains reachable
    // as secondary context, not a second signing or closeout ceremony.
    expect(closeout.indexOf('{children}', closeout.indexOf('return ('))).toBeLessThan(
      closeout.indexOf('id="session-next-steps"'),
    );
  });

  it('keeps signing in Review & Close instead of duplicating it in Copilot', () => {
    const copilot = read('components/app/CopilotDecisionBoard.tsx');

    expect(copilot).not.toContain("import { postSignNote } from '@/lib/sign-note'");
    expect(copilot).not.toContain("'Sign and close'");
    expect(copilot).not.toContain('Wrap up decisions');
    expect(copilot).not.toContain('function WrapUpSignStep');
    expect(copilot).toContain('<AdditionalSessionDetails');
  });

  it('makes processing and completion return states explicit', () => {
    const notes = read('components/app/NotesTab.tsx');
    const today = read('app/app/today/page.tsx');

    expect(notes).toContain('You can return to');
    expect(notes).toContain('It cannot recover audio that was never saved');
    expect(notes).not.toContain('Nothing you recorded is');
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

  it('checks saved corrections before signing or requesting an AI rewrite', () => {
    const notes = read('components/app/NotesTab.tsx');
    const sign = notes.slice(
      notes.indexOf('const triggerSignOff'),
      notes.indexOf('const signAndShare'),
    );
    expect(sign.indexOf("recoveryStatus !== 'none'")).toBeLessThan(sign.indexOf('postSignNote'));
    expect(sign).toContain('setEditing(true)');
    expect(notes).toContain('onStatusChange={setRecoveryStatus}');
    expect(notes).toContain('Review saved edits before signing');
    expect(notes).toContain('Apply or discard saved edits before asking AI to rewrite the note');
    expect(notes).toContain('recoveryBlocked={recoveryStatus');
  });

  it('embeds optional clinical review without fetching it for documentation-only accounts', () => {
    const page = read('app/app/sessions/[id]/page.tsx');
    const actions = read('components/app/MindCloseoutDecisionActions.tsx');
    expect(page).toContain("effective.capabilities.has('CLINICAL_ANALYSIS')");
    expect(page).toContain("if (tab === 'review' && !canReviewClinical) notFound()");
    expect(page).toContain('clinicalReview={');
    expect(page).toMatch(/canReviewClinical\s*\?\s*\(?\s*<AICopilotTab/);
    expect(page).toContain('embeddedCloseout');
    expect(actions).toContain('hidden={!reviewOpen}');
    expect(actions.replace(/\s+/g, ' ')).toContain('opening this panel does not mark it reviewed');
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
