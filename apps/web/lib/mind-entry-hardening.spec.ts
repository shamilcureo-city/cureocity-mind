import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8');

describe('Mind entry interaction wiring', () => {
  it('keeps failed preparation stable until explicit retry or reopening', () => {
    const source = read('components/app/PreparePanel.tsx');
    expect(source).toContain('}, [open, summaryVisible, load])');
    expect(source).not.toContain('[open, data, loading, load]');
    expect(source).toContain('Retry preparation');
    expect(source).toContain('controller.signal.aborted');
    expect(source).toContain('requestRef.current?.abort()');
  });
  it('wires filtered selection validation, real receipts, and visible skip failures', () => {
    const source = read('components/app/ScheduleSessionPanel.tsx');
    expect(source).toContain('scheduleSelectionAfterSearch(');
    expect(source).toContain('requireScheduleClient(');
    expect(source).toContain('readScheduleReceipt(');
    expect(source).toContain('scheduleTriggerDisabled(closeoutMode, outcome)');
    expect(source).toContain('skipFollowUp()');
    expect(source).toContain('useModalA11y(');
    expect(source).not.toContain('if (!res.ok) return;');
  });
  it('opens client creation from URL intent and groups only completed and future appointments', () => {
    const roster = read('app/app/clients/page.tsx');
    expect(roster).toContain('clientCreationEntry(sp)');
    expect(roster).toContain("status: 'COMPLETED'");
    expect(roster).toContain("status: 'SCHEDULED'");
    expect(roster).toContain('_max: { endedAt: true, scheduledAt: true }');
    expect(roster).toContain('_min: { scheduledAt: true }');
    expect(roster).toContain('<MindClientRosterRows');
    expect(roster).toContain('lastCompletedLabel:');
    expect(roster).toContain('nextAppointmentLabel:');
  });
});
