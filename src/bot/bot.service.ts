import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot, { Message, CallbackQuery, SendMessageOptions } from 'node-telegram-bot-api';
import { UsersService } from '../users/users.service';
import { Role, ProfileStatus } from '../../generated/prisma';
import { parentCommands, nannyCommands } from './config/commands.config';
import { parentFsmSteps, orderCreationSteps } from './config/fsm.config';
import { BOT_CONSTANTS } from './config/constants';
import { FsmStep, OrderCreationStep, BotCommand } from './types/index';
import { MessageService } from './services/message.service';
import { HandlerService } from '../bot/services/handler.service';
import { MenuService } from '../bot/services/menu.service';
import { FsmService } from './services/fsm.service';
import { OrderService } from './services/order.service';
import { RatingService } from './services/rating.service';
import { ProfileService } from './services/profile.service';
import { CallbackService } from './services/callback.service';
import { MessageHandlerService } from './services/message-handler.service';
import { CommandHandler } from './services/handlers/command.handler';

@Injectable()
export class BotService implements OnModuleInit {
  private bot!: TelegramBot;

  private parentCommands: BotCommand[] = parentCommands;
  private nannyCommands: BotCommand[] = nannyCommands;
  private orderCreationSteps: OrderCreationStep[] = orderCreationSteps;
  private parentFsmSteps: FsmStep[] = parentFsmSteps;

  private constants = BOT_CONSTANTS;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly messageService: MessageService,
    private readonly handlerService: HandlerService,
    private readonly menuService: MenuService,
    private readonly fsmService: FsmService,
    private readonly orderService: OrderService,
    private readonly profileService: ProfileService,
    private readonly callbackService: CallbackService,
    private readonly ratingService: RatingService,
    private readonly messageHandlerService: MessageHandlerService,
    private readonly CommandHandler: CommandHandler,
  ) {}

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
                await this.fsmService.handleParentMessage(
                  this.bot,
                  chatId,
                  '',
                  this.parentFsmSteps,
                  false,
                );
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

    // --- Обработка всех текстовых команд ---
    this.bot.onText(/\/(.+)/, (msg: Message, match: RegExpExecArray | null) => {
      void (async () => {
        if (!msg.from || !match) return;

        try {
          const chatId = msg.chat.id.toString();
          const fullCommand = `/${match[1]}`;

          console.log(`🔧 Обработка команды: ${fullCommand} от ${chatId}`);

          const user = await this.usersService.getByChatId(chatId);
          if (!user) {
            return;
          }

          await this.CommandHandler.handle(this.bot, msg, chatId, user, fullCommand);
        } catch (error) {
          console.error(`❌ Ошибка обработки команды:`, error);
          const chatId = msg.chat.id.toString();
          await this.bot.sendMessage(chatId, '⚠️ Произошла ошибка при обработке команды.');
        }
      })();
    });
    // --- Обработка callback ---
    this.bot.on('callback_query', async (query: CallbackQuery) => {
      try {
        const chatId = query.message?.chat.id.toString();
        if (!chatId || !query.data) return;

        // 🔹 ОБРАБОТКА confirm_order ПЕРВОЙ
        if (query.data === 'confirm_order') {
          // 🔹 ПОЛУЧАЕМ ПОЛЬЗОВАТЕЛЯ для parentId
          const user = await this.usersService.getByChatId(chatId);
          if (!user) {
            await this.bot.answerCallbackQuery(query.id);
            return;
          }

          await this.callbackService.handleConfirmOrder(this.bot, chatId, user);

          await this.bot.answerCallbackQuery(query.id);
          return;
        }

        // 🔹 Выбор роли
        if (query.data.startsWith('role_')) {
          await this.callbackService.handleRoleSelection(this.bot, query, chatId);
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
          const handled = await this.callbackService.handleParentCallbacks(
            this.bot,
            query,
            chatId,
            user,
          );
          if (handled) {
            return;
          }
          // Если не обработано, продолжаем старую логику (на всякий случай)
        }

        // 🔹 Няня
        if (user.role === Role.NANNY) {
          const handled = await this.callbackService.handleNannyCallbacks(
            this.bot,
            query,
            chatId,
            user,
          );
          if (handled) return;
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
          await this.fsmService.handleParentMessage(
            this.bot,
            chatId,
            '',
            this.parentFsmSteps,
            false,
            msg.contact,
          );
          return;
        }

        // 🔹 На всякий случай, если роль неизвестна
        await this.bot.sendMessage(chatId, 'Спасибо! Назовите, пожалуйста, ваше имя?');
      } catch (error) {
        console.error('Error in contact handler:', error);
      }
    });

    // --- Обработка текста ---
    this.bot.on('message', async (msg: any) => {
      await this.messageHandlerService.handleMessage(this.bot, msg);
    });
    console.log('Telegram Bot запущен ✅');
  }
}
