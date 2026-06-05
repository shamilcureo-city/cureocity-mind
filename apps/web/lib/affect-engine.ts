import type {
  AffectBaseline,
  AffectDeviation,
  AffectFeature,
  AffectSessionPoint,
} from '@cureocity/contracts';
import { mean, round2, sigmaDistance, stddev } from './affect-stats';
import { prisma } from './prisma';

/**
 * Affect-engine logic in apps/web. Ported from
 * services/affect-engine-service/src/affect/affect.service.ts —
 * algorithm is identical, only the persistence layer differs (direct
 * Prisma rather than the service's PrismaService DI wrapper).
 */

export const AFFECT_MIN_SESSIONS = Number(process.env['AFFECT_BASELINE_MIN_SESSIONS'] ?? 4);
export const AFFECT_WINDOW_SESSIONS = Number(
  process.env['AFFECT_BASELINE_WINDOW_SESSIONS'] ?? 10,
);
export const AFFECT_SIGMA_THRESHOLD = Number(process.env['AFFECT_DEVIATION_SIGMA'] ?? 1.5);

export async function loadSessionPoints(clientId: string): Promise<AffectSessionPoint[]> {
  const sessions = await prisma.session.findMany({
    where: { clientId, status: 'COMPLETED', endedAt: { not: null } },
    include: { noteDraft: true },
    orderBy: { endedAt: 'desc' },
    take: AFFECT_WINDOW_SESSIONS,
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

export function computeBaseline(
  clientId: string,
  points: AffectSessionPoint[],
): AffectBaseline {
  const now = new Date().toISOString();
  if (points.length < AFFECT_MIN_SESSIONS) {
    return {
      clientId,
      status: 'INSUFFICIENT_DATA',
      sessionsUsed: points.length,
      windowSessions: AFFECT_WINDOW_SESSIONS,
      minSessions: AFFECT_MIN_SESSIONS,
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
    windowSessions: AFFECT_WINDOW_SESSIONS,
    minSessions: AFFECT_MIN_SESSIONS,
    valence: { mean: mean(valences), stddev: stddev(valences) },
    arousal: { mean: mean(arousals), stddev: stddev(arousals) },
    computedAt: now,
  };
}

export function findDeviations(
  baseline: AffectBaseline,
  points: AffectSessionPoint[],
): AffectDeviation[] {
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
    if (Math.abs(valSigma) >= AFFECT_SIGMA_THRESHOLD) {
      out.push({
        sessionId: p.sessionId,
        endedAt: p.endedAt,
        dimension: 'valence',
        sigma: round2(valSigma),
        message: `Mean valence ${valSigma > 0 ? 'above' : 'below'} baseline by ${Math.abs(valSigma).toFixed(2)}σ`,
      });
    }
    const arSigma = sigmaDistance(p.meanArousal, baseline.arousal.mean, baseline.arousal.stddev);
    if (Math.abs(arSigma) >= AFFECT_SIGMA_THRESHOLD) {
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
