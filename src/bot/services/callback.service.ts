// src/bot/services/callback.service.ts
import { Injectable } from '@nestjs/common';
import { FsmService } from './fsm.service';
import { UsersService } from 'src/users/users.service';
import { OrderService } from './order.service';
import { ParentCallbackHandler } from './callback-handlers/parent-callback.handler';
import { NannyCallbackHandler } from './callback-handlers/nanny-callback.handler';
import { AdminHandlerService } from './admin-handler.service';
import TelegramBot, { CallbackQuery } from 'node-telegram-bot-api';
import { ProfileStatus } from 'generated/prisma';
@Injectable()
export class CallbackService {
  constructor(
    private readonly usersService: UsersService,
    private readonly orderService: OrderService,
    private readonly fsmService: FsmService,
    private readonly parentCallbackHandler: ParentCallbackHandler,
    private readonly nannyCallbackHandler: NannyCallbackHandler,
    private readonly adminHandler: AdminHandlerService,
  ) {}

  async handleAdminCallbacks(
    bot: TelegramBot,
    query: CallbackQuery,
    chatId: string,
    user: any,
  ): Promise<boolean> {
    const data = query.data;

    if (!data) return false;
    if (data.startsWith('admin_nannies_page_')) {
      const page = parseInt(data.replace('admin_nannies_page_', ''));
      await this.adminHandler.showAllNannies(bot, chatId, page);
      return true;
    }
    if (data.startsWith('admin_show_more_nannies_')) {
      const offset = parseInt(data.replace('admin_show_more_nannies_', ''));
      await this.adminHandler.showAllNannies(bot, chatId, offset);
      return true;
    }
    if (data.startsWith('admin_view_nanny_')) {
      const nannyId = parseInt(data.replace('admin_view_nanny_', ''));
      await this.handleViewNanny(bot, query, nannyId, chatId);
      return true;
    }

    // 🔥 ДЕАКТИВИРОВАТЬ НЯНЮ
    if (data.startsWith('admin_deactivate_')) {
      const nannyId = parseInt(data.replace('admin_deactivate_', ''));
      await this.handleDeactivateNanny(bot, query, nannyId, chatId);
      return true;
    }
    // 🔥 ОБРАБОТКА ОДОБРЕНИЯ АНКЕТЫ
    if (data.startsWith('admin_approve_')) {
      const userId = parseInt(data.replace('admin_approve_', ''));
      await this.handleApproveProfile(bot, query, userId, chatId);
      return true;
    }

    // 🔥 ОБРАБОТКА ОТКЛОНЕНИЯ АНКЕТЫ
    if (data.startsWith('admin_reject_')) {
      const userId = parseInt(data.replace('admin_reject_', ''));
      await this.handleRejectProfile(bot, query, userId, chatId);
      return true;
    }
    if (data.startsWith('admin_nannies_page_')) {
      const page = parseInt(data.replace('admin_nannies_page_', ''));
      await this.adminHandler.showAllNannies(bot, chatId, page);
      return true;
    }
    if (data === 'admin_orders_active') {
      await this.adminHandler.showOrdersByStatus(bot, chatId, 'active', '🟢 Активные');
      return true;
    }

    if (data === 'admin_orders_completed') {
      await this.adminHandler.showOrdersByStatus(bot, chatId, 'COMPLETED', '✅ Завершенные');
      return true;
    }

    if (data === 'admin_orders_cancelled') {
      await this.adminHandler.showOrdersByStatus(bot, chatId, 'CANCELLED', '❌ Отмененные');
      return true;
    }

    if (data === 'admin_orders_pending') {
      await this.adminHandler.showOrdersByStatus(bot, chatId, 'PENDING', '🟡 Ожидающие');
      return true;
    }

    if (data === 'admin_orders_all') {
      await this.adminHandler.showOrdersByStatus(bot, chatId, 'all', '📋 Все');
      return true;
    }

    if (data === 'admin_orders_stats') {
      await this.adminHandler.showOrdersStats(bot, chatId);
      return true;
    }

    if (data === 'admin_back_to_orders') {
      await this.adminHandler.showAllOrders(bot, chatId);
      return true;
    }

    return false;
  }
  private async handleViewNanny(
    bot: TelegramBot,
    query: CallbackQuery,
    nannyId: number,
    adminChatId: string,
  ): Promise<void> {
    try {
      const nanny = await this.usersService.getById(nannyId);
      if (!nanny) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Няня не найдена' });
        return;
      }

      const detailedMessage = this.formatDetailedNannyMessage(nanny);

      await bot.sendMessage(adminChatId, detailedMessage, {
        parse_mode: 'Markdown',
      });

      await bot.answerCallbackQuery(query.id, { text: 'Подробная информация отправлена' });
    } catch (error) {
      console.error('Error viewing nanny:', error);
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Ошибка при получении информации',
        show_alert: true,
      });
    }
  }

  // 🔥 МЕТОД ДЛЯ ДЕАКТИВАЦИИ НЯНИ
  private async handleDeactivateNanny(
    bot: TelegramBot,
    query: CallbackQuery,
    nannyId: number,
    adminChatId: string,
  ): Promise<void> {
    try {
      await this.usersService.updateNannyStatus(nannyId, ProfileStatus.REJECTED);

      await bot.editMessageText('🚫 Няня деактивирована', {
        chat_id: adminChatId,
        message_id: query.message!.message_id,
      });

      await bot.answerCallbackQuery(query.id, { text: 'Няня деактивирована' });
    } catch (error) {
      console.error('Error deactivating nanny:', error);
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Ошибка при деактивации',
        show_alert: true,
      });
    }
  }

  // 🔥 МЕТОД ДЛЯ РЕДАКТИРОВАНИЯ НЯНИ
  private async handleEditNanny(
    bot: TelegramBot,
    query: CallbackQuery,
    nannyId: number,
    adminChatId: string,
  ): Promise<void> {
    try {
      // Здесь можно реализовать FSM для редактирования
      await bot.sendMessage(
        adminChatId,
        `Редактирование няни #${nannyId}\n\n` + `Выберите что хотите изменить:`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✏️ Имя', callback_data: `admin_edit_name_${nannyId}` },
                { text: '💰 Ставка', callback_data: `admin_edit_rate_${nannyId}` },
              ],
              [
                { text: '📞 Телефон', callback_data: `admin_edit_phone_${nannyId}` },
                { text: '📊 Статус', callback_data: `admin_edit_status_${nannyId}` },
              ],
            ],
          },
        },
      );

      await bot.answerCallbackQuery(query.id, { text: 'Редактирование начато' });
    } catch (error) {
      console.error('Error editing nanny:', error);
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Ошибка при редактировании',
        show_alert: true,
      });
    }
  }

  // 🔥 ФОРМАТИРОВАНИЕ ПОДРОБНОГО СООБЩЕНИЯ
  private formatDetailedNannyMessage(nanny: any): string {
    const profile = nanny.profile;
    const orders = nanny.ordersAsNanny || [];

    return `
👤 *Подробная информация о няне*

*Основное:*
• Имя: ${profile?.name || 'Не указано'}
• Телефон: ${nanny.phone || 'Не указан'}
• Статус: ${this.getProfileStatusText(profile?.status)}
• Рейтинг: ${nanny.avgRating || 'Нет отзывов'}

*Профиль:*
• Опыт: ${profile?.experience || 'Не указан'}
• Ставка: ${profile?.price ? `${profile.price} руб/час` : 'Не указана'}
• Медкарта: ${profile?.hasMedCard ? '✅ Есть' : '❌ Нет'}

*Статистика:*
• Всего заказов: ${orders.length}
• Завершено: ${orders.filter((o: any) => o.status === 'COMPLETED').length}
• Дата регистрации: ${new Date(nanny.createdAt).toLocaleDateString('ru-RU')}

*Последние заказы:*
${
  orders
    .slice(0, 3)
    .map((order: any) => `• #${order.id} - ${order.status} - ${order.date}`)
    .join('\n') || '• Нет заказов'
}
  `.trim();
  }

  // 🔥 МЕТОД ДЛЯ ОДОБРЕНИЯ АНКЕТЫ
  private async handleApproveProfile(
    bot: TelegramBot,
    query: CallbackQuery,
    userId: number,
    adminChatId: string,
  ): Promise<void> {
    try {
      // 🔥 ПРОВЕРКА НА UNDEFINED - БОЛЕЕ СТРОГАЯ
      if (!query.message || typeof query.message.message_id === 'undefined') {
        await bot.answerCallbackQuery(query.id, {
          text: '❌ Ошибка: сообщение не найдено',
        });
        return;
      }

      // 🔥 ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА ТИПА СООБЩЕНИЯ
      const message = query.message;
      if ('message_id' in message) {
        // Одобряем профиль
        await this.usersService.updateNannyStatus(userId, ProfileStatus.VERIFIED);

        // Обновляем сообщение
        await bot.editMessageText('✅ Анкета одобрена!', {
          chat_id: adminChatId,
          message_id: message.message_id,
        });

        // 🔥 УВЕДОМЛЯЕМ НЯНЮ (если нужно)
        const nanny = await this.usersService.getById(userId);
        if (nanny && nanny.chatId) {
          await bot.sendMessage(
            nanny.chatId,
            '🎉 Поздравляем! Ваша анкета одобрена!\n\nТеперь вы можете принимать заказы.',
          );
        }

        await bot.answerCallbackQuery(query.id, { text: 'Анкета одобрена' });
      } else {
        await bot.answerCallbackQuery(query.id, {
          text: '❌ Нельзя редактировать это сообщение',
        });
      }
    } catch (error) {
      console.error('Error approving profile:', error);
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Ошибка при одобрении анкеты',
        show_alert: true,
      });
    }
  }

  // 🔥 МЕТОД ДЛЯ ОТКЛОНЕНИЯ АНКЕТЫ
  private async handleRejectProfile(
    bot: TelegramBot,
    query: CallbackQuery,
    userId: number,
    adminChatId: string,
  ): Promise<void> {
    try {
      // 🔥 ПРОВЕРКА НА UNDEFINED - БОЛЕЕ СТРОГАЯ
      if (!query.message || typeof query.message.message_id === 'undefined') {
        await bot.answerCallbackQuery(query.id, {
          text: '❌ Ошибка: сообщение не найдено',
        });
        return;
      }

      // 🔥 ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА ТИПА СООБЩЕНИЯ
      const message = query.message;
      if ('message_id' in message) {
        // Отклоняем профиль
        await this.usersService.updateNannyStatus(userId, ProfileStatus.REJECTED);

        // Обновляем сообщение
        await bot.editMessageText('❌ Анкета отклонена', {
          chat_id: adminChatId,
          message_id: message.message_id,
        });

        await bot.answerCallbackQuery(query.id, { text: 'Анкета отклонена' });
      } else {
        await bot.answerCallbackQuery(query.id, {
          text: '❌ Нельзя редактировать это сообщение',
        });
      }
    } catch (error) {
      console.error('Error rejecting profile:', error);
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Ошибка при отклонении анкеты',
        show_alert: true,
      });
    }
  }

  // В классе CallbackService добавьте этот метод
  async handleRegistrationCallbacks(
    bot: any,
    query: any,
    chatId: string,
    user: any,
    fsmParent: string | null,
  ): Promise<boolean> {
    const data = query.data;

    // 🔹 Обработка согласия с условиями
    if (data === 'consent_yes') {
      await this.usersService.setConsentGiven(user.id, true);
      await this.usersService.setParentFSM(chatId, 'FINISH');
      await bot.sendMessage(chatId, '✅ Отлично! Регистрация завершена.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👶 Добавить ребенка', callback_data: 'add_child' }],
            [{ text: '⏰ Сделать позже', callback_data: 'add_child_later' }],
          ],
        },
      });
      await bot.answerCallbackQuery(query.id);
      return true;
    }
    // 🔹 ДОБАВЬТЕ ЭТО - Обработка "Добавить ребенка"
    if (data === 'add_child') {
      console.log('👶 Пользователь хочет добавить ребенка');
      await this.usersService.setParentFSM(chatId, 'ASK_CHILD_NAME');
      await bot.sendMessage(chatId, 'Введите имя вашего ребёнка:');
      await bot.answerCallbackQuery(query.id);
      return true;
    }
    // 🔹 Обработка "Сделать позже"
    if (data === 'add_child_later') {
      console.log('⏰ Пользователь отложил добавление ребенка');
      await bot.sendMessage(
        chatId,
        'Хорошо! Вы можете добавить ребенка позже в разделе "Мой профиль".\n\nТеперь вы можете создать заказ на няню.',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '👶 Создать заказ', callback_data: 'create_order' }]],
          },
        },
      );
      await bot.answerCallbackQuery(query.id);
      return true;
    }
    // 🔹 ДОБАВЬТЕ ЭТО - Обработка создания заказа
    // 🔹 Обработка создания заказа
    if (data === 'create_order') {
      console.log('👶 Пользователь хочет создать заказ');

      // Запускаем процесс создания заказа через FSM
      await this.usersService.setParentFSM(chatId, 'ORDER_ASK_DATE');
      await this.usersService.setTempOrderData(chatId, {});

      await bot.sendMessage(
        chatId,
        '📅 Укажите дату, когда присмотреть за ребенком (например: 15.11.2024):',
      );
      await bot.answerCallbackQuery(query.id);
      return true;
    }
    if (data === 'edit_order') {
      console.log('✏️ Пользователь хочет исправить заказ');
      await this.usersService.setParentFSM(chatId, 'ORDER_ASK_DATE');
      await bot.sendMessage(chatId, 'Давайте исправим заказ. 📅 Укажите дату:');
      await bot.answerCallbackQuery(query.id);
      return true;
    }

    if (data === 'skip_child_notes') {
      console.log('⏩ Пользователь пропустил заметки о ребенке');

      // Находим последнего созданного ребенка
      const children = await this.usersService.getChildrenByParentId(user.id);
      const lastChild = children[children.length - 1];
      const childName = lastChild?.name || 'ребенок';

      // ✅ ИЗМЕНИТЕ: переходим к FINISH и показываем сообщение о добавлении ребенка
      await this.usersService.setParentFSM(chatId, 'FINISH');
      await bot.sendMessage(chatId, `✅ Готово! ${childName} добавлен в ваш профиль.`, {
        reply_markup: {
          inline_keyboard: [[{ text: '👶 Создать заказ', callback_data: 'create_order' }]],
        },
      });
      await bot.answerCallbackQuery(query.id);
      return true;
    }
    if (data.startsWith('select_child_')) {
      const childId = data.replace('select_child_', '');
      const child = await this.usersService.getChildById(parseInt(childId));

      if (child) {
        const orderData = await this.usersService.getTempOrderData(chatId);
        await this.usersService.setTempOrderData(chatId, {
          ...orderData,
          child: `${child.name} (${child.age} лет)`,
          childId: child.id,
        });

        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_TASKS');
        await bot.sendMessage(
          chatId,
          '📝 Опишите какая именно помощь нужна:\n• Будете ли вы дома вовремя визита или хотите отлучиться?\n• Будут ли дополнительные задачи (приготовление пищи, отвезти/забрать с секции)?',
        );
      }
      await bot.answerCallbackQuery(query.id);
      return true;
    }

    if (data === 'add_new_child') {
      await this.usersService.setParentFSM(chatId, 'ORDER_ASK_CHILD');
      await bot.sendMessage(chatId, '👶 Укажите имя и возраст ребенка:');
      await bot.answerCallbackQuery(query.id);
      return true;
    }

    return false;
  }

  async handleNannyCallbacks(bot: any, query: any, chatId: string, user: any): Promise<boolean> {
    return await this.nannyCallbackHandler.handle(bot, query, chatId, user);
  }

  async handleParentCallbacks(bot: any, query: any, chatId: string, user: any): Promise<boolean> {
    const fsmParent = await this.usersService.getParentFSM(chatId);
    // 🔹 СНАЧАЛА обрабатываем регистрационные callback'ы
    const registrationHandled = await this.handleRegistrationCallbacks(
      bot,
      query,
      chatId,
      user,
      fsmParent,
    );
    if (registrationHandled) return true;

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
  // В CallbackService добавьте этот метод
  async handleRoleSelection(bot: any, query: any, chatId: string): Promise<void> {
    let role: any = null;
    if (query.data === 'role_nanny') role = 'NANNY';
    if (query.data === 'role_parent') role = 'PARENT';

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

      // 🔹 ВОССТАНАВЛИВАЕМ ЗАПРОС НОМЕРА ТЕЛЕФОНА
      await bot.sendMessage(
        chatId,
        'Для регистрации поделитесь, пожалуйста, вашим номером телефона:',
        {
          reply_markup: {
            keyboard: [[{ text: '📞 Поделиться номером', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      );

      // 🔹 НЕ УСТАНАВЛИВАЕМ FSM - номер обработается в contact handler
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

      // 🔹 ДЛЯ НЯНИ ТОЖЕ ЗАПРАШИВАЕМ НОМЕР
      await bot.sendMessage(
        chatId,
        'Для авторизации поделитесь, пожалуйста, вашим номером телефона:',
        {
          reply_markup: {
            keyboard: [[{ text: '📞 Поделиться номером', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      );
    }

    await bot.answerCallbackQuery(query.id);
  }
  // 🔥 ДОБАВИТЬ ЭТОТ МЕТОД В КЛАСС CallbackService
  private getProfileStatusText(status: any): string {
    switch (status) {
      case 'NEW':
        return '🆕 Новая';
      case 'PENDING':
        return '⏳ На модерации';
      case 'VERIFIED':
        return '✅ Одобрена';
      case 'REJECTED':
        return '❌ Отклонена';
      default:
        return '❓ Неизвестно';
    }
  }
}
