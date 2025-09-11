import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
