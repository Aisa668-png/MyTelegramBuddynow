// src/bot/services/message-handler.service.ts
import { Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { CommandHandler } from './handlers/command.handler';
import { ParentMessageHandler } from './handlers/parent-message.handler';
import { NannyMessageHandler } from './handlers/nanny-message.handler';
import { Role } from 'generated/prisma';

@Injectable()
export class MessageHandlerService {
  constructor(
    private readonly usersService: UsersService,
    private readonly commandHandler: CommandHandler,
    private readonly parentMessageHandler: ParentMessageHandler,
    private readonly nannyMessageHandler: NannyMessageHandler,
  ) {}

  async handleMessage(bot: any, msg: any): Promise<void> {
    try {
      const chatId = msg.chat.id.toString();
      const text = msg.text;
      const user = await this.usersService.getByChatId(chatId);

      if (!user) return;

      // 🔹 ОБРАБОТКА КОМАНД
      if (text?.startsWith('/')) {
        // await this.commandHandler.handle(bot, msg, chatId, user, text);
        return;
      }

      // 🔹 ОБРАБОТКА СООБЩЕНИЙ ПО РОЛЯМ
      if (user.role === Role.PARENT) {
        const handled = await this.parentMessageHandler.handle(bot, msg, chatId, user, text);
        if (handled) return;
      } else if (user.role === Role.NANNY) {
        const handled = await this.nannyMessageHandler.handle(bot, msg, chatId, user, text);
        if (handled) return;
      }

      // 🔹 Если не обработано - логируем
      if (text) {
        console.log('📝 Необработанное сообщение:', { chatId, role: user.role, text });
      }
    } catch (error) {
      console.error('Error in message handler service:', error);
    }
  }
}
