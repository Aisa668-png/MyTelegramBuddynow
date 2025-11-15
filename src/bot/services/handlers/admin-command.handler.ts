import { Injectable } from '@nestjs/common';
import TelegramBot, { Message } from 'node-telegram-bot-api';
import { AdminHandlerService } from '../admin-handler.service';

@Injectable()
export class AdminCommandHandler {
  constructor(private readonly adminHandler: AdminHandlerService) {}

  async handle(bot: TelegramBot, msg: Message, chatId: string, command: string): Promise<boolean> {
    try {
      switch (command) {
        case '/start':
          //await this.adminHandler.showAdminPanel(bot, chatId);
          return true;

        case '/pending_profiles':
          await this.adminHandler.showPendingProfiles(bot, chatId);
          return true;

        case '/all_nannies':
          await this.adminHandler.showAllNannies(bot, chatId);
          return true;

        case '/rejected_profiles':
          await this.adminHandler.showRejectedProfiles(bot, chatId);
          return true;

        case '/parent_profiles':
          await this.adminHandler.showParentProfiles(bot, chatId);
          return true;

        case '/new_orders':
          await this.adminHandler.showNewOrders(bot, chatId);
          return true;

        case '/all_orders':
          await this.adminHandler.showAllOrders(bot, chatId);
          return true;

        case '/stats':
          await this.adminHandler.showStats(bot, chatId);
          return true;

        default:
          return false;
      }
    } catch (error) {
      console.error('Error handling admin command:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при выполнении команды');
      return true;
    }
  }
}
