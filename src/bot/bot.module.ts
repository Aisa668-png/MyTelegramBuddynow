import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { UsersModule } from '../users/users.module';
import { MessageService } from './services/message.service';
import { HandlerService } from './services/handler.service';
import { MenuService } from './services/menu.service';
import { FsmService } from './services/fsm.service';
import { ProfileService } from './services/profile.service';
import { OrderService } from './services/order.service';
import { RatingService } from './services/rating.service';
@Module({
  imports: [UsersModule],
  providers: [
    BotService,
    MessageService,
    HandlerService,
    MenuService,
    FsmService,
    ProfileService,
    OrderService,
    RatingService,
  ],
  exports: [BotService],
})
export class BotModule {}
