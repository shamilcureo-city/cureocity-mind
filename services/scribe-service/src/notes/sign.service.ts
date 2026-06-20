import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AuditMetadata,
  NoteEditEntry,
  NoteEditField,
  SignNoteInput,
  TherapyNote,
  TherapyNoteV1,
} from '@cureocity/contracts';
import { TherapyNoteV1Schema } from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// NoteEditField now also spans intake + medical-encounter fields (Sprint
// DV3). The signable SOAP subset is the keys that exist on a TherapyNoteV1.
type SoapField = 'subjective' | 'objective' | 'assessment' | 'plan';
const SIGNABLE_FIELDS: readonly SoapField[] = ['subjective', 'objective', 'assessment', 'plan'];

/**
 * SignService — turns a COMPLETED NoteDraft into a signed TherapyNote.
 *
 * V1 verification chain (Sprint 7 PR 4):
 *   1. sha256(payload) === payloadHashHex                — client did not lie about its own hash
 *   2. sha256(payload) === assertion.challengeHashHex    — assertion proves the same payload
 *   3. note matches TherapyNoteV1 schema                 — defensive re-check
 *   4. edits[].before matches draft.content[field]       — edits derive from the draft we have
 *
 * Full WebAuthn signature verification (against a registered credential
 * public key + RP id + counter monotonicity) lands in Sprint 9 once the
 * registration endpoint exists. The captured assertion is persisted so it
 * can be re-verified retrospectively. Until then, the in-session challenge
 * binding plus auth-guard'd authenticated user is the strongest claim we
 * can make.
 */
@Injectable()
export class SignService {
  private readonly logger = new Logger(SignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async sign(
    psychologistId: string,
    sessionId: string,
    input: SignNoteInput,
    auditMeta: AuditMetadata,
  ): Promise<TherapyNote> {
    const recomputed = createHash('sha256').update(input.payload).digest('hex');
    if (recomputed !== input.payloadHashHex) {
      throw new BadRequestException('payloadHashHex does not match sha256(payload)');
    }
    if (input.assertion && input.assertion.challengeHashHex !== recomputed) {
      throw new BadRequestException(
        'WebAuthn assertion challenge does not match the payload hash — possible replay or substitution',
      );
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { psychologistId: true, status: true },
    });
    if (!session || session.psychologistId !== psychologistId) {
      throw new NotFoundException('Session not found');
    }
    if (session.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Cannot sign a note for a session in ${session.status} state (expected COMPLETED)`,
      );
    }

    const draft = await this.prisma.noteDraft.findUnique({ where: { sessionId } });
    if (!draft) {
      throw new NotFoundException('Note draft not found for this session');
    }
    if (draft.status !== 'COMPLETED' || draft.content === null) {
      throw new BadRequestException(
        `Note draft is in ${draft.status} state — cannot sign until COMPLETED`,
      );
    }

    const existing = await this.prisma.therapyNote.findUnique({
      where: { sessionId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Therapy note already signed for this session');
    }

    const draftContent = TherapyNoteV1Schema.parse(draft.content);
    const finalNote = TherapyNoteV1Schema.parse(input.note);
    this.validateEditsAgainstDraft(draftContent, finalNote, input.edits);

    const created = await this.prisma.$transaction(async (tx) => {
      const note = await tx.therapyNote.create({
        data: {
          sessionId,
          draftId: draft.id,
          version: finalNote.version,
          content: finalNote as unknown as object,
          signedAt: new Date(input.signedAt),
          signedBy: psychologistId,
          signCredentialId: input.assertion?.credentialId ?? null,
          signClientDataJsonB64u: input.assertion?.clientDataJSON ?? null,
          signAuthenticatorDataB64u: input.assertion?.authenticatorData ?? null,
          signSignatureB64u: input.assertion?.signature ?? null,
          signChallengeHashHex: input.assertion?.challengeHashHex ?? recomputed,
        },
      });

      if (input.edits.length > 0) {
        await tx.noteEdit.createMany({
          data: input.edits.map((e) => ({
            therapyNoteId: note.id,
            field: e.field,
            before: e.before,
            after: e.after,
          })),
        });
      }

      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'NOTE_SIGNED',
          targetType: 'TherapyNote',
          targetId: note.id,
          metadata: {
            ...auditMeta,
            sessionId,
            draftId: draft.id,
            editedFields: input.edits.map((e) => e.field),
            payloadHashHex: recomputed,
            webauthnUsed: input.assertion !== undefined,
          },
        },
        tx,
      );

      return note;
    });

    const edits = await this.prisma.noteEdit.findMany({
      where: { therapyNoteId: created.id },
      orderBy: { createdAt: 'asc' },
    });

    this.logger.log(
      `Signed therapy note ${created.id} for session=${sessionId} editedFields=${input.edits
        .map((e) => e.field)
        .join(',')}`,
    );

    return {
      id: created.id,
      sessionId: created.sessionId,
      draftId: created.draftId,
      version: 'V1',
      content: finalNote,
      signedAt: created.signedAt.toISOString(),
      signedBy: created.signedBy,
      edits: edits.map((e) => ({
        id: e.id,
        field: e.field,
        before: e.before,
        after: e.after,
        createdAt: e.createdAt.toISOString(),
      })),
      signCredentialId: created.signCredentialId,
      signChallengeHashHex: created.signChallengeHashHex,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async getTherapyNote(psychologistId: string, sessionId: string): Promise<TherapyNote | null> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { psychologistId: true },
    });
    if (!session || session.psychologistId !== psychologistId) {
      throw new NotFoundException('Session not found');
    }
    const note = await this.prisma.therapyNote.findUnique({
      where: { sessionId },
      include: { edits: { orderBy: { createdAt: 'asc' } } },
    });
    if (!note) return null;
    const content = TherapyNoteV1Schema.parse(note.content);
    return {
      id: note.id,
      sessionId: note.sessionId,
      draftId: note.draftId,
      version: 'V1',
      content,
      signedAt: note.signedAt.toISOString(),
      signedBy: note.signedBy,
      edits: note.edits.map((e) => ({
        id: e.id,
        field: e.field,
        before: e.before,
        after: e.after,
        createdAt: e.createdAt.toISOString(),
      })),
      signCredentialId: note.signCredentialId,
      signChallengeHashHex: note.signChallengeHashHex,
      createdAt: note.createdAt.toISOString(),
    };
  }

  /**
   * Each edit must (a) target one of the four SOAP fields, (b) have
   * `before` equal to the draft's current value, and (c) have `after`
   * equal to the final note's value. Anything else means the client
   * fabricated or stale-cached the edit list.
   */
  private validateEditsAgainstDraft(
    draft: TherapyNoteV1,
    final: TherapyNoteV1,
    edits: readonly NoteEditEntry[],
  ): void {
    const seen = new Set<NoteEditField>();
    for (const e of edits) {
      if (!(SIGNABLE_FIELDS as readonly NoteEditField[]).includes(e.field)) {
        throw new BadRequestException(`edit.field ${e.field} is not a signable SOAP field`);
      }
      if (seen.has(e.field)) {
        throw new BadRequestException(`Duplicate edit entry for field ${e.field}`);
      }
      seen.add(e.field);
      // The guard above guarantees e.field is one of the SOAP fields.
      const field = e.field as SoapField;
      if (e.before !== draft[field]) {
        throw new BadRequestException(
          `edit.before for ${field} does not match the current draft text (stale draft?)`,
        );
      }
      if (e.after !== final[field]) {
        throw new BadRequestException(
          `edit.after for ${field} does not match the submitted note (inconsistent payload)`,
        );
      }
    }
    // Any unedited field MUST equal the draft's value — caller cannot
    // sneak in a change without recording an edit row.
    for (const field of SIGNABLE_FIELDS) {
      if (!seen.has(field) && final[field] !== draft[field]) {
        throw new BadRequestException(`Field ${field} changed but is missing from the edits list`);
      }
    }
  }
}
