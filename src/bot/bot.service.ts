import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot, { Message, CallbackQuery, SendMessageOptions } from 'node-telegram-bot-api';
import { UsersService } from '../users/users.service';
import { Role, ProfileStatus } from '../../generated/prisma';

@Injectable()
export class BotService implements OnModuleInit {
  private bot!: TelegramBot;
  // 🔹 ДОБАВЛЕНО: Конфигурация шагов FSM родителей

  // FSM состояния для создания заказа
  private orderCreationSteps = [
    { key: 'ASK_DATE', message: '📅 Укажите дату, когда нужно присмотреть за вашим ребенком?' },
    { key: 'ASK_TIME', message: '⏰ Укажите время начала и окончания визита няни?' },
    { key: 'ASK_CHILD', message: '👶 Укажите имя и возраст ребенка:' },
    {
      key: 'ASK_TASKS',
      message:
        '📝 Опишите какая именно помощь нужна:\n• Будете ли вы дома вовремя визита или хотите отлучиться?\n• Будут ли дополнительные задачи (приготовление пищи, отвезти/забрать с секции)?',
    },
    { key: 'ASK_ADDRESS', message: '🏠 Укажите адрес куда нужно приехать:' },
    { key: 'CONFIRM_ORDER', message: '✅ ВАШ ЗАКАЗ' },
  ];

  parentCommands = [
    { command: 'create_order', description: 'Создать заказ' },
    { command: 'my_orders', description: 'Мои заказы' },
    { command: 'my_profile', description: 'Мой профиль' },
    { command: 'tariffs', description: 'Тарифы и оплата' },
    { command: 'faq', description: 'Вопросы и ответы' },
    { command: 'support', description: 'Поддержка' },
    { command: 'feedback', description: 'Оставить отзыв' },
  ];

  nannyCommands = [
    { command: 'new_orders', description: 'Новые заказы' },
    { command: 'my_schedule', description: 'Мое расписание' },
    { command: 'my_orders', description: 'Мои заказы' },
    { command: 'my_rating', description: 'Мой рейтинг' },
    { command: 'edit_profile', description: 'Редактировать профиль' },
    { command: 'support', description: 'Связаться с поддержкой' },
    { command: 'faq', description: 'Вопросы и ответы' },
  ];

  parentFsmSteps = [
    {
      key: 'ASK_ROLE',
      message: 'Выберите вашу роль:',
      field: null,
      options: {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Родитель', callback_data: 'PARENT' }],
            [{ text: 'Няня', callback_data: 'NANNY' }],
          ],
        },
      },
    },
    /*{
      key: 'ASK_PHONE',
      message: 'Пожалуйста, поделитесь своим номером телефона:',
      field: 'phone',
      options: {
        reply_markup: {
          keyboard: [[{ text: 'Поделиться номером', request_contact: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      },
    },*/
    {
      key: 'ASK_NAME',
      message: 'Введите ваше имя:',
      field: 'fullName',
    },
    {
      key: 'ASK_CONSENT',
      message:
        'Минутка формальности. Подтвердите согласие с условиями обработки персональных данных.',
      field: null, // просто кнопка или чекбокс
      options: {
        reply_markup: {
          inline_keyboard: [[{ text: 'Согласен', callback_data: 'consent_yes' }]],
        },
      },
    },
    {
      key: 'ASK_CHILD_NAME',
      message: 'Введите имя вашего ребёнка:',
      field: 'name',
    },
    {
      key: 'ASK_CHILD_AGE',
      message: 'Укажите возраст вашего ребёнка:',
      field: 'age',
    },
    {
      key: 'ASK_CHILD_NOTES',
      message: 'Расскажите о особенностях вашего ребёнка (аллергии, привычки и т.д.):',
      field: 'notes',
      options: {
        reply_markup: {
          inline_keyboard: [[{ text: 'Пропустить', callback_data: 'skip_child_notes' }]],
        },
      },
    },

    {
      key: 'FINISH',
      message: '✅ Регистрация завершена! Теперь вы можете искать няню.',
      field: null,
      options: {
        reply_markup: {
          inline_keyboard: [[{ text: 'Найти няню', callback_data: 'search_nanny' }]],
        },
      },
    },
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  private async handleParentMessage(
    chatId: string,
    text: string,
    isSkip = false,
    contact?: { phone_number: string },
  ) {
    const user = await this.usersService.getByChatId(chatId);
    if (!user) return;

    // 🔹 Проверяем телефон перед FSM
    if (!user.phone) {
      if (contact?.phone_number) {
        await this.usersService.savePhoneNumber(user.id, contact.phone_number);
        user.phone = contact.phone_number; // обновляем локально
      }
    }

    // Если телефона нет — просим поделиться
    if (!user.phone) {
      await this.bot.sendMessage(chatId, 'Для авторизации нажмите кнопку "Поделиться номером"', {
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
        await this.bot.sendMessage(chatId, `С возвращением, ${name}! 👋\nНужна помощь няни?`, {
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
        fsmParent = 'ASK_NAME'; // сразу начинаем с имени
        await this.usersService.setParentFSM(chatId, fsmParent);
      }
    }

    // Разделяем baseKey и childId (если есть)
    const [baseKey, childIdStr] = fsmParent.split(':');
    const childId = childIdStr ? parseInt(childIdStr, 10) : undefined;

    // 🔹 Если шаг FINISH → показываем главное меню
    if (baseKey === 'FINISH') {
      // Вместо показа меню здесь, имитируем нажатие кнопки согласия
      await this.usersService.setParentFSM(chatId, null);

      await this.bot.sendMessage(
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
    const stepIndex = this.parentFsmSteps.findIndex((s) => s.key === baseKey);
    if (stepIndex === -1) {
      await this.usersService.setParentFSM(chatId, null);
      // ⚠️ НЕ устанавливаем меню здесь, просто сообщение
      const name = user.fullName || user.username || 'родитель';
      await this.bot.sendMessage(chatId, `С возвращением, ${name}! 👋\nНужна помощь няни?`, {
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

    const step = this.parentFsmSteps[stepIndex];

    // 🔹 Если нет текста и не пропуск — показываем сообщение текущего шага
    if ((!text || text.trim() === '') && !isSkip) {
      await this.bot.sendMessage(chatId, step.message, step.options);
      return;
    }

    // 🔹 Обработка полей текущего шага (оставляем всё как было)
    if (step.field) {
      // === Шаг имя ===
      if (step.field === 'fullName') {
        await this.usersService.saveParentName(user.id, text);
        const nextStep = this.parentFsmSteps.find((s) => s.key === 'ASK_CONSENT');
        if (nextStep) {
          await this.usersService.setParentFSM(chatId, nextStep.key);
          await this.bot.sendMessage(chatId, nextStep.message, nextStep.options);
        }
        return;
      }

      // === Шаг согласия ===
      if (step.field === 'consent') {
        await this.usersService.setConsentGiven(user.id, true);
        await this.usersService.setParentFSM(chatId, 'FINISH');
        await this.handleParentMessage(chatId, '');
        return;
      }

      // === Шаги добавления ребёнка ===
      if (step.key.startsWith('ASK_CHILD')) {
        if (step.key === 'ASK_CHILD_NAME' && !isSkip) {
          const child = await this.usersService.saveChild(user.id, {
            name: text,
          });
          const nextStep = this.parentFsmSteps.find((s) => s.key === 'ASK_CHILD_AGE');
          if (nextStep) {
            await this.usersService.setParentFSM(chatId, `${nextStep.key}:${child.id}`);
            await this.bot.sendMessage(chatId, nextStep.message, nextStep.options);
          }
          return;
        }

        if (!childId) {
          await this.bot.sendMessage(chatId, 'Ошибка: не найден ID ребёнка. Попробуйте снова.');
          await this.usersService.setParentFSM(chatId, null);
          return;
        }

        if (step.field === 'age') {
          const parsedAge = parseInt(text, 10);
          if (isNaN(parsedAge) || parsedAge < 0) {
            await this.bot.sendMessage(chatId, 'Пожалуйста, введите возраст числом.');
            return;
          }
          await this.usersService.updateChild(childId, { age: parsedAge });
          const nextStep = this.parentFsmSteps.find((s) => s.key === 'ASK_CHILD_NOTES');
          if (nextStep) {
            await this.usersService.setParentFSM(chatId, `${nextStep.key}:${childId}`);
            await this.bot.sendMessage(chatId, nextStep.message, nextStep.options);
          }
          return;
        }

        if (step.field === 'notes') {
          if (!isSkip) await this.usersService.updateChild(childId, { notes: text });
          await this.usersService.setParentFSM(chatId, null);
          const child = await this.usersService.getChildById(childId);
          await this.bot.sendMessage(
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
    }

    // 🔹 Если шагов больше нет — завершаем FSM
    await this.usersService.setParentFSM(chatId, null);
    await this.bot.sendMessage(chatId, '✅ Регистрация завершена! Теперь вы можете искать няню.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Найти няню', callback_data: 'search_nanny' }],
          [{ text: 'Добавить ребёнка', callback_data: 'add_child' }],
        ],
      },
    });
  }

  private async handleOrderCreation(chatId: string, text: string, fsmState: string, user: any) {
    // Получаем или создаем временные данные заказа
    const orderData = (await this.usersService.getTempOrderData(chatId)) || {};

    switch (fsmState) {
      case 'ORDER_ASK_DATE':
        orderData.date = text;
        await this.usersService.setTempOrderData(chatId, orderData);
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_TIME');
        await this.bot.sendMessage(
          chatId,
          '⏰ Укажите время начала и окончания визита няни? (например: 14:00 - 18:00)',
        );
        break;

      case 'ORDER_ASK_TIME':
        orderData.time = text;
        await this.usersService.setTempOrderData(chatId, orderData);
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_CHILD');

        // Получаем детей пользователя для выбора
        const children = await this.usersService.getUserChildren(user.id);
        if (children.length > 0) {
          const childButtons = children.map((child) => [
            { text: `${child.name} (${child.age} лет)`, callback_data: `select_child_${child.id}` },
          ]);
          childButtons.push([
            { text: '➕ Добавить нового ребенка', callback_data: 'add_new_child' },
          ]);

          await this.bot.sendMessage(chatId, '👶 Выберите ребенка из списка или добавьте нового:', {
            reply_markup: { inline_keyboard: childButtons },
          });
        } else {
          await this.bot.sendMessage(chatId, '👶 Укажите имя и возраст ребенка:');
        }
        break;

      case 'ORDER_ASK_CHILD':
        orderData.child = text;
        await this.usersService.setTempOrderData(chatId, orderData);
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_TASKS');
        await this.bot.sendMessage(
          chatId,
          '📝 Опишите какая именно помощь нужна:\n• Будете ли вы дома вовремя визита или хотите отлучиться?\n• Будут ли дополнительные задачи (приготовление пищи, отвезти/забрать с секции)?',
        );
        break;

      case 'ORDER_ASK_TASKS':
        orderData.tasks = text;
        await this.usersService.setTempOrderData(chatId, orderData);
        await this.usersService.setParentFSM(chatId, 'ORDER_ASK_ADDRESS');
        await this.bot.sendMessage(chatId, '🏠 Укажите адрес куда нужно приехать:');
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
🏠 Адрес: ${orderData.address || 'Не указано'}
📝 Задачи: ${orderData.tasks || 'Не указано'}
      `;

        await this.bot.sendMessage(chatId, orderSummary.trim(), {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Да, подтверждаю', callback_data: 'confirm_order' }],
              [{ text: '✏️ Исправить', callback_data: 'edit_order' }],
            ],
          },
        });
        break;
    }
  }

  private async showParentProfile(chatId: string, user: any) {
    try {
      // 🔹 Получаем детей родителя
      const children = await this.usersService.getChildrenByParentId(user.id);

      // 🔹 Формируем текст профиля
      let profileText = `👤 *Мой профиль*\n\n`;

      // Основная информация родителя
      profileText += `*Имя:* ${user.fullName || 'Не указано'}\n`;
      profileText += `*Номер тлф:* ${user.phone ? this.formatPhone(user.phone) : 'Не указано'}\n\n`;

      // 🔹 Информация о детях
      if (children.length > 0) {
        children.forEach((child, index) => {
          profileText += `*Ребенок ${index + 1}:*\n`;
          profileText += `*Имя ребенка:* ${child.name || 'Не указано'}\n`;
          profileText += `*Возраст ребенка:* ${child.age ? child.age + ' лет' : 'Не указано'}\n`;
          profileText += `*О ребенке:* ${child.notes || 'Не указано'}\n`;
          if (index < children.length - 1) profileText += `\n`;
        });
      } else {
        profileText += `*Дети:* не добавлены\n`;
      }

      // 🔹 Только одна кнопка "Редактировать"
      await this.bot.sendMessage(chatId, profileText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '✏️ Редактировать', callback_data: 'edit_profile' }]],
        },
      });
    } catch (error) {
      console.error('Error showing parent profile:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке профиля');
    }
  }

  // 🔹 Вспомогательный метод для форматирования телефона
  private formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `+7 (${cleaned.substring(1, 4)}) ${cleaned.substring(4, 7)}-${cleaned.substring(7, 9)}-${cleaned.substring(9)}`;
    }
    return phone;
  }

  private async showTariffsMenu(chatId: string) {
    const tariffsText = `💰 *Тарифы и оплата*\n\nВыберите тип оплаты:`;

    await this.bot.sendMessage(chatId, tariffsText, {
      //parse_mode: 'Markdown',
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

  private async showFeedbackMenu(chatId: string) {
    const feedbackText = `💬 *Оставить отзыв*\n\nВыберите тип отзыва:`;

    await this.bot.sendMessage(chatId, feedbackText, {
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

  private async showMyOrdersMenu(chatId: string) {
    const ordersText = `📋 Мои заказы\n\nВыберите раздел:`;

    await this.bot.sendMessage(chatId, ordersText, {
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

  private async showFaqMenu(chatId: string) {
    const faqText = `❓ Вопросы и ответы\n\nЗдесь вы найдете ответы на часто задаваемые вопросы о нашем сервисе.`;

    await this.bot.sendMessage(chatId, faqText, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📖 Статья о работе сервиса',
              url: 'https://telegra.ph/FAQ-o-servise-Pomogator-10-09', // моковая ссылка
            },
          ],
        ],
      },
    });
  }

  onModuleInit(): void {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('❌ TELEGRAM_BOT_TOKEN не найден в .env');

    this.bot = new TelegramBot(token, { polling: true });
    // 🔹 ОЧИСТКА ВСЕХ КОМАНД ПРИ ЗАПУСКЕ
    this.bot
      .setMyCommands([], { scope: { type: 'default' } })
      .then(() => console.log('✅ Все команды очищены'))
      .catch((err) => console.error('❌ Ошибка очистки команд:', err));

    // --- /start ---
    this.bot.onText(/\/start/, (msg: Message) => {
      void (async () => {
        if (!msg.from) return;
        try {
          const chatId = msg.chat.id.toString();
          console.log(`🔍 /start вызван для chatId: ${chatId}`);
          let user = await this.usersService.getByChatId(chatId);
          console.log(`🔍 Пользователь: ${user ? `найден, роль: ${user.role}` : 'не найден'}`);

          // 🔹 Новые пользователи или пользователь без роли
          if (!user || !user.role) {
            const welcomeMessage = `Здравствуйте! Меня зовут Сян, я бот-помощник "Помогатор". 
Узнать больше о работе сервиса можно в описании. 
Вы родитель или няня?`;

            const buttons: { text: string; callback_data: string }[][] = [
              [{ text: 'Няня', callback_data: 'role_nanny' }],
              [{ text: 'Родитель', callback_data: 'role_parent' }],
            ];

            const options: SendMessageOptions = {
              reply_markup: { inline_keyboard: buttons },
            };

            await this.bot.sendMessage(chatId, welcomeMessage, options);
            return;
          }

          // 🔹 Если пользователь уже есть и у него есть роль
          if (user?.role) {
            if (user?.role === Role.PARENT) {
              const parentFsm = await this.usersService.getParentFSM(chatId);

              if (parentFsm && parentFsm !== 'FINISH') {
                // 🔹 ДОБАВЛЕНО: установка меню для родителя
                /* await this.bot.setMyCommands(parentCommands, {
                  scope: { type: 'chat', chat_id: Number(chatId) },
                });*/
                await this.handleParentMessage(chatId, '');
                return;
              } else {
                const name = user.fullName || user.username || 'родитель';
                await this.bot.sendMessage(
                  chatId,
                  `С возвращением, ${name}! 👋\nНужна помощь няни?`,
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

            if (user.role === Role.ADMIN) {
              await this.bot.sendMessage(chatId, `С возвращением, админ 👑`, {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: 'Просмотреть анкеты нянь',
                        callback_data: 'admin_view_nannies',
                      },
                    ],
                  ],
                },
              });
              return;
            }

            if (user && user.role === Role.NANNY) {
              const fsmNanny = await this.usersService.getNannyFSM(chatId);
              if (fsmNanny) {
                switch (fsmNanny) {
                  case 'ASK_NAME':
                    await this.bot.sendMessage(
                      chatId,
                      'Вы начали заполнять анкету. Напишите полностью ваше ФИО:',
                    );
                    break;
                  case 'ASK_DOB':
                    await this.bot.sendMessage(
                      chatId,
                      'Вы начали заполнение. Укажите вашу дату рождения (дд.мм.гггг):',
                    );
                    break;
                  case 'ASK_OCCUPATION':
                    await this.bot.sendMessage(
                      chatId,
                      'Укажите род деятельности (например: студент, мама в декрете):',
                    );
                    break;
                  case 'ASK_MEDCARD':
                    await this.bot.sendMessage(
                      chatId,
                      'Есть ли у вас действительная медицинская карта?',
                      {
                        reply_markup: {
                          inline_keyboard: [
                            [{ text: '✅ Да', callback_data: 'medcard_yes' }],
                            [{ text: '❌ Нет', callback_data: 'medcard_no' }],
                          ],
                        },
                      },
                    );
                    break;
                  case 'ASK_MEDCARD_READY':
                    await this.bot.sendMessage(chatId, 'Готовы ли вы её сделать?', {
                      reply_markup: {
                        inline_keyboard: [
                          [
                            {
                              text: '✅ Да, готова',
                              callback_data: 'medcard_ready',
                            },
                          ],
                          [
                            {
                              text: '❌ Нет',
                              callback_data: 'medcard_not_ready',
                            },
                          ],
                        ],
                      },
                    });
                    break;
                  case 'ASK_RATE':
                    await this.bot.sendMessage(
                      chatId,
                      'Какую почасовую ставку вы хотите установить?',
                      {
                        reply_markup: {
                          inline_keyboard: [
                            [{ text: '300 руб', callback_data: 'rate_300' }],
                            [{ text: '400 руб', callback_data: 'rate_400' }],
                            [{ text: '500 руб', callback_data: 'rate_500' }],
                            [
                              {
                                text: 'Другая сумма',
                                callback_data: 'rate_custom',
                              },
                            ],
                          ],
                        },
                      },
                    );
                    break;
                  case 'ASK_RATE_CUSTOM':
                    await this.bot.sendMessage(
                      chatId,
                      'Введите вашу ставку вручную (например: 450):',
                    );
                    break;
                  case 'ASK_PHOTO':
                    await this.bot.sendMessage(
                      chatId,
                      'Заключительный шаг! 📷 Пришлите фото из галереи для аватарки.',
                    );
                    break;
                  default:
                    await this.bot.sendMessage(
                      chatId,
                      'Вы начали заполнять анкету, давайте продолжим!',
                    );
                }
                return;
              }

              await this.usersService.ensureProfileForNanny(user.id);
              user = await this.usersService.getByChatId(chatId);

              if (!user || !user.profile) {
                await this.bot.sendMessage(chatId, 'Ошибка: анкета няни не найдена.');
                return;
              }

              const profile = user.profile;
              if (!profile.status || profile.status === ProfileStatus.NEW) {
                const options: SendMessageOptions = {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: 'Заполнить анкету',
                          callback_data: 'fill_profile',
                        },
                      ],
                      [
                        {
                          text: 'Что такое Помогатор',
                          callback_data: 'what_is_pomogator',
                        },
                      ],
                      [
                        {
                          text: 'Связаться с поддержкой',
                          callback_data: 'contact_support',
                        },
                      ],
                    ],
                  },
                };
                await this.bot.sendMessage(
                  chatId,
                  'Добро пожаловать! Пожалуйста, заполните анкету:',
                  options,
                );
                return;
              }

              if (profile.status === ProfileStatus.PENDING) {
                await this.bot.sendMessage(
                  chatId,
                  `Здравствуйте, ${profile.name || user.username || 'няня'}! Ваша заявка найдена, но она ещё находится на проверке. Обычно это занимает до 24 часов. Мы свяжемся с вами сразу после её одобрения. Спасибо за терпение!`,
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [
                          {
                            text: 'Связаться с поддержкой',
                            callback_data: 'contact_support',
                          },
                        ],
                      ],
                    },
                  },
                );
                return;
              }

              if (profile.status === ProfileStatus.VERIFIED) {
                // Устанавливаем меню слева от скрепки
                console.log(`🚨 УСТАНАВЛИВАЮ МЕНЮ В ${new Error().stack?.split('\n')[2]}`);
                await this.bot.setMyCommands(this.nannyCommands, {
                  scope: { type: 'chat', chat_id: Number(chatId) },
                });
                const name = profile.name || user.username || 'няня';
                const buttons = [[{ text: 'Новые заказы', callback_data: 'new_orders' }]];

                if (profile.firstLoginAfterVerification) {
                  await this.bot.sendMessage(
                    chatId,
                    `${name}, поздравляем! Ваша анкета одобрена 🎉. Добро пожаловать в наш сервис!`,
                    { reply_markup: { inline_keyboard: buttons } },
                  );
                  await this.usersService.setFirstLoginAfterVerification(user.id, false);
                  return;
                } else {
                  await this.bot.sendMessage(
                    chatId,
                    `Здравствуйте, ${name}! Ваш профиль проверен и активирован. Добро пожаловать в сервис!`,
                    { reply_markup: { inline_keyboard: buttons } },
                  );
                  return;
                }
              }

              if (profile.status === ProfileStatus.REJECTED) {
                const name = profile.name || user.fullName || user.username || 'Няня';
                await this.bot.sendMessage(
                  chatId,
                  `⚠️${name}, благодарим вас за время и усилия, которые вы потратили на заполнение анкеты! Мы тщательно изучили вашу заявку и, к сожалению, не можем предложить сотрудничество на данный момент.`,
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [
                          {
                            text: 'Связаться с поддержкой',
                            callback_data: 'contact_support',
                          },
                        ],
                      ],
                    },
                  },
                );
              }
            }
          }
        } catch (error) {
          console.error('Error in /start handler:', error);
        }
      })();
    });

    // --- Обработка callback ---
    this.bot.on('callback_query', async (query: CallbackQuery) => {
      try {
        const chatId = query.message?.chat.id.toString();
        if (!chatId || !query.data) return;

        // 🔹 Выбор роли
        if (query.data.startsWith('role_')) {
          let role: Role | null = null;
          if (query.data === 'role_nanny') role = Role.NANNY;
          if (query.data === 'role_parent') role = Role.PARENT;

          if (!role) {
            await this.bot.answerCallbackQuery(query.id);
            return;
          }

          await this.usersService.createUser(chatId, query.from.username || 'unknown_user', role);

          if (role === Role.PARENT) {
            await this.handleParentMessage(chatId, '');
          }

          if (role === Role.NANNY) {
            const options: SendMessageOptions = {
              reply_markup: {
                keyboard: [[{ text: 'Поделиться номером', request_contact: true }]],
                resize_keyboard: true,
                one_time_keyboard: true,
              },
            };
            await this.bot.sendMessage(
              chatId,
              'Для авторизации нажмите кнопку "Поделиться номером"',
              options,
            );
          }

          await this.bot.answerCallbackQuery(query.id);
          return;
        }

        // 🔹 Проверяем, что пользователь существует
        const user = await this.usersService.getByChatId(chatId);
        if (!user) {
          await this.bot.sendMessage(chatId, '❌ Ошибка: пользователь не найден.');
          await this.bot.answerCallbackQuery(query.id);
          return;
        }

        // 🔹 Родитель
        if (user.role === Role.PARENT) {
          const fsmParent = await this.usersService.getParentFSM(chatId);
          // 🔹 Обработка select_child_ отдельно (перед switch)
          if (query.data.startsWith('select_child_')) {
            const childId = query.data.replace('select_child_', '');
            const child = await this.usersService.getChildById(parseInt(childId));
            if (child) {
              const orderData = (await this.usersService.getTempOrderData(chatId)) || {};
              orderData.child = `${child.name} (${child.age} лет)`;
              orderData.childId = child.id;
              await this.usersService.setTempOrderData(chatId, orderData);
              await this.usersService.setParentFSM(chatId, 'ORDER_ASK_TASKS');
              await this.bot.sendMessage(
                chatId,
                '📝 Опишите какая именно помощь нужна:\n• Будете ли вы дома вовремя визита или хотите отлучиться?\n• Будут ли дополнительные задачи (приготовление пищи, отвезти/забрать с секции)?',
              );
            }
            await this.bot.answerCallbackQuery(query.id);
            return;
          }

          // Обработка выбора ребенка для редактирования имени
          if (query.data.startsWith('edit_child_name_')) {
            const childIdForName = query.data.replace('edit_child_name_', '');
            await this.usersService.setParentFSM(chatId, `EDIT_CHILD_NAME_${childIdForName}`);
            await this.bot.sendMessage(chatId, 'Введите новое имя ребенка:');
            return;
          }
          // Обработка выбора ребенка для редактирования возраста
          if (query.data.startsWith('edit_child_age_')) {
            const childIdForAge = query.data.replace('edit_child_age_', '');
            await this.usersService.setParentFSM(chatId, `EDIT_CHILD_AGE_${childIdForAge}`);
            await this.bot.sendMessage(chatId, 'Введите новый возраст ребенка:');
            return;
          }
          // Обработка выбора ребенка для редактирования информации
          if (query.data.startsWith('edit_child_info_')) {
            const childIdForInfo = query.data.replace('edit_child_info_', '');
            await this.usersService.setParentFSM(chatId, `EDIT_CHILD_INFO_${childIdForInfo}`);
            await this.bot.sendMessage(chatId, 'Введите новую информацию о ребенке:');
            return;
          }
          switch (query.data) {
            // 🔹 ДОБАВЛЕНО: Обработка вопросов и ответов
            case 'ask_question':
              await this.usersService.setParentFSM(chatId, 'ASK_QUESTION');
              await this.bot.sendMessage(
                chatId,
                '💬 Напишите ваш вопрос, и мы ответим вам в ближайшее время:',
                {
                  reply_markup: {
                    inline_keyboard: [[]],
                  },
                },
              );
              break;

            case 'back_to_faq':
              await this.showFaqMenu(chatId);
              break;
            // 🔹 ДОБАВЛЕНО: Обработка моих заказов
            case 'active_orders':
              const activeOrders = await this.usersService.getActiveOrders(user.id.toString());

              if (activeOrders.length === 0) {
                await this.bot.sendMessage(
                  chatId,
                  '🟢 У вас нет активных заказов.\n\nСоздайте первый заказ с помощью команды /create_order',
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '👶 Создать заказ', callback_data: 'create_order' }],
                      ],
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

                await this.bot.sendMessage(chatId, ordersText, {
                  reply_markup: {
                    inline_keyboard: [],
                  },
                });
              }
              break;

            case 'order_history':
              const orderHistory = await this.usersService.getOrderHistory(user.id.toString());

              if (orderHistory.length === 0) {
                await this.bot.sendMessage(
                  chatId,
                  '📊 История заказов пуста.\n\nЗдесь появятся ваши завершенные заказы',
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '👶 Создать заказ', callback_data: 'create_order' }],
                      ],
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

                await this.bot.sendMessage(chatId, historyText, {
                  reply_markup: {
                    inline_keyboard: [],
                  },
                });
              }
              break;

            case 'back_to_orders':
              await this.showMyOrdersMenu(chatId);
              break;
            // 🔹 ДОБАВЛЕНО: Обработка тарифов
            case 'one_time_payment':
              const oneTimeText = `
💳 Разовая оплата

Преимущества:
• Доступ на 30 дней
• Все функции включены
• Поддержка 24/7
• Возможность продления

Стоимость: 500 руб.

Для оплаты используйте команду /create_order
      `;
              await this.bot.sendMessage(chatId, oneTimeText.trim(), {
                //parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '💳 Оплатить', callback_data: 'create_order' }]],
                },
              });
              break;

            case 'subscription':
              const subscriptionText = `
🔔 Подписка

Преимущества:
• Ежемесячный доступ
• Автопродление
• Скидка 10% при оплате за 3 месяца
• Приоритетная поддержка
• Эксклюзивные функции

Стоимость: 400 руб./месяц

Для оформления подписки используйте команду /create_order
      `;
              await this.bot.sendMessage(chatId, subscriptionText.trim(), {
                //parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔔 Оформить подписку', callback_data: 'create_order' }],
                  ],
                },
              });
              break;

            case 'back_to_tariffs':
            case 'back_to_menu':
              await this.showTariffsMenu(chatId);
              break;

            // 🔹 ДОБАВЛЕНО: Обработка отзывов
            case 'feedback_service':
              await this.usersService.setParentFSM(chatId, 'FEEDBACK_SERVICE');
              await this.bot.sendMessage(
                chatId,
                '📝 Пожалуйста, напишите ваш отзыв о нашем сервисе. Мы ценим каждое мнение!',
                {
                  reply_markup: {
                    inline_keyboard: [],
                  },
                },
              );
              break;

            case 'feedback_nanny':
              await this.usersService.setParentFSM(chatId, 'FEEDBACK_NANNY');
              await this.bot.sendMessage(
                chatId,
                '📝 Пожалуйста, напишите ваш отзыв о работе няни. Укажите имя няни и ваши впечатления.',
                {
                  reply_markup: {
                    inline_keyboard: [],
                  },
                },
              );
              break;

            case 'back_to_feedback':
              await this.showFeedbackMenu(chatId);
              break;

            case 'edit_profile':
              await this.bot.sendMessage(chatId, 'Что вы хотите отредактировать?', {
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
            // Редактирование имени родителя
            case 'edit_field_name':
              await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_NAME');
              await this.bot.sendMessage(chatId, 'Введите новое имя:');
              break;

            // Редактирование телефона родителя
            case 'edit_field_phone':
              await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_PHONE');
              await this.bot.sendMessage(chatId, 'Пожалуйста, поделитесь вашим номером телефона:', {
                reply_markup: {
                  keyboard: [[{ text: '📞 Поделиться номером', request_contact: true }]],
                  resize_keyboard: true,
                  one_time_keyboard: true,
                },
              });
              break;

            // Редактирование имени ребенка
            case 'edit_field_child_name':
              await this.usersService.setParentFSM(chatId, 'EDIT_CHILD_NAME_SELECT');
              // Сначала нужно выбрать какого ребенка редактировать
              const children = await this.usersService.getChildrenByParentId(user.id);
              if (children.length === 0) {
                await this.bot.sendMessage(
                  chatId,
                  'У вас нет детей для редактирования. Сначала добавьте ребенка.',
                );
                await this.usersService.setParentFSM(chatId, null);
              } else {
                const childButtons = children.map((child) => [
                  { text: child.name, callback_data: `edit_child_name_${child.id}` },
                ]);
                await this.bot.sendMessage(chatId, 'Выберите ребенка для изменения имени:', {
                  reply_markup: { inline_keyboard: childButtons },
                });
              }
              break;

            // Редактирование возраста ребенка
            case 'edit_field_child_age':
              await this.usersService.setParentFSM(chatId, 'EDIT_CHILD_AGE_SELECT');
              const childrenForAge = await this.usersService.getChildrenByParentId(user.id);
              if (childrenForAge.length === 0) {
                await this.bot.sendMessage(
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
                await this.bot.sendMessage(chatId, 'Выберите ребенка для изменения возраста:', {
                  reply_markup: { inline_keyboard: childButtons },
                });
              }
              break;

            // Редактирование информации о ребенке
            case 'edit_field_child_info':
              await this.usersService.setParentFSM(chatId, 'EDIT_CHILD_INFO_SELECT');
              const childrenForInfo = await this.usersService.getChildrenByParentId(user.id);
              if (childrenForInfo.length === 0) {
                await this.bot.sendMessage(
                  chatId,
                  'У вас нет детей для редактирования. Сначала добавьте ребенка.',
                );
                await this.usersService.setParentFSM(chatId, null);
              } else {
                const childButtons = childrenForInfo.map((child) => [
                  { text: child.name, callback_data: `edit_child_info_${child.id}` },
                ]);
                await this.bot.sendMessage(chatId, 'Выберите ребенка для изменения информации:', {
                  reply_markup: { inline_keyboard: childButtons },
                });
              }
              break;

            case 'add_child':
              await this.usersService.setParentFSM(chatId, 'ASK_CHILD_NAME');
              await this.bot.sendMessage(chatId, 'Как зовут вашего ребёнка?');
              break;
            /* case 'edit_parent':
              await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_PHONE');
              await this.bot.sendMessage(chatId, 'Пожалуйста, поделитесь вашим номером телефона:', {
                reply_markup: {
                  keyboard: [[{ text: 'Поделиться номером', request_contact: true }]],
                  resize_keyboard: true,
                  one_time_keyboard: true,
                },
              });
              break;*/
            case 'skip_add_child':
              await this.bot.sendMessage(
                chatId,
                'Хорошо, вы можете добавить ребенка в любой момент, нажав кнопку "Отредактировать профиль" в главном меню.\n\nНайдем няню? Первые услуги предоставляются бесплатно!',
                {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: 'Создать заказ',
                          callback_data: 'create_order',
                        },
                      ],
                    ],
                  },
                },
              );
              break;

            case 'skip_child_notes':
              await this.handleParentMessage(chatId, '', true);
              break;

            case 'consent_yes':
            case 'accept_terms':
              await this.usersService.setParentFSM(chatId, 'FINISH');
              console.log(`🚨 УСТАНАВЛИВАЮ МЕНЮ В ${new Error().stack?.split('\n')[2]}`);
              await this.bot.setMyCommands(this.parentCommands, {
                scope: { type: 'chat', chat_id: Number(chatId) },
              });
              await this.bot.sendMessage(
                chatId,
                'Отлично 🎉 Регистрация завершена!Чтобы в будущем создавать заказы быстрее, вы можете уже сейчас добавить данные о ваших детях. Это займет минуту.',
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
              break;
            case 'create_order':
              // Начинаем процесс создания заказа
              await this.usersService.setParentFSM(chatId, 'ORDER_ASK_DATE');
              await this.bot.sendMessage(
                chatId,
                '📅 Укажите дату, когда нужно присмотреть за вашим ребенком?',
              );
              break;
            case 'search_nanny':
              const nannies = await this.usersService.getAllNannies();
              const verifiedNannies = nannies.filter(
                (n) => n.profile?.status === ProfileStatus.VERIFIED,
              );

              if (!verifiedNannies.length) {
                await this.bot.sendMessage(chatId, 'Пока нет доступных нянь.');
                break;
              }

              for (const nanny of verifiedNannies) {
                const profile = nanny.profile!;
                const skillsText = profile.skills?.length ? profile.skills.join(', ') : 'Нет';
                const msg = `Няня: ${profile.name || 'Без имени'}\nОпыт: ${profile.experience || 'Не указан'}\nНавыки: ${skillsText}\nРайон: ${profile.area || 'Не указан'}\nЦена: ${profile.price ? profile.price + ' ₽/час' : 'Не указана'}`;
                await this.bot.sendMessage(chatId, msg);
              }
              break;
            case 'confirm_order':
              // Сохраняем заказ в базу
              const orderData = await this.usersService.getTempOrderData(chatId);
              if (orderData) {
                const order = await this.usersService.createOrder(user.id.toString(), orderData);

                // Очищаем FSM и временные данные
                await this.usersService.setParentFSM(chatId, null);
                await this.usersService.clearTempOrderData(chatId);

                await this.bot.sendMessage(
                  chatId,
                  '✅ Готово! Ваш заказ принят. Мы уведомим вас, когда няня откликнется.',
                );

                // Запускаем таймер на 1 час для уведомления об отсутствии откликов
                setTimeout(
                  async () => {
                    const orderStatus = await this.usersService.getOrderStatus(order.id);
                    if (orderStatus === 'PENDING') {
                      await this.bot.sendMessage(
                        chatId,
                        '⏰ К сожалению, на ваш заказ пока нет откликов. Попробуйте создать заказ в другое время.',
                      );
                    }
                  },
                  60 * 60 * 1000,
                ); // 1 час
              }
              break;

            case 'edit_order':
              await this.usersService.setParentFSM(chatId, 'ORDER_ASK_DATE');
              await this.bot.sendMessage(
                chatId,
                '📅 Укажите дату, когда нужно присмотреть за вашим ребенком?',
              );
              break;

            // Обработка выбора ребенка из списка

            case 'add_new_child':
              await this.usersService.setParentFSM(chatId, 'ORDER_ASK_CHILD');
              await this.bot.sendMessage(chatId, '👶 Укажите имя и возраст ребенка:');
              break;
            default:
              if (!fsmParent) {
                await this.handleParentMessage(chatId, '');
              }
          }

          await this.bot.answerCallbackQuery(query.id);
          return;
        }

        // 🔹 Няня
        if (user.role === Role.NANNY) {
          switch (query.data) {
            case 'medcard_yes':
              await this.usersService.updateNannyProfile(user.id, {
                hasMedCard: true,
              });
              await this.usersService.setNannyFSM(chatId, 'ASK_RATE');
              await this.bot.sendMessage(chatId, 'Какую почасовую ставку вы хотите установить?', {
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
              await this.bot.sendMessage(
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
              await this.bot.sendMessage(
                chatId,
                '📍 Отлично! Вы можете оформить медкнижку бесплатно по ОМС...',
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
              await this.bot.sendMessage(chatId, 'Какую почасовую ставку вы хотите установить?', {
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
              if (query.data === 'rate_300') rate = 300;
              if (query.data === 'rate_400') rate = 400;
              if (query.data === 'rate_500') rate = 500;

              if (rate) {
                await this.usersService.updateNannyProfile(user.id, {
                  price: rate,
                });
                await this.usersService.setNannyFSM(chatId, 'ASK_PHOTO');
                await this.bot.sendMessage(
                  chatId,
                  'Заключительный шаг! 📷 Пришлите фото из галереи для аватарки.',
                );
              } else {
                await this.usersService.setNannyFSM(chatId, 'ASK_RATE_CUSTOM');
                await this.bot.sendMessage(chatId, 'Введите вашу ставку вручную (например: 450):');
              }
              break;

            case 'fill_profile':
              await this.usersService.setNannyFSM(chatId, 'ASK_NAME');
              await this.bot.sendMessage(chatId, 'Напишите полностью ваше ФИО:');
              break;
          }

          await this.bot.answerCallbackQuery(query.id);
          return;
        }
      } catch (error) {
        console.error('Error in callback_query handler:', error);
        if (query?.id) {
          try {
            await this.bot.answerCallbackQuery(query.id);
          } catch {}
        }
      }
    });

    // --- Обработка контакта (номер телефона) ---
    this.bot.on('contact', async (msg: Message) => {
      try {
        const chatId = msg.chat.id.toString();
        const phone = msg.contact?.phone_number;
        if (!phone) return;

        const user = await this.usersService.getByChatId(chatId);
        if (!user) return;

        await this.usersService.savePhoneNumber(user.id, phone);

        const updatedUser = await this.usersService.getByChatId(chatId);
        if (!updatedUser) return;

        if (updatedUser.role === Role.NANNY) {
          // 🔹 Показать меню для няни после авторизации
          const options: SendMessageOptions = {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Заполнить анкету', callback_data: 'fill_profile' }],
                [
                  {
                    text: 'Что такое Помогатор',
                    callback_data: 'what_is_pomogator',
                  },
                ],
                [
                  {
                    text: 'Связаться с поддержкой',
                    callback_data: 'contact_support',
                  },
                ],
              ],
            },
          };
          await this.bot.sendMessage(
            chatId,
            `${updatedUser.fullName || updatedUser.username}, Здравствуйте! Пока мы не нашли вашу анкету в нашей базе, но это легко исправить! Чтобы стать частью нашей команды нянь, пожалуйста, заполните анкету. Это займет 5 минут. После этого мы внимательно изучим вашу заявку (обычно это занимает до 24 часов) и сразу свяжемся с вами. Пока вы ждете, предлагаем узнать больше о том, как мы работаем.`,
            options,
          );
          return;
        }

        if (updatedUser.role === Role.PARENT) {
          const fsmParent = await this.usersService.getParentFSM(chatId);

          if (fsmParent === 'EDIT_PARENT_PHONE') {
            // сохраняем номер
            if (msg.contact?.phone_number) {
              await this.usersService.savePhoneNumber(updatedUser.id, msg.contact.phone_number);
            }

            // ставим следующий шаг редактирования — ФИО
            // await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_NAME');

            // сразу отправляем сообщение про ФИО
            /*await this.bot.sendMessage(
              chatId,
              '✅ Номер успешно обновлён! Теперь введите ваше ФИО:',
            );*/
            await this.usersService.setParentFSM(chatId, null);
            await this.bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');

            return; // больше ничего не вызываем
          }

          if (!fsmParent) {
            // Новая регистрация — FSM на ввод ФИО
            await this.usersService.setParentFSM(chatId, 'ASK_NAME');
            await this.bot.sendMessage(chatId, 'Пожалуйста, введите ваше ФИО:');
            return;
          }

          // Если FSM уже был — продолжаем текущий процесс
          await this.handleParentMessage(chatId, '', false, msg.contact);
          return;
        }

        // 🔹 На всякий случай, если роль неизвестна
        await this.bot.sendMessage(chatId, 'Спасибо! Назовите, пожалуйста, ваше имя?');
      } catch (error) {
        console.error('Error in contact handler:', error);
      }
    });

    // --- Обработка текста ---
    this.bot.on('message', async (msg: Message) => {
      try {
        const chatId = msg.chat.id.toString();
        const text = msg.text;

        const user = await this.usersService.getByChatId(chatId);
        if (!user) return;

        // 🔹 ОБРАБОТКА КОМАНД ИЗ МЕНЮ СЛЕВА ОТ СКРЕПКИ
        if (text === '/create_order') {
          if (user.role === Role.PARENT) {
            // Запускаем процесс создания заказа
            await this.usersService.setParentFSM(chatId, 'ORDER_ASK_DATE');
            await this.bot.sendMessage(
              chatId,
              '📅 Укажите дату, когда нужно присмотреть за вашим ребенком?',
            );
          } else {
            await this.bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
          }
          return;
        }

        if (text === '/my_profile') {
          if (user.role === Role.PARENT) {
            await this.showParentProfile(chatId, user);
          } else {
            await this.bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
          }
          return;
        }

        // 🔹 ДОБАВЛЕНО: Обработка команды Тарифы и оплата
        if (text === '/tariffs') {
          if (user.role === Role.PARENT) {
            await this.showTariffsMenu(chatId);
          } else {
            await this.bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
          }
          return;
        }
        // 🔹 ДОБАВЛЕНО: Обработка команды Оставить отзыв
        if (text === '/feedback') {
          if (user.role === Role.PARENT) {
            await this.showFeedbackMenu(chatId);
          } else {
            await this.bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
          }
          return;
        }

        // 🔹 ДОБАВЛЕНО: Обработка команды Мои заказы
        if (text === '/my_orders') {
          if (user.role === Role.PARENT) {
            await this.showMyOrdersMenu(chatId);
          } else {
            await this.bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
          }
          return;
        }

        // 🔹 ДОБАВЛЕНО: Обработка команды Вопросы и ответы
        if (text === '/faq') {
          if (user.role === Role.PARENT) {
            await this.showFaqMenu(chatId);
          } else {
            await this.bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
          }
          return;
        }

        const fsmNanny = await this.usersService.getNannyFSM(chatId);
        const fsmParent = await this.usersService.getParentFSM(chatId);

        if (fsmParent?.startsWith('EDIT_')) {
          /*if (msg.contact && fsmParent === 'EDIT_PARENT_PHONE') {
            await this.usersService.savePhoneNumber(user.id, msg.contact.phone_number);
            await this.usersService.setParentFSM(chatId, null);
            await this.bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
            return;
          }*/
          if (text) {
            // Редактирование имени родителя
            if (fsmParent === 'EDIT_PARENT_NAME') {
              await this.usersService.saveParentName(user.id, text);
              await this.usersService.setParentFSM(chatId, null);
              await this.bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
              return;
            }

            // Редактирование имени ребенка
            if (fsmParent.startsWith('EDIT_CHILD_NAME_')) {
              const childId = fsmParent.replace('EDIT_CHILD_NAME_', '');
              await this.usersService.updateChild(parseInt(childId), { name: text });
              await this.usersService.setParentFSM(chatId, null);
              await this.bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
              return;
            }

            // Редактирование возраста ребенка
            if (fsmParent.startsWith('EDIT_CHILD_AGE_')) {
              const childId = fsmParent.replace('EDIT_CHILD_AGE_', '');
              const age = parseInt(text);
              if (isNaN(age) || age < 0) {
                await this.bot.sendMessage(chatId, '❌ Пожалуйста, введите возраст числом.');
                return;
              }
              await this.usersService.updateChild(parseInt(childId), { age });
              await this.usersService.setParentFSM(chatId, null);
              await this.bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
              return;
            }

            // Редактирование информации о ребенке
            if (fsmParent.startsWith('EDIT_CHILD_INFO_')) {
              const childId = fsmParent.replace('EDIT_CHILD_INFO_', '');
              await this.usersService.updateChild(parseInt(childId), { notes: text });
              await this.usersService.setParentFSM(chatId, null);
              await this.bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
              return;
            }
          }
          return;
        }

        // 🔹 ДОБАВЛЕНО: Обработка отзывов
        // 🔹 ДОБАВЛЕНО: Обработка отзывов (ИСПРАВЛЕННАЯ ВЕРСИЯ)
        if (fsmParent?.startsWith('FEEDBACK_') && text) {
          if (fsmParent === 'FEEDBACK_SERVICE') {
            // Сохраняем отзыв о сервисе
            await this.usersService.saveServiceFeedback(user.id.toString(), text);
            await this.usersService.setParentFSM(chatId, null);
            await this.bot.sendMessage(
              chatId,
              '✅ Спасибо за ваш отзыв о сервисе! Мы ценим ваше мнение и обязательно его учтем.',
              {
                reply_markup: {
                  inline_keyboard: [],
                },
              },
            );
            return;
          }

          if (fsmParent === 'FEEDBACK_NANNY') {
            // Сохраняем отзыв о няне (без конкретной няни)
            await this.usersService.saveNannyFeedback(user.id.toString(), 'general', text);
            await this.usersService.setParentFSM(chatId, null);
            await this.bot.sendMessage(
              chatId,
              '✅ Спасибо за ваш отзыв о няне! Он поможет другим родителям в выборе.',
              {
                reply_markup: {
                  inline_keyboard: [],
                },
              },
            );
            return;
          }
        }

        // 🔹 ДОБАВЛЕНО: Обработка вопросов
        if (fsmParent === 'ASK_QUESTION' && text) {
          // Сохраняем вопрос в базе или отправляем администратору
          await this.usersService.saveUserQuestion(user.id.toString(), text);
          await this.usersService.setParentFSM(chatId, null);

          await this.bot.sendMessage(
            chatId,
            '✅ Ваш вопрос принят! Мы ответим вам в ближайшее время.\n\nА пока можете ознакомиться с нашей статьей о работе сервиса:',
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '📖 Читать статью',
                      url: 'https://telegra.ph/FAQ-o-servise-Pomogator-10-09',
                    },
                  ],
                  [{ text: '⬅️ В главное меню', callback_data: 'back_to_menu' }],
                ],
              },
            },
          );
          return;
        }

        /*if (fsmParent === 'EDIT_PARENT_NAME') {
          if (text) {
            await this.usersService.saveParentName(user.id, text);
            await this.usersService.setParentFSM(chatId, null);
            await this.bot.sendMessage(chatId, '✅ Ваши данные успешно обновлены!');
          } else {
            await this.bot.sendMessage(chatId, 'Спасибо!Назовите,пожалуйста,ваше имя?');
          }
          return; // останавливаем дальнейшую обработку
        }*/

        // 🔹 Проверка текста или медиа
        const hasText = text && !text.startsWith('/');
        const hasMedia =
          Boolean(msg.photo?.length) ||
          (msg.document && msg.document.mime_type?.startsWith('image/'));
        const hasContact = !!msg.contact;
        if (!hasText && !hasMedia && !hasContact) return;

        if (user.role === Role.PARENT) {
          const fsmParent = await this.usersService.getParentFSM(chatId);
          if (fsmParent?.startsWith('ORDER_')) {
            if (text) {
              await this.handleOrderCreation(chatId, text, fsmParent, user);
            }
            return;
          }

          // 🔹 Редактирование телефона
          /* if (fsmParent === 'EDIT_PARENT_PHONE') {
            if (msg.contact?.phone_number) {
              await this.usersService.savePhoneNumber(user.id, msg.contact.phone_number);
              await this.usersService.setParentFSM(chatId, null);
              await this.bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
            } else {
              await this.bot.sendMessage(
                chatId,
                'Пожалуйста, используйте кнопку "Поделиться номером" для корректного номера.',
              );
            }
            return; // останавливаем дальнейшую обработку
          }*/

          // 🔹 Редактирование ФИО
          /*if (fsmParent === 'EDIT_PARENT_NAME') {
            if (text) {
              await this.usersService.saveParentName(user.id, text);
              await this.usersService.setParentFSM(chatId, null);
              await this.bot.sendMessage(chatId, '✅ Ваши данные успешно обновлены!');
            }
            return;
          }*/

          // 🔹 Любая другая логика родителей
          if (!fsmParent?.startsWith('EDIT_') && text) {
            await this.handleParentMessage(chatId, text);
          }

          return;
        }

        // 🔹 Логика FSM няни
        if (fsmNanny === 'ASK_RATE_CUSTOM' && text) {
          const rate = parseInt(text, 10);
          if (!isNaN(rate)) {
            await this.usersService.updateNannyProfile(user.id, {
              price: rate,
            });
            await this.usersService.setNannyFSM(chatId, 'ASK_PHOTO');
            await this.bot.sendMessage(
              chatId,
              'Заключительный шаг! 📷 Пришлите фото из галереи для аватарки.',
            );
          } else {
            await this.bot.sendMessage(chatId, 'Введите число, например 450.');
          }
          return;
        }

        // 🔹 Фото для няни
        let photoId: string | undefined;
        if (msg.photo?.length) {
          photoId = msg.photo[msg.photo.length - 1].file_id;
        } else if (msg.document) {
          const docMime = msg.document.mime_type?.toLowerCase();
          if (!docMime || docMime.startsWith('image/')) {
            photoId = msg.document.file_id;
          }
        }

        if (fsmNanny === 'ASK_PHOTO' && photoId) {
          await this.usersService.updateNannyProfile(user.id, {
            avatar: photoId,
          });
          await this.usersService.setNannyFSM(chatId, null);
          await this.bot.sendMessage(
            chatId,
            '🎉 Ура, ваша анкета у нас! Мы уже отправили ее на проверку.Обычно мы справляемся в течении 24 часов.Как только все будет готово-мы сразу же вам позвоним.Осталось совсем немного!спасибо что выбрали наш сервис! ✅',
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: 'Связаться с поддержкой',
                      callback_data: 'contact_support',
                    },
                  ],
                ],
              },
            },
          );
        }

        // 🔹 FSM няни — ФИО
        if (fsmNanny === 'ASK_NAME' && text) {
          await this.usersService.updateNannyProfile(user.id, { name: text });
          await this.usersService.setNannyFSM(chatId, 'ASK_DOB');
          await this.bot.sendMessage(chatId, 'Укажите вашу дату рождения (дд.мм.гггг):');
          return;
        }

        // 🔹 FSM няни — Дата рождения
        if (fsmNanny === 'ASK_DOB' && text) {
          const success = await this.usersService.updateDob(user.id, text);
          if (!success) {
            await this.bot.sendMessage(
              chatId,
              '❌ Неверный формат даты. Введите в формате дд.мм.гггг',
            );
            return;
          }
          await this.usersService.setNannyFSM(chatId, 'ASK_OCCUPATION');
          await this.bot.sendMessage(
            chatId,
            'Укажите род деятельности (например: студент, мама в декрете):',
          );
          return;
        }

        // 🔹 FSM няни — Род деятельности
        if (fsmNanny === 'ASK_OCCUPATION' && text) {
          await this.usersService.updateNannyProfile(user.id, {
            occupation: text,
          });
          await this.usersService.setNannyFSM(chatId, 'ASK_MEDCARD');
          await this.bot.sendMessage(chatId, 'Есть ли у вас действующая медицинская карта?', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Да', callback_data: 'medcard_yes' }],
                [{ text: '❌ Нет', callback_data: 'medcard_no' }],
              ],
            },
          });
          return;
        }
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });

    console.log('Telegram Bot запущен ✅');
  }
}
