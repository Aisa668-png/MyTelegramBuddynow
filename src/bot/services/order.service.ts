import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { UsersService } from '../../users/users.service';
import { MessageService } from './message.service';

@Injectable()
export class OrderService {
  constructor(
    private readonly usersService: UsersService,
    private readonly messageService: MessageService,
  ) {}

  async showNewOrdersToNanny(bot: TelegramBot, chatId: string): Promise<void> {
    try {
      const newOrders = await this.usersService.getNewOrdersForNannies();

      if (newOrders.length === 0) {
        await bot.sendMessage(chatId, '📭 На данный момент нет новых заказов.\nПроверьте позже!', {
          reply_markup: { inline_keyboard: [] },
        });
        return;
      }

      for (const order of newOrders) {
        const orderText = `
📋 *Новый заказ*

📅 Дата: ${order.date}
⏰ Время: ${order.time}
👶 Ребенок: ${order.child}
🏠 Адрес: ${order.address}
📝 Задачи: ${order.tasks || 'Не указано'}

*Статус:* 🔍 В поиске няни
      `;

        await bot.sendMessage(chatId, orderText.trim(), {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Взять заказ', callback_data: `accept_order_${order.id}` }],
            ],
          },
        });
      }
    } catch (error) {
      console.error('Error showing orders to nanny:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке заказов');
    }
  }

  async showNannyAcceptedOrders(bot: TelegramBot, chatId: string, nannyId: number): Promise<void> {
    try {
      const acceptedOrders = await this.usersService.getNannyOrdersByStatus(nannyId.toString(), [
        'ACCEPTED',
        'IN_PROGRESS',
      ]);

      if (acceptedOrders.length === 0) {
        await bot.sendMessage(chatId, '📋 У вас пока нет принятых заказов.', {
          reply_markup: {
            inline_keyboard: [[{ text: '📭 Новые заказы', callback_data: 'new_orders' }]],
          },
        });
        return;
      }

      let ordersText = '✅ Ваши принятые заказы:\n\n';
      acceptedOrders.forEach((order, index) => {
        ordersText += `${index + 1}. ${order.date} - ${order.time}\n`;
        ordersText += `👶 ${order.child}\n`;
        ordersText += `🏠 ${order.address}\n`;
        ordersText += `Статус: ${order.status}\n\n`;
      });

      await bot.sendMessage(chatId, ordersText, {
        reply_markup: {
          inline_keyboard: [[{ text: '📭 Новые заказы', callback_data: 'new_orders' }]],
        },
      });
    } catch (error) {
      console.error('Error showing nanny orders:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке ваших заказов');
    }
  }

  async notifyNanniesAboutNewOrder(bot: TelegramBot, orderId: number): Promise<void> {
    try {
      const activeNannies = await this.usersService.getActiveNannies();
      for (const nanny of activeNannies) {
        await bot.sendMessage(
          nanny.chatId,
          '🔔 Появился новый заказ! Посмотрите в разделе "Новые заказы"',
        );
      }
    } catch (error) {
      console.error('Error notifying nannies:', error);
    }
  }

  async showNannyActiveOrders(bot: TelegramBot, chatId: string, nannyId: number): Promise<void> {
    try {
      const activeOrders = await this.usersService.getNannyActiveOrders(nannyId);
      const waitingConfirmation = activeOrders.filter((order) => order.status === 'ACCEPTED');
      const inProgressOrders = activeOrders.filter((order) => order.status === 'IN_PROGRESS');

      if (activeOrders.length === 0) {
        await bot.sendMessage(chatId, '🟡 У вас пока нет активных заказов.', {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        });
        return;
      }

      // 🔹 Показываем заказы ожидающие подтверждения
      if (waitingConfirmation.length > 0) {
        for (const order of waitingConfirmation) {
          const orderText = this.messageService.formatActiveOrder(order, 'waiting');
          const keyboard = this.messageService.createOrderKeyboard(order.id, 'waiting');

          await bot.sendMessage(chatId, orderText, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });
        }
      }

      // 🔹 Показываем активные заказы (подтвержденные)
      if (inProgressOrders.length > 0) {
        for (const order of inProgressOrders) {
          const orderText = this.messageService.formatActiveOrder(order, 'confirmed');
          const keyboard = this.messageService.createOrderKeyboard(order.id, 'confirmed');

          await bot.sendMessage(chatId, orderText, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });
        }
      }
    } catch (error) {
      console.error('Error showing active orders:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке заказов');
    }
  }

  async showNannySchedule(bot: TelegramBot, chatId: string, nannyId: number): Promise<void> {
    try {
      const activeOrders = await this.usersService.getNannyActiveOrders(nannyId);
      const today = new Date().toISOString().split('T')[0];
      const confirmedOrders = activeOrders.filter(
        (order) => order.status === 'IN_PROGRESS' && order.date >= today,
      );

      if (confirmedOrders.length === 0) {
        await bot.sendMessage(
          chatId,
          '📅 <b>Мое расписание</b>\n\nНа ближайшее время у вас нет запланированных заказов.',
          {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] },
          },
        );
        return;
      }

      const ordersByDate = this.messageService.groupOrdersByDate(confirmedOrders);
      let message = '📅 <b>Мое расписание</b>\n\n';

      for (const [date, orders] of Object.entries(ordersByDate)) {
        const formattedDate = this.messageService.formatScheduleDate(date);
        message += `📌 <b>${formattedDate}</b>\n\n`;

        for (const order of orders) {
          message += this.messageService.formatScheduleOrder(order);
          message += '\n' + '─'.repeat(30) + '\n\n';
        }
      }

      message += '<i>Это ваши подтвержденные заказы на ближайшее время</i>';

      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      });
    } catch (error) {
      console.error('Error showing nanny schedule:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке расписания');
    }
  }
}
