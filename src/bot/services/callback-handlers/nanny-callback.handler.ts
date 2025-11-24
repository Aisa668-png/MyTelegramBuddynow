// src/bot/services/callback-handlers/nanny-callback.handler.ts
import { Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { OrderService } from '../order.service';
import { RatingService } from '../rating.service';
import { ReviewService } from '../review.service';
import { PaymentsService } from '../payments.service';

@Injectable()
export class NannyCallbackHandler {
  constructor(
    private readonly usersService: UsersService,
    private readonly orderService: OrderService,
    private readonly ratingService: RatingService,
    private readonly reviewService: ReviewService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async handle(bot: any, query: any, chatId: string, user: any): Promise<boolean> {
    const data = query.data;

    // 🔹 ПРИНЯТИЕ ЗАКАЗА
    if (data.startsWith('accept_order_')) {
      return await this.handleAcceptOrder(bot, query, chatId, user, data);
    }

    // 🔹 ЗАВЕРШЕНИЕ ЗАКАЗА
    if (data.startsWith('complete_visit_')) {
      return await this.handleCompleteVisit(bot, query, chatId, data);
    }

    // 🔹 ОБРАБОТКА МЕНЮ НЯНИ
    return await this.handleMenuActions(bot, query, chatId, user, data);
  }

  private async handleAcceptOrder(
    bot: any,
    query: any,
    chatId: string,
    user: any,
    data: string,
  ): Promise<boolean> {
    const orderId = parseInt(data.replace('accept_order_', ''));

    try {
      // Принимаем заказ
      const updatedOrder = await this.orderService.acceptOrder(orderId, user.id);
      const order = await this.orderService.getOrderById(orderId);

      if (!order || !order.parent) {
        await bot.sendMessage(chatId, '❌ Ошибка: заказ не найден.');
        await bot.answerCallbackQuery(query.id);
        return true;
      }

      // 🔹 ОТПРАВЛЯЕМ РОДИТЕЛЮ СТАТИСТИКУ НЯНИ
      const nanny = await this.usersService.getById(user.id);

      if (!nanny) {
        await bot.sendMessage(chatId, '❌ Ошибка: няня не найдена.');
        await bot.answerCallbackQuery(query.id);
        return true;
      }

      const nannyStats = await this.orderService.getNannyStats(user.id);
      const recentReviews = await this.reviewService.getRecentNannyReviews(user.id, 2);

      // 🔹 ФОРМИРУЕМ ТЕКСТ С РЕЙТИНГОМ И СТАТИСТИКОЙ
      const ratingText = nanny.avgRating
        ? `⭐ Рейтинг: ${nanny.avgRating.toFixed(1)}/5 (${nanny.totalReviews || 0} ${this.ratingService.getReviewWord(nanny.totalReviews || 0)})`
        : '⭐ Рейтинг: пока нет отзывов';

      // 🔹 СТАТИСТИКА
      const statsText = `
📊 *Статистика няни:*
✅ Завершено заказов: ${nannyStats.completedOrders}
👨‍👩‍👧‍👦 Обслужено родителей: ${nannyStats.uniqueParents}
🎯 Постоянных клиентов: ${nannyStats.loyalParents}
⏱️ Опыт работы: ${nannyStats.totalHours} часов
`.trim();

      // 🔹 ПОСЛЕДНИЕ ОТЗЫВЫ
      let reviewsText = '';
      if (recentReviews.length > 0) {
        reviewsText = `\n💬 *Последние отзывы:*\n`;
        recentReviews.forEach((review, index) => {
          const stars = '⭐'.repeat(review.rating);
          const shortComment =
            review.comment && review.comment.length > 50
              ? review.comment.substring(0, 50) + '...'
              : review.comment;

          reviewsText += `${stars}\n`;
          if (shortComment) {
            reviewsText += `${shortComment}\n`;
          }
          reviewsText += `\n`;
        });
      }

      const parentNotification = `
🎉 Няня откликнулась на ваш заказ!

${ratingText}
${statsText}
${reviewsText}

👩‍🍼 *Профиль няни:*
*Имя:* ${nanny.profile?.name || 'Не указано'}
*Опыт работы:* ${nanny.profile?.experience || 'Не указан'}
*Род деятельности:* ${nanny.profile?.occupation || 'Не указан'}
*Мед. карта:* ${nanny.profile?.hasMedCard ? '✅ Есть' : '❌ Нет'}
*Ставка:* ${nanny.profile?.price ? nanny.profile.price + ' ₽/час' : 'Не указана'}

*Детали заказа:*
👶 Ребенок: ${order.child}
📅 Дата: ${order.date}
⏰ Время: ${order.time}
🏠 Адрес: ${order.address}
      `.trim();

      // 🔹 ОТПРАВЛЯЕМ РОДИТЕЛЮ СТАТИСТИКУ И ПРОФИЛЬ НЯНИ
      if (nanny.profile?.avatar) {
        await bot.sendPhoto(order.parent.chatId, nanny.profile.avatar, {
          caption: parentNotification,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '✅ Подтвердить заказ',
                  callback_data: `parent_confirm_order_${orderId}_${user.id}`,
                },
                {
                  text: '❌ Отклонить',
                  callback_data: `parent_reject_order_${orderId}_${user.id}`,
                },
              ],
            ],
          },
        });
      } else {
        await bot.sendMessage(order.parent.chatId, parentNotification, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '✅ Подтвердить заказ',
                  callback_data: `parent_confirm_order_${orderId}_${user.id}`,
                },
                {
                  text: '❌ Отклонить',
                  callback_data: `parent_reject_order_${orderId}_${user.id}`,
                },
              ],
            ],
          },
        });
      }

      // 🔹 УВЕДОМЛЯЕМ НЯНЮ
      await bot.sendMessage(
        chatId,
        '✅ Вы откликнулись на заказ! Родитель получил вашу анкету и скоро примет решение.',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '📭 Новые заказы', callback_data: 'new_orders' }]],
          },
        },
      );

      await bot.answerCallbackQuery(query.id);
    } catch (error: any) {
      console.error('Error accepting order:', error);
      await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
      await bot.answerCallbackQuery(query.id);
    }

    return true;
  }

  private async handleCompleteVisit(
    bot: any,
    query: any,
    chatId: string,
    data: string,
  ): Promise<boolean> {
    const orderId = parseInt(data.replace('complete_visit_', ''));

    try {
      const order = await this.orderService.getOrderById(orderId);
      if (!order) {
        await bot.sendMessage(chatId, '❌ Заказ не найден.');
        await bot.answerCallbackQuery(query.id);
        return true;
      }

      // Обновляем статус заказа на "Завершен"
      await this.orderService.updateOrderStatus(orderId, 'COMPLETED');

      // 🔹 УВЕДОМЛЯЕМ РОДИТЕЛЯ - СНАЧАЛА ОПЛАТА
      const parent = await this.usersService.getById(order.parentId);
      if (parent?.chatId) {
        const amount = await this.calculateOrderAmount(order);

        // 🔹 ИСПОЛЬЗУЕМ PaymentsService ДЛЯ СОЗДАНИЯ ПЛАТЕЖА
        const payment = await this.paymentsService.createPayment(
          amount,
          `Оплата заказа #${orderId}`,
          `order_${orderId}`,
        );

        // 🔹 СОЗДАЕМ КНОПКУ С ССЫЛКОЙ ИЗ PaymentsService
        const paymentKeyboard = {
          inline_keyboard: [
            [
              {
                text: '💳 Оплатить сейчас',
                url: payment.confirmation.confirmation_url, // Ссылка из заглушки!
              },
            ],
          ],
        };
        // 🔹 СРАЗУ ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ ОБ ОПЛАТЕ
        await bot.sendMessage(
          parent.chatId,
          `💳 *Заказ #${orderId} завершен!*\n\n💰 К оплате: ${amount} руб.\n\nДля оплаты перейдите в раздел "Мои заказы" → "Активные заказы".`,
          { parse_mode: 'Markdown', reply_markup: paymentKeyboard },
        );

        // 🔹 ЧЕРЕЗ 5 СЕКУНД - ПРЕДЛАГАЕМ ОТЗЫВ
        setTimeout(async () => {
          const completionMessage = `
✅ Визит няни завершен!
Пожалуйста, оставьте отзыв о работе няни.
        `.trim();

          const reviewKeyboard = {
            inline_keyboard: [
              [
                {
                  text: '⭐ Оставить отзыв',
                  callback_data: `leave_review_${orderId}_${order.nannyId}`,
                },
              ],
            ],
          };

          await bot.sendMessage(parent.chatId, completionMessage, {
            parse_mode: 'Markdown',
            reply_markup: reviewKeyboard,
          });
        }, 5000); // 5 секунд задержки
      }

      // 🔹 ОБНОВЛЯЕМ СООБЩЕНИЕ У НЯНИ
      await bot.editMessageText(
        '✅ Вы завершили визит! Родитель получил уведомление об оплате и отзыве.',
        {
          chat_id: chatId,
          message_id: query.message?.message_id,
          parse_mode: 'Markdown',
        },
      );

      await bot.answerCallbackQuery(query.id, { text: '✅ Заказ завершен!' });
    } catch (error: any) {
      console.error('Error completing order:', error);
      await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка завершения' });
    }

    return true;
  }
  private async calculateOrderAmount(order: any): Promise<number> {
    const nanny = await this.usersService.getById(order.nannyId);
    const hourlyRate = nanny?.profile?.price || 500;

    const durationHours = order.duration;

    return hourlyRate * durationHours;
  }

  private async handleMenuActions(
    bot: any,
    query: any,
    chatId: string,
    user: any,
    data: string,
  ): Promise<boolean> {
    switch (data) {
      case 'new_orders':
        await this.orderService.showNewOrdersToNanny(bot, chatId);
        break;

      case 'my_schedule':
        await this.orderService.showNannySchedule(bot, chatId, user.id);
        break;

      case 'refresh_orders':
        await this.orderService.showNewOrdersToNanny(bot, chatId);
        break;

      case 'my_accepted_orders':
        await this.orderService.showNannyAcceptedOrders(bot, chatId, user.id);
        break;

      case 'nanny_orders_active':
        await this.orderService.showNannyActiveOrders(bot, chatId, user.id);
        break;

      case 'nanny_orders_history':
        await this.orderService.showNannyOrderHistory(bot, chatId, user.id);
        break;

      case 'medcard_yes':
        await this.usersService.updateNannyProfile(user.id, {
          hasMedCard: true,
        });
        await this.usersService.setNannyFSM(chatId, 'ASK_RATE');
        await bot.sendMessage(chatId, 'Какую почасовую ставку вы хотите установить?', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '300 руб', callback_data: 'rate_300' }],
              [{ text: '400 руб', callback_data: 'rate_400' }],
              [{ text: '500 руб', callback_data: 'rate_500' }],
              [{ text: 'Другая сумма', callback_data: 'rate_custom' }],
            ],
          },
        });
        break;

      case 'medcard_no':
        await this.usersService.updateNannyProfile(user.id, {
          hasMedCard: false,
        });
        await this.usersService.setNannyFSM(chatId, 'ASK_MEDCARD_READY');
        await bot.sendMessage(
          chatId,
          'Готовы ли вы её сделать? Мы сотрудничаем с медицинским центром Авиценна...',
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '✅ Да, готова',
                    callback_data: 'medcard_ready',
                  },
                ],
                [{ text: '❌ Нет', callback_data: 'medcard_not_ready' }],
              ],
            },
          },
        );
        break;

      case 'medcard_ready':
        await bot.sendMessage(
          chatId,
          '📍 Отлично! Вы можете оформить медкнижку бесплатно по ОМС,обратившись к своему участковому терапевту.Либо обратитесь в медицинский центр Авиценна по номеру +79998887766',
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: 'Продолжить регистрацию',
                    callback_data: 'continue_registration',
                  },
                ],
              ],
            },
          },
        );
        break;

      case 'medcard_not_ready':
      case 'continue_registration':
        await this.usersService.setNannyFSM(chatId, 'ASK_RATE');
        await bot.sendMessage(chatId, 'Какую почасовую ставку вы хотите установить?', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '300 руб', callback_data: 'rate_300' }],
              [{ text: '400 руб', callback_data: 'rate_400' }],
              [{ text: '500 руб', callback_data: 'rate_500' }],
              [{ text: 'Другая сумма', callback_data: 'rate_custom' }],
            ],
          },
        });
        break;

      case 'rate_300':
      case 'rate_400':
      case 'rate_500':
      case 'rate_custom':
        let rate: number | null = null;
        if (data === 'rate_300') rate = 300;
        if (data === 'rate_400') rate = 400;
        if (data === 'rate_500') rate = 500;

        if (rate) {
          await this.usersService.updateNannyProfile(user.id, {
            price: rate,
          });
          await this.usersService.setNannyFSM(chatId, 'ASK_PHOTO');
          await bot.sendMessage(
            chatId,
            'Заключительный шаг! 📷 Пришлите фото из галереи для аватарки.',
          );
        } else {
          await this.usersService.setNannyFSM(chatId, 'ASK_RATE_CUSTOM');
          await bot.sendMessage(chatId, 'Введите вашу ставку вручную (например: 450):');
        }
        break;

      case 'fill_profile':
        await this.usersService.setNannyFSM(chatId, 'ASK_NAME');
        await bot.sendMessage(chatId, 'Напишите полностью ваше ФИО:');
        break;

      default:
        // Если callback не обработан
        await bot.answerCallbackQuery(query.id);
        return false;
    }

    await bot.answerCallbackQuery(query.id);
    return true;
  }
}
