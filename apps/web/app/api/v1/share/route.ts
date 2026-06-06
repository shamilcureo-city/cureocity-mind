import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import type {
  PatientShareArtefactType as PrismaArtefactType,
  PatientShareChannel as PrismaChannel,
  PatientShareStatus as PrismaStatus,
} from '@prisma/client';
import type { SendResult } from '@cureocity/notifications';
import {
  ClinicalLocaleSchema,
  ShareInputSchema,
  type ClinicalLocale,
  type PatientShareChannel,
  type PatientShareSnapshot,
  type ShareInput,
  type ShareResultEntry,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { shareChannels } from '@/lib/share-channels';
import { buildSnapshot, SnapshotBuildError } from '@/lib/share-snapshots';
import { toPatientShare } from '@/lib/clinical-mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Token expiry — patients can re-open the portal for this long. */
const SHARE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * POST /api/v1/share
 *
 * Fans out one share request to N channels, producing one
 * PatientShare row per channel. Each row carries a snapshot of the
 * artefact body so the patient view is stable even if the source is
 * later edited or deleted.
 *
 * Side effects per channel:
 *   - WHATSAPP   → WATI sendTemplateMessage with a short copy +
 *                  portal URL; falls back to Noop in dev
 *   - EMAIL      → SendGrid with a subject + portal URL; falls back
 *                  to Noop in dev
 *   - PORTAL_LINK → no send; just creates the row + returns the URL
 *                  for the therapist to copy and share manually
 *
 * Every row writes PATIENT_ARTEFACT_SHARED with the channel + outcome.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const body = await parseJson(req, ShareInputSchema);
  if (!body.ok) return body.response;
  const input: ShareInput = body.value;

  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: {
      id: true,
      psychologistId: true,
      fullName: true,
      contactPhone: true,
      contactEmail: true,
      preferredLanguage: true,
      deletedAt: true,
    },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const language: ClinicalLocale = resolveLanguage(input.language, client.preferredLanguage);

  // Build the artefact snapshot once; reused across channels.
  let snapshotResult;
  try {
    snapshotResult = await buildSnapshot({
      ref: input.artefact,
      clientId: client.id,
      psychologistId: auth.value.psychologistId,
      language,
    });
  } catch (e) {
    if (e instanceof SnapshotBuildError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }
  if (!snapshotResult) {
    return NextResponse.json({ error: 'Artefact not found' }, { status: 404 });
  }

  const { snapshot, subject, sessionId } = snapshotResult;
  const portalOrigin = req.nextUrl.origin;
  const channels = dedup(input.channels);
  const channelResults: ShareResultEntry[] = [];

  for (const channel of channels) {
    const toContact =
      channel === 'WHATSAPP'
        ? client.contactPhone
        : channel === 'EMAIL'
          ? client.contactEmail
          : null;

    if (channel === 'WHATSAPP' && !toContact) {
      channelResults.push({
        channel,
        shareId: 'n/a',
        status: 'PERMANENT_FAILURE',
        portalUrl: '',
        errorCode: 'NO_CONTACT_PHONE',
        errorDetail: 'Client has no contactPhone on file.',
      });
      continue;
    }
    if (channel === 'EMAIL' && !toContact) {
      channelResults.push({
        channel,
        shareId: 'n/a',
        status: 'PERMANENT_FAILURE',
        portalUrl: '',
        errorCode: 'NO_CONTACT_EMAIL',
        errorDetail: 'Client has no contactEmail on file.',
      });
      continue;
    }

    const shareToken = generateShareToken();
    const artefactId = extractArtefactId(input);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SHARE_EXPIRY_MS);

    const row = await prisma.patientShare.create({
      data: {
        clientId: client.id,
        psychologistId: auth.value.psychologistId,
        sessionId: sessionId ?? null,
        artefactType: input.artefact.artefactType as PrismaArtefactType,
        artefactId,
        channel: channel as PrismaChannel,
        status: 'PENDING' as PrismaStatus,
        shareToken,
        language,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        subject,
        toContact: toContact ?? null,
        expiresAt,
      },
    });
    const portalUrl = `${portalOrigin}/p/${shareToken}`;

    let sendResult: SendResult | { outcome: 'sent' } = { outcome: 'sent' };
    if (channel !== 'PORTAL_LINK') {
      sendResult = await sendViaChannel({
        channel,
        toContact: toContact!,
        clientFirstName: firstName(client.fullName),
        therapistMessage: input.therapistMessage,
        subject,
        snapshot,
        portalUrl,
        language,
      });
    }

    const nextStatus = mapOutcomeToStatus(sendResult.outcome);
    const sendErrorCode = 'errorCode' in sendResult ? sendResult.errorCode ?? null : null;
    const sendErrorDetail = 'errorDetail' in sendResult ? sendResult.errorDetail ?? null : null;
    const providerMessageId =
      'providerMessageId' in sendResult ? sendResult.providerMessageId ?? null : null;

    const updated = await prisma.patientShare.update({
      where: { id: row.id },
      data: {
        status: nextStatus,
        ...(sendResult.outcome === 'sent' && { sentAt: new Date() }),
        ...(providerMessageId !== null && { providerMessageId }),
        ...(sendErrorCode !== null && { errorCode: sendErrorCode }),
        ...(sendErrorDetail !== null && { errorDetail: sendErrorDetail }),
      },
    });

    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'PATIENT_ARTEFACT_SHARED',
      targetType: 'PatientShare',
      targetId: updated.id,
      metadata: {
        ...auditMetadataFromRequest(req),
        clientId: client.id,
        sessionId: sessionId ?? null,
        artefactType: input.artefact.artefactType,
        channel,
        outcome: sendResult.outcome,
        providerMessageId,
        errorCode: sendErrorCode,
      },
    });

    channelResults.push({
      channel,
      shareId: updated.id,
      status: updated.status,
      portalUrl,
      errorCode: sendErrorCode,
      errorDetail: sendErrorDetail,
    });
  }

  return NextResponse.json({ results: channelResults });
}

// ============================================================================
// Channel send + message composition.
// ============================================================================

interface SendArgs {
  channel: PatientShareChannel;
  toContact: string;
  clientFirstName: string;
  therapistMessage: string | undefined;
  subject: string;
  snapshot: PatientShareSnapshot;
  portalUrl: string;
  language: ClinicalLocale;
}

async function sendViaChannel(args: SendArgs): Promise<SendResult> {
  const channels = shareChannels();
  if (args.channel === 'WHATSAPP') {
    const templateName = process.env['WATI_TEMPLATE_PATIENT_SHARE'] ?? 'patient_share';
    return channels.messaging.sendWhatsApp({
      to: args.toContact,
      templateName,
      // Positional template params: 1=first name, 2=subject, 3=portal URL.
      // The WATI template must declare these; until production templates
      // are approved, the Noop backend captures the call as if sent.
      templateParams: [args.clientFirstName, args.subject, args.portalUrl],
    });
  }
  if (args.channel === 'EMAIL') {
    const intro = args.therapistMessage?.trim();
    const bodyLines = [
      `Hi ${args.clientFirstName},`,
      '',
      intro ? `${intro}` : 'Your therapist has shared something with you.',
      '',
      `Open it here: ${args.portalUrl}`,
      '',
      'This link is private to you. It expires in 30 days.',
      '',
      '— Cureocity Mind',
    ];
    return channels.email.sendEmail({
      to: args.toContact,
      subject: args.subject,
      textBody: bodyLines.join('\n'),
      htmlBody: composeEmailHtml({
        clientFirstName: args.clientFirstName,
        intro: intro ?? null,
        subject: args.subject,
        portalUrl: args.portalUrl,
      }),
    });
  }
  // PORTAL_LINK has no send action — handled by the caller.
  return { outcome: 'sent' };
}

function composeEmailHtml(args: {
  clientFirstName: string;
  intro: string | null;
  subject: string;
  portalUrl: string;
}): string {
  const introBlock = args.intro
    ? `<p style="margin:0 0 16px 0; color:#3c4858">${escapeHtml(args.intro)}</p>`
    : '';
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#1f2933; max-width:560px; margin:0 auto; padding:32px 24px;">
  <h1 style="font-size:18px; margin:0 0 16px 0;">${escapeHtml(args.subject)}</h1>
  <p style="margin:0 0 16px 0;">Hi ${escapeHtml(args.clientFirstName)},</p>
  ${introBlock}
  <p style="margin:0 0 24px 0;">Your therapist has shared something with you. Open it on a private page:</p>
  <p style="margin:0 0 32px 0;">
    <a href="${args.portalUrl}" style="display:inline-block; background:#1f2933; color:#fff; text-decoration:none; padding:10px 18px; border-radius:999px; font-weight:500;">Open the page</a>
  </p>
  <p style="margin:0; font-size:12px; color:#7b8794;">This link is private to you and expires in 30 days.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// Helpers.
// ============================================================================

function generateShareToken(): string {
  // 16 bytes → 22 base64url chars (matches ClientClaimToken convention).
  return randomBytes(16).toString('base64url');
}

function extractArtefactId(input: ShareInput): string {
  switch (input.artefact.artefactType) {
    case 'SIGNED_NOTE':
      return input.artefact.sessionId;
    case 'REFLECTION_QUESTIONS':
      // Reflection questions are not persisted; use the session id as
      // the artefact discriminator. The questions live in the snapshot.
      return input.artefact.sessionId;
    case 'THERAPY_SCRIPT':
      return input.artefact.therapyScriptId;
    case 'TREATMENT_PLAN':
      return input.artefact.treatmentPlanId;
  }
}

function resolveLanguage(
  override: ClinicalLocale | undefined,
  preferred: string,
): ClinicalLocale {
  if (override) return override;
  const parsed = ClinicalLocaleSchema.safeParse(preferred);
  return parsed.success ? parsed.data : 'en';
}

function dedup<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of arr) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return 'there';
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function mapOutcomeToStatus(outcome: SendResult['outcome']): PrismaStatus {
  switch (outcome) {
    case 'sent':
      return 'SENT' as PrismaStatus;
    case 'transient_failure':
      return 'TRANSIENT_FAILURE' as PrismaStatus;
    case 'permanent_failure':
      return 'PERMANENT_FAILURE' as PrismaStatus;
  }
}

// Re-export the mapper for callers that import from this route file
// (e.g. tests). Pure ergonomics.
export const __toPatientShare = toPatientShare;
