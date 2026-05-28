import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AffectController } from './affect.controller';
import { AffectService } from './affect.service';

@Module({
  imports: [AuthModule],
  controllers: [AffectController],
  providers: [AffectService],
  exports: [AffectService],
})
export class AffectModule {}
