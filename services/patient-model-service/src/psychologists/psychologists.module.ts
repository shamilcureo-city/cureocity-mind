import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PsychologistsController } from './psychologists.controller';
import { PsychologistsService } from './psychologists.service';

@Module({
  imports: [AuthModule],
  controllers: [PsychologistsController],
  providers: [PsychologistsService],
  exports: [PsychologistsService],
})
export class PsychologistsModule {}
