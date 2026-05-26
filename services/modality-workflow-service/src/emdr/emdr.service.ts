import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuditMetadata,
  CreateEmdrTargetInput,
  EmdrTarget,
  PreparationCompleteInput,
  UpdateEmdrTargetInput,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class EmdrService {
  private readonly logger = new Logger(EmdrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async markPreparationComplete(
    psychologistId: string,
    workflowId: string,
    dto: PreparationCompleteInput,
    auditMeta: AuditMetadata,
  ): Promise<{ workflowId: string; preparationComplete: true }> {
    const state = await this.fetchOwnedEmdr(psychologistId, workflowId);
    const existingState = (state.state ?? {}) as Record<string, unknown>;

    await this.prisma.$transaction(async (tx) => {
      await tx.modalityState.update({
        where: { id: workflowId },
        data: {
          state: {
            ...existingState,
            preparationComplete: true,
            preparationCompletedAt: new Date().toISOString(),
            preparationConfirmations: {
              safePlaceInstalled: true,
              resourcesAdequate: true,
              dissociationScreened: true,
              ...(dto.notes !== undefined && { notes: dto.notes }),
            },
          } as Prisma.InputJsonValue,
        },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'EMDR_PREPARATION_COMPLETED',
          targetType: 'ModalityState',
          targetId: workflowId,
          metadata: { ...auditMeta, notes: dto.notes ?? null },
        },
        tx,
      );
    });

    return { workflowId, preparationComplete: true };
  }

  async addTarget(
    psychologistId: string,
    workflowId: string,
    dto: CreateEmdrTargetInput,
    auditMeta: AuditMetadata,
  ): Promise<EmdrTarget> {
    await this.fetchOwnedEmdr(psychologistId, workflowId);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.emdrTarget.create({
        data: {
          stateId: workflowId,
          label: dto.label,
          image: dto.image,
          negativeCognition: dto.negativeCognition,
          positiveCognition: dto.positiveCognition,
          vocStart: dto.vocStart,
          sudsStart: dto.sudsStart,
          emotion: dto.emotion,
          bodyLocation: dto.bodyLocation,
          status: 'identified',
        },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'EMDR_TARGET_ADDED',
          targetType: 'EmdrTarget',
          targetId: row.id,
          metadata: {
            ...auditMeta,
            workflowId,
            sudsStart: dto.sudsStart,
            vocStart: dto.vocStart,
          },
        },
        tx,
      );
      return row;
    });
    return toEmdrTarget(created);
  }

  async listTargets(psychologistId: string, workflowId: string): Promise<EmdrTarget[]> {
    await this.fetchOwnedEmdr(psychologistId, workflowId);
    const rows = await this.prisma.emdrTarget.findMany({
      where: { stateId: workflowId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toEmdrTarget);
  }

  async updateTarget(
    psychologistId: string,
    workflowId: string,
    targetId: string,
    dto: UpdateEmdrTargetInput,
    auditMeta: AuditMetadata,
  ): Promise<EmdrTarget> {
    await this.fetchOwnedEmdr(psychologistId, workflowId);
    const existing = await this.prisma.emdrTarget.findUnique({ where: { id: targetId } });
    if (!existing || existing.stateId !== workflowId) {
      throw new NotFoundException('Target not found');
    }

    const noteAppend = dto.progressNote
      ? `${existing.notes ? existing.notes + '\n---\n' : ''}[${new Date().toISOString()}] ${dto.progressNote}`
      : existing.notes;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.emdrTarget.update({
        where: { id: targetId },
        data: {
          ...(dto.sudsCurrent !== undefined && { sudsCurrent: dto.sudsCurrent }),
          ...(dto.vocCurrent !== undefined && { vocCurrent: dto.vocCurrent }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.bilateralSetsTotal !== undefined && {
            bilateralSetsTotal: dto.bilateralSetsTotal,
          }),
          ...(dto.progressNote !== undefined && { notes: noteAppend }),
        },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'EMDR_TARGET_UPDATED',
          targetType: 'EmdrTarget',
          targetId,
          metadata: {
            ...auditMeta,
            workflowId,
            before: {
              sudsCurrent: existing.sudsCurrent,
              vocCurrent: existing.vocCurrent,
              status: existing.status,
            },
            after: {
              sudsCurrent: dto.sudsCurrent,
              vocCurrent: dto.vocCurrent,
              status: dto.status,
            },
          },
        },
        tx,
      );
      return row;
    });
    return toEmdrTarget(updated);
  }

  private async fetchOwnedEmdr(psychologistId: string, workflowId: string) {
    const row = await this.prisma.modalityState.findUnique({ where: { id: workflowId } });
    if (!row) throw new NotFoundException('Workflow not found');
    if (row.psychologistId !== psychologistId) {
      this.logger.warn(`Cross-tenant EMDR access: psy=${psychologistId} workflow=${workflowId}`);
      throw new NotFoundException('Workflow not found');
    }
    if (row.modality !== 'EMDR') {
      throw new BadRequestException(
        `Workflow modality is ${row.modality}; EMDR endpoints only operate on EMDR workflows`,
      );
    }
    return row;
  }
}

function toEmdrTarget(row: {
  id: string;
  stateId: string;
  label: string;
  image: string;
  negativeCognition: string;
  positiveCognition: string;
  vocStart: number;
  vocCurrent: number | null;
  sudsStart: number;
  sudsCurrent: number | null;
  emotion: string;
  bodyLocation: string;
  status: EmdrTarget['status'];
  bilateralSetsTotal: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): EmdrTarget {
  return {
    id: row.id,
    stateId: row.stateId,
    label: row.label,
    image: row.image,
    negativeCognition: row.negativeCognition,
    positiveCognition: row.positiveCognition,
    vocStart: row.vocStart,
    vocCurrent: row.vocCurrent,
    sudsStart: row.sudsStart,
    sudsCurrent: row.sudsCurrent,
    emotion: row.emotion,
    bodyLocation: row.bodyLocation,
    status: row.status,
    bilateralSetsTotal: row.bilateralSetsTotal,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
