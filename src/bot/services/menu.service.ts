import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { UsersService } from '../../users/users.service';
import { BOT_CONSTANTS } from '../config/constants';

@Injectable()
export class MenuService {
  constructor(private readonly usersService: UsersService) {}

  private constants = BOT_CONSTANTS;

  async showMyOrdersMenu(bot: TelegramBot, chatId: string): Promise<void> {
    const ordersText = `📋 Мои заказы\n\nВыберите раздел:`;

    await bot.sendMessage(chatId, ordersText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟢 Активные заказы', callback_data: 'active_orders' },
            { text: '📊 История заказов', callback_data: 'order_history' },
          ],
        ],
      },
    });
  }

  async showFaqMenu(bot: TelegramBot, chatId: string): Promise<void> {
    const faqText = `❓ Вопросы и ответы\n\nЗдесь вы найдете ответы на часто задаваемые вопросы о нашем сервисе.`;

    await bot.sendMessage(chatId, faqText, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📖 Статья о работе сервиса',
              url: 'https://telegra.ph/FAQ-o-servise-Pomogator-10-09',
            },
          ],
        ],
      },
    });
  }

  async showNannyOrdersMenu(bot: TelegramBot, chatId: string): Promise<void> {
    try {
      await bot.sendMessage(chatId, '📋 <b>Мои заказы</b>', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: `🟡 Незавершенные`, callback_data: 'nanny_orders_active' }],
            [{ text: `✅ История заказов`, callback_data: 'nanny_orders_history' }],
          ],
        },
      });
    } catch (error) {
      console.error('Error showing nanny orders menu:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке заказов');
    }
  }

  async showTariffsMenu(bot: TelegramBot, chatId: string): Promise<void> {
    const tariffsText = `💰 *Тарифы и оплата*\n\nВыберите тип оплаты:`;

    await bot.sendMessage(chatId, tariffsText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💳 Разовая оплата', callback_data: 'one_time_payment' },
            { text: '🔔 Подписка', callback_data: 'subscription' },
          ],
        ],
      },
    });
  }

  async showFeedbackMenu(bot: TelegramBot, chatId: string): Promise<void> {
    const feedbackText = `💬 *Оставить отзыв*\n\nВыберите тип отзыва:`;

    await bot.sendMessage(chatId, feedbackText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⭐ Отзыв о сервисе', callback_data: 'feedback_service' },
            { text: '👩‍🍼 Отзыв о няне', callback_data: 'feedback_nanny' },
          ],
        ],
      },
    });
  }
}
