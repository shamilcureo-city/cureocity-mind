import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmdrController } from './emdr.controller';
import { EmdrService } from './emdr.service';

@Module({
  imports: [AuthModule],
  controllers: [EmdrController],
  providers: [EmdrService],
  exports: [EmdrService],
})
export class EmdrModule {}
