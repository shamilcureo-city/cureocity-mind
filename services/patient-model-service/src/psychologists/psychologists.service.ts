import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreatePsychologistInput, AuditMetadata } from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PsychologistsService {
  private readonly logger = new Logger(PsychologistsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async register(firebaseUid: string, dto: CreatePsychologistInput, auditMeta: AuditMetadata) {
    const existing = await this.prisma.psychologist.findUnique({
      where: { firebaseUid },
    });
    if (existing) {
      this.logger.log(`Psychologist already registered: ${existing.id}`);
      return existing;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const psy = await tx.psychologist.create({
          data: {
            firebaseUid,
            email: dto.email,
            fullName: dto.fullName,
            phone: dto.phone,
            rciNumber: dto.rciNumber,
            status: 'PENDING_VERIFICATION',
          },
        });
        await this.audit.log(
          {
            actorType: 'SYSTEM',
            action: 'PSYCHOLOGIST_REGISTERED',
            targetType: 'Psychologist',
            targetId: psy.id,
            metadata: { ...auditMeta, firebaseUid, email: dto.email },
          },
          tx,
        );
        return psy;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const fields = (e.meta?.['target'] as string[] | undefined)?.join(', ') ?? 'unique field';
        throw new ConflictException(`Already in use: ${fields}`);
      }
      throw e;
    }
  }
}
