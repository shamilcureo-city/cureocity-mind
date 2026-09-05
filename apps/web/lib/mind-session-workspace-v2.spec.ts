import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Mind session workspace v2', () => {
  it('exposes only four session-owned tabs', () => {
    const tabs = read('components/app/SessionWorkspaceTabs.tsx');
    for (const label of ['Review & close', 'Clinical context', 'Transcript', 'Session details']) {
      expect(tabs).toContain(`label: '${label}'`);
    }
    expect(tabs).not.toContain("label: 'AI Copilot'");
    expect(tabs).not.toContain("label: 'Plan of care'");
    expect(tabs).not.toContain("label: 'Client'");
  });

  it('keeps Review & Close as the sole note signing ceremony', () => {
    const page = read('app/app/sessions/[id]/page.tsx');
    const closeout = read('components/app/MindSessionCloseout.tsx');
    const copilot = read('components/app/CopilotDecisionBoard.tsx');

    expect(page).toContain("tab === 'note'");
    expect(page).toContain('showSubTabs={false}');
    expect(page).toContain('<MindSessionCloseout');
    expect(closeout).toContain('Review &amp; Close');
    expect(copilot).not.toContain('<NoteSignPanel');
  });

  it('redirects old longitudinal bookmarks to client-owned routes', () => {
    const page = read('app/app/sessions/[id]/page.tsx');

    expect(page).toContain("rawTab === 'plan-of-care'");
    expect(page).toContain("rawTab === 'client'");
    expect(page).toContain("rawTab === 'copilot' && rawSub === 'progress'");
    expect(page).toContain('redirect(`/app/clients/${session.clientId}/plan`)');
    expect(page).toContain('redirect(`/app/clients/${session.clientId}/journey`)');
    expect(page).toContain('redirect(`/app/clients/${session.clientId}`)');
  });

  it('redirects old session-local bookmarks to canonical tabs', () => {
    const page = read('app/app/sessions/[id]/page.tsx');
    expect(page).toContain(
      "rawTab === 'copilot' && (!rawSub || ['session', 'review'].includes(rawSub))",
    );
    expect(page).toContain("rawTab === 'copilot' && rawSub === 'close'");
    expect(page).toContain('redirect(`/app/sessions/${id}?tab=review`)');
    expect(page).toContain("rawTab === 'clinical-brief'");
    expect(page).toContain("rawTab === 'notes'");
    expect(page).toContain('redirect(`/app/sessions/${id}?tab=note`)');
    expect(page).toContain('redirect(`/app/sessions/${id}?tab=details`)');
  });

  it('uses canonical destinations for current Mind actions', () => {
    for (const file of [
      'components/app/TherapistLiveSession.tsx',
      'components/app/RecordingShell.tsx',
      'components/app/LiveRecorder.tsx',
      'components/app/NoteToolbar.tsx',
      'components/app/VirtualSessionShell.tsx',
    ]) {
      expect(read(file)).not.toContain('?tab=copilot');
    }
    const decisions = read('components/app/CopilotDecisionBoard.tsx');
    expect(decisions).toContain('/app/clients/${clientId}/journey');
    expect(decisions).toContain('/app/clients/${clientId}/plan');
  });

  it('routes every signing entry point to the canonical Note tab', () => {
    const decisions = read('components/app/CopilotDecisionBoard.tsx');
    const today = read('components/app/TodaySessionCard.tsx');
    const dashboard = read('app/app/dashboard/page.tsx');
    const notesDue = read('app/app/notes-due/page.tsx');
    const todayPage = read('app/app/today/page.tsx');
    const unsignedDigest = read('app/api/v1/cron/unsigned-digest/route.ts');

    expect(decisions).toContain('href={`/app/sessions/${sessionId}?tab=note`}');
    expect(today).toContain('href={`/app/sessions/${session.id}?tab=note`}');
    expect(dashboard).toContain('href={`/app/sessions/${n.sessionId}?tab=note`}');
    expect(notesDue).toContain('href={`/app/sessions/${r.id}?tab=note`}');
    expect(todayPage).toContain('href: `/app/sessions/${session.id}?tab=note`');
    expect(unsignedDigest).toContain('${appUrl}/app/sessions/${entry.oldestSessionId}?tab=note');
  });

  it('does not emit the superseded Notes tab URL from current Mind source', () => {
    const whereWeLeftOff = read('components/app/WhereWeLeftOff.tsx');
    expect(whereWeLeftOff).toContain('/app/sessions/${p.lastSession.id}?tab=note');
    expect(whereWeLeftOff).not.toContain('?tab=notes');
  });

  it('preserves the Doctor boundary before Mind session data access', () => {
    const page = read('app/app/sessions/[id]/page.tsx');
    expect(page.indexOf("therapist.vertical === 'DOCTOR'")).toBeLessThan(
      page.indexOf('prisma.session.findFirst'),
    );
  });
});
