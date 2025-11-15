import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { UsersService } from '../../users/users.service';
import { ProfileStatus, Role } from 'generated/prisma';

@Injectable()
export class AdminHandlerService {
  constructor(private readonly usersService: UsersService) {}

  // 🔥 ГЛАВНОЕ МЕНЮ АДМИНА
  async showAdminPanel(bot: TelegramBot, chatId: string): Promise<void> {
    await bot.sendMessage(chatId, `С возвращением, админ 👑`);
  }

  // 🔥 МЕТОДЫ ДЛЯ АДМИНСКИХ КОМАНД
  async showPendingProfiles(bot: TelegramBot, chatId: string): Promise<void> {
    const pendingProfiles = await this.usersService.getPendingProfiles();

    if (pendingProfiles.length === 0) {
      await bot.sendMessage(chatId, '✅ Нет анкет на модерации');
      return;
    }

    for (const profile of pendingProfiles) {
      const message = this.formatPendingProfileMessage(profile);
      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Одобрить', callback_data: `admin_approve_${profile.userId}` },
              { text: '❌ Отклонить', callback_data: `admin_reject_${profile.userId}` },
            ],
          ],
        },
      });
    }
  }

  async showAllNannies(bot: TelegramBot, chatId: string, offset: number = 0): Promise<void> {
    const limit = 5; // 5 анкет за раз

    const allNannies = await this.usersService.getAllNannies();
    const nannies = allNannies.slice(offset, offset + limit);

    if (nannies.length === 0) {
      await bot.sendMessage(chatId, '👩‍🍼 Больше нянь не найдено');
      return;
    }

    for (const nanny of nannies) {
      const message = this.formatNannyMessage(nanny);

      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚫 Деактивировать', callback_data: `admin_deactivate_${nanny.id}` },
              { text: '✏️ Редактировать', callback_data: `admin_edit_nanny_${nanny.id}` },
            ],
          ],
        },
      });
    }

    // 🔥 ПРОСТАЯ КНОПКА "ПОКАЗАТЬ СЛЕДУЮЩИЕ"
    if (offset + limit < allNannies.length) {
      await bot.sendMessage(chatId, `Показано ${offset + limit} из ${allNannies.length} нянь`, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '📄 Показать следующие 5',
                callback_data: `admin_show_more_nannies_${offset + limit}`,
              },
            ],
          ],
        },
      });
    } else {
      await bot.sendMessage(chatId, `✅ Показаны все ${allNannies.length} нянь`);
    }
  }

  async showRejectedProfiles(bot: TelegramBot, chatId: string): Promise<void> {
    const rejectedProfiles = await this.usersService.getProfilesByStatus(ProfileStatus.REJECTED);

    if (rejectedProfiles.length === 0) {
      await bot.sendMessage(chatId, '❌ Нет отклоненных анкет');
      return;
    }

    for (const profile of rejectedProfiles) {
      const message = this.formatRejectedProfileMessage(profile);
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
  }

  async showParentProfiles(bot: TelegramBot, chatId: string): Promise<void> {
    const parents = await this.usersService.getUsersByRole(Role.PARENT);

    if (parents.length === 0) {
      await bot.sendMessage(chatId, '👥 Родителей не найдено');
      return;
    }

    for (const parent of parents) {
      const message = await this.formatParentMessage(parent);
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
  }

  async showNewOrders(bot: TelegramBot, chatId: string): Promise<void> {
    const newOrders = await this.usersService.getNewOrdersForNannies();

    if (newOrders.length === 0) {
      await bot.sendMessage(chatId, '📦 Новых заказов нет');
      return;
    }

    for (const order of newOrders) {
      const message = this.formatOrderMessage(order);
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
  }

  async showAllOrders(bot: TelegramBot, chatId: string): Promise<void> {
    await bot.sendMessage(chatId, '📊 Фильтр заказов:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟢 Активные', callback_data: 'admin_orders_active' },
            { text: '✅ Завершенные', callback_data: 'admin_orders_completed' },
          ],
          [
            { text: '❌ Отмененные', callback_data: 'admin_orders_cancelled' },
            { text: '🟡 Незавершенные', callback_data: 'admin_orders_pending' },
          ],
          [
            { text: '📋 Все заказы', callback_data: 'admin_orders_all' },
            { text: '📈 Статистика', callback_data: 'admin_orders_stats' },
          ],
        ],
      },
    });
  }

  async showStats(bot: TelegramBot, chatId: string): Promise<void> {
    const stats = await this.usersService.getPlatformStats();
    const message = this.formatStatsMessage(stats);
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }
  async showOrdersByStatus(
    bot: TelegramBot,
    chatId: string,
    status: string,
    statusName: string,
  ): Promise<void> {
    let orders;

    if (status === 'all') {
      orders = await this.usersService.getAllOrders();
    } else if (status === 'active') {
      // 🔥 АКТИВНЫЕ ЗАКАЗЫ - PENDING, ACCEPTED, IN_PROGRESS
      orders = await this.usersService.getOrdersByStatuses(['PENDING', 'ACCEPTED', 'IN_PROGRESS']);
    } else {
      orders = await this.usersService.getOrdersByStatus(status);
    }

    if (orders.length === 0) {
      await bot.sendMessage(chatId, `📦 ${statusName} заказов нет`);
      return;
    }

    // 🔥 ОГРАНИЧИВАЕМ 10 ЗАКАЗАМИ ДЛЯ УДОБСТВА
    const limitedOrders = orders.slice(0, 10);

    await bot.sendMessage(
      chatId,
      `📦 ${statusName} заказы (показано ${limitedOrders.length} из ${orders.length}):`,
    );

    for (const order of limitedOrders) {
      const message = this.formatOrderMessage(order);
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    // 🔥 КНОПКА ВОЗВРАТА
    if (orders.length > 10) {
      await bot.sendMessage(chatId, `... и еще ${orders.length - 10} заказов`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Назад к фильтрам', callback_data: 'admin_back_to_orders' }],
          ],
        },
      });
    } else {
      await bot.sendMessage(chatId, 'Выберите действие:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Назад к фильтрам', callback_data: 'admin_back_to_orders' }],
          ],
        },
      });
    }
  }

  async showOrdersStats(bot: TelegramBot, chatId: string): Promise<void> {
    const allOrders = await this.usersService.getAllOrders();

    if (allOrders.length === 0) {
      await bot.sendMessage(chatId, '📊 Заказов нет');
      return;
    }

    // 🔥 СТАТИСТИКА ПО СТАТУСАМ
    const byStatus = allOrders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {});

    const statusText = Object.entries(byStatus)
      .map(([status, count]) => `${this.getOrderStatusText(status)}: ${count}`)
      .join('\n');

    const completedOrders = allOrders.filter((order) => order.status === 'COMPLETED').length;
    const completionRate =
      allOrders.length > 0 ? ((completedOrders / allOrders.length) * 100).toFixed(1) : '0';

    const message = `
📊 *Статистика заказов*

Общее количество: ${allOrders.length}

По статусам:
${statusText}

📈 Completion rate: ${completionRate}%
  `.trim();

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ Назад к фильтрам', callback_data: 'admin_back_to_orders' }]],
      },
    });
  }

  // 🔥 ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
  private formatPendingProfileMessage(profile: any): string {
    return `
📋 *Анкета на модерации*
👤 Имя: ${profile.name || 'Не указано'}
💼 Опыт: ${profile.experience || 'Не указан'}
💰 Ставка: ${profile.price ? `${profile.price} руб/час` : 'Не указана'}
📅 Дата регистрации: ${new Date(profile.createdAt).toLocaleDateString('ru-RU')}
    `.trim();
  }

  private formatNannyMessage(nanny: any): string {
    const profile = nanny.profile;
    const status = this.getProfileStatusText(profile?.status);
    const isActive = profile?.status === ProfileStatus.VERIFIED;

    return `
👤 *${profile?.name || nanny.username || 'Без имени'}*
📊 Статус: ${status} ${isActive ? '🟢' : '🔴'}
⭐ Рейтинг: ${nanny.avgRating || 'нет отзывов'}
📞 Телефон: ${nanny.phone || 'не указан'}
📅 Заказов: ${nanny.ordersAsNanny?.length || 0}
🆔 ID: ${nanny.id}
📅 Регистрация: ${new Date(nanny.createdAt).toLocaleDateString('ru-RU')}
  `.trim();
  }

  private formatRejectedProfileMessage(profile: any): string {
    return `
❌ *Отклоненная анкета*
👤 Имя: ${profile.name || 'Не указано'}
💼 Опыт: ${profile.experience || 'Не указан'}
📅 Дата отклонения: ${profile.updatedAt ? new Date(profile.updatedAt).toLocaleDateString('ru-RU') : 'Не указана'}
    `.trim();
  }

  private async formatParentMessage(parent: any): Promise<string> {
    const children = await this.usersService.getChildrenByParentId(parent.id);

    return `
👤 *${parent.fullName || parent.username || 'Без имени'}*
📞 Телефон: ${parent.phone || 'не указан'}
👶 Детей: ${children.length}
📅 Заказов: ${parent.ordersAsParent?.length || 0}
📅 Регистрация: ${new Date(parent.createdAt).toLocaleDateString('ru-RU')}
    `.trim();
  }

  private formatOrderMessage(order: any): string {
    return `
📦 *Новый заказ #${order.id}*
👶 Ребенок: ${order.child}
📅 Дата: ${order.date}
⏰ Время: ${order.time}
📍 Адрес: ${order.address}
⏱️ Длительность: ${order.duration} ч.
📅 Создан: ${new Date(order.createdAt).toLocaleDateString('ru-RU')}
    `.trim();
  }

  private formatStatsMessage(stats: any): string {
    return `
📈 *Статистика платформы*

👥 Пользователи:
• Всего: ${stats.totalUsers}
• Нянь: ${stats.totalNannies}
• Родителей: ${stats.totalParents}
• На модерации: ${stats.pendingModeration}

📦 Заказы:
• Всего: ${stats.totalOrders}
• Завершено: ${stats.completedOrders}
• Completion rate: ${stats.completionRate}%
    `.trim();
  }

  private getProfileStatusText(status: ProfileStatus): string {
    switch (status) {
      case ProfileStatus.NEW:
        return '🆕 Новая';
      case ProfileStatus.PENDING:
        return '⏳ На модерации';
      case ProfileStatus.VERIFIED:
        return '✅ Одобрена';
      case ProfileStatus.REJECTED:
        return '❌ Отклонена';
      default:
        return '❓ Неизвестно';
    }
  }

  private getOrderStatusText(status: string): string {
    switch (status) {
      case 'PENDING':
        return '⏳ Ожидает';
      case 'ACCEPTED':
        return '✅ Принят';
      case 'IN_PROGRESS':
        return '🔄 В работе';
      case 'COMPLETED':
        return '✅ Завершен';
      case 'CANCELLED':
        return '❌ Отменен';
      default:
        return '❓ Неизвестно';
    }
  }
}
