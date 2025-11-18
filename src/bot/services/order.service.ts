import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { UsersService } from '../../users/users.service';
import { MessageService } from './message.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderStatus } from 'generated/prisma';
import { Role, ProfileStatus } from 'generated/prisma';

@Injectable()
export class OrderService {
  private tempOrderStorage = new Map<string, any>();
  constructor(
    private readonly usersService: UsersService,
    private readonly messageService: MessageService,
    private readonly prismaService: PrismaService,
  ) {}

  async showNewOrdersToNanny(bot: TelegramBot, chatId: string): Promise<void> {
    try {
      const newOrders = await this.getNewOrdersForNannies();

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
  async getOrdersByNanny(nannyId: string) {
    try {
      return await this.prismaService.order.findMany({
        where: {
          nannyId: parseInt(nannyId),
        },
        include: {
          parent: {
            select: {
              fullName: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      console.error('Error getting nanny orders:', error);
      return [];
    }
  }
  async getNannyOrdersByStatus(nannyId: string, statuses: string[]) {
    try {
      return await this.prismaService.order.findMany({
        where: {
          nannyId: parseInt(nannyId),
          status: {
            in: statuses as any, // Используем as any чтобы обойти проверку типов
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      console.error('Error getting nanny orders by status:', error);
      return [];
    }
  }

  async showNannyAcceptedOrders(bot: TelegramBot, chatId: string, nannyId: number): Promise<void> {
    try {
      const acceptedOrders = await this.getNannyOrdersByStatus(nannyId.toString(), [
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
  async getNewOrdersForNannies() {
    try {
      return await this.prismaService.order.findMany({
        where: {
          status: 'PENDING', // Только новые заказы
          nannyId: null, // Еще не приняты няней
        },
        // УБРАТЬ include пока не настроены связи
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      console.error('Error getting new orders:', error);
      return [];
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
      const activeOrders = await this.getNannyActiveOrders(nannyId);
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
      const activeOrders = await this.getNannyActiveOrders(nannyId);
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
  async getNannyStats(nannyId: number) {
    const completedOrders = await this.prismaService.order.count({
      where: {
        nannyId: nannyId,
        status: 'COMPLETED',
      },
    });

    // Сумма часов из всех завершенных заказов
    const hoursResult = await this.prismaService.order.aggregate({
      where: {
        nannyId: nannyId,
        status: 'COMPLETED',
      },
      _sum: {
        duration: true,
      },
    });

    // Количество уникальных родителей
    const uniqueParents = await this.prismaService.order.groupBy({
      by: ['parentId'],
      where: {
        nannyId: nannyId,
        status: 'COMPLETED',
      },
      _count: {
        parentId: true,
      },
    });

    // Родители с более чем 1 заказом (лояльные клиенты)
    const loyalParents = uniqueParents.filter((parent) => parent._count.parentId > 1).length;

    // Общее количество часов (используем реальную сумму duration)
    const totalHours = hoursResult._sum.duration || completedOrders * 3;

    return {
      completedOrders,
      uniqueParents: uniqueParents.length,
      loyalParents,
      totalHours: Math.round(totalHours),
    };
  }
  async getNannyActiveOrders(nannyId: number) {
    return this.prismaService.order.findMany({
      where: {
        nannyId: nannyId,
        status: {
          in: ['ACCEPTED', 'IN_PROGRESS'],
        },
      },
      include: {
        parent: {
          select: {
            fullName: true,
            phone: true,
          },
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  async getNannyOrderHistory(nannyId: number, page: number = 1, limit: number = 10) {
    try {
      const skip = (page - 1) * limit;

      const orders = await this.prismaService.order.findMany({
        where: {
          nannyId: nannyId,
          status: 'COMPLETED', // Только завершенные заказы
        },
        include: {
          parent: {
            select: {
              id: true,
              fullName: true,
              phone: true,
            },
          },
          review: true, // Включаем отзывы если есть
        },
        orderBy: {
          createdAt: 'desc', // Сначала новые
        },
        skip,
        take: limit,
      });

      const total = await this.prismaService.order.count({
        where: {
          nannyId: nannyId,
          status: 'COMPLETED',
        },
      });

      return {
        orders,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalOrders: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      console.error('Error getting nanny order history:', error);
      throw error;
    }
  }

  async showNannyOrderHistory(
    bot: TelegramBot,
    chatId: string,
    nannyId: number,
    page: number = 1,
  ): Promise<void> {
    try {
      const history = await this.getNannyOrderHistory(nannyId, page);

      if (history.orders.length === 0) {
        await bot.sendMessage(
          chatId,
          '📭 У вас пока нет завершенных заказов.\n\nКак только вы завершите первые заказы, они появятся здесь.',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📭 Новые заказы', callback_data: 'new_orders' }],
                [{ text: '📅 Мое расписание', callback_data: 'my_schedule' }],
              ],
            },
          },
        );
        return;
      }

      // Формируем сообщение с историей
      let message = `📊 *История заказов* (страница ${page}/${history.pagination.totalPages})\n\n`;

      history.orders.forEach((order: any, index: number) => {
        const orderNumber = (page - 1) * 10 + index + 1;
        const date = new Date(order.date).toLocaleDateString('ru-RU');

        message += `*Заказ #${orderNumber}*\n`;
        message += `👶 Ребенок: ${order.child}\n`;
        message += `📅 Дата: ${date}\n`;
        message += `⏰ Время: ${order.time}\n`;
        message += `🏠 Адрес: ${order.address}\n`;

        // 🔹 ИСПРАВЛЕНИЕ: используем существующие поля или заглушку
        // const price = order.finalPrice || order.estimatedPrice || 'Не указана';
        // message += `💰 Стоимость: ${price} ₽\n`;

        // Добавляем информацию об отзыве если есть
        if (order.review) {
          const stars = '⭐'.repeat(order.review.rating);
          message += `💬 Отзыв: ${stars} (${order.review.rating}/5)\n`;
          if (order.review.comment) {
            const shortComment =
              order.review.comment.length > 50
                ? order.review.comment.substring(0, 50) + '...'
                : order.review.comment;
            message += `   "${shortComment}"\n`;
          }
        } else {
          message += `💬 Отзыв: нет отзыва\n`;
        }

        message += `---\n\n`;
      });

      message += `📈 Всего завершено заказов: ${history.pagination.totalOrders}`;

      // 🔹 ИСПРАВЛЕНИЕ: правильно типизируем клавиатуру
      const keyboard: any[] = [];

      // Кнопки пагинации
      const paginationButtons: any[] = [];
      if (history.pagination.hasPrev) {
        paginationButtons.push({
          text: '⬅️ Назад',
          callback_data: `nanny_history_page_${page - 1}`,
        });
      }
      if (history.pagination.hasNext) {
        paginationButtons.push({
          text: 'Вперед ➡️',
          callback_data: `nanny_history_page_${page + 1}`,
        });
      }

      if (paginationButtons.length > 0) {
        keyboard.push(paginationButtons);
      }

      // Основные кнопки
      keyboard.push([
        { text: '📭 Новые заказы', callback_data: 'new_orders' },
        { text: '📅 Активные заказы', callback_data: 'nanny_orders_active' },
      ]);

      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });
    } catch (error) {
      console.error('Error showing order history:', error);
      await bot.sendMessage(
        chatId,
        '❌ Произошла ошибка при загрузке истории заказов. Попробуйте позже.',
      );
    }
  }
  async createOrder(parentId: string, orderData: any) {
    try {
      console.log('📦 CREATING ORDER - INPUT DATA:', {
        parentId,
        orderData,
        duration: orderData.duration,
        hasDuration: !!orderData.duration,
        time: orderData.time,
      });

      // 🔥 ПРОВЕРКА: если duration не пришел, но есть time - рассчитываем
      let finalDuration = orderData.duration;
      if (!finalDuration && orderData.time) {
        // Можно добавить расчет длительности здесь или передавать из FSM
        console.log('⚠️ Duration not provided, using default 3 hours');
        finalDuration = 3;
      }

      const order = await this.prismaService.order.create({
        data: {
          parentId: parseInt(parentId),
          date: orderData.date || '',
          time: orderData.time || '',
          child: orderData.child || '',
          tasks: orderData.tasks || '',
          address: orderData.address || '',
          duration: finalDuration, // 🔥 ИСПОЛЬЗУЕМ ПРОВЕРЕННОЕ ЗНАЧЕНИЕ
          status: 'PENDING',
          parentChatId: orderData.parentChatId || null,
        },
      });

      console.log('✅ ORDER CREATED IN DB:', {
        orderId: order.id,
        duration: order.duration, // 🔥 ДОЛЖЕН БЫТЬ НЕ 3
        time: order.time,
      });

      // 🔥 УВЕДОМЛЯЕМ НЯНЬ О НОВОМ ЗАКАЗЕ
      //await this.notifyNanniesAboutNewOrder(null, order.id);

      return order;
    } catch (error) {
      console.error('❌ Error creating order:', error);
      throw error;
    }
  }
  async getOrderById(orderId: number): Promise<any> {
    try {
      return await this.prismaService.order.findUnique({
        where: { id: orderId },
        include: {
          parent: {
            select: {
              id: true,
              chatId: true,
              fullName: true,
              phone: true,
            },
          },
          nanny: {
            include: {
              profile: {
                select: {
                  name: true,
                  experience: true,
                },
              },
            },
          },
          review: true,
        },
      });
    } catch (error) {
      console.error('Error getting order by ID:', error);
      throw error;
    }
  }
  async acceptOrder(orderId: number, nannyId: number) {
    try {
      // Получаем данные няни и заказа
      const nanny = await this.usersService.getById(nannyId);
      const order = await this.getOrderById(orderId);

      if (!nanny || !order) {
        throw new Error('Няня или заказ не найдены');
      }

      const updatedOrder = await this.prismaService.order.update({
        where: { id: orderId },
        data: {
          nannyId: nannyId,
          status: 'ACCEPTED',
          nannyChatId: nanny.chatId,
          parentChatId: order.parent?.chatId,
        },
        include: {
          parent: true, // 🔹 ВАЖНО: включаем родителя для получения parentId
        },
      });

      return updatedOrder;
    } catch (error) {
      console.error('Error accepting order:', error);
      throw error;
    }
  }
  async completeOrder(orderId: number, nannyId: number) {
    const order = await this.prismaService.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error('Заказ не найден');
    }

    if (order.nannyId !== nannyId) {
      throw new Error('Вы не можете завершить этот заказ');
    }

    if (order.status !== 'ACCEPTED' && order.status !== 'IN_PROGRESS') {
      throw new Error('Нельзя завершить заказ с текущим статусом');
    }

    return this.prismaService.order.update({
      where: { id: orderId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }
  async getAllOrders() {
    return this.prismaService.order.findMany({
      include: {
        parent: { select: { fullName: true } },
        nanny: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async getOrderCount(): Promise<number> {
    return this.prismaService.order.count();
  }
  async canCompleteOrder(
    orderId: number,
    nannyId: number,
  ): Promise<{ canComplete: boolean; reason?: string }> {
    const order = await this.prismaService.order.findUnique({
      where: { id: orderId },
      include: { nanny: true },
    });

    if (!order) {
      return { canComplete: false, reason: 'Заказ не найден' };
    }

    if (order.nannyId !== nannyId) {
      return { canComplete: false, reason: 'Это не ваш заказ' };
    }

    // 🔹 ПРОВЕРКА ВРЕМЕНИ (опционально - можно добавить позже)
    // const orderDateTime = new Date(`${order.date}T${order.time.split(' - ')[0]}`);
    // const now = new Date();
    // if (now < orderDateTime) {
    //   return { canComplete: false, reason: 'Заказ еще не начался' };
    // }

    return { canComplete: true };
  }
  async updateOrderStatus(orderId: number, status: OrderStatus): Promise<any> {
    try {
      return await this.prismaService.order.update({
        where: { id: orderId },
        data: { status },
      });
    } catch (error) {
      console.error('Error updating order status:', error);
      throw error;
    }
  }
  async setTempOrderData(chatId: string, data: any): Promise<void> {
    try {
      console.log('💾 Saving temp order data to DB:', { chatId, data });

      await this.prismaService.tempOrderData.upsert({
        where: { chatId },
        update: {
          data: data,
          updatedAt: new Date(),
        },
        create: {
          chatId,
          data: data,
        },
      });

      console.log('✅ Temp order data saved to DB successfully');
    } catch (error) {
      console.error('❌ Error saving temp order data to DB:', error);
      // Fallback на память
      this.tempOrderStorage.set(chatId, data);
    }
  }

  async getTempOrderData(chatId: string): Promise<any> {
    try {
      const tempData = await this.prismaService.tempOrderData.findUnique({
        where: { chatId },
      });

      if (tempData) {
        console.log('📋 Temp order data from DB:', { chatId, data: tempData.data });
        return tempData.data;
      }

      console.log('📋 No temp order data in DB for:', chatId);

      // Fallback: проверяем память
      const memoryData = this.tempOrderStorage.get(chatId);
      if (memoryData) {
        console.log('📋 Temp order data from memory:', { chatId, memoryData });
        return memoryData;
      }

      return null;
    } catch (error) {
      console.error('❌ Error getting temp order data from DB:', error);
      return this.tempOrderStorage.get(chatId) || null;
    }
  }

  async clearTempOrderData(chatId: string): Promise<void> {
    try {
      await this.prismaService.tempOrderData.delete({
        where: { chatId },
      });
      this.tempOrderStorage.delete(chatId);
      console.log('🧹 Temp order data cleared for:', chatId);
    } catch (error) {
      console.error('❌ Error clearing temp order data:', error);
    }
  }
  async getOrdersByStatus(status: string) {
    return this.prismaService.order.findMany({
      where: {
        status: status as any, // Используем as any для обхода типизации
      },
      include: {
        parent: { select: { fullName: true } },
        nanny: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrdersByStatuses(statuses: string[]) {
    return this.prismaService.order.findMany({
      where: {
        status: { in: statuses as any },
      },
      include: {
        parent: { select: { fullName: true } },
        nanny: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async getPlatformStats() {
    const [totalUsers, totalNannies, totalParents, pendingProfiles, totalOrders, completedOrders] =
      await Promise.all([
        this.prismaService.user.count(),
        this.prismaService.user.count({ where: { role: Role.NANNY } }),
        this.prismaService.user.count({ where: { role: Role.PARENT } }),
        this.prismaService.profile.count({ where: { status: ProfileStatus.PENDING } }),
        this.prismaService.order.count(),
        this.prismaService.order.count({ where: { status: 'COMPLETED' } }),
      ]);

    return {
      totalUsers,
      totalNannies,
      totalParents,
      pendingModeration: pendingProfiles,
      totalOrders,
      completedOrders,
      completionRate: totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(1) : '0',
    };
  }
}
