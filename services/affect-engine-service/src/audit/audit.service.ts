import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditAction, AuditActorType, AuditMetadata } from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditWrite {
  actorType: AuditActorType;
  actorPsychologistId?: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  metadata?: AuditMetadata;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes a single audit row. Pass a Prisma TransactionClient when the audit
   * write must be atomic with the business write (e.g. CLIENT_CREATED).
   */
  async log(input: AuditWrite, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorType: input.actorType,
        actorPsychologistId: input.actorPsychologistId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata:
          input.metadata === undefined
            ? Prisma.JsonNull
            : (input.metadata as Prisma.InputJsonValue),
      },
    });
  }
}
