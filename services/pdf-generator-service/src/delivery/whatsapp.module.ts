import { Module } from '@nestjs/common';
import { PdfsModule } from '../pdfs/pdfs.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppDeliveryService } from './whatsapp.service';

@Module({
  imports: [PdfsModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppDeliveryService],
  exports: [WhatsAppDeliveryService],
})
export class WhatsAppModule {}
