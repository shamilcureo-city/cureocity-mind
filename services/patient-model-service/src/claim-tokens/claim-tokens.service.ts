import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AuditMetadata,
  ClaimTokenPreview,
  ClaimTokenRedeemResult,
  ClientClaimToken as ClientClaimTokenDto,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DEFAULT_TTL_DAYS = 14;
const TOKEN_BYTES = 16; // 22 base64url chars after stripping padding

/**
 * ClaimTokensService — Sprint 8 PR 1.
 *
 * Three operations:
 *   - issue(): therapist-authenticated, generates a single-use token for one
 *     of their clients. Returns the token (rendered as QR by the therapist
 *     UI). Multiple unredeemed tokens may exist for one client — useful when
 *     the first one expired or was lost; redeeming any valid one fulfils
 *     the pairing.
 *   - preview(): unauthenticated lookup so the client's PWA can show
 *     "Pair as Riya, with Dr. Sharma" before asking for OTP. Doesn't reveal
 *     contact phone / email — just first name + therapist full name.
 *   - redeem(): client-authenticated (Firebase phone OTP), marks the token
 *     used, sets Client.clientFirebaseUid. Idempotent for the SAME firebaseUid
 *     (re-redeeming returns the same result); rejects if a DIFFERENT firebaseUid
 *     tries to reuse it or if the Client already has a different uid bound.
 */
@Injectable()
export class ClaimTokensService {
  private readonly logger = new Logger(ClaimTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async issue(
    psychologistId: string,
    clientId: string,
    auditMeta: AuditMetadata,
    opts?: { ttlDays?: number },
  ): Promise<ClientClaimTokenDto> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, psychologistId: true, clientFirebaseUid: true, deletedAt: true },
    });
    if (!client || client.deletedAt !== null || client.psychologistId !== psychologistId) {
      // Cross-tenant or soft-deleted: surface as 404 to avoid leaking existence.
      throw new NotFoundException('Client not found');
    }
    if (client.clientFirebaseUid !== null) {
      throw new ConflictException('Client is already paired to a Firebase identity');
    }

    const token = generateToken();
    const ttlDays = opts?.ttlDays ?? DEFAULT_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clientClaimToken.create({
        data: {
          clientId,
          psychologistId,
          token,
          expiresAt,
        },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'CLIENT_CLAIM_TOKEN_ISSUED',
          targetType: 'ClientClaimToken',
          targetId: created.id,
          metadata: { ...auditMeta, clientId, expiresAt: expiresAt.toISOString() },
        },
        tx,
      );
      return created;
    });

    this.logger.log(`Issued claim token for client=${clientId} expires=${expiresAt.toISOString()}`);

    return {
      token: row.token,
      clientId: row.clientId,
      psychologistId: row.psychologistId,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async preview(token: string): Promise<ClaimTokenPreview> {
    const row = await this.prisma.clientClaimToken.findUnique({
      where: { token },
      include: {
        client: {
          select: {
            fullNameEncrypted: true,
            psychologist: { select: { fullName: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Claim token not found');
    if (row.expiresAt <= new Date()) throw new BadRequestException('Claim token has expired');

    return {
      clientFirstName: firstName(row.client.fullNameEncrypted ?? ''),
      psychologistFullName: row.client.psychologist.fullName,
      expiresAt: row.expiresAt.toISOString(),
      redeemed: row.redeemedAt !== null,
    };
  }

  async redeem(
    token: string,
    firebaseUid: string,
    auditMeta: AuditMetadata,
  ): Promise<ClaimTokenRedeemResult> {
    const row = await this.prisma.clientClaimToken.findUnique({
      where: { token },
      include: {
        client: {
          select: {
            id: true,
            fullNameEncrypted: true,
            clientFirebaseUid: true,
            psychologist: { select: { fullName: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Claim token not found');
    if (row.expiresAt <= new Date()) throw new BadRequestException('Claim token has expired');

    // Idempotency: same uid re-redeeming returns the same result.
    if (row.redeemedAt && row.redeemedByFirebaseUid === firebaseUid) {
      return {
        clientId: row.clientId,
        clientFirstName: firstName(row.client.fullNameEncrypted ?? ''),
        psychologistFullName: row.client.psychologist.fullName,
        redeemedAt: row.redeemedAt.toISOString(),
      };
    }
    if (row.redeemedAt) {
      throw new ConflictException('Claim token has already been redeemed by a different account');
    }
    if (row.client.clientFirebaseUid !== null && row.client.clientFirebaseUid !== firebaseUid) {
      throw new ConflictException('Client is already paired to a different Firebase identity');
    }

    const redeemedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // Bind the Client only if it isn't already bound to this same uid
      // (otherwise leave the row untouched — protects against unique
      // constraint failure if the same uid redeems twice via two tokens).
      if (row.client.clientFirebaseUid !== firebaseUid) {
        await tx.client.update({
          where: { id: row.clientId },
          data: { clientFirebaseUid: firebaseUid },
        });
      }
      const updated = await tx.clientClaimToken.update({
        where: { id: row.id },
        data: { redeemedAt, redeemedByFirebaseUid: firebaseUid },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'CLIENT_CLAIM_TOKEN_REDEEMED',
          targetType: 'ClientClaimToken',
          targetId: updated.id,
          metadata: { ...auditMeta, clientId: row.clientId, firebaseUid },
        },
        tx,
      );
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'CLIENT_FIREBASE_LINKED',
          targetType: 'Client',
          targetId: row.clientId,
          metadata: { ...auditMeta, firebaseUid, tokenId: updated.id },
        },
        tx,
      );
      return updated;
    });

    this.logger.log(
      `Redeemed claim token ${result.id} for client=${row.clientId} firebaseUid=${firebaseUid}`,
    );

    return {
      clientId: row.clientId,
      clientFirstName: firstName(row.client.fullNameEncrypted ?? ''),
      psychologistFullName: row.client.psychologist.fullName,
      redeemedAt: redeemedAt.toISOString(),
    };
  }
}

function generateToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}
