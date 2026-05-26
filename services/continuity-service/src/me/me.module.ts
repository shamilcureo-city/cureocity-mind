import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientAuthGuard } from './client-auth.guard';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [AuthModule],
  controllers: [MeController],
  providers: [ClientAuthGuard, MeService],
  exports: [MeService],
})
export class MeModule {}
