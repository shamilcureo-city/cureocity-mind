import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8');

describe('entry simplification preserves recoverability and explicit authority', () => {
  it('does not limit unfinished-session or failed-delivery queries behind the complete recovery claim', () => {
    const today = read('app/app/today/page.tsx');
    const activeStart = today.indexOf("status: 'IN_PROGRESS'");
    const activeQuery = today.slice(activeStart, today.indexOf("status: 'SCHEDULED'", activeStart));
    expect(activeQuery).toContain('startedAt:');
    expect(activeQuery).not.toContain('take:');
    const failureStart = today.indexOf(
      "status: { in: ['TRANSIENT_FAILURE', 'PERMANENT_FAILURE'] }",
    );
    const failureQuery = today.slice(failureStart, today.indexOf('// Read cutover', failureStart));
    expect(failureQuery).not.toContain('take:');
    expect(failureQuery).not.toContain('responseCutoff');
    expect(today).toContain('...rawActiveSessions');
    expect(today).toContain('mindSessionDestination(session, defaultCapture)');
  });

  it('places safety summary outside full-brief disclosure, without treating missing flags as an assessment', () => {
    const prepare = read('components/app/PreparePanel.tsx');
    expect(prepare.indexOf('<PrepareSafety openCrises={data.openCrises}')).toBeLessThan(
      prepare.indexOf('aria-expanded={open}'),
    );
    expect(prepare).toContain('data && open');
    expect(prepare).toContain('This is not a safety assessment');
    expect(prepare).toContain('summaryVisible');
    expect(prepare).toContain('Older undated intention — not carried forward');
    expect(prepare).toContain('Use this intention today');
  });

  it('uses native grouped selection and keeps current consent and device checks outside settings disclosure', () => {
    const confirm = read('components/app/RecordConfirmStrip.tsx');
    expect(confirm).toContain('type="radio"');
    expect(confirm).toContain('name={groupName}');
    expect(confirm).toContain('checked={checked}');
    expect(confirm).toContain('disabled={disabled}');
    expect(confirm.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(confirm).toContain('title="In person"');
    expect(confirm).not.toContain('title="Walk-in"');
    expect(confirm.indexOf('</details>')).toBeLessThan(
      confirm.indexOf('id="rcs-today-confirmation"'),
    );
    expect(confirm).toContain('confirmedToday &&');
    expect(confirm).toContain('(!needsDevicePreflight || preflightReady)');
    expect(confirm).not.toContain('defaultOpen={expectedSessionId');
  });
});
