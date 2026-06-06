import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PDF_RENDERER } from '../renderer/renderer.module';
import type { IPdfRenderer } from '../renderer/pdf-renderer.types';
import { renderSessionNoteHtml } from '../templates/session-note.template';
import {
  renderTreatmentPlanHtml,
  type TreatmentPlanExercise,
  type TreatmentPlanGoal,
} from '../templates/treatment-plan.template';
import { isSupportedLocale, type Locale } from '../i18n/strings';

@Injectable()
export class PdfsService {
  private readonly logger = new Logger(PdfsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PDF_RENDERER) private readonly renderer: IPdfRenderer,
  ) {}

  async renderSessionNote(
    psychologistId: string,
    sessionId: string,
    locale: Locale,
  ): Promise<Buffer> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { client: true, therapyNote: true, noteDraft: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.psychologistId !== psychologistId) {
      this.logger.warn(`Cross-tenant PDF: psy=${psychologistId} session=${sessionId}`);
      throw new NotFoundException('Session not found');
    }

    // Prefer signed TherapyNote; fall back to NoteDraft.content for in-progress sessions.
    const noteContent =
      (session.therapyNote?.content as unknown as TherapyNoteV1 | undefined) ??
      (session.noteDraft?.content as unknown as TherapyNoteV1 | null);
    if (!noteContent) {
      throw new NotFoundException('No note content available yet for this session');
    }

    const durationMs =
      session.endedAt && session.startedAt
        ? session.endedAt.getTime() - session.startedAt.getTime()
        : null;

    const html = renderSessionNoteHtml({
      note: noteContent,
      clientFullName: session.client.fullName,
      sessionId: session.id,
      // Sprint 19 — Session.modality is nullable for intake sessions.
      // PDF rendering falls back to the session kind label.
      modality: session.modality ?? session.kind,
      scheduledAt: session.scheduledAt.toISOString().slice(0, 10),
      durationMs,
      signedBy: session.therapyNote?.signedBy ?? null,
      signedAt: session.therapyNote?.signedAt?.toISOString() ?? null,
      locale,
    });

    const pdf = await this.renderer.render({ html });

    await this.audit.log({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: psychologistId,
      action: 'NOTE_DRAFT_VIEWED',
      targetType: 'Session',
      targetId: sessionId,
      metadata: {
        pdfType: 'session_note',
        locale,
        sizeBytes: pdf.byteLength,
      },
    });

    return pdf;
  }

  async renderTreatmentPlan(
    psychologistId: string,
    clientId: string,
    locale: Locale,
  ): Promise<Buffer> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: {
        psychologist: true,
        modalityState: true,
        exerciseAssignments: {
          where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
          orderBy: { assignedAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!client || client.deletedAt !== null) throw new NotFoundException('Client not found');
    if (client.psychologistId !== psychologistId) {
      this.logger.warn(`Cross-tenant PDF: psy=${psychologistId} client=${clientId}`);
      throw new NotFoundException('Client not found');
    }

    const goals: TreatmentPlanGoal[] = (
      (client.modalityState?.goals as unknown as Array<{
        description: string;
        achieved?: boolean;
      }>) ?? []
    ).map((g) => ({
      description: g.description,
      achieved: g.achieved === true,
    }));

    const exercises: TreatmentPlanExercise[] = client.exerciseAssignments.map((a) => ({
      title: a.exerciseId.replace(/_/g, ' '),
      description: a.therapistNote ?? '',
      dueAt: a.dueAt?.toISOString().slice(0, 10) ?? null,
    }));

    const html = renderTreatmentPlanHtml({
      clientFullName: client.fullName,
      psychologistFullName: client.psychologist.fullName,
      modality: client.modalityState?.modality ?? client.preferredModality ?? 'CBT',
      currentPhase:
        client.modalityState?.currentPhase ?? (locale === 'en' ? 'getting started' : '...'),
      goals,
      exercises,
      locale,
    });
    const pdf = await this.renderer.render({ html });

    await this.audit.log({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: psychologistId,
      action: 'CLIENT_BRIEFING_VIEWED',
      targetType: 'Client',
      targetId: clientId,
      metadata: {
        pdfType: 'treatment_plan',
        locale,
        sizeBytes: pdf.byteLength,
      },
    });

    return pdf;
  }
}

export function parseLocale(raw: string | undefined): Locale {
  if (raw && isSupportedLocale(raw)) return raw;
  return 'en';
}
