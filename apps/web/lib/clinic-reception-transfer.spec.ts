import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReceptionCustodyTransferConflictError,
  transferAllCustody,
  transferClientCustody,
} from './clinic';
import { POST } from '../app/api/v1/clinics/[id]/reassign/route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    client: { findUnique: vi.fn() },
    clinicMembership: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), auditMetadataFromRequest: () => ({}) }));
vi.mock('@/lib/auth-server', () => ({ requirePsychologistId: mocks.auth }));

const from = `c${'z'.repeat(24)}`;
const to = `c${'a'.repeat(24)}`;
const clientId = `c${'c'.repeat(24)}`;

function transaction(
  options: {
    enabledDesk?: string;
    currentOwner?: string;
    linkedRequest?: boolean;
    receptionAppointment?: boolean;
  } = {},
) {
  const events: string[] = [];
  const modelWrites: string[] = [];
  const fallback = new Map<string, { updateMany: ReturnType<typeof vi.fn> }>();
  const db = {
    $executeRaw: vi.fn().mockImplementation(async (_query, key: string) => {
      events.push(`lock:${key}`);
      return 1;
    }),
    $queryRaw: vi.fn().mockImplementation(async (query: TemplateStringsArray) => {
      if (query.join('?').includes('SELECT a."id" FROM "Appointment"')) {
        events.push('reception-appointment');
        return options.receptionAppointment ? [{ id: 'appointment-1' }] : [];
      }
      events.push('client-lock');
      return [{ id: clientId, psychologistId: options.currentOwner ?? from }];
    }),
    receptionSettings: {
      findFirst: vi.fn().mockImplementation(async () => {
        events.push('settings');
        return options.enabledDesk ? { psychologistId: options.enabledDesk } : null;
      }),
    },
    receptionRequest: {
      findFirst: vi.fn().mockImplementation(async () => {
        events.push('reception-history');
        return options.linkedRequest ? { id: 'request-1' } : null;
      }),
    },
    client: {
      update: vi.fn().mockImplementation(async () => {
        events.push('write:client');
        modelWrites.push('client');
        return { id: clientId };
      }),
      updateMany: vi.fn().mockImplementation(async () => {
        events.push('write:client');
        modelWrites.push('client');
        return { count: 2 };
      }),
    },
  };
  const tx = new Proxy(db, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      const model = String(property);
      if (!fallback.has(model)) {
        fallback.set(model, {
          updateMany: vi.fn().mockImplementation(async () => {
            events.push(`write:${model}`);
            modelWrites.push(model);
            return { count: 1 };
          }),
        });
      }
      return fallback.get(model);
    },
  });
  return { tx, events, modelWrites };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('reception custody transfer containment', () => {
  it('checks persistent history before allowing a clean single-client transfer with the pilot off', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'false');
    const { tx, events, modelWrites } = transaction();
    await transferClientCustody(tx as never, {
      clientId,
      fromPsychologistId: from,
      toPsychologistId: to,
    });
    expect(events.slice(0, 6)).toEqual([
      `lock:reception-calendar:${to}`,
      `lock:reception-calendar:${from}`,
      'settings',
      'client-lock',
      'reception-history',
      'reception-appointment',
    ]);
    expect(modelWrites).toContain('session');
    expect(tx.client.update).toHaveBeenCalledWith({
      where: { id: clientId },
      data: { psychologistId: to },
    });
  });

  it('checks persistent history before allowing a clean bulk transfer with the pilot off', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'false');
    const { tx, events } = transaction();
    await expect(
      transferAllCustody(tx as never, { fromPsychologistId: from, toPsychologistId: to }),
    ).resolves.toBe(2);
    expect(events.slice(0, 6)).toEqual([
      `lock:reception-calendar:${to}`,
      `lock:reception-calendar:${from}`,
      'settings',
      'client-lock',
      'reception-history',
      'reception-appointment',
    ]);
  });

  it.each([from, to])(
    'blocks a single transfer when either practitioner has enabled reception: %s',
    async (enabledDesk) => {
      vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
      const { tx, events, modelWrites } = transaction({ enabledDesk });
      await expect(
        transferClientCustody(tx as never, {
          clientId,
          fromPsychologistId: from,
          toPsychologistId: to,
        }),
      ).rejects.toBeInstanceOf(ReceptionCustodyTransferConflictError);
      expect(events).toEqual([
        `lock:reception-calendar:${to}`,
        `lock:reception-calendar:${from}`,
        'settings',
      ]);
      expect(tx.receptionSettings.findFirst).toHaveBeenCalledWith({
        where: { psychologistId: { in: [to, from] }, enabled: true },
        select: { psychologistId: true },
      });
      expect(modelWrites).toEqual([]);
    },
  );

  it('also blocks bulk transfer before locking or changing clients', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
    const { tx, modelWrites } = transaction({ enabledDesk: to });
    await expect(
      transferAllCustody(tx as never, { fromPsychologistId: from, toPsychologistId: to }),
    ).rejects.toThrow('Pause reception for both practitioners');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(modelWrites).toEqual([]);
  });

  it('takes the same lock order for opposite transfer directions', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
    const forward = transaction();
    const reverse = transaction({ currentOwner: to });
    await transferClientCustody(forward.tx as never, {
      clientId,
      fromPsychologistId: from,
      toPsychologistId: to,
    });
    await transferClientCustody(reverse.tx as never, {
      clientId,
      fromPsychologistId: to,
      toPsychologistId: from,
    });
    expect(forward.events.slice(0, 4)).toEqual([
      `lock:reception-calendar:${to}`,
      `lock:reception-calendar:${from}`,
      'settings',
      'client-lock',
    ]);
    expect(reverse.events.slice(0, 4)).toEqual(forward.events.slice(0, 4));
  });

  it('rejects stale single-client ownership instead of bypassing a third practitioner desk', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
    const { tx, modelWrites } = transaction({ currentOwner: 'third-practitioner' });
    await expect(
      transferClientCustody(tx as never, {
        clientId,
        fromPsychologistId: from,
        toPsychologistId: to,
      }),
    ).rejects.toThrow('Client ownership changed');
    expect(modelWrites).toEqual([]);
  });

  it('locks bulk source clients before changing clinical records when both desks are paused', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
    const { tx, events } = transaction();
    await expect(
      transferAllCustody(tx as never, { fromPsychologistId: from, toPsychologistId: to }),
    ).resolves.toBe(2);
    expect(events.slice(0, 4)).toEqual([
      `lock:reception-calendar:${to}`,
      `lock:reception-calendar:${from}`,
      'settings',
      'client-lock',
    ]);
    expect(tx.$queryRaw.mock.calls[0]?.[1]).toBe(from);
    expect(tx.client.updateMany).toHaveBeenCalledWith({
      where: { psychologistId: from },
      data: { psychologistId: to },
    });
  });

  it.each(['true', 'false'])(
    'blocks a paused single-client transfer with linked reception history when pilot=%s',
    async (pilot) => {
      vi.stubEnv('RECEPTION_PILOT_ENABLED', pilot);
      const { tx, events, modelWrites } = transaction({ linkedRequest: true });
      await expect(
        transferClientCustody(tx as never, {
          clientId,
          fromPsychologistId: from,
          toPsychologistId: to,
        }),
      ).rejects.toThrow(
        'Custody transfer is not supported for patients with reception booking history',
      );
      expect(events.at(-1)).toBe('reception-history');
      expect(events.indexOf('client-lock')).toBeLessThan(events.indexOf('reception-history'));
      expect(tx.receptionRequest.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ clientId }, { session: { clientId } }] },
        select: { id: true },
      });
      expect(modelWrites).toEqual([]);
    },
  );

  it.each(['true', 'false'])(
    'blocks a paused single-client transfer after enquiry erasure while its appointment remains when pilot=%s',
    async (pilot) => {
      vi.stubEnv('RECEPTION_PILOT_ENABLED', pilot);
      const { tx, modelWrites } = transaction({ receptionAppointment: true });
      await expect(
        transferClientCustody(tx as never, {
          clientId,
          fromPsychologistId: from,
          toPsychologistId: to,
        }),
      ).rejects.toBeInstanceOf(ReceptionCustodyTransferConflictError);
      const appointmentQuery = tx.$queryRaw.mock.calls[1];
      expect(appointmentQuery?.[0].join('?')).toContain('LEFT JOIN "sessions"');
      expect(appointmentQuery?.[0].join('?')).toContain('a."suppressAutomaticMessages" = true');
      expect(appointmentQuery?.[0].join('?')).toContain('a."clientId" = ? OR s."clientId" = ?');
      expect(appointmentQuery?.slice(1)).toEqual([clientId, clientId]);
      expect(modelWrites).toEqual([]);
    },
  );

  it.each([
    ['true', 'request'],
    ['false', 'request'],
    ['true', 'appointment'],
    ['false', 'appointment'],
  ])(
    'blocks paused bulk transfer of existing %s / %s history before any ownership write',
    async (pilot, kind) => {
      vi.stubEnv('RECEPTION_PILOT_ENABLED', pilot);
      const { tx, events, modelWrites } = transaction({
        linkedRequest: kind === 'request',
        receptionAppointment: kind === 'appointment',
      });
      await expect(
        transferAllCustody(tx as never, { fromPsychologistId: from, toPsychologistId: to }),
      ).rejects.toThrow('A dedicated ownership-transfer workflow is required.');
      const linkedSource = {
        OR: [
          { client: { psychologistId: from } },
          { session: { psychologistId: from } },
          { session: { client: { psychologistId: from } } },
        ],
      };
      expect(tx.receptionRequest.findFirst).toHaveBeenCalledWith({
        where: linkedSource,
        select: { id: true },
      });
      if (kind === 'appointment') {
        const appointmentQuery = tx.$queryRaw.mock.calls[1];
        expect(appointmentQuery?.[0].join('?')).toContain('LEFT JOIN "clients" c');
        expect(appointmentQuery?.[0].join('?')).toContain('LEFT JOIN "clients" sc');
        expect(appointmentQuery?.[0].join('?')).toContain('s."psychologistId" = ?');
        expect(appointmentQuery?.slice(1)).toEqual([from, from, from]);
      }
      expect(events.indexOf('client-lock')).toBeLessThan(events.indexOf('reception-history'));
      expect(modelWrites).toEqual([]);
    },
  );

  it('still requires paused desks when the deployment pilot flag is off', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'false');
    const { tx, modelWrites } = transaction({ enabledDesk: from });
    await expect(
      transferAllCustody(tx as never, { fromPsychologistId: from, toPsychologistId: to }),
    ).rejects.toThrow('Pause reception for both practitioners');
    expect(modelWrites).toEqual([]);
  });
});

describe('reassign API conflict response', () => {
  it.each(['single', 'bulk'])('returns an explicit 409 for blocked %s transfers', async (mode) => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
    const { tx, modelWrites } = transaction({ enabledDesk: from });
    mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: from } });
    mocks.prisma.clinicMembership.findUnique.mockResolvedValue({ role: 'OWNER' });
    mocks.prisma.client.findUnique.mockResolvedValue({
      id: clientId,
      psychologistId: from,
      deletedAt: null,
    });
    mocks.prisma.$transaction.mockImplementation(async (work: (db: unknown) => Promise<unknown>) =>
      work(tx),
    );
    const response = await POST(
      new NextRequest('https://example.test/api/v1/clinics/clinic/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toPsychologistId: to,
          ...(mode === 'single' ? { clientId } : { fromPsychologistId: from }),
        }),
      }),
      { params: Promise.resolve({ id: 'clinic' }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Pause reception for both practitioners before transferring client custody.',
      code: 'RECEPTION_CUSTODY_TRANSFER_CONFLICT',
    });
    expect(modelWrites).toEqual([]);
  });
});
