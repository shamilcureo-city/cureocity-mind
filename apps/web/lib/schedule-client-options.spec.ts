import { describe, expect, it } from 'vitest';
import {
  addCreatedClientOption,
  visibleScheduleClients,
  scheduleSelectionAfterSearch,
  requireScheduleClient,
  readScheduleReceipt,
  scheduleTriggerDisabled,
} from './schedule-client-options';

describe('Mind scheduling client options', () => {
  it('adds a newly created client to an empty scheduling roster', () => {
    expect(
      addCreatedClientOption([], {
        id: 'client-new',
        fullName: 'Asha Nair',
        preferredModality: null,
      }),
    ).toEqual([
      {
        id: 'client-new',
        fullName: 'Asha Nair',
        preferredModality: null,
      },
    ]);
  });

  it('replaces an existing option instead of duplicating the client', () => {
    expect(
      addCreatedClientOption([{ id: 'client-1', fullName: 'Old name', preferredModality: 'CBT' }], {
        id: 'client-1',
        fullName: 'Updated name',
        preferredModality: null,
      }),
    ).toEqual([{ id: 'client-1', fullName: 'Updated name', preferredModality: null }]);
  });
});

describe('Mind scheduling selection and receipts', () => {
  const clients = [
    { id: 'a', fullName: 'Asha', preferredModality: null },
    { id: 'b', fullName: 'Beena', preferredModality: null },
  ];

  it('clears A when searching for B rather than silently submitting A', () => {
    const query = 'Been';
    const selected = scheduleSelectionAfterSearch(clients, query, 'a');
    const visible = visibleScheduleClients(clients, query, selected);
    expect(selected).toBe('');
    expect(visible.map((client) => client.id)).toEqual(['b']);
    expect(() => requireScheduleClient(visible, selected)).toThrow('Choose the client');
    expect(() => requireScheduleClient(visible, 'a')).toThrow();
    expect(requireScheduleClient(visible, 'b').id).toBe('b');
  });

  it('keeps explicit selections visible beyond the 30-client limit', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `c${index}`,
      fullName: `Client ${index}`,
      preferredModality: null,
    }));
    const visible = visibleScheduleClients(many, '', 'c39');
    expect(visible).toHaveLength(30);
    expect(visible[0]?.id).toBe('c39');
    expect(scheduleSelectionAfterSearch(many, '', 'c39')).toBe('c39');
  });

  it('requires the source-session client in closeout, even if another client exists', () => {
    expect(() => requireScheduleClient(clients, 'b', 'a')).toThrow();
    expect(() => requireScheduleClient(clients, 'a', '')).toThrow();
    expect(requireScheduleClient(clients, 'a', 'a').fullName).toBe('Asha');
  });

  it('allows repeated general bookings but prevents duplicate closeout bookings', () => {
    expect(scheduleTriggerDisabled(false, 'scheduled')).toBe(false);
    expect(scheduleTriggerDisabled(true, 'scheduled')).toBe(true);
    expect(scheduleTriggerDisabled(true, 'skipped')).toBe(false);
  });

  it('uses saved dates from reused server bookings, never the proposed date', () => {
    expect(
      readScheduleReceipt(
        { id: 'existing', clientId: 'a', scheduledAt: '2026-10-05T10:00:00.000Z' },
        'a',
      ),
    ).toEqual({ id: 'existing', clientId: 'a', scheduledAt: '2026-10-05T10:00:00.000Z' });
  });

  it.each([
    null,
    {},
    { id: 's', clientId: 'b', scheduledAt: '2026-10-05' },
    { id: 's', clientId: 'a', scheduledAt: 'invalid' },
  ])('does not invent a receipt from malformed or wrong-client data', (response) => {
    expect(readScheduleReceipt(response, 'a')).toBeNull();
  });
});
