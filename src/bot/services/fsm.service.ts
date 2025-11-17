import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { UsersService } from '../../users/users.service';
import { FsmStep } from '../types';
import { Role } from '../../../generated/prisma';
import { OrderService } from './order.service';

@Injectable()
export class FsmService {
  constructor(
    private readonly usersService: UsersService,
    private readonly orderService: OrderService,
  ) {}

  /**
   * 👤 Обработчик FSM для родителя
   */
  async handleParentMessage(
    bot: TelegramBot,
    chatId: string,
    text: string,
    parentFsmSteps: FsmStep[],
    isSkip = false,
    contact?: { phone_number: string },
  ): Promise<void> {
    const user = await this.usersService.getByChatId(chatId);
    if (!user) return;

    // 🔹 Проверяем телефон перед FSM
    if (!user.phone) {
      if (contact?.phone_number) {
        await this.usersService.savePhoneNumber(user.id, contact.phone_number);
        user.phone = contact.phone_number;
      }
    }

    // Если телефона нет — просим поделиться
    if (!user.phone) {
      await bot.sendMessage(chatId, 'Для авторизации нажмите кнопку "Поделиться номером"', {
        reply_markup: {
          keyboard: [[{ text: 'Поделиться номером', request_contact: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });
      return;
    }

    // 🔹 Получаем FSM из БД
    let fsmParent = await this.usersService.getParentFSM(chatId);

    // 🔹 Если FSM пустой или некорректный
    if (!fsmParent || !fsmParent.trim() || ['null', 'undefined'].includes(fsmParent.trim())) {
      if (user.fullName && user.fullName.trim()) {
        const name = user.fullName || user.username || 'родитель';
        await bot.sendMessage(chatId, `С возвращением, ${name}! 👋\nНужна помощь няни?`, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '👶 Создать заказ',
                  callback_data: 'create_order',
                },
              ],
            ],
          },
        });
        return;
      } else {
        fsmParent = 'ASK_NAME';
        await this.usersService.setParentFSM(chatId, fsmParent);
      }
    }

    // Разделяем baseKey и childId (если есть)
    const [baseKey, childIdStr] = fsmParent.split(':');
    const childId = childIdStr ? parseInt(childIdStr, 10) : undefined;

    // 🔹 Если шаг FINISH → показываем главное меню
    if (baseKey === 'FINISH') {
      await this.usersService.setParentFSM(chatId, null);
      await bot.sendMessage(
        chatId,
        'Отлично 🎉 Регистрация завершена! Чтобы в будущем создавать заказы быстрее, вы можете уже сейчас добавить данные о ваших детях. Это займет минуту.',
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '👶 Добавить ребёнка',
                  callback_data: 'add_child',
                },
              ],
              [
                {
                  text: '⏳ Сделаю позже',
                  callback_data: 'skip_add_child',
                },
              ],
            ],
          },
        },
      );
      return;
    }

    // Находим текущий шаг FSM
    const stepIndex = parentFsmSteps.findIndex((s) => s.key === baseKey);
    if (stepIndex === -1) {
      await this.usersService.setParentFSM(chatId, null);
      const name = user.fullName || user.username || 'родитель';
      await bot.sendMessage(chatId, `С возвращением, ${name}! 👋\nНужна помощь няни?`, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '👶 Создать заказ',
                callback_data: 'create_order',
              },
            ],
          ],
        },
      });
      return;
    }

    const step = parentFsmSteps[stepIndex];

    // 🔹 Если нет текста и не пропуск — показываем сообщение текущего шага
    if ((!text || text.trim() === '') && !isSkip) {
      await bot.sendMessage(chatId, step.message, step.options);
      return;
    }

    // 🔹 Обработка полей текущего шага
    if (step.field) {
      // === Шаг имя ===
      if (step.field === 'fullName') {
        await this.usersService.saveParentName(user.id, text);
        const nextStep = parentFsmSteps.find((s) => s.key === 'ASK_CONSENT');
        if (nextStep) {
          await this.usersService.setParentFSM(chatId, nextStep.key);
          await bot.sendMessage(chatId, nextStep.message, nextStep.options);
        }
        return;
      }

      // === Шаг согласия ===
      if (step.field === 'consent') {
        await this.usersService.setConsentGiven(user.id, true);
        await this.usersService.setParentFSM(chatId, 'FINISH');
        // Рекурсивный вызов для перехода к FINISH
        await this.handleParentMessage(bot, chatId, '', parentFsmSteps, false);
        return;
      }

      // === Шаги добавления ребёнка ===
      if (step.key.startsWith('ASK_CHILD')) {
        await this.handleChildSteps(bot, chatId, text, step, childId, user, parentFsmSteps, isSkip);
        return;
      }
    }

    // 🔹 Если шагов больше нет — завершаем FSM
    await this.usersService.setParentFSM(chatId, null);
    await bot.sendMessage(chatId, '✅ Регистрация завершена! Теперь вы можете искать няню.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Найти няню', callback_data: 'search_nanny' }],
          [{ text: 'Добавить ребёнка', callback_data: 'add_child' }],
        ],
      },
    });
  }

  private async handleChildSteps(
    bot: TelegramBot,
    chatId: string,
    text: string,
    step: FsmStep,
    childId: number | undefined,
    user: any,
    parentFsmSteps: FsmStep[],
    isSkip: boolean,
  ): Promise<void> {
    if (step.key === 'ASK_CHILD_NAME' && !isSkip) {
      const child = await this.usersService.saveChild(user.id, {
        name: text,
      });
      const nextStep = parentFsmSteps.find((s) => s.key === 'ASK_CHILD_AGE');
      if (nextStep) {
        await this.usersService.setParentFSM(chatId, `${nextStep.key}:${child.id}`);
        await bot.sendMessage(chatId, nextStep.message, nextStep.options);
      }
      return;
    }

    if (!childId) {
      await bot.sendMessage(chatId, 'Ошибка: не найден ID ребёнка. Попробуйте снова.');
      await this.usersService.setParentFSM(chatId, null);
      return;
    }

    if (step.field === 'age') {
      const parsedAge = parseInt(text, 10);
      if (isNaN(parsedAge) || parsedAge < 0) {
        await bot.sendMessage(chatId, 'Пожалуйста, введите возраст числом.');
        return;
      }
      await this.usersService.updateChild(childId, { age: parsedAge });
      const nextStep = parentFsmSteps.find((s) => s.key === 'ASK_CHILD_NOTES');
      if (nextStep) {
        await this.usersService.setParentFSM(chatId, `${nextStep.key}:${childId}`);
        await bot.sendMessage(chatId, nextStep.message, nextStep.options);
      }
      return;
    }

    if (step.field === 'notes') {
      if (!isSkip) await this.usersService.updateChild(childId, { notes: text });
      await this.usersService.setParentFSM(chatId, null);
      const child = await this.usersService.getChildById(childId);
      await bot.sendMessage(
        chatId,
        `Готово! ${child?.name || 'Ребёнок'} добавлен в ваш профиль. Теперь вы можете искать няню или добавить ещё одного ребёнка.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '👶 Создать заказ',
                  callback_data: 'create_order',
                },
              ],
            ],
          },
        },
      );
      return;
    }
  }

  async handleOrderCreation(
    bot: TelegramBot,
    chatId: string,
    text: string,
    fsmState: string,
    user: any,
  ): Promise<void> {
    const orderData = (await this.usersService.getTempOrderData(chatId)) || {};

    switch (fsmState) {
      case 'ORDER_ASK_DATE':
        orderData.date = text;
        await this.usersService.setTempOrderData(chatId, orderData);
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_TIME');
        await bot.sendMessage(
          chatId,
          '⏰ Укажите время начала и окончания визита няни? (например: 14:00 - 18:00)',
        );
        break;

      case 'ORDER_ASK_TIME':
        orderData.time = text;
        const calculatedHours = this.calculateDurationFromTime(text);
        orderData.duration = calculatedHours;

        console.log('🕒 Расчет длительности заказа:', {
          input: text,
          calculated: calculatedHours,
        });
        await this.usersService.setTempOrderData(chatId, orderData);
        await this.usersService.setParentFSM(chatId, 'ORDER_SELECT_CHILD');

        const children = await this.usersService.getUserChildren(user.id);
        if (children.length > 0) {
          const childButtons = children.map((child) => [
            { text: `${child.name} (${child.age} лет)`, callback_data: `select_child_${child.id}` },
          ]);
          childButtons.push([
            { text: '➕ Добавить нового ребенка', callback_data: 'add_new_child' },
          ]);

          await bot.sendMessage(chatId, '👶 Выберите ребенка из списка или добавьте нового:', {
            reply_markup: { inline_keyboard: childButtons },
          });
        } else {
          await this.usersService.setParentFSM(chatId, 'ORDER_ASK_CHILD');
          await bot.sendMessage(chatId, '👶 Укажите имя и возраст ребенка:');
        }
        break;

      case 'ORDER_ASK_CHILD':
        orderData.child = text;
        await this.usersService.setTempOrderData(chatId, orderData);
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_TASKS');
        await bot.sendMessage(
          chatId,
          '📝 Опишите какая именно помощь нужна:\n• Будете ли вы дома вовремя визита или хотите отлучиться?\n• Будут ли дополнительные задачи (приготовление пищи, отвезти/забрать с секции)?',
        );
        break;

      case 'ORDER_ASK_TASKS':
        orderData.tasks = text;
        await this.usersService.setTempOrderData(chatId, orderData);
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_ADDRESS');
        await bot.sendMessage(chatId, '🏠 Укажите адрес куда нужно приехать:');
        break;

      case 'ORDER_ASK_ADDRESS':
        orderData.address = text;
        await this.usersService.setTempOrderData(chatId, orderData);
        await this.usersService.setParentFSM(chatId, 'ORDER_CONFIRM');

        // Показываем сводку заказа для подтверждения
        const orderSummary = `
✅ ВАШ ЗАКАЗ

👶 Дети: ${orderData.child || 'Не указано'}
📅 Дата: ${orderData.date || 'Не указано'}
⏰ Время: ${orderData.time || 'Не указано'}
⏱️ Продолжительность: ${orderData.duration || 3} часа
🏠 Адрес: ${orderData.address || 'Не указано'}
📝 Задачи: ${orderData.tasks || 'Не указано'}
        `.trim();

        await bot.sendMessage(chatId, orderSummary.trim(), {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Да, подтверждаю', callback_data: 'confirm_order' }],
              [{ text: '✏️ Исправить', callback_data: 'edit_order' }],
            ],
          },
        });
        break;
      case 'ORDER_CONFIRM':
        console.log('✅ CONFIRMING ORDER WITH DATA:', orderData);

        try {
          const createdOrder = await this.orderService.createOrder(user.id.toString(), {
            ...orderData,
            parentChatId: chatId,
          });

          console.log('📦 Order created successfully:', {
            orderId: createdOrder.id,
            duration: createdOrder.duration,
            status: createdOrder.status,
          });

          // Очищаем FSM и временные данные
          await this.usersService.setParentFSM(chatId, null);
          await this.usersService.clearTempOrderData(chatId);

          await bot.sendMessage(
            chatId,
            `✅ Заказ создан! Ожидайте подтверждения няни.\n\n` +
              `📋 Детали заказа:\n` +
              `• Дата: ${orderData.date}\n` +
              `• Время: ${orderData.time}\n` +
              `• Длительность: ${orderData.duration} ч.\n` +
              `• Адрес: ${orderData.address}`,
          );
        } catch (error) {
          console.error('❌ Error creating order:', error);
          await bot.sendMessage(
            chatId,
            '❌ Произошла ошибка при создании заказа. Попробуйте еще раз.',
          );
        }
        break;
    }
  }

  private calculateDurationFromTime(timeInput: string): number {
    try {
      const cleanInput = timeInput.replace(/\s/g, '');
      const timeParts = cleanInput.split('-').filter((part) => part.length > 0);

      if (timeParts.length !== 2) return 3;

      const startTime = this.parseTime(timeParts[0]);
      const endTime = this.parseTime(timeParts[1]);

      if (!startTime || !endTime) return 3;

      let diffMs = endTime.getTime() - startTime.getTime();
      if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;

      return Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
    } catch (error) {
      return 3;
    }
  }

  private parseTime(timeStr: string): Date | null {
    try {
      const cleanTime = timeStr.replace(/[^0-9:]/g, '');

      let hours, minutes;

      if (cleanTime.includes(':')) {
        [hours, minutes] = cleanTime.split(':').map(Number);
      } else {
        if (cleanTime.length <= 2) {
          hours = Number(cleanTime);
          minutes = 0;
        } else {
          hours = Number(cleanTime.slice(0, 2));
          minutes = Number(cleanTime.slice(2));
        }
      }

      if (
        isNaN(hours) ||
        hours < 0 ||
        hours > 23 ||
        isNaN(minutes) ||
        minutes < 0 ||
        minutes > 59
      ) {
        return null;
      }

      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return date;
    } catch (error) {
      return null;
    }
  }
}
