import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotesModule } from '../notes/notes.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [AuthModule, NotesModule.register()],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
