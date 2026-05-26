import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdvancementSuggestion,
  AuditMetadata,
  CreateTransitionInput,
  CreateWorkflowInput,
  ModalityState,
  ModalityStateWithHistory,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  toModalityState,
  toModalityStateWithHistory,
  toModalityTransition,
} from './workflow.mappers';

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    psychologistId: string,
    dto: CreateWorkflowInput,
    auditMeta: AuditMetadata,
  ): Promise<ModalityState> {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client || client.deletedAt !== null) {
      throw new NotFoundException('Client not found');
    }
    if (client.psychologistId !== psychologistId) {
      this.logger.warn(
        `Cross-tenant workflow create: psy=${psychologistId} client=${dto.clientId}`,
      );
      throw new NotFoundException('Client not found');
    }

    const goalsWithDefaults = dto.goals.map((g) => ({
      ...g,
      achieved: g.achieved ?? false,
    }));

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.modalityState.create({
          data: {
            clientId: dto.clientId,
            psychologistId,
            modality: dto.modality,
            currentPhase: dto.initialPhase,
            state: {} as Prisma.InputJsonValue,
            goals: goalsWithDefaults as unknown as Prisma.InputJsonValue,
          },
        });
        await this.audit.log(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: psychologistId,
            action: 'WORKFLOW_CREATED',
            targetType: 'ModalityState',
            targetId: row.id,
            metadata: {
              ...auditMeta,
              clientId: dto.clientId,
              modality: dto.modality,
              initialPhase: dto.initialPhase,
              goalCount: goalsWithDefaults.length,
            },
          },
          tx,
        );
        return row;
      });
      return toModalityState(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          `A workflow already exists for client ${dto.clientId}. End it before starting a new one.`,
        );
      }
      throw e;
    }
  }

  async get(
    psychologistId: string,
    workflowId: string,
    _auditMeta: AuditMetadata,
  ): Promise<ModalityStateWithHistory> {
    const state = await this.fetchOwned(psychologistId, workflowId);
    const transitions = await this.prisma.modalityTransition.findMany({
      where: { stateId: workflowId },
      orderBy: { occurredAt: 'asc' },
    });
    return toModalityStateWithHistory(state, transitions);
  }

  async recordTransition(
    psychologistId: string,
    workflowId: string,
    dto: CreateTransitionInput,
    auditMeta: AuditMetadata,
  ): Promise<ModalityStateWithHistory> {
    const state = await this.fetchOwned(psychologistId, workflowId);
    if (state.completedAt !== null) {
      throw new BadRequestException('Cannot transition a completed workflow');
    }
    if (dto.toPhase === state.currentPhase) {
      throw new BadRequestException(`Workflow is already in phase "${state.currentPhase}"`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.modalityTransition.create({
        data: {
          stateId: workflowId,
          fromPhase: state.currentPhase,
          toPhase: dto.toPhase,
          trigger: 'PSYCHOLOGIST_MANUAL',
          reason: dto.reason,
          psychologistId,
          evidence:
            dto.evidence === undefined ? Prisma.JsonNull : (dto.evidence as Prisma.InputJsonValue),
        },
      });
      const updatedState = await tx.modalityState.update({
        where: { id: workflowId },
        data: { currentPhase: dto.toPhase },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'WORKFLOW_PHASE_TRANSITIONED',
          targetType: 'ModalityState',
          targetId: workflowId,
          metadata: {
            ...auditMeta,
            fromPhase: state.currentPhase,
            toPhase: dto.toPhase,
            transitionId: transition.id,
            trigger: 'PSYCHOLOGIST_MANUAL',
          },
        },
        tx,
      );
      const allTransitions = await tx.modalityTransition.findMany({
        where: { stateId: workflowId },
        orderBy: { occurredAt: 'asc' },
      });
      return { state: updatedState, transitions: allTransitions };
    });

    return toModalityStateWithHistory(result.state, result.transitions);
  }

  /**
   * Phase advancement suggestion — proper implementation lands in Sprint 3 PR 2
   * once @cureocity/clinical ships. Here we return a null suggestion so the
   * endpoint contract is in place.
   */
  async getAdvancementSuggestion(
    psychologistId: string,
    workflowId: string,
    _auditMeta: AuditMetadata,
  ): Promise<AdvancementSuggestion> {
    const state = await this.fetchOwned(psychologistId, workflowId);
    return {
      workflowId: state.id,
      currentPhase: state.currentPhase,
      suggestedPhase: null,
      confidence: 0,
      rationale: 'Advancement evaluator ships in Sprint 3 PR 2 (@cureocity/clinical).',
      signals: {},
    };
  }

  private async fetchOwned(psychologistId: string, workflowId: string) {
    const row = await this.prisma.modalityState.findUnique({ where: { id: workflowId } });
    if (!row) throw new NotFoundException('Workflow not found');
    if (row.psychologistId !== psychologistId) {
      this.logger.warn(
        `Cross-tenant workflow access: psy=${psychologistId} workflow=${workflowId}`,
      );
      throw new NotFoundException('Workflow not found');
    }
    return row;
  }

  // Used by toModalityTransition import (keeps tree-shaking happy).
  static _unused = toModalityTransition;
}
