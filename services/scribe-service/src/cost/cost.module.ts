import { Global, Module } from '@nestjs/common';
import { CostGuardService } from './cost-guard.service';

@Global()
@Module({
  providers: [CostGuardService],
  exports: [CostGuardService],
})
export class CostModule {}
