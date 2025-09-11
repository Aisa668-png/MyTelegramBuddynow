import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot, {
  Message,
  CallbackQuery,
  SendMessageOptions,
} from 'node-telegram-bot-api';
import { UsersService } from '../users/users.service';
import { Role } from '../../generated/prisma';

@Injectable()
export class BotService implements OnModuleInit {
  private bot!: TelegramBot;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  onModuleInit(): void {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      throw new Error('❌ TELEGRAM_BOT_TOKEN не найден в .env');
    }

    try {
      this.bot = new TelegramBot(token, { polling: true });

      // Команда /start
      this.bot.onText(/\/start/, async (msg: Message) => {
        const chatId = msg.chat.id.toString();
        const username = msg.chat.username ?? undefined;

        try {
          const user = await this.usersService.getByChatId(chatId);

          if (user) {
            // Пользователь уже есть — показываем меню по роли
            this.showMenuForRole(user.role, chatId);
            return;
          }

          // Пользователь не найден — предлагаем выбрать роль
          const options: SendMessageOptions = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Няня', callback_data: 'role_nanny' },
                  { text: 'Родитель', callback_data: 'role_parent' },
                ],
              ],
            },
          };

          this.bot.sendMessage(chatId, 'Выберите роль:', options);
        } catch (err: unknown) {
          if (err instanceof Error) {
            console.error('Ошибка при обработке /start:', err.message);
          } else {
            console.error('Неизвестная ошибка при обработке /start:', err);
          }
        }
      });

      // Обработка кнопок
      this.bot.on('callback_query', async (query: CallbackQuery) => {
        const chatId = query.message?.chat.id.toString();
        const username = query.from.username ?? undefined;
        if (!chatId || !query.data) return;

        // Выбор роли
        if (query.data.startsWith('role_')) {
          const role: Role =
            query.data === 'role_nanny' ? Role.NANNY : Role.PARENT;

          // Создаем пользователя сразу с выбранной ролью
          await this.usersService.createUser(chatId, username, role);

          this.bot.sendMessage(chatId, `Вы выбрали роль: ${role}`);
          this.showMenuForRole(role, chatId);
          await this.bot.answerCallbackQuery(query.id);
          return;
        }

        // Пример других callback (hello, about)
        const reply =
          query.data === 'hello'
            ? 'Привет, как дела? 👋'
            : query.data === 'about'
              ? 'Я тестовый бот на NestJS 😉'
              : undefined;

        if (reply) {
          this.bot.sendMessage(chatId, reply).catch((err: unknown) => {
            if (err instanceof Error)
              console.error('Ошибка sendMessage:', err.message);
            else console.error('Неизвестная ошибка sendMessage:', err);
          });
        }

        this.bot.answerCallbackQuery(query.id).catch((err: unknown) => {
          if (err instanceof Error)
            console.error('Ошибка answerCallbackQuery:', err.message);
          else console.error('Неизвестная ошибка answerCallbackQuery:', err);
        });
      });

      // Эхо-сообщения
      this.bot.on('message', (msg: Message) => {
        if (!msg.text || msg.text === '/start') return;

        const chatId = msg.chat.id.toString();
        this.bot
          .sendMessage(chatId, `Ты написал: ${msg.text}`)
          .catch((err: unknown) => {
            if (err instanceof Error)
              console.error('Ошибка sendMessage:', err.message);
            else console.error('Неизвестная ошибка sendMessage:', err);
          });
      });

      console.log('Telegram Bot запущен ✅');
    } catch (err: unknown) {
      if (err instanceof Error)
        console.error('Ошибка при запуске Telegram Bot:', err.message);
      else console.error('Неизвестная ошибка при запуске Telegram Bot:', err);
    }
  }

  // Меню по ролям
  private showMenuForRole(role: Role | null, chatId: string) {
    if (!role) return;

    if (role === Role.NANNY) {
      const options: SendMessageOptions = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Добавить/редактировать резюме',
                callback_data: 'edit_resume',
              },
            ],
          ],
        },
      };
      this.bot.sendMessage(chatId, 'Меню для няни:', options);
    } else if (role === Role.PARENT) {
      const options: SendMessageOptions = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Найти няню', callback_data: 'search_nanny' }],
          ],
        },
      };
      this.bot.sendMessage(chatId, 'Меню для родителя:', options);
    } else if (role === Role.ADMIN) {
      const options: SendMessageOptions = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Все пользователи', callback_data: 'all_users' }],
            [{ text: 'Все резюме', callback_data: 'all_resumes' }],
          ],
        },
      };
      this.bot.sendMessage(chatId, 'Меню для админа:', options);
    }
  }
}
