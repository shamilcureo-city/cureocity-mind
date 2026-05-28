import { Module } from '@nestjs/common';
import { ClaimTokensController } from './claim-tokens.controller';
import { ClaimTokensService } from './claim-tokens.service';

@Module({
  controllers: [ClaimTokensController],
  providers: [ClaimTokensService],
  exports: [ClaimTokensService],
})
export class ClaimTokensModule {}
