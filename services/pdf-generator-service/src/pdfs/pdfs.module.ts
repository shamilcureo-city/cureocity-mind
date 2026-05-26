import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PdfsController } from './pdfs.controller';
import { PdfsService } from './pdfs.service';

@Module({
  imports: [AuthModule],
  controllers: [PdfsController],
  providers: [PdfsService],
  exports: [PdfsService],
})
export class PdfsModule {}
