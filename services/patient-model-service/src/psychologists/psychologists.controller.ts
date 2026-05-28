import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { CreatePsychologistInputSchema } from '@cureocity/contracts';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditMetadataFromRequest } from '../common/request-context';
import { PsychologistsService } from './psychologists.service';

@Controller('psychologists')
@UseGuards(FirebaseAuthGuard)
export class PsychologistsController {
  constructor(private readonly service: PsychologistsService) {}

  @Post()
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreatePsychologistInputSchema))
    dto: ReturnType<typeof CreatePsychologistInputSchema.parse>,
    @Req() req: Request,
  ) {
    return this.service.register(user.firebaseUid, dto, auditMetadataFromRequest(req));
  }
}
