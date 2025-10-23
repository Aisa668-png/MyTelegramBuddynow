// src/bot/services/callback.service.ts
import { Injectable } from '@nestjs/common';
import { FsmService } from './fsm.service';
import { UsersService } from 'src/users/users.service';
import { OrderService } from './order.service';
import { ParentCallbackHandler } from './callback-handlers/parent-callback.handler';
import { NannyCallbackHandler } from './callback-handlers/nanny-callback.handler';

@Injectable()
export class CallbackService {
  constructor(
    private readonly usersService: UsersService,
    private readonly orderService: OrderService,
    private readonly fsmService: FsmService,
    private readonly parentCallbackHandler: ParentCallbackHandler,
    private readonly nannyCallbackHandler: NannyCallbackHandler,
  ) {}

  async handleNannyCallbacks(bot: any, query: any, chatId: string, user: any): Promise<boolean> {
    return await this.nannyCallbackHandler.handle(bot, query, chatId, user);
  }

  async handleParentCallbacks(bot: any, query: any, chatId: string, user: any): Promise<boolean> {
    const fsmParent = await this.usersService.getParentFSM(chatId);
    return await this.parentCallbackHandler.handle(bot, query, chatId, user, fsmParent);
  }

  // 🔹 Метод ВНУТРИ класса
  async handleConfirmOrder(bot: any, chatId: string, user: any): Promise<void> {
    // Выносим ТОЛЬКО логику confirm_order
    console.log('🎯 confirm_order processing...');

    const orderData = await this.usersService.getTempOrderData(chatId);

    if (orderData) {
      try {
        const order = await this.usersService.createOrder(user.id.toString(), orderData);

        await this.orderService.notifyNanniesAboutNewOrder(bot, order.id);

        // Очищаем FSM и временные данные
        await this.usersService.setParentFSM(chatId, null);
        await this.usersService.clearTempOrderData(chatId);

        await bot.sendMessage(chatId, '✅ Заказ создан и отправлен няням! Ожидайте откликов.', {
          reply_markup: { remove_keyboard: true },
        });

        // Запускаем таймер на 1 час для уведомления об отсутствии откликов
        this.scheduleNoResponseNotification(bot, chatId, order.id);

        console.log('✅ confirm_order completed successfully');
      } catch (error) {
        console.error('❌ Error creating order:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при создании заказа. Попробуйте еще раз.');
      }
    } else {
      await bot.sendMessage(chatId, '❌ Данные заказа не найдены. Начните создание заказа заново.');
    }
  }

  private scheduleNoResponseNotification(bot: any, chatId: string, orderId: number): void {
    setTimeout(
      async () => {
        const orderStatus = await this.usersService.getOrderStatus(orderId);
        if (orderStatus === 'PENDING') {
          await bot.sendMessage(
            chatId,
            '⏰ К сожалению, на ваш заказ пока нет откликов. Попробуйте создать заказ в другое время.',
          );
        }
      },
      60 * 60 * 1000,
    ); // 1 час
  }
  // В CallbackService добавьте этот метод
  async handleRoleSelection(bot: any, query: any, chatId: string): Promise<void> {
    console.log('🎯 Role selection processing...');

    let role: any = null;
    if (query.data === 'role_nanny') role = 'NANNY'; // или используйте ваш enum Role.NANNY
    if (query.data === 'role_parent') role = 'PARENT'; // или Role.PARENT

    if (!role) {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    await this.usersService.createUser(chatId, query.from.username || 'unknown_user', role);

    if (role === 'PARENT') {
      await bot.setMyCommands(
        [
          { command: 'start', description: 'Запустить бота' },
          { command: 'create_order', description: '👶 Создать заказ' },
          { command: 'my_orders', description: '📝 Мои заказы' },
          { command: 'my_profile', description: '👤 Мой профиль' },
          { command: 'tariffs', description: '💰 Тарифы' },
          { command: 'feedback', description: '💬 Обратная связь' },
          { command: 'faq', description: '❓ Частые вопросы' },
        ],
        { scope: { type: 'chat', chat_id: Number(chatId) } },
      );
      // Нужно будет передать parentFsmSteps или вынести в FSM service
      await this.fsmService.handleParentMessage(
        bot,
        chatId,
        '',
        // this.parentFsmSteps, // Пока закомментируем или передадим через параметры
        [],
        false,
      );
    }

    if (role === 'NANNY') {
      await bot.setMyCommands(
        [
          { command: 'start', description: 'Запустить бота' },
          { command: 'new_orders', description: '📋 Новые заказы' },
          { command: 'my_orders', description: '📝 Мои заказы' },
          { command: 'my_schedule', description: '📅 Мое расписание' },
          { command: 'my_rating', description: '⭐ Мой рейтинг' },
          { command: 'edit_profile', description: '✏️ Редактировать профиль' },
          { command: 'support', description: '🆘 Поддержка' },
        ],
        { scope: { type: 'chat', chat_id: Number(chatId) } },
      );
      const options = {
        reply_markup: {
          keyboard: [[{ text: 'Поделиться номером', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      };
      await bot.sendMessage(chatId, 'Для авторизации нажмите кнопку "Поделиться номером"', options);
    }

    await bot.answerCallbackQuery(query.id);
  }
}
