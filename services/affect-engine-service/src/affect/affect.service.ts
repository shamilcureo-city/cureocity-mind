import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AffectFeature } from '@cureocity/contracts';
import type {
  AffectBaseline,
  AffectDeviation,
  AffectSessionPoint,
  AffectTrend,
  AuditMetadata,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { mean, sigmaDistance, stddev } from './affect-stats';

@Injectable()
export class AffectService {
  private readonly logger = new Logger(AffectService.name);
  private readonly minSessions: number;
  private readonly windowSessions: number;
  private readonly sigmaThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.minSessions = Number(config.get('AFFECT_BASELINE_MIN_SESSIONS') ?? 4);
    this.windowSessions = Number(config.get('AFFECT_BASELINE_WINDOW_SESSIONS') ?? 10);
    this.sigmaThreshold = Number(config.get('AFFECT_DEVIATION_SIGMA') ?? 1.5);
  }

  async getBaseline(
    psychologistId: string,
    clientId: string,
    auditMeta: AuditMetadata,
  ): Promise<AffectBaseline> {
    await this.assertClientOwnership(psychologistId, clientId);
    const points = await this.loadSessionPoints(clientId);
    const baseline = this.computeBaseline(clientId, points);

    await this.audit.log({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: psychologistId,
      action: 'AFFECT_BASELINE_VIEWED',
      targetType: 'Client',
      targetId: clientId,
      metadata: {
        ...auditMeta,
        status: baseline.status,
        sessionsUsed: baseline.sessionsUsed,
      },
    });

    return baseline;
  }

  async getTrend(
    psychologistId: string,
    clientId: string,
    auditMeta: AuditMetadata,
  ): Promise<AffectTrend> {
    await this.assertClientOwnership(psychologistId, clientId);
    const points = await this.loadSessionPoints(clientId);
    const baseline = this.computeBaseline(clientId, points);
    const deviations = this.findDeviations(baseline, points);

    await this.audit.log({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: psychologistId,
      action: 'AFFECT_TREND_VIEWED',
      targetType: 'Client',
      targetId: clientId,
      metadata: {
        ...auditMeta,
        baselineStatus: baseline.status,
        pointCount: points.length,
        deviationCount: deviations.length,
      },
    });

    return {
      clientId,
      baseline,
      points,
      deviations,
      sigmaThreshold: this.sigmaThreshold,
    };
  }

  /**
   * Loads completed sessions for a client (newest first), reads their
   * NoteDraft.affectFeatures, and reduces to a per-session mean point.
   * Sessions without affect features are dropped.
   */
  private async loadSessionPoints(clientId: string): Promise<AffectSessionPoint[]> {
    const sessions = await this.prisma.session.findMany({
      where: { clientId, status: 'COMPLETED', endedAt: { not: null } },
      include: { noteDraft: true },
      orderBy: { endedAt: 'desc' },
      take: this.windowSessions,
    });

    const points: AffectSessionPoint[] = [];
    for (const s of sessions) {
      const features = s.noteDraft?.affectFeatures as unknown as AffectFeature[] | null;
      if (!features || features.length === 0) continue;
      points.push({
        sessionId: s.id,
        endedAt: s.endedAt!.toISOString(),
        meanValence: mean(features.map((f) => f.valence)),
        meanArousal: mean(features.map((f) => f.arousal)),
        sampleCount: features.length,
      });
    }
    return points;
  }

  /**
   * Public for testing (exported via direct import in unit tests). Returns
   * an AffectBaseline with status INSUFFICIENT_DATA when fewer than
   * `minSessions` points are available; otherwise ESTABLISHED with mean +
   * sample stddev across the points.
   */
  computeBaseline(clientId: string, points: AffectSessionPoint[]): AffectBaseline {
    const now = new Date().toISOString();
    if (points.length < this.minSessions) {
      return {
        clientId,
        status: 'INSUFFICIENT_DATA',
        sessionsUsed: points.length,
        windowSessions: this.windowSessions,
        minSessions: this.minSessions,
        valence: null,
        arousal: null,
        computedAt: now,
      };
    }
    const valences = points.map((p) => p.meanValence);
    const arousals = points.map((p) => p.meanArousal);
    return {
      clientId,
      status: 'ESTABLISHED',
      sessionsUsed: points.length,
      windowSessions: this.windowSessions,
      minSessions: this.minSessions,
      valence: { mean: mean(valences), stddev: stddev(valences) },
      arousal: { mean: mean(arousals), stddev: stddev(arousals) },
      computedAt: now,
    };
  }

  /**
   * Finds points whose valence or arousal sits outside ±sigmaThreshold from
   * the baseline mean. Returns empty when status=INSUFFICIENT_DATA.
   * Messages use neutral, descriptive language — no clinical interpretation.
   */
  findDeviations(baseline: AffectBaseline, points: AffectSessionPoint[]): AffectDeviation[] {
    if (
      baseline.status !== 'ESTABLISHED' ||
      baseline.valence === null ||
      baseline.arousal === null
    ) {
      return [];
    }
    const out: AffectDeviation[] = [];
    for (const p of points) {
      const valSigma = sigmaDistance(p.meanValence, baseline.valence.mean, baseline.valence.stddev);
      if (Math.abs(valSigma) >= this.sigmaThreshold) {
        out.push({
          sessionId: p.sessionId,
          endedAt: p.endedAt,
          dimension: 'valence',
          sigma: round2(valSigma),
          message: `Mean valence ${valSigma > 0 ? 'above' : 'below'} baseline by ${Math.abs(valSigma).toFixed(2)}σ`,
        });
      }
      const arSigma = sigmaDistance(p.meanArousal, baseline.arousal.mean, baseline.arousal.stddev);
      if (Math.abs(arSigma) >= this.sigmaThreshold) {
        out.push({
          sessionId: p.sessionId,
          endedAt: p.endedAt,
          dimension: 'arousal',
          sigma: round2(arSigma),
          message: `Mean arousal ${arSigma > 0 ? 'above' : 'below'} baseline by ${Math.abs(arSigma).toFixed(2)}σ`,
        });
      }
    }
    return out;
  }

  private async assertClientOwnership(psychologistId: string, clientId: string): Promise<void> {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.deletedAt !== null) throw new NotFoundException('Client not found');
    if (client.psychologistId !== psychologistId) {
      this.logger.warn(`Cross-tenant affect access: psy=${psychologistId} client=${clientId}`);
      throw new NotFoundException('Client not found');
    }
  }
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}
