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
import { CallbackService } from './services/callback.service';
import { ParentCallbackHandler } from './services/callback-handlers/parent-callback.handler';
import { NannyCallbackHandler } from './services/callback-handlers/nanny-callback.handler';
import { CommandHandler } from './services/handlers/command.handler';
import { ParentMessageHandler } from './services/handlers/parent-message.handler';
import { NannyMessageHandler } from './services/handlers/nanny-message.handler';
import { MessageHandlerService } from './services/message-handler.service';
import { AdminCommandHandler } from './services/handlers/admin-command.handler';
import { AdminHandlerService } from './services/admin-handler.service';
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
    CallbackService,
    ParentCallbackHandler,
    NannyCallbackHandler,
    CommandHandler,
    ParentMessageHandler,
    NannyMessageHandler,
    MessageHandlerService,
    AdminHandlerService,
    AdminCommandHandler,
  ],
  exports: [BotService, AdminHandlerService, AdminCommandHandler],
})
export class BotModule {}
