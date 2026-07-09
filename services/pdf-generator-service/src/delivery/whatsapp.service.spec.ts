import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { InMemoryStorageClient } from '@cureocity/storage';
import { NoopBackend } from '@cureocity/notifications';
import { WhatsAppDeliveryService } from './whatsapp.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { PdfsService } from '../pdfs/pdfs.service';

const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const CLIENT_ID = 'cclient11111111111111111x';

const baseClient: {
  psychologistId: string;
  fullNameEncrypted: string;
  contactPhoneEncrypted: string;
  deletedAt: Date | null;
} = {
  psychologistId: PSY_ID,
  fullNameEncrypted: 'Riya Sharma',
  contactPhoneEncrypted: '+919900000000',
  deletedAt: null,
};

function makeDeps(overrides?: {
  client?: typeof baseClient | null;
  configValues?: Record<string, string>;
}) {
  const clientFindUnique = vi
    .fn()
    .mockResolvedValue(overrides?.client === undefined ? baseClient : overrides.client);
  const prisma = { client: { findUnique: clientFindUnique } } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  const pdfs = {
    renderTreatmentPlan: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4\n%fake')),
  } as unknown as PdfsService;
  const configValues: Record<string, string> = {
    S3_BUCKET_PDFS: 'cureocity-mind-pdfs',
    WATI_TEMPLATE_TREATMENT_PLAN: 'treatment_plan',
    ...overrides?.configValues,
  };
  const config = {
    get: (key: string) => configValues[key],
  } as unknown as ConfigService;
  const storage = new InMemoryStorageClient();
  const messaging = new NoopBackend();

  return {
    prisma,
    audit,
    pdfs,
    config,
    storage,
    messaging,
    clientFindUnique,
  };
}

describe('WhatsAppDeliveryService.sendTreatmentPlan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders PDF, uploads to storage, sends via WATI, audits', async () => {
    const deps = makeDeps();
    const svc = new WhatsAppDeliveryService(
      deps.prisma,
      deps.audit,
      deps.pdfs,
      deps.config,
      deps.storage,
      deps.messaging,
    );

    const result = await svc.sendTreatmentPlan(PSY_ID, CLIENT_ID, 'en', { requestId: 'r1' });

    expect(result.sendResult.outcome).toBe('sent');
    expect(result.pdfKey).toMatch(/^treatment-plans\/cclient/);
    expect(result.pdfUrl).toBeTruthy();
    expect(deps.pdfs.renderTreatmentPlan).toHaveBeenCalledWith(PSY_ID, CLIENT_ID, 'en');
    expect(deps.messaging.calls).toHaveLength(1);
    const sent = deps.messaging.calls[0]!;
    expect(sent.type).toBe('whatsapp');
    if (sent.type === 'whatsapp') {
      expect(sent.req.to).toBe('+919900000000');
      expect(sent.req.templateName).toBe('treatment_plan');
      expect(sent.req.templateParams).toEqual(['Riya']); // first name only
      expect(sent.req.mediaUrl).toBeTruthy();
    }
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TREATMENT_PLAN_WHATSAPP_SENT',
        targetType: 'Client',
        targetId: CLIENT_ID,
        metadata: expect.objectContaining({
          templateName: 'treatment_plan',
          outcome: 'sent',
        }),
      }),
    );
  });

  it('rejects 404 for cross-tenant client (no leak)', async () => {
    const deps = makeDeps({ client: { ...baseClient, psychologistId: OTHER_PSY_ID } });
    const svc = new WhatsAppDeliveryService(
      deps.prisma,
      deps.audit,
      deps.pdfs,
      deps.config,
      deps.storage,
      deps.messaging,
    );

    await expect(svc.sendTreatmentPlan(PSY_ID, CLIENT_ID, undefined, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deps.pdfs.renderTreatmentPlan).not.toHaveBeenCalled();
    expect(deps.messaging.calls).toHaveLength(0);
  });

  it('rejects 404 for soft-deleted client', async () => {
    const deps = makeDeps({ client: { ...baseClient, deletedAt: new Date() } });
    const svc = new WhatsAppDeliveryService(
      deps.prisma,
      deps.audit,
      deps.pdfs,
      deps.config,
      deps.storage,
      deps.messaging,
    );

    await expect(svc.sendTreatmentPlan(PSY_ID, CLIENT_ID, undefined, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('propagates transient failure outcome from messaging port (caller retries)', async () => {
    const deps = makeDeps();
    deps.messaging = new NoopBackend({ simulateOutcome: 'transient_failure' });
    const svc = new WhatsAppDeliveryService(
      deps.prisma,
      deps.audit,
      deps.pdfs,
      deps.config,
      deps.storage,
      deps.messaging,
    );

    const result = await svc.sendTreatmentPlan(PSY_ID, CLIENT_ID, undefined, {});

    expect(result.sendResult.outcome).toBe('transient_failure');
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: 'transient_failure' }),
      }),
    );
  });

  it('uses configured template name override', async () => {
    const deps = makeDeps({
      configValues: { WATI_TEMPLATE_TREATMENT_PLAN: 'treatment_plan_hi' },
    });
    const svc = new WhatsAppDeliveryService(
      deps.prisma,
      deps.audit,
      deps.pdfs,
      deps.config,
      deps.storage,
      deps.messaging,
    );
    await svc.sendTreatmentPlan(PSY_ID, CLIENT_ID, 'hi', {});
    const sent = deps.messaging.calls[0];
    if (sent && sent.type === 'whatsapp') {
      expect(sent.req.templateName).toBe('treatment_plan_hi');
    } else {
      throw new Error('expected a whatsapp send');
    }
  });
});
