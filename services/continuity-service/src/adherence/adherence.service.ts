import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdherenceSummary, AuditMetadata } from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';

interface PerExerciseAgg {
  exerciseId: string;
  assigned: number;
  completed: number;
  lastPrescribedAt: Date | null;
}

@Injectable()
export class AdherenceService {
  private readonly windowDays: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.windowDays = Number(config.get('ADHERENCE_WINDOW_DAYS') ?? 30);
  }

  async summaryFor(
    psychologistId: string,
    clientId: string,
    _auditMeta: AuditMetadata,
  ): Promise<AdherenceSummary> {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.deletedAt !== null) throw new NotFoundException('Client not found');
    if (client.psychologistId !== psychologistId) {
      throw new NotFoundException('Client not found');
    }

    const since = new Date(Date.now() - this.windowDays * 24 * 3600 * 1000);
    const assignments = await this.prisma.exerciseAssignment.findMany({
      where: { clientId, assignedAt: { gte: since } },
    });

    const byStatus = {
      PENDING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      SKIPPED: 0,
      EXPIRED: 0,
    } as Record<string, number>;
    const perEx = new Map<string, PerExerciseAgg>();

    for (const a of assignments) {
      byStatus[a.status]! += 1;
      const existing = perEx.get(a.exerciseId) ?? {
        exerciseId: a.exerciseId,
        assigned: 0,
        completed: 0,
        lastPrescribedAt: null,
      };
      existing.assigned += 1;
      if (a.status === 'COMPLETED') existing.completed += 1;
      if (existing.lastPrescribedAt === null || a.assignedAt > existing.lastPrescribedAt) {
        existing.lastPrescribedAt = a.assignedAt;
      }
      perEx.set(a.exerciseId, existing);
    }

    const totalAssigned = assignments.length;
    const totalCompleted = byStatus['COMPLETED']!;
    const totalSkipped = byStatus['SKIPPED']!;
    const totalExpired = byStatus['EXPIRED']!;
    const totalPending = byStatus['PENDING']! + byStatus['IN_PROGRESS']!;
    const denominator = totalAssigned - totalPending;
    const completionRate = denominator > 0 ? totalCompleted / denominator : null;

    return {
      clientId,
      windowDays: this.windowDays,
      totalAssigned,
      totalCompleted,
      totalSkipped,
      totalExpired,
      totalPending,
      completionRate,
      perExercise: Array.from(perEx.values()).map((p) => ({
        exerciseId: p.exerciseId,
        lastPrescribedAt: p.lastPrescribedAt?.toISOString() ?? null,
        assigned: p.assigned,
        completed: p.completed,
        completionRate: p.assigned > 0 ? p.completed / p.assigned : 0,
      })),
      computedAt: new Date().toISOString(),
    };
  }
}
