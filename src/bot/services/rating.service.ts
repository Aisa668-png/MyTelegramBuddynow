import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { UsersService } from '../../users/users.service';

@Injectable()
export class RatingService {
  constructor(private readonly usersService: UsersService) {}

  /**
   * ⭐ Показать рейтинг няни
   */
  async showNannyRating(bot: TelegramBot, chatId: string, nannyId: number): Promise<void> {
    try {
      const nanny = await this.usersService.getById(nannyId);
      if (!nanny) {
        await bot.sendMessage(chatId, '❌ Няня не найдена');
        return;
      }

      const nannyStats = await this.usersService.getNannyStats(nannyId);
      const reviews = await this.usersService.getNannyReviews(nannyId);

      let message = `⭐ *Ваш рейтинг:* ${nanny.avgRating?.toFixed(1) || '0.0'}/5\n`;
      message += `📊 *На основе отзывов:* ${nanny.totalReviews || 0}\n\n`;
      message += `📈 *Ваша статистика:*\n`;
      message += `✅ Завершено заказов: ${nannyStats.completedOrders}\n`;
      message += `👨‍👩‍👧‍👦 Обслужено родителей: ${nannyStats.uniqueParents}\n`;
      message += `🎯 Постоянных клиентов: ${nannyStats.loyalParents}\n`;
      message += `⏱️ Всего часов с детьми: ${nannyStats.totalHours}\n\n`;

      if (reviews.length > 0) {
        message += `*Последние отзывы:*\n\n`;
        reviews.slice(0, 5).forEach((review, index) => {
          const stars = '⭐'.repeat(review.rating);
          const date = new Date(review.createdAt).toLocaleDateString('ru-RU');
          const parentName = review.parent.fullName || 'Аноним';
          message += `${stars} (${date})\n`;
          message += `👤 От: ${parentName}\n`;
          if (review.comment) message += `💬 ${review.comment}\n`;
          message += `\n`;
        });
      } else {
        message += `*Отзывов пока нет*\n`;
      }

      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '📭 Новые заказы', callback_data: 'new_orders' }]],
        },
      });
    } catch (error) {
      console.error('Error showing nanny rating:', error);
      await bot.sendMessage(chatId, '📊 Ваш рейтинг загружается...');
    }
  }

  /**
   * 💬 Обработка текстового отзыва
   */
  async handleReviewComment(
    bot: TelegramBot,
    chatId: string,
    orderId: number,
    comment: string,
  ): Promise<void> {
    try {
      const review = await this.usersService.getReviewByOrderId(orderId);
      if (review) {
        await this.usersService.updateReviewComment(review.id, comment);
        await bot.sendMessage(
          chatId,
          '✅ Спасибо за ваш отзыв! Он поможет другим родителям в выборе няни.',
        );
      } else {
        await bot.sendMessage(chatId, '❌ Отзыв не найден');
      }
    } catch (error) {
      console.error('Error saving review comment:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при сохранении отзыва');
    }
  }

  /**
   * 📝 Полуcorrect слово для отзыва
   */
  getReviewWord(count: number): string {
    if (count % 10 === 1 && count % 100 !== 11) return 'отзыв';
    if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'отзыва';
    return 'отзывов';
  }
}
