import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuditMetadata } from '@cureocity/contracts';
import type { IStorageClient } from '@cureocity/storage';
import type { IMessagingPort, SendResult } from '@cureocity/notifications';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PdfsService } from '../pdfs/pdfs.service';
import { parseLocale } from '../pdfs/pdfs.service';
import { MESSAGING_PORT, STORAGE_CLIENT } from './delivery.module';

export interface SendTreatmentPlanResult {
  sendResult: SendResult;
  pdfUrl: string;
  pdfKey: string;
}

@Injectable()
export class WhatsAppDeliveryService {
  private readonly logger = new Logger(WhatsAppDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pdfs: PdfsService,
    private readonly config: ConfigService,
    @Inject(STORAGE_CLIENT) private readonly storage: IStorageClient,
    @Inject(MESSAGING_PORT) private readonly messaging: IMessagingPort,
  ) {}

  async sendTreatmentPlan(
    psychologistId: string,
    clientId: string,
    localeRaw: string | undefined,
    auditMeta: AuditMetadata,
  ): Promise<SendTreatmentPlanResult> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        psychologistId: true,
        fullNameEncrypted: true,
        contactPhoneEncrypted: true,
        deletedAt: true,
      },
    });
    if (!client || client.deletedAt !== null || client.psychologistId !== psychologistId) {
      throw new NotFoundException('Client not found');
    }

    const locale = parseLocale(localeRaw);
    const pdfBuffer = await this.pdfs.renderTreatmentPlan(psychologistId, clientId, locale);

    const bucket = this.config.get<string>('S3_BUCKET_PDFS') ?? 'cureocity-mind-pdfs';
    const key = `treatment-plans/${clientId}/${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
    await this.storage.put({
      bucket,
      key,
      body: pdfBuffer,
      contentType: 'application/pdf',
      metadata: { clientId, locale },
    });
    const pdfUrl = await this.storage.presignedGetUrl({
      bucket,
      key,
      expiresSec: 7 * 24 * 3600,
    });

    const templateName =
      this.config.get<string>('WATI_TEMPLATE_TREATMENT_PLAN') ?? 'treatment_plan';
    const clientFullName = client.fullNameEncrypted ?? '';
    const firstName = clientFullName.trim().split(/\s+/)[0] ?? clientFullName;
    const sendResult = await this.messaging.sendWhatsApp({
      to: client.contactPhoneEncrypted ?? '',
      templateName,
      templateParams: [firstName],
      mediaUrl: pdfUrl,
    });

    await this.audit.log({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: psychologistId,
      action: 'TREATMENT_PLAN_WHATSAPP_SENT',
      targetType: 'Client',
      targetId: clientId,
      metadata: {
        ...auditMeta,
        templateName,
        outcome: sendResult.outcome,
        ...(sendResult.providerMessageId !== undefined && {
          providerMessageId: sendResult.providerMessageId,
        }),
        ...(sendResult.errorCode !== undefined && { errorCode: sendResult.errorCode }),
        pdfKey: key,
      },
    });

    this.logger.log(
      `Treatment-plan WhatsApp send client=${clientId} outcome=${sendResult.outcome}`,
    );
    return { sendResult, pdfUrl, pdfKey: key };
  }
}
