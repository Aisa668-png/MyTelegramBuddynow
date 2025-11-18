import { Injectable } from '@nestjs/common';
import TelegramBot, { CallbackQuery } from 'node-telegram-bot-api';
import { UsersService } from 'src/users/users.service';
import { MessageService } from './message.service';
import { BOT_CONSTANTS } from '../config/constants';
import { Role, OrderStatus } from 'generated/prisma';
import { OrderService } from './order.service';
import { ReviewService } from './review.service';
import { ParentCallbackHandler } from './callback-handlers/parent-callback.handler';

@Injectable()
export class HandlerService {
  constructor(
    private readonly usersService: UsersService,
    private readonly messageService: MessageService,
    private readonly orderService: OrderService,
    private readonly reviewService: ReviewService,
    private readonly parentCallbackHandler: ParentCallbackHandler,
  ) {}

  private constants = BOT_CONSTANTS;

  async handleCallbackQuery(bot: TelegramBot, query: CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id.toString();
    if (!chatId || !query.data) {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    try {
      const user = await this.usersService.getByChatId(chatId);
      if (!user) {
        await bot.answerCallbackQuery(query.id);
        return;
      }

      // 🔹 ИСПОЛЬЗУЕМ ЛОКАЛЬНУЮ ПЕРЕМЕННУЮ ДЛЯ БЕЗОПАСНОСТИ
      const callbackData = query.data;

      if (callbackData.startsWith('accept_order_')) {
        const orderId = parseInt(callbackData.replace('accept_order_', ''));
        await this.handleAcceptOrder(bot, query, user, orderId);
      } else if (callbackData.startsWith('complete_visit_')) {
        const orderId = parseInt(callbackData.replace('complete_visit_', ''));
        await this.handleCompleteVisit(bot, query, user, orderId);
      } else if (callbackData.startsWith('review_')) {
        const parts = callbackData.split('_');
        const orderId = parseInt(parts[1]);
        const rating = parseInt(parts[2]);
        await this.handleReview(bot, query, user, orderId, rating);
      } else if (callbackData.startsWith('parent_confirm_order_')) {
        const parts = callbackData.split('_');
        const orderId = parseInt(parts[3]);
        const nannyId = parseInt(parts[4]);
        await this.handleParentConfirmOrder(bot, query, user, orderId, nannyId);
      }

      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error('Error handling callback:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Произошла ошибка' });
    }
  }

  private async handleAcceptOrder(
    bot: TelegramBot,
    query: CallbackQuery,
    user: any,
    orderId: number,
  ): Promise<void> {
    try {
      const chatId = query.message?.chat.id.toString();
      if (!chatId) return;

      const updatedOrder = await this.orderService.acceptOrder(orderId, user.id);
      const parent = await this.usersService.getById(updatedOrder.parentId);
      const nanny = await this.usersService.getById(user.id);
      const nannyProfile = nanny?.profile;

      // 🔹 УВЕДОМЛЕНИЕ НЯНЕ
      await bot.sendMessage(
        chatId,
        `✅ Вы успешно приняли заказ! Ожидайте подтверждения от родителя.`,
        { reply_markup: { inline_keyboard: [] } },
      );

      // 🔹 УВЕДОМЛЕНИЕ РОДИТЕЛЮ С ПРОФИЛЕМ НЯНИ И РЕЙТИНГОМ
      if (parent && parent.chatId && nannyProfile) {
        const ratingText = nanny.avgRating
          ? `⭐ Рейтинг: ${nanny.avgRating.toFixed(1)}/5 (${nanny.totalReviews || 0} отзывов)`
          : '⭐ Рейтинг: пока нет отзывов';

        const profileText = `
🎉 Ваш заказ приняла няня!

${ratingText}

👩‍🍼 *Профиль няни:*
*Имя:* ${nannyProfile.name || 'Не указано'}
*Опыт работы:* ${nannyProfile.experience || 'Не указан'}
*Род деятельности:* ${nannyProfile.occupation || 'Не указан'}
*Мед. карта:* ${nannyProfile.hasMedCard ? '✅ Есть' : '❌ Нет'}
*Ставка:* ${nannyProfile.price ? nannyProfile.price + ' ₽/час' : 'Не указана'}

Подтвердите заказ или отклоните:
      `.trim();

        const keyboard = {
          inline_keyboard: [
            [
              {
                text: '✅ Подтвердить заказ',
                callback_data: `parent_confirm_order_${orderId}_${user.id}`,
              },
              {
                text: '❌ Отклонить заказ',
                callback_data: `parent_reject_order_${orderId}_${user.id}`,
              },
            ],
          ],
        };

        if (nannyProfile.avatar) {
          await bot.sendPhoto(parent.chatId, nannyProfile.avatar, {
            caption: profileText,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        } else {
          await bot.sendMessage(parent.chatId, profileText, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        }
      }
    } catch (error) {
      console.error('Error accepting order:', error);
      await bot.sendMessage(
        query.message?.chat.id.toString() || '',
        '❌ Не удалось принять заказ. Возможно, его уже кто-то взял.',
      );
    }
  }

  private async handleCompleteVisit(
    bot: TelegramBot,
    query: CallbackQuery,
    user: any,
    orderId: number,
  ): Promise<void> {
    try {
      const chatId = query.message?.chat.id.toString();
      if (!chatId) return;

      // 1. Проверяем возможность завершения
      const check = await this.orderService.canCompleteOrder(orderId, user.id);
      if (!check.canComplete) {
        throw new Error(check.reason);
      }

      // 2. Завершаем заказ
      const completedOrder = await this.orderService.completeOrder(orderId, user.id);

      // 3. Получаем полные данные заказа для уведомлений
      const orderWithDetails = await this.orderService.getOrderById(orderId);

      if (!orderWithDetails) {
        throw new Error('Заказ не найден');
      }

      // 4. Уведомляем няню
      if (orderWithDetails.nanny?.chatId) {
        await bot.sendMessage(
          orderWithDetails.nanny.chatId,
          '✅ Вы завершили визит! Ожидаем отзыв от родителя.',
        );
      }

      // 5. Уведомляем родителя и запрашиваем отзыв
      if (orderWithDetails.parent?.chatId) {
        const nannyName = orderWithDetails.nanny?.profile?.name || 'няня';
        const completionText = `
👶 Визит няни завершен!

${nannyName} сообщила об окончании визита.

Пожалуйста, оцените работу:
      `.trim();

        await bot.sendMessage(orderWithDetails.parent.chatId, completionText);

        // Запрашиваем отзыв
        await this.requestReview(bot, orderWithDetails.parent.chatId, orderId);
      }
    } catch (error) {
      console.error('Error in complete order process:', error);
      await bot.sendMessage(
        query.message?.chat.id.toString() || '',
        '❌ Ошибка при завершении визита: ' + error.message,
      );
    }
  }

  private async handleReview(
    bot: TelegramBot,
    query: CallbackQuery,
    user: any,
    orderId: number,
    rating: number,
  ): Promise<void> {
    const chatId = query.message?.chat.id.toString();
    if (!chatId) return;

    try {
      const order = await this.orderService.getOrderById(orderId);
      if (!order || !order.nannyId) {
        await bot.sendMessage(chatId, '❌ Ошибка: заказ не найден');
        return;
      }

      // Сохраняем рейтинг
      const review = await this.reviewService.createReview({
        orderId,
        nannyId: order.nannyId,
        parentId: order.parentId,
        rating,
      });

      // Убираем кнопки рейтинга
      if (query.message && 'message_id' in query.message) {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          {
            chat_id: Number(chatId),
            message_id: query.message.message_id,
          },
        );
      }

      // Просим текстовый отзыв
      await bot.sendMessage(
        chatId,
        `Спасибо за оценку ${rating} ⭐! Хотите оставить текстовый отзыв? (или напишите "пропустить")`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Оставить отзыв', callback_data: `write_review_${orderId}` }],
              [{ text: '⏭ Пропустить', callback_data: `skip_review_${orderId}` }],
            ],
          },
        },
      );
    } catch (error) {
      console.error('Error handling rating:', error);
      // 🔹 ИСПОЛЬЗУЕМ chatId ИЗ ВНЕШНЕЙ ОБЛАСТИ ВИДИМОСТИ
      await bot.sendMessage(chatId, '❌ Ошибка при сохранении оценки');
    }
  }

  private async handleParentConfirmOrder(
    bot: TelegramBot,
    query: CallbackQuery,
    user: any,
    orderId: number,
    nannyId: number,
  ): Promise<void> {
    const chatId = query.message?.chat.id.toString();
    if (!chatId) return;

    try {
      const order = await this.orderService.getOrderById(orderId);
      const nanny = await this.usersService.getById(nannyId);

      if (!order || !nanny) {
        await bot.sendMessage(chatId, '❌ Ошибка: данные не найдены.');
        return;
      }

      // Обновляем статус заказа
      await this.orderService.updateOrderStatus(orderId, OrderStatus.IN_PROGRESS);

      // 🔹 ОТПРАВЛЯЕМ НЯНЕ УВЕДОМЛЕНИЕ О ПОДТВЕРЖДЕНИИ
      if (nanny.chatId) {
        const parentPhone = user.phone
          ? `📞 Телефон родителя: ${user.phone}`
          : '📞 Телефон не указан';

        const nannyNotification = `
🎉 Родитель подтвердил ваш заказ!

${parentPhone}

👶 *Детали заказа:*
*Ребенок:* ${order.child}
*Дата:* ${order.date}
*Время:* ${order.time}  
*Адрес:* ${order.address}

Можете связаться для уточнения деталей.
После окончания визита нажмите кнопку ниже:
        `.trim();

        const completeKeyboard = {
          inline_keyboard: [
            [
              {
                text: '✅ Завершить заказ',
                callback_data: `complete_visit_${orderId}`,
              },
            ],
          ],
        };

        await bot.sendMessage(nanny.chatId, nannyNotification, {
          parse_mode: 'Markdown',
          reply_markup: completeKeyboard,
        });
      }

      // 🔹 ОТПРАВЛЯЕМ РОДИТЕЛЮ ТОЛЬКО НОМЕР ТЕЛЕФОНА
      const nannyPhone = nanny.phone
        ? `📞 Телефон няни: ${nanny.phone}`
        : '📞 Телефон няни не указан';

      const parentConfirmation = `
Договорились отлично!Теперь ты на связи с ней по телефону,чтобы обсудить все детали.

${nannyPhone}


    `.trim();

      await bot.sendMessage(chatId, parentConfirmation);

      const stepsMessage = `
📋 *Напоминание о важных моментах взаимодействия с няней:*

• Обязательно расскажите, что можно и нельзя делать во время визита
• Оставьте экстренные контакты
• На всякий случай сообщаем вам, что за договоренности не через сайт мы лишаем бебиситтеров возможности работать с нами
• Помните, пожалуйста, об этом, когда будете пытаться договориться с ними

💳 *Как оплатить услуги?*
• Работа ситтера оплачивается непосредственно ему в конце визита
• Услуги сервиса Помогатор оплачиваются отдельно, так как мы не хотим удерживать комиссию у няни
• В конце визита мы попросим вас подтвердить окончание заказа и дадим ссылку для оплаты
• Подробнее о тарифах вы можете ознакомиться в меню
`.trim();

      await bot.sendMessage(chatId, stepsMessage);

      if (query.message && 'message_id' in query.message) {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          {
            chat_id: Number(chatId),
            message_id: query.message.message_id,
          },
        );
      }
    } catch (error) {
      console.error('Error confirming order:', error);
      // 🔹 ИСПОЛЬЗУЕМ chatId ИЗ ВНЕШНЕЙ ОБЛАСТИ ВИДИМОСТИ
      await bot.sendMessage(chatId, '❌ Ошибка при подтверждении заказа');
    }
  }

  private async requestReview(bot: TelegramBot, parentChatId: string, orderId: number) {
    try {
      const order = await this.orderService.getOrderById(orderId);
      if (!order || !order.nannyId) {
        console.error('Order or nanny not found for review request');
        return;
      }

      const nannyName = order.nanny?.profile?.name || 'няня';
      const text = `👶 Визит ${nannyName} завершен! Пожалуйста, оцените работу от 1 до 5 звезд:`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '⭐', callback_data: `review_${orderId}_1` },
            { text: '⭐⭐', callback_data: `review_${orderId}_2` },
            { text: '⭐⭐⭐', callback_data: `review_${orderId}_3` },
            { text: '⭐⭐⭐⭐', callback_data: `review_${orderId}_4` },
            { text: '⭐⭐⭐⭐⭐', callback_data: `review_${orderId}_5` },
          ],
        ],
      };

      await bot.sendMessage(parentChatId, text, { reply_markup: keyboard });
      console.log(`Review requested for order ${orderId} from parent ${parentChatId}`);
    } catch (error) {
      console.error('Error requesting review:', error);
    }
  }
}
