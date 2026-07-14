import { WatiBackend } from '@cureocity/notifications';
import { writeAudit } from './audit';
import { careNudgeTemplate, type CareNudgeKind } from './care-nudge';
import { istDayKey } from './care-streak';
import { prisma } from './prisma';

/**
 * CG4 — the outbound send path. One entry point: record the DECISION first
 * (SENT / SUPPRESSED / FAILED CareNudge row — suppressed rows prove the
 * negative), audit with literal actions, then deliver via the WATI
 * template API. Bodies are Meta-approved templates; the only parameter we
 * pass is the first name — DISCREET by construction (no clinical
 * vocabulary reaches a lock screen).
 *
 * Missing WATI env or template env → the nudge records as SUPPRESSED
 * 'channel_unconfigured' and the in-app surfaces carry the loop alone.
 */

export interface CareNudgeTarget {
  careUserId: string;
  phone: string | null;
  firstName: string;
}

export type CareNudgeSendResult = 'SENT' | 'SUPPRESSED' | 'FAILED' | 'DUPLICATE';

export async function recordAndSendCareNudge(
  target: CareNudgeTarget,
  kind: CareNudgeKind | 'REPORT_READY',
): Promise<CareNudgeSendResult> {
  const istDay = istDayKey(new Date());

  const template = careNudgeTemplate(kind);
  const watiBase = process.env['WATI_API_BASE'];
  const watiToken = process.env['WATI_BEARER_TOKEN'];

  let status: 'SENT' | 'SUPPRESSED' | 'FAILED';
  let reason: string | null = null;
  let providerMessageId: string | null = null;

  if (!template || !watiBase || !watiToken) {
    status = 'SUPPRESSED';
    reason = 'channel_unconfigured';
  } else if (!target.phone) {
    status = 'SUPPRESSED';
    reason = 'no_phone';
  } else {
    const backend = new WatiBackend({ apiBase: watiBase, bearerToken: watiToken });
    const result = await backend.sendWhatsApp({
      to: target.phone,
      templateName: template.templateName,
      templateParams: [target.firstName],
    });
    if (result.outcome === 'sent') {
      status = 'SENT';
      providerMessageId = result.providerMessageId ?? null;
    } else {
      status = 'FAILED';
      reason = result.errorCode ?? 'send_failed';
    }
  }

  try {
    const row = await prisma.careNudge.create({
      data: { careUserId: target.careUserId, kind, status, reason, providerMessageId, istDay },
    });
    if (status === 'SENT') {
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'CARE_NUDGE_SENT',
        targetType: 'CareNudge',
        targetId: row.id,
        metadata: { kind, istDay },
      });
    } else if (status === 'SUPPRESSED') {
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'CARE_NUDGE_SUPPRESSED',
        targetType: 'CareNudge',
        targetId: row.id,
        metadata: { kind, istDay, reason },
      });
    }
  } catch (e) {
    // P2002 on (careUserId, kind, istDay) — an idempotent double-fire.
    if ((e as { code?: string }).code === 'P2002') return 'DUPLICATE';
    throw e;
  }
  return status;
}
