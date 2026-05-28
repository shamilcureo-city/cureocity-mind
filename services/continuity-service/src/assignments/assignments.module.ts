import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientAssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { AdherenceService } from '../adherence/adherence.service';

@Module({
  imports: [AuthModule],
  controllers: [ClientAssignmentsController],
  providers: [AssignmentsService, AdherenceService],
  exports: [AssignmentsService, AdherenceService],
})
export class AssignmentsModule {}
