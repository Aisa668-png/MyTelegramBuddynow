// src/bot/services/callback-handlers/parent-callback.handler.ts
import { Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { FsmService } from '../fsm.service';
import { MenuService } from '../menu.service';
import { OrderService } from '../order.service';
import { PaymentsService } from '../payments.service';

@Injectable()
export class ParentCallbackHandler {
  constructor(
    private readonly usersService: UsersService,
    private readonly fsmService: FsmService,
    private readonly menuService: MenuService,
    private readonly orderService: OrderService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async handle(bot: any, query: any, chatId: string, user: any, fsmParent: any): Promise<boolean> {
    const data = query.data;

    // 🔹 ОБРАБОТКА ОСТАВЛЕНИЯ ОТЗЫВА
    if (data.startsWith('leave_review_')) {
      return await this.handleLeaveReview(bot, query, chatId, data);
    }

    // 🔹 ОБРАБОТКА ВЫБОРА РЕЙТИНГА
    if (data.startsWith('set_rating_')) {
      return await this.handleSetRating(bot, query, chatId, data);
    }

    // 🔹 ОБРАБОТКА ПОДТВЕРЖДЕНИЯ ЗАКАЗА
    if (data.startsWith('parent_confirm_order_')) {
      return await this.handleParentConfirmOrder(bot, query, chatId, user, data);
    }

    // 🔹 ОБРАБОТКА ОТКЛОНЕНИЯ ЗАКАЗА
    if (data.startsWith('parent_reject_order_')) {
      return await this.handleParentRejectOrder(bot, query, chatId, data);
    }

    // 🔹 ВЫБОР РЕБЕНКА
    if (data.startsWith('select_child_')) {
      return await this.handleSelectChild(bot, query, chatId, data);
    }

    // 🔹 РЕДАКТИРОВАНИЕ ДЕТЕЙ
    if (data.startsWith('edit_child_name_')) {
      return await this.handleEditChildName(bot, chatId, data);
    }
    if (data.startsWith('edit_child_age_')) {
      return await this.handleEditChildAge(bot, chatId, data);
    }
    if (data.startsWith('edit_child_info_')) {
      return await this.handleEditChildInfo(bot, chatId, data);
    }

    // 🔹 ОБРАБОТКА РЕЙТИНГОВ И ОТЗЫВОВ
    if (data.startsWith('review_')) {
      await bot.answerCallbackQuery(query.id);
      return true;
    }
    if (data.startsWith('write_review_')) {
      return await this.handleWriteReview(bot, query, chatId, data);
    }
    if (data.startsWith('skip_review_')) {
      return await this.handleSkipReview(bot, chatId);
    }

    // 🔹 ЗАВЕРШЕНИЕ ЗАКАЗА
    if (data.startsWith('complete_visit_')) {
      return await this.handleCompleteVisit(bot, query, chatId, data);
    }

    // 🔹 РЕДАКТИРОВАНИЕ ПРОФИЛЯ НЯНИ
    if (data === 'edit_nanny_profile') {
      // await this.profileService.handleEditNannyProfile(bot, query);
      await bot.answerCallbackQuery(query.id);
      return true;
    }

    // 🔹 ОБРАБОТКА МЕНЮ
    return await this.handleMenuActions(bot, query, chatId, user, data, fsmParent);
  }

  private async handleLeaveReview(
    bot: any,
    query: any,
    chatId: string,
    data: string,
  ): Promise<boolean> {
    const parts = data.split('_');
    const orderId = parseInt(parts[2]);
    const nannyId = parseInt(parts[3]);

    await this.usersService.setParentFSM(chatId, `awaiting_review_${orderId}_${nannyId}`);

    const reviewRequest = `
📝 Пожалуйста, оставьте отзыв о работе няни.

Оцените от 1 до 5 звезд и напишите комментарий.

Например:
"5 ⭐️
Отличная няня! Ребенок был доволен."
    `.trim();

    const ratingKeyboard = {
      inline_keyboard: [
        [
          { text: '1 ⭐', callback_data: `set_rating_1_${orderId}_${nannyId}` },
          { text: '2 ⭐', callback_data: `set_rating_2_${orderId}_${nannyId}` },
          { text: '3 ⭐', callback_data: `set_rating_3_${orderId}_${nannyId}` },
          { text: '4 ⭐', callback_data: `set_rating_4_${orderId}_${nannyId}` },
          { text: '5 ⭐', callback_data: `set_rating_5_${orderId}_${nannyId}` },
        ],
      ],
    };

    await bot.sendMessage(chatId, reviewRequest, {
      parse_mode: 'Markdown',
      reply_markup: ratingKeyboard,
    });

    await bot.answerCallbackQuery(query.id);
    return true;
  }

  private async handleSetRating(
    bot: any,
    query: any,
    chatId: string,
    data: string,
  ): Promise<boolean> {
    const parts = data.split('_');
    const rating = parseInt(parts[2]);
    const orderId = parseInt(parts[3]);
    const nannyId = parseInt(parts[4]);

    console.log('⭐ set_rating callback DETAILS:', {
      queryData: data,
      parts: parts,
      rating,
      orderId,
      nannyId,
      chatId,
    });

    if (isNaN(rating) || isNaN(orderId) || isNaN(nannyId)) {
      console.error('❌ INVALID RATING PARAMETERS:', { parts, rating, orderId, nannyId });
      await bot.sendMessage(chatId, '❌ Ошибка: неверные данные рейтинга.');
      await bot.answerCallbackQuery(query.id);
      return true;
    }

    await this.usersService.setParentFSM(
      chatId,
      `awaiting_review_text_${orderId}_${nannyId}_${rating}`,
    );

    await bot.sendMessage(chatId, '📝 Теперь напишите текстовый отзыв (комментарий):');
    await bot.answerCallbackQuery(query.id);
    return true;
  }

  private async handleParentConfirmOrder(
    bot: any,
    query: any,
    chatId: string,
    user: any,
    data: string,
  ): Promise<boolean> {
    const parts = data.split('_');
    const orderId = parseInt(parts[3]);
    const nannyId = parseInt(parts[4]);

    const order = await this.orderService.getOrderById(orderId);
    const nanny = await this.usersService.getById(nannyId);

    if (!order || !nanny) {
      await bot.sendMessage(chatId, '❌ Ошибка: данные не найдены.');
      await bot.answerCallbackQuery(query.id);
      return true;
    }

    // Обновляем статус заказа
    await this.orderService.updateOrderStatus(orderId, 'IN_PROGRESS');

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

    // Убираем кнопки, но оставляем сообщение
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      {
        chat_id: chatId,
        message_id: query.message?.message_id,
      },
    );

    await bot.answerCallbackQuery(query.id, { text: '✅ Заказ подтвержден!' });
    return true;
  }

  private async handleParentRejectOrder(
    bot: any,
    query: any,
    chatId: string,
    data: string,
  ): Promise<boolean> {
    const parts = data.split('_');
    const orderId = parseInt(parts[3]);
    const nannyId = parseInt(parts[4]);

    const order = await this.orderService.getOrderById(orderId);
    const nanny = await this.usersService.getById(nannyId);

    if (!order || !nanny) {
      await bot.sendMessage(chatId, '❌ Ошибка: данные не найдены.');
      await bot.answerCallbackQuery(query.id);
      return true;
    }

    // Обновляем статус заказа
    await this.orderService.updateOrderStatus(orderId, 'CANCELLED');

    // Уведомляем няню об отклонении
    if (nanny.chatId) {
      await bot.sendMessage(
        nanny.chatId,
        '❌ Родитель отклонил ваш заказ. Не расстраивайтесь! Посмотрите другие доступные заказы в разделе "Новые заказы".',
      );
    }

    // Обновляем сообщение у родителя
    await bot.editMessageText('❌ Заказ отклонен.', {
      chat_id: chatId,
      message_id: query.message?.message_id,
      reply_markup: { inline_keyboard: [] },
    });

    await bot.answerCallbackQuery(query.id);
    return true;
  }

  private async handleSelectChild(
    bot: any,
    query: any,
    chatId: string,
    data: string,
  ): Promise<boolean> {
    const childId = data.replace('select_child_', '');
    const child = await this.usersService.getChildById(parseInt(childId));

    if (child) {
      const orderData = (await this.orderService.getTempOrderData(chatId)) || {};
      orderData.child = `${child.name} (${child.age} лет)`;
      orderData.childId = child.id;
      await this.orderService.setTempOrderData(chatId, orderData);

      // 🔹 ПЕРЕХОДИМ К ЗАДАЧАМ
      await this.usersService.setParentFSM(chatId, 'ORDER_ASK_TASKS');
      await bot.sendMessage(
        chatId,
        '📝 Опишите какая именно помощь нужна:\n• Будете ли вы дома вовремя визита или хотите отлучиться?\n• Будут ли дополнительные задачи (приготовление пищи, отвезти/забрать с секции)?',
      );
    }

    await bot.answerCallbackQuery(query.id);
    return true;
  }

  private async handleEditChildName(bot: any, chatId: string, data: string): Promise<boolean> {
    const childIdForName = data.replace('edit_child_name_', '');
    await this.usersService.setParentFSM(chatId, `EDIT_CHILD_NAME_${childIdForName}`);
    await bot.sendMessage(chatId, 'Введите новое имя ребенка:');
    return true;
  }

  private async handleEditChildAge(bot: any, chatId: string, data: string): Promise<boolean> {
    const childIdForAge = data.replace('edit_child_age_', '');
    await this.usersService.setParentFSM(chatId, `EDIT_CHILD_AGE_${childIdForAge}`);
    await bot.sendMessage(chatId, 'Введите новый возраст ребенка:');
    return true;
  }

  private async handleEditChildInfo(bot: any, chatId: string, data: string): Promise<boolean> {
    const childIdForInfo = data.replace('edit_child_info_', '');
    await this.usersService.setParentFSM(chatId, `EDIT_CHILD_INFO_${childIdForInfo}`);
    await bot.sendMessage(chatId, 'Введите новую информацию о ребенке:');
    return true;
  }

  private async handleWriteReview(
    bot: any,
    query: any,
    chatId: string,
    data: string,
  ): Promise<boolean> {
    const orderId = parseInt(data.replace('write_review_', ''));
    await this.usersService.setParentFSM(chatId, `REVIEW_COMMENT_${orderId}`);
    await bot.sendMessage(chatId, '📝 Напишите ваш отзыв о работе няни:');
    await bot.answerCallbackQuery(query.id);
    return true;
  }

  private async handleSkipReview(bot: any, chatId: string): Promise<boolean> {
    await bot.sendMessage(chatId, '✅ Рейтинг сохранен. Спасибо!');
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
      // await this.completeOrderProcess(orderId, user.id);

      // Убираем кнопку завершения
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: Number(chatId),
          message_id: query.message?.message_id,
        },
      );

      await bot.answerCallbackQuery(query.id, { text: '✅ Заказ завершен!' });
    } catch (error: any) {
      console.error('Error completing order:', error);
      await bot.sendMessage(chatId, `❌ ${error.message}`);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка завершения' });
    }

    return true;
  }

  private async handleMenuActions(
    bot: any,
    query: any,
    chatId: string,
    user: any,
    data: string,
    fsmParent: any,
  ): Promise<boolean> {
    switch (data) {
      case 'ask_question':
        await this.usersService.setParentFSM(chatId, 'ASK_QUESTION');
        await bot.sendMessage(
          chatId,
          '💬 Напишите ваш вопрос, и мы ответим вам в ближайшее время:',
          { reply_markup: { inline_keyboard: [[]] } },
        );
        break;

      case 'back_to_faq':
        await this.menuService.showFaqMenu(bot, chatId);
        break;

      case 'active_orders':
        await this.handleActiveOrders(bot, chatId, user);
        break;

      case 'order_history':
        await this.handleOrderHistory(bot, chatId, user);
        break;

      case 'back_to_orders':
        await this.menuService.showMyOrdersMenu(bot, chatId);
        break;

      case 'one_time_payment':
        const lastCompletedOrder = await this.orderService.getLastCompletedOrderByParent(user.id);
        if (lastCompletedOrder) {
          await this.startPaymentProcess(bot, chatId, lastCompletedOrder);
        } else {
          await bot.sendMessage(chatId, '❌ У вас нет завершенных заказов для оплаты.');
        }
        break;

      case 'subscription':
        await bot.sendMessage(
          chatId,
          '🔔 Подписка временно недоступна. Используйте разовую оплату.',
          {
            reply_markup: {
              inline_keyboard: [[{ text: '💳 Разовая оплата', callback_data: 'one_time_payment' }]],
            },
          },
        );
        break;

      case 'create_payment':
        await this.handleCreatePayment(bot, query, chatId, data);
        break;

      case 'check_payment':
        await this.handleCheckPayment(bot, query, chatId, data);
        break;

      case 'mock_success':
        await this.handleMockSuccess(bot, query, chatId, data);
        break;

      case 'mock_failed':
        await this.handleMockFailed(bot, query, chatId, data);
        break;

      case 'back_to_tariffs':
      case 'back_to_menu':
        await this.menuService.showTariffsMenu(bot, chatId);
        break;

      case 'feedback_service':
        await this.usersService.setParentFSM(chatId, 'FEEDBACK_SERVICE');
        await bot.sendMessage(
          chatId,
          '📝 Пожалуйста, напишите ваш отзыв о нашем сервисе. Мы ценим каждое мнение!',
          { reply_markup: { inline_keyboard: [] } },
        );
        break;

      case 'feedback_nanny':
        await this.usersService.setParentFSM(chatId, 'FEEDBACK_NANNY');
        await bot.sendMessage(
          chatId,
          '📝 Пожалуйста, напишите ваш отзыв о работе няни. Укажите имя няни и ваши впечатления.',
          { reply_markup: { inline_keyboard: [] } },
        );
        break;

      case 'back_to_feedback':
        await this.menuService.showFeedbackMenu(bot, chatId);
        break;

      case 'edit_profile':
        await bot.sendMessage(chatId, 'Что вы хотите отредактировать?', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Имя', callback_data: 'edit_field_name' }],
              [{ text: '📞 Номер тлф', callback_data: 'edit_field_phone' }],
              [{ text: '👶 Имя ребенка', callback_data: 'edit_field_child_name' }],
              [{ text: '🔢 Возраст ребенка', callback_data: 'edit_field_child_age' }],
              [{ text: '📋 Информация о ребенке', callback_data: 'edit_field_child_info' }],
            ],
          },
        });
        break;

      case 'edit_field_name':
        await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_NAME');
        await bot.sendMessage(chatId, 'Введите новое имя:');
        break;

      case 'edit_field_phone':
        await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_PHONE');
        await bot.sendMessage(chatId, 'Пожалуйста, поделитесь вашим номером телефона:', {
          reply_markup: {
            keyboard: [[{ text: '📞 Поделиться номером', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        });
        break;

      case 'edit_field_child_name':
        await this.usersService.setParentFSM(chatId, 'EDIT_CHILD_NAME_SELECT');
        const children = await this.usersService.getChildrenByParentId(user.id);
        if (children.length === 0) {
          await bot.sendMessage(
            chatId,
            'У вас нет детей для редактирования. Сначала добавьте ребенка.',
          );
          await this.usersService.setParentFSM(chatId, null);
        } else {
          const childButtons = children.map((child) => [
            { text: child.name, callback_data: `edit_child_name_${child.id}` },
          ]);
          await bot.sendMessage(chatId, 'Выберите ребенка для изменения имени:', {
            reply_markup: { inline_keyboard: childButtons },
          });
        }
        break;

      case 'edit_field_child_age':
        await this.usersService.setParentFSM(chatId, 'EDIT_CHILD_AGE_SELECT');
        const childrenForAge = await this.usersService.getChildrenByParentId(user.id);
        if (childrenForAge.length === 0) {
          await bot.sendMessage(
            chatId,
            'У вас нет детей для редактирования. Сначала добавьте ребенка.',
          );
          await this.usersService.setParentFSM(chatId, null);
        } else {
          const childButtons = childrenForAge.map((child) => [
            {
              text: `${child.name} (${child.age || 'нет возраста'})`,
              callback_data: `edit_child_age_${child.id}`,
            },
          ]);
          await bot.sendMessage(chatId, 'Выберите ребенка для изменения возраста:', {
            reply_markup: { inline_keyboard: childButtons },
          });
        }
        break;

      case 'edit_field_child_info':
        await this.usersService.setParentFSM(chatId, 'EDIT_CHILD_INFO_SELECT');
        const childrenForInfo = await this.usersService.getChildrenByParentId(user.id);
        if (childrenForInfo.length === 0) {
          await bot.sendMessage(
            chatId,
            'У вас нет детей для редактирования. Сначала добавьте ребенка.',
          );
          await this.usersService.setParentFSM(chatId, null);
        } else {
          const childButtons = childrenForInfo.map((child) => [
            { text: child.name, callback_data: `edit_child_info_${child.id}` },
          ]);
          await bot.sendMessage(chatId, 'Выберите ребенка для изменения информации:', {
            reply_markup: { inline_keyboard: childButtons },
          });
        }
        break;

      case 'add_child':
        await this.usersService.setParentFSM(chatId, 'ASK_CHILD_NAME');
        await bot.sendMessage(chatId, 'Как зовут вашего ребёнка?');
        break;

      case 'skip_add_child':
        await bot.sendMessage(
          chatId,
          'Хорошо, вы можете добавить ребенка в любой момент, нажав кнопку "Мой профиль" в главном меню.\n\nНайдем няню? Первые услуги предоставляются бесплатно!',
          {
            reply_markup: {
              inline_keyboard: [[{ text: 'Создать заказ', callback_data: 'create_order' }]],
            },
          },
        );
        break;

      case 'skip_child_notes':
        // await this.fsmService.handleParentMessage(bot, chatId, '', this.parentFsmSteps, true);
        break;

      case 'consent_yes':
      case 'accept_terms':
        await this.usersService.setParentFSM(chatId, 'FINISH');
        console.log(`🚨 УСТАНАВЛИВАЮ МЕНЮ`);
        await bot.setMyCommands([], {
          // временно пустые команды
          scope: { type: 'chat', chat_id: Number(chatId) },
        });
        await bot.sendMessage(
          chatId,
          'Отлично 🎉 Регистрация завершена! Чтобы в будущем создавать заказы быстрее, вы можете уже сейчас добавить данные о ваших детях. Это займет минуту.',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '👶 Добавить ребёнка', callback_data: 'add_child' }],
                [{ text: '⏳ Сделаю позже', callback_data: 'skip_add_child' }],
              ],
            },
          },
        );
        break;

      case 'create_order':
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_DATE');
        await bot.sendMessage(
          chatId,
          '📅 Укажите дату, когда нужно присмотреть за вашим ребенком?',
        );
        break;

      case 'search_nanny':
        const nannies = await this.usersService.getAllNannies();
        const verifiedNannies = nannies.filter(
          (n) => n.profile?.status === 'VERIFIED', // временно строка
        );

        if (!verifiedNannies.length) {
          await bot.sendMessage(chatId, 'Пока нет доступных нянь.');
          break;
        }

        for (const nanny of verifiedNannies) {
          const profile = nanny.profile!;
          const skillsText = profile.skills?.length ? profile.skills.join(', ') : 'Нет';
          const msg = `Няня: ${profile.name || 'Без имени'}\nОпыт: ${profile.experience || 'Не указан'}\nНавыки: ${skillsText}\nРайон: ${profile.area || 'Не указан'}\nЦена: ${profile.price ? profile.price + ' ₽/час' : 'Не указана'}`;
          await bot.sendMessage(chatId, msg);
        }
        break;

      case 'edit_order':
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_DATE');
        await bot.sendMessage(
          chatId,
          '📅 Укажите дату, когда нужно присмотреть за вашим ребенком?',
        );
        break;

      case 'add_new_child':
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_CHILD');
        await bot.sendMessage(chatId, '👶 Укажите имя и возраст ребенка:');
        break;

      default:
        if (!fsmParent) {
          // await this.fsmService.handleParentMessage(bot, chatId, '', this.parentFsmSteps, false);
        }
    }
    if (data.startsWith('nanny_history_page_')) {
      const page = parseInt(data.replace('nanny_history_page_', ''));
      await this.orderService.showNannyOrderHistory(bot, chatId, user.id, page);
    }

    await bot.answerCallbackQuery(query.id);
    return true;
  }

  private async startPaymentProcess(bot: any, parentChatId: string, order: any) {
    try {
      const amount = await this.calculateOrderAmount(order);

      const paymentMessage = `
💳 *Оплата заказа #${order.id}*

👶 Услуга: Присмотр за ребенком
💰 Сумма: ${amount} руб.
⏱️ Продолжительность: ${order.duration || 2} часа

*Для завершения заказа произведите оплату*
    `.trim();

      await bot.sendMessage(parentChatId, paymentMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '💳 Оплатить картой',
                callback_data: `create_payment_${order.id}_${amount}`,
              },
            ],
          ],
        },
      });
    } catch (error) {
      console.error('Error starting payment process:', error);
    }
  }

  private async handleCreatePayment(bot: any, query: any, chatId: string, data: string) {
    const [_, orderId, amount] = data.split('_');

    try {
      const payment = await this.paymentsService.createPayment(
        parseInt(amount),
        `Оплата заказа #${orderId}`,
        orderId,
      );

      await bot.sendMessage(
        chatId,
        `
🎯 **ТЕСТОВЫЙ ПЛАТЕЖ**

Сумма: ${amount} руб.
Статус: Ожидает оплаты

*Это тестовая система - деньги не списываются*
    `.trim(),
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '✅ Имитировать успешную оплату',
                  callback_data: `mock_success_${orderId}`,
                },
              ],
              [{ text: '❌ Имитировать отмену оплаты', callback_data: `mock_failed_${orderId}` }],
            ],
          },
        },
      );

      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error('Error creating payment:', error);
    }
  }
  private async handleCheckPayment(bot: any, query: any, chatId: string, data: string) {
    const orderId = data.replace('check_payment_', '');
    await bot.sendMessage(chatId, '🔄 Проверяем статус оплаты...');
    // Здесь будет реальная проверка статуса платежа
    await bot.answerCallbackQuery(query.id);
  }

  private async calculateOrderAmount(order: any): Promise<number> {
    const nanny = await this.usersService.getById(order.nannyId);
    const hourlyRate = nanny?.profile?.price || 500;

    const durationHours = order.duration;

    return hourlyRate * durationHours;
  }

  private async handleMockSuccess(bot: any, query: any, chatId: string, data: string) {
    const orderId = data.replace('mock_success_', '');
    await bot.sendMessage(chatId, '✅ Тест: оплата прошла успешно! Заказ оплачен.');
    await bot.answerCallbackQuery(query.id);
  }

  private async handleMockFailed(bot: any, query: any, chatId: string, data: string) {
    const orderId = data.replace('mock_failed_', '');
    await bot.sendMessage(chatId, '❌ Тест: оплата не прошла. Попробуйте еще раз.');
    await bot.answerCallbackQuery(query.id);
  }

  private async handleActiveOrders(bot: any, chatId: string, user: any): Promise<void> {
    const activeOrders = await this.usersService.getActiveOrders(user.id.toString());

    if (activeOrders.length === 0) {
      await bot.sendMessage(
        chatId,
        '🟢 У вас нет активных заказов.\n\nСоздайте первый заказ с помощью команды /create_order',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '👶 Создать заказ', callback_data: 'create_order' }]],
          },
        },
      );
    } else {
      let ordersText = '🟢 Ваши активные заказы:\n\n';
      activeOrders.forEach((order, index) => {
        ordersText += `${index + 1}. ${order.date} - ${order.time}\n`;
        ordersText += `👶 ${order.child}\n`;
        ordersText += `🏠 ${order.address}\n`;
        ordersText += `📝 ${order.tasks?.substring(0, 50)}${order.tasks && order.tasks.length > 50 ? '...' : ''}\n`;
        ordersText += `Статус: ${order.status}\n\n`;
      });
      await bot.sendMessage(chatId, ordersText, { reply_markup: { inline_keyboard: [] } });
    }
  }

  private async handleOrderHistory(bot: any, chatId: string, user: any): Promise<void> {
    const orderHistory = await this.usersService.getOrderHistory(user.id.toString());

    if (orderHistory.length === 0) {
      await bot.sendMessage(
        chatId,
        '📊 История заказов пуста.\n\nЗдесь появятся ваши завершенные заказы',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '👶 Создать заказ', callback_data: 'create_order' }]],
          },
        },
      );
    } else {
      let historyText = '📊 История заказов:\n\n';
      orderHistory.forEach((order, index) => {
        historyText += `${index + 1}. ${order.date} - ${order.time}\n`;
        historyText += `👶 ${order.child}\n`;
        historyText += `🏠 ${order.address}\n`;
        historyText += `Статус: ${order.status}\n\n`;
      });
      await bot.sendMessage(chatId, historyText, { reply_markup: { inline_keyboard: [] } });
    }
  }
}
