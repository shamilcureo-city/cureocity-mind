import { Module } from '@nestjs/common';
import { PsychologistsController } from './psychologists.controller';
import { PsychologistsService } from './psychologists.service';

@Module({
  controllers: [PsychologistsController],
  providers: [PsychologistsService],
  exports: [PsychologistsService],
})
export class PsychologistsModule {}
