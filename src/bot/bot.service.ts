import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot, {
  Message,
  CallbackQuery,
  SendMessageOptions,
} from 'node-telegram-bot-api';
import { UsersService } from '../users/users.service';
import { Role, ProfileStatus } from '../../generated/prisma';

@Injectable()
export class BotService implements OnModuleInit {
  private bot!: TelegramBot;
  // 🔹 ДОБАВЛЕНО: Конфигурация шагов FSM родителей
  // src/bot/bot.service.ts (или отдельный файл с константами)
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
          inline_keyboard: [
            [{ text: 'Согласен', callback_data: 'consent_yes' }],
          ],
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
      message:
        'Расскажите о особенностях вашего ребёнка (аллергии, привычки и т.д.):',
      field: 'notes',
      options: {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Пропустить', callback_data: 'skip_child_notes' }],
          ],
        },
      },
    },

    {
      key: 'FINISH',
      message: '✅ Регистрация завершена! Теперь вы можете искать няню.',
      field: null,
      options: {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Найти няню', callback_data: 'search_nanny' }],
          ],
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
      await this.bot.sendMessage(
        chatId,
        'Пожалуйста, поделитесь своим номером телефона:',
        {
          reply_markup: {
            keyboard: [[{ text: 'Поделиться номером', request_contact: true }]],
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        },
      );
      return;
    }

    // 🔹 Получаем FSM из БД
    let fsmParent = await this.usersService.getParentFSM(chatId);

    // 🔹 Если FSM пустой или некорректный
    if (
      !fsmParent ||
      !fsmParent.trim() ||
      ['null', 'undefined'].includes(fsmParent.trim())
    ) {
      if (user.fullName && user.fullName.trim()) {
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
                [
                  {
                    text: 'Отредактировать профиль',
                    callback_data: 'edit_profile',
                  },
                ],
              ],
            },
          },
        );
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
              [
                {
                  text: 'Отредактировать профиль',
                  callback_data: 'edit_profile',
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
              [
                {
                  text: 'Отредактировать профиль',
                  callback_data: 'edit_profile',
                },
              ],
            ],
          },
        },
      );
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
        const nextStep = this.parentFsmSteps.find(
          (s) => s.key === 'ASK_CONSENT',
        );
        if (nextStep) {
          await this.usersService.setParentFSM(chatId, nextStep.key);
          await this.bot.sendMessage(
            chatId,
            nextStep.message,
            nextStep.options,
          );
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
          const nextStep = this.parentFsmSteps.find(
            (s) => s.key === 'ASK_CHILD_AGE',
          );
          if (nextStep) {
            await this.usersService.setParentFSM(
              chatId,
              `${nextStep.key}:${child.id}`,
            );
            await this.bot.sendMessage(
              chatId,
              nextStep.message,
              nextStep.options,
            );
          }
          return;
        }

        if (!childId) {
          await this.bot.sendMessage(
            chatId,
            'Ошибка: не найден ID ребёнка. Попробуйте снова.',
          );
          await this.usersService.setParentFSM(chatId, null);
          return;
        }

        if (step.field === 'age') {
          const parsedAge = parseInt(text, 10);
          if (isNaN(parsedAge) || parsedAge < 0) {
            await this.bot.sendMessage(
              chatId,
              'Пожалуйста, введите возраст числом.',
            );
            return;
          }
          await this.usersService.updateChild(childId, { age: parsedAge });
          const nextStep = this.parentFsmSteps.find(
            (s) => s.key === 'ASK_CHILD_NOTES',
          );
          if (nextStep) {
            await this.usersService.setParentFSM(
              chatId,
              `${nextStep.key}:${childId}`,
            );
            await this.bot.sendMessage(
              chatId,
              nextStep.message,
              nextStep.options,
            );
          }
          return;
        }

        if (step.field === 'notes') {
          if (!isSkip)
            await this.usersService.updateChild(childId, { notes: text });
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
                  [
                    {
                      text: 'Отредактировать профиль',
                      callback_data: 'edit_profile',
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
    await this.bot.sendMessage(
      chatId,
      '✅ Регистрация завершена! Теперь вы можете искать няню.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Найти няню', callback_data: 'search_nanny' }],
            [{ text: 'Добавить ребёнка', callback_data: 'add_child' }],
          ],
        },
      },
    );
  }

  onModuleInit(): void {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('❌ TELEGRAM_BOT_TOKEN не найден в .env');

    this.bot = new TelegramBot(token, { polling: true });

    // --- /start ---
    this.bot.onText(/\/start/, async (msg: Message) => {
      try {
        const chatId = msg.chat.id.toString();
        let user = await this.usersService.getByChatId(chatId);

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
          return; // 🔹 Важно: завершить, чтобы не шла логика для зарегистрированных пользователей
        }
        // 🔹 Если пользователь уже есть и у него есть роль
        if (user?.role) {
          if (user?.role === Role.PARENT) {
            const parentFsm = await this.usersService.getParentFSM(chatId);

            /*const invalid =
              !parentFsm ||
              !parentFsm.trim() ||
              ['null', 'undefined'].includes(parentFsm.trim());*/

            if (parentFsm && parentFsm !== 'FINISH') {
              // есть незавершённый процесс — резюмируем
              await this.handleParentMessage(chatId, '');
              return;
            } else {
              // обычный возвратный сценарий
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
                      [
                        {
                          text: 'Отредактировать профиль',
                          callback_data: 'edit_profile',
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
            // 1) Проверяем незавершённое состояние FSM (resume)
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
                  await this.bot.sendMessage(
                    chatId,
                    'Готовы ли вы её сделать?',
                    {
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
                    },
                  );
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
              return; // Возвращаем сразу — resume-путь
            }

            // 🔹 Убеждаемся, что профиль существует
            await this.usersService.ensureProfileForNanny(user.id);
            user = await this.usersService.getByChatId(chatId);

            if (!user || !user.profile) {
              await this.bot.sendMessage(
                chatId,
                'Ошибка: анкета няни не найдена.',
              );
              return;
            }

            const profile = user.profile;

            // 🔹 Проверка статуса анкеты няни
            if (profile.status === ProfileStatus.PENDING) {
              await this.bot.sendMessage(
                chatId,
                `Здравствуйте, ${profile.name || user.username || 'няня'}! Ваша заявка найдена, но она ещё находится на проверке. Обычно это занимает до 24 часов. Мы свяжемся с вами сразу после ее одобрения. Спасибо за терпение!`,
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
              const name = profile.name || user.username || 'няня';
              if (profile.firstLoginAfterVerification) {
                await this.bot.sendMessage(
                  chatId,
                  `${name}, поздравляем! Ваша анкета одобрена 🎉. Добро пожаловать в наш сервис! Все необходимое для старта ждет вас в памятке (главное меню бота). Поехали? Первые заказы уже в разделе "Новые заказы"!`,
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: 'Новые заказы', callback_data: 'new_orders' }],
                        [
                          {
                            text: 'Мое расписание',
                            callback_data: 'my_schedule',
                          },
                        ],
                        [{ text: 'Мои заказы', callback_data: 'my_orders' }],
                        [{ text: 'Мой рейтинг', callback_data: 'my_rating' }],
                        [
                          {
                            text: 'Редактировать профиль',
                            callback_data: 'fill_profile',
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
                  },
                );
                await this.usersService.setFirstLoginAfterVerification(
                  user.id,
                  false,
                );
                return;
              } else {
                await this.bot.sendMessage(
                  chatId,
                  `Здравствуйте, ${name}! Ваш профиль проверен и активирован. Добро пожаловать в сервис! Найдем заказ?`,
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: 'Новые заказы', callback_data: 'new_orders' }],
                        [
                          {
                            text: 'Мое расписание',
                            callback_data: 'my_schedule',
                          },
                        ],
                        [{ text: 'Мои заказы', callback_data: 'my_orders' }],
                        [{ text: 'Мой рейтинг', callback_data: 'my_rating' }],
                        [
                          {
                            text: 'Редактировать профиль',
                            callback_data: 'fill_profile',
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
                  },
                );
                return;
              }
            }

            if (profile.status === ProfileStatus.REJECTED) {
              const name =
                profile.name || user.fullName || user.username || 'Няня';
              await this.bot.sendMessage(
                chatId,
                `⚠️${name}, благодарим вас за время и усилия, которые вы потратили на заполнение анкеты! Мы тщательно изучили вашу заявку и, к сожалению, не можем предложить вам сотрудничество на данный момент. Мы искренне желаем вам успехов в поиске подходящей работы и будем рады увидеть вашу анкету снова, когда вы наберетесь большего опыта! С уважением, команда сервиса Помогатор.`,
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

          await this.usersService.createUser(chatId, query.from.username, role);

          if (role === Role.PARENT) {
            await this.handleParentMessage(chatId, '');
          }

          if (role === Role.NANNY) {
            const options: SendMessageOptions = {
              reply_markup: {
                keyboard: [
                  [{ text: 'Поделиться номером', request_contact: true }],
                ],
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
          await this.bot.sendMessage(
            chatId,
            '❌ Ошибка: пользователь не найден.',
          );
          await this.bot.answerCallbackQuery(query.id);
          return;
        }

        // 🔹 Родитель
        if (user.role === Role.PARENT) {
          const fsmParent = await this.usersService.getParentFSM(chatId);
          switch (query.data) {
            case 'edit_profile':
              await this.bot.sendMessage(chatId, 'Что вы хотите сделать?', {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'Добавить ребёнка', callback_data: 'add_child' }],
                    [
                      {
                        text: 'Изменить данные родителя',
                        callback_data: 'edit_parent',
                      },
                    ],
                  ],
                },
              });
              break;

            case 'add_child':
              await this.usersService.setParentFSM(chatId, 'ASK_CHILD_NAME');
              await this.bot.sendMessage(chatId, 'Как зовут вашего ребёнка?');
              break;
            case 'edit_parent':
              await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_PHONE');
              await this.bot.sendMessage(
                chatId,
                'Пожалуйста, поделитесь вашим номером телефона:',
                {
                  reply_markup: {
                    keyboard: [
                      [{ text: 'Поделиться номером', request_contact: true }],
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true,
                  },
                },
              );
              break;
            case 'skip_add_child':
              await this.bot.sendMessage(
                chatId,
                'Хорошо, вы можете добавить ребенка в любой момент, нажав кнопку "Отредактировать профиль" в главном меню.\n\nНайдем няню? Первые услуги предоставляются бесплатно!',
                {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: 'Отредактировать профиль',
                          callback_data: 'edit_profile',
                        },
                      ],
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
              await this.usersService.setParentFSM(chatId, null);
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
                const skillsText = profile.skills?.length
                  ? profile.skills.join(', ')
                  : 'Нет';
                const msg = `Няня: ${profile.name || 'Без имени'}\nОпыт: ${profile.experience || 'Не указан'}\nНавыки: ${skillsText}\nРайон: ${profile.area || 'Не указан'}\nЦена: ${profile.price ? profile.price + ' ₽/час' : 'Не указана'}`;
                await this.bot.sendMessage(chatId, msg);
              }
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
              await this.bot.sendMessage(
                chatId,
                'Какую почасовую ставку вы хотите установить?',
                {
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '300 руб', callback_data: 'rate_300' }],
                      [{ text: '400 руб', callback_data: 'rate_400' }],
                      [{ text: '500 руб', callback_data: 'rate_500' }],
                      [{ text: 'Другая сумма', callback_data: 'rate_custom' }],
                    ],
                  },
                },
              );
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
              await this.bot.sendMessage(
                chatId,
                'Какую почасовую ставку вы хотите установить?',
                {
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '300 руб', callback_data: 'rate_300' }],
                      [{ text: '400 руб', callback_data: 'rate_400' }],
                      [{ text: '500 руб', callback_data: 'rate_500' }],
                      [{ text: 'Другая сумма', callback_data: 'rate_custom' }],
                    ],
                  },
                },
              );
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
                await this.bot.sendMessage(
                  chatId,
                  'Введите вашу ставку вручную (например: 450):',
                );
              }
              break;

            case 'fill_profile':
              await this.usersService.setNannyFSM(chatId, 'ASK_NAME');
              await this.bot.sendMessage(
                chatId,
                'Напишите полностью ваше ФИО:',
              );
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
<<<<<<< HEAD
          const fsmParent = await this.usersService.getParentFSM(chatId);

          if (fsmParent === 'EDIT_PARENT_PHONE') {
            // Пользователь редактирует телефон — сразу идём на ввод ФИО
            await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_NAME');
=======
          // Проверяем, редактирование или обычная регистрация
          const fsm = await this.usersService.getParentFSM(chatId);

          if (fsm === 'EDIT_PARENT_PHONE') {
            // сохраняем номер
            await this.usersService.savePhoneNumber(
              updatedUser.id,
              msg.contact.phone_number,
            );

            // ставим следующий шаг редактирования — ФИО
            await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_NAME');

            // сразу отправляем сообщение про ФИО
>>>>>>> temp-save
            await this.bot.sendMessage(
              chatId,
              '✅ Номер успешно обновлён! Теперь введите ваше ФИО:',
            );
<<<<<<< HEAD
            return;
          }

          if (!fsmParent) {
            // Новая регистрация — FSM на ввод имени
            await this.usersService.setParentFSM(chatId, 'ASK_NAME');
            await this.bot.sendMessage(chatId, 'Пожалуйста, введите ваше ФИО:');
            return;
          }

          // Если FSM уже был — продолжаем текущий процесс
=======

            return; // больше ничего не вызываем
          }
>>>>>>> temp-save
          await this.handleParentMessage(chatId, '', false, msg.contact);
          return;
        }

        // 🔹 На всякий случай, если роль неизвестна
        await this.bot.sendMessage(
          chatId,
          'Спасибо! Назовите, пожалуйста, ваше имя?',
        );
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

        const fsmNanny = await this.usersService.getNannyFSM(chatId);
        const fsmParent = await this.usersService.getParentFSM(chatId);

        if (fsmParent === 'EDIT_PARENT_NAME') {
          if (text) {
            await this.usersService.saveParentName(user.id, text);
            await this.usersService.setParentFSM(chatId, null);
            await this.bot.sendMessage(
              chatId,
              '✅ Ваши данные успешно обновлены!',
            );
          } else {
            await this.bot.sendMessage(
              chatId,
              'Пожалуйста, введите ваше ФИО текстом.',
            );
          }
          return; // останавливаем дальнейшую обработку
        }

        // 🔹 Проверка текста или медиа
        const hasText = text && !text.startsWith('/');
        const hasMedia =
          msg.photo?.length > 0 ||
          (msg.document && msg.document.mime_type?.startsWith('image/'));
        const hasContact = !!msg.contact;
        if (!hasText && !hasMedia && !hasContact) return;

if (user.role === Role.PARENT) {
  const fsmParent = await this.usersService.getParentFSM(chatId);

  // 🔹 Редактирование телефона
  if (fsmParent === 'EDIT_PARENT_PHONE') {
    if (msg.contact?.phone_number) {
      await this.usersService.savePhoneNumber(user.id, msg.contact.phone_number);
      await this.usersService.setParentFSM(chatId, 'EDIT_PARENT_NAME');
      // Сообщение про ФИО можно показывать или нет
      // await this.bot.sendMessage(chatId, '✅ Номер успешно обновлён! Теперь введите ваше ФИО:');
    } else {
      await this.bot.sendMessage(
        chatId,
        'Пожалуйста, используйте кнопку "Поделиться номером" для корректного номера.',
      );
    }
    return; // останавливаем дальнейшую обработку
  }

  // 🔹 Редактирование ФИО
  if (fsmParent === 'EDIT_PARENT_NAME') {
    if (text) {
      await this.usersService.saveParentName(user.id, text);
      await this.usersService.setParentFSM(chatId, null);
      await this.bot.sendMessage(chatId, '✅ Ваши данные успешно обновлены!');
    }
    return;
  }

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
          await this.bot.sendMessage(
            chatId,
            'Укажите вашу дату рождения (дд.мм.гггг):',
          );
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
          await this.bot.sendMessage(
            chatId,
            'Есть ли у вас действующая медицинская карта?',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✅ Да', callback_data: 'medcard_yes' }],
                  [{ text: '❌ Нет', callback_data: 'medcard_no' }],
                ],
              },
            },
          );
          return;
        }
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });

    console.log('Telegram Bot запущен ✅');
  }
}
