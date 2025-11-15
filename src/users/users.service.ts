import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, ProfileStatus, OrderStatus } from '../../generated/prisma';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getByChatId(chatId: string) {
    return this.prisma.user.findUnique({
      where: { chatId },
      include: { profile: true },
    });
  }

  async createUser(chatId: string, username: string, role: Role) {
    // Создаём или НЕ меняем роль, если пользователь уже есть
    const existing = await this.prisma.user.findUnique({
      where: { chatId },
      include: { profile: true },
    });
    if (existing) {
      return existing;
    }
    const user = await this.prisma.user.create({
      data: { chatId, username, role },
    });

    // Создаём профиль только для няни, если его нет
    if (role === Role.NANNY) {
      try {
        await this.prisma.profile.create({
          data: {
            userId: user.id,
            status: ProfileStatus.NEW,
          },
        });
        console.log(`✅ Профиль создан для няни: ${user.id}`);
      } catch (error) {
        console.error('❌ Ошибка создания профиля:', error);
      }
    }

    return this.getByChatId(chatId);
  }

  // В классе UsersService добавьте:
  async getAllUsers() {
    return this.prisma.user.findMany({
      include: { profile: true },
    });
  }

  // 🔹 FSM для родителя
  async setParentFSM(chatId: string, state: string | null) {
    await this.prisma.user.update({
      where: { chatId },
      data: { fsmStateParent: state }, // исправлено
    });
  }

  async getParentFSM(chatId: string) {
    const user = await this.getByChatId(chatId);
    return user?.fsmStateParent || null; // исправлено
  }

  // 🔹 FSM для няни
  async setNannyFSM(chatId: string, state: string | null) {
    await this.prisma.user.update({
      where: { chatId },
      data: { fsmStateNanny: state }, // исправлено
    });
  }

  async getNannyFSM(chatId: string) {
    const user = await this.getByChatId(chatId);
    return user?.fsmStateNanny || null; // исправлено
  }

  // users.service.ts
  async updateNannyProfile(
    userId: number,
    data: Partial<{
      name: string;
      experience: string;
      skills: string[];
      price: number;
      avatar: string;
      dob: Date;
      occupation: string;
      hasMedCard: boolean;
    }>,
  ) {
    return this.prisma.profile.update({
      where: { userId },
      data: { ...data, status: ProfileStatus.PENDING }, // ставим статус PENDING после редактирования
    });
  }

  // 🔹 Получить всех нянь (для админа) - ОБНОВИТЕ этот метод
  async getAllNannies() {
    return this.prisma.user.findMany({
      where: { role: Role.NANNY },
      include: {
        profile: true,
        ordersAsNanny: {
          include: {
            parent: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },
    });
  }

  // 🔹 Обновить статус анкеты няни
  async updateNannyStatus(userId: number, status: ProfileStatus) {
    return this.prisma.profile.update({
      where: { userId },
      data: { status },
    });
  }

  // 🔹 Сохранение номера телефона
  async savePhoneNumber(userId: number, phone: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { phone },
    });
  }

  // 🔹 Получить пользователя по ID
  async getById(userId: number) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
  }
  async saveParentName(userId: number, fullName: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fullName },
    });
  }

  async saveChild(userId: number, data: { name?: string; age?: number; notes?: string }) {
    // Проверяем, что имя есть и не пустое
    const name = data.name?.trim();
    if (!name) {
      throw new Error('Child name is required');
    }

    // Если возраст не число или меньше 0, делаем null
    const age = typeof data.age === 'number' && data.age >= 0 ? data.age : null;

    // Если заметки пустые, делаем null
    const notes = data.notes?.trim() || null;

    return this.prisma.child.create({
      data: {
        userId,
        name,
        age,
        notes,
      },
    });
  }

  // Обновляем существующего ребёнка
  async updateChild(childId: number, data: { name?: string; age?: number; notes?: string }) {
    return this.prisma.child.update({
      where: { id: childId },
      data,
    });
  }
  // 🔹 Получить значение флага
  async getFirstLoginAfterVerification(userId: number): Promise<boolean> {
    const user = await this.getById(userId);
    return user?.profile?.firstLoginAfterVerification || false;
  }

  // 🔹 Установить значение флага
  async setFirstLoginAfterVerification(userId: number, value: boolean): Promise<void> {
    await this.prisma.profile.update({
      where: { userId },
      data: { firstLoginAfterVerification: value },
    });
  }
  // ...

  // 🔹 Проверить, что у няни есть профиль, если нет — создать
  async ensureProfileForNanny(userId: number) {
    const user = await this.getById(userId);

    if (user?.role === Role.NANNY && !user.profile) {
      return this.prisma.profile.create({ data: { userId } });
    }

    return user?.profile;
  }
  parseDateFromString(dateStr: string): Date | null {
    const parts = dateStr.split('.');
    if (parts.length !== 3) return null;

    const day = Number(parts[0]);
    const month = Number(parts[1]) - 1; // месяцы с 0
    const year = Number(parts[2]);

    if (
      isNaN(day) ||
      isNaN(month) ||
      isNaN(year) ||
      day < 1 ||
      day > 31 ||
      month < 0 ||
      month > 11 ||
      year < 1900
    ) {
      return null;
    }

    return new Date(year, month, day);
  }

  /**
   * Обновляет дату рождения няни
   */
  async updateDob(userId: number, dateStr: string): Promise<boolean> {
    const dob = this.parseDateFromString(dateStr);
    if (!dob) return false;

    await this.prisma.profile.update({
      where: { userId },
      data: { dob },
    });

    return true;
  }
  async saveParentAnswer(userId: number, field: 'fullName' | 'phone', value: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { [field]: value },
    });
  }
  async getChildById(childId: number) {
    return this.prisma.child.findUnique({
      where: { id: childId },
    });
  }

  // Получить всех детей родителя
  async getChildrenByParentId(parentId: number) {
    return this.prisma.child.findMany({
      where: { userId: parentId },
    });
  }
  async setConsentGiven(userId: number, value: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { consentGiven: value },
    });
  }
  async updateUser(userId: number, data: Partial<{ phone: string }>) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }
  // В UsersService замените эти методы:

  private tempOrderStorage = new Map<string, any>(); // Добавьте это поле в класс

  async setTempOrderData(chatId: string, data: any): Promise<void> {
    // Сохраняем данные в памяти
    this.tempOrderStorage.set(chatId, data);
    console.log('✅ Temp order data saved for chat:', chatId, data);
  }

  async getTempOrderData(chatId: string): Promise<any> {
    // Получаем данные из памяти
    const data = this.tempOrderStorage.get(chatId) || {};
    console.log('📋 Temp order data retrieved for chat:', chatId, data);
    return data;
  }

  async clearTempOrderData(chatId: string): Promise<void> {
    // Очищаем данные
    this.tempOrderStorage.delete(chatId);
    console.log('🧹 Temp order data cleared for chat:', chatId);
  }

  async createOrder(parentId: string, orderData: any) {
    try {
      return await this.prisma.order.create({
        data: {
          parentId: parseInt(parentId),
          date: orderData.date || '',
          time: orderData.time || '',
          child: orderData.child || '',
          tasks: orderData.tasks || '',
          address: orderData.address || '',
          duration: orderData.duration || 3,
          status: 'PENDING',
        },
      });
    } catch (error) {
      console.error('Error creating order:', error);
      throw error;
    }
  }

  async getUserChildren(userId: string): Promise<any[]> {
    // Используйте ваш существующий метод getChildrenByParentId
    // Но преобразуйте userId из string в number
    const children = await this.getChildrenByParentId(parseInt(userId));
    console.log('👶 Found children for user:', userId, children);
    return children;
  }
  async getOrderStatus(orderId: number) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      return order?.status;
    } catch (error) {
      console.error('Error getting order status:', error);
      return null;
    }
  }
  // В UsersService
  async getCompletedOrders(parentId: string) {
    return true;
  }

  // В UsersService измените на:
  async saveServiceFeedback(parentId: string, feedback: string) {
    console.log(`Отзыв о сервисе от пользователя ${parentId}: ${feedback}`);
    // TODO: Реализовать сохранение в БД
    return true;
  }

  async saveNannyFeedback(parentId: string, nannyId: string, feedback: string) {
    console.log(`Отзыв о няне ${nannyId} от пользователя ${parentId}: ${feedback}`);
    // TODO: Реализовать сохранение в БД
    return true;
  }
  // В UsersService добавьте:
  async getActiveOrders(parentId: string) {
    try {
      return await this.prisma.order.findMany({
        where: {
          parentId: parseInt(parentId),
          status: {
            in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'],
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      console.error('Error getting active orders:', error);
      return [];
    }
  }

  async getOrderHistory(parentId: string) {
    try {
      return await this.prisma.order.findMany({
        where: {
          parentId: parseInt(parentId),
          status: {
            in: ['COMPLETED', 'CANCELLED', 'EXPIRED'],
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      console.error('Error getting order history:', error);
      return [];
    }
  }
  // В UsersService
  async saveUserQuestion(parentId: string, question: string) {
    console.log(`Вопрос от пользователя ${parentId}: ${question}`);
    // TODO: Реализовать сохранение в БД или отправку администратору
    return true;
  }
  // В UsersService добавьте:

  // 🔹 Получить новые заказы для нянь
  async getNewOrdersForNannies() {
    try {
      return await this.prisma.order.findMany({
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

  // 🔹 Получить заказы конкретной няни
  async getOrdersByNanny(nannyId: string) {
    try {
      return await this.prisma.order.findMany({
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

  // 🔹 Принять заказ няней
  // users.service.ts - исправленный метод acceptOrder

  async acceptOrder(orderId: number, nannyId: number) {
    try {
      // Получаем данные няни и заказа
      const nanny = await this.getById(nannyId);
      const order = await this.getOrderById(orderId);

      if (!nanny || !order) {
        throw new Error('Няня или заказ не найдены');
      }

      const updatedOrder = await this.prisma.order.update({
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

  // 🔹 Получить активных нянь для уведомлений
  async getActiveNannies() {
    try {
      return await this.prisma.user.findMany({
        where: {
          role: Role.NANNY,
          profile: {
            status: 'VERIFIED',
          },
        },
        include: {
          profile: true,
        },
      });
    } catch (error) {
      console.error('Error getting active nannies:', error);
      return [];
    }
  }

  // 🔹 Получить заказы няни по статусу
  async getNannyOrdersByStatus(nannyId: string, statuses: string[]) {
    try {
      return await this.prisma.order.findMany({
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
  // 🔹 Получить заказ по ID

  async getOrderById(orderId: number): Promise<any> {
    try {
      return await this.prisma.order.findUnique({
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
  async getOrdersByStatus(status: string) {
    return this.prisma.order.findMany({
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
    return this.prisma.order.findMany({
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

  // 🔹 Обновить статус заказа
  async updateOrderStatus(orderId: number, status: OrderStatus): Promise<any> {
    try {
      return await this.prisma.order.update({
        where: { id: orderId },
        data: { status },
      });
    } catch (error) {
      console.error('Error updating order status:', error);
      throw error;
    }
  }

  // users.service.ts

  // 🔹 СОЗДАНИЕ ОТЗЫВА (критически важно)
  async createReview(data: {
    orderId: number;
    nannyId: number;
    parentId: number;
    rating: number;
    comment?: string;
  }) {
    // Проверяем, существует ли уже отзыв для этого заказа
    const existingReview = await this.prisma.review.findUnique({
      where: { orderId: data.orderId },
    });

    if (existingReview) {
      throw new Error('Отзыв для этого заказа уже существует');
    }

    // Создаем отзыв
    const review = await this.prisma.review.create({
      data: {
        orderId: data.orderId,
        nannyId: data.nannyId,
        parentId: data.parentId,
        rating: data.rating,
        comment: data.comment,
      },
    });

    // Обновляем рейтинг няни
    await this.updateNannyRating(data.nannyId);

    return review;
  }

  // 🔹 ОБНОВЛЕНИЕ РЕЙТИНГА НЯНИ (критически важно)
  async updateNannyRating(nannyId: number) {
    const stats = await this.prisma.review.aggregate({
      where: { nannyId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prisma.user.update({
      where: { id: nannyId },
      data: {
        avgRating: stats._avg.rating || 0,
        totalReviews: stats._count.rating || 0,
      },
    });
  }

  // 🔹 ПОЛУЧЕНИЕ ОТЗЫВОВ НЯНИ (для меню "Мой рейтинг")
  async getNannyReviews(nannyId: number) {
    return this.prisma.review.findMany({
      where: { nannyId },
      include: {
        parent: {
          select: {
            fullName: true,
            phone: true,
          },
        },
        order: {
          select: {
            date: true,
            time: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 🔹 ЗАВЕРШЕНИЕ ЗАКАЗА НЯНЕЙ (критически важно)
  async completeOrder(orderId: number, nannyId: number) {
    const order = await this.prisma.order.findUnique({
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

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }

  // 🔹 ПОЛУЧЕНИЕ АКТИВНЫХ ЗАКАЗОВ НЯНИ (с кнопкой завершения)
  async getNannyActiveOrders(nannyId: number) {
    return this.prisma.order.findMany({
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

  // 🔹 ПРОВЕРКА ВОЗМОЖНОСТИ ЗАВЕРШЕНИЯ (защита от преждевременного завершения)
  async canCompleteOrder(
    orderId: number,
    nannyId: number,
  ): Promise<{ canComplete: boolean; reason?: string }> {
    const order = await this.prisma.order.findUnique({
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

  // 🔹 СОЗДАНИЕ ЖАЛОБЫ (для системы контроля качества)
  // users.service.ts - исправленный метод createReport
  async createReport(data: {
    orderId: number;
    reporterId: number;
    type: any; // 🔹 Измените на any или используйте правильный enum
    reason: string;
  }) {
    return this.prisma.report.create({
      data: {
        orderId: data.orderId,
        reporterId: data.reporterId,
        type: data.type,
        reason: data.reason,
      },
    });
  }

  // 🔹 ПОЛУЧЕНИЕ ЗАВЕРШЕННЫХ ЗАКАЗОВ ДЛЯ ОЦЕНКИ (для родителя)
  async getCompletedOrdersForReview(parentId: number) {
    return this.prisma.order.findMany({
      where: {
        parentId: parentId,
        status: 'COMPLETED',
        review: null, // Только заказы без отзывов
      },
      include: {
        nanny: {
          include: {
            profile: true,
          },
        },
      },
      orderBy: { completedAt: 'desc' },
    });
  }

  // 🔹 ОБНОВЛЕНИЕ КОММЕНТАРИЯ ОТЗЫВА (после оценки)
  async updateReviewComment(reviewId: number, comment: string) {
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { comment },
    });
  }

  // 🔹 ПОЛУЧЕНИЕ ОТЗЫВА ПО ID ЗАКАЗА
  async getReviewByOrderId(orderId: number) {
    return this.prisma.review.findUnique({
      where: { orderId },
    });
  }

  // В UsersService добавьте эти методы:

  /**
   * Получить статистику няни
   */
  async getNannyStats(nannyId: number) {
    // Количество завершенных заказов
    const completedOrders = await this.prisma.order.count({
      where: {
        nannyId: nannyId,
        status: 'COMPLETED',
      },
    });

    // Сумма часов из всех завершенных заказов
    const hoursResult = await this.prisma.order.aggregate({
      where: {
        nannyId: nannyId,
        status: 'COMPLETED',
      },
      _sum: {
        duration: true,
      },
    });

    // Количество уникальных родителей
    const uniqueParents = await this.prisma.order.groupBy({
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

  /**
   * Получить последние отзывы няни (ограниченное количество)
   */
  async getRecentNannyReviews(nannyId: number, limit: number = 3) {
    return this.prisma.review.findMany({
      where: { nannyId },
      include: {
        parent: {
          select: {
            fullName: true,
          },
        },
        order: {
          select: {
            date: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
  // В конец класса UsersService добавьте:

  /**
   * 🔄 Обновление статуса няни с уведомлением
   */
  async updateNannyStatusWithNotify(
    userId: number,
    status: ProfileStatus,
    bot: any,
  ): Promise<void> {
    // 1. Обновляем статус в БД
    await this.updateNannyStatus(userId, status);

    // 2. Отправляем уведомление няне
    await this.notifyNannyStatusChange(userId, bot);
  }

  /**
   * 🔔 Уведомление няни об изменении статуса анкеты (приватный метод)
   */
  private async notifyNannyStatusChange(userId: number, bot: any): Promise<void> {
    try {
      const user = await this.getById(userId);
      if (!user || !user.chatId || !bot) return;

      const profile = user.profile;
      if (!profile) return;

      const name = profile.name || user.username || 'няня';

      if (profile.status === ProfileStatus.VERIFIED) {
        // ✅ Одобрение
        await bot.sendMessage(
          user.chatId,
          `🎉 Поздравляем, ${name}! Ваша анкета одобрена!\n\n` +
            `Теперь вы можете принимать заказы. Нажмите "Новые заказы" чтобы начать работу!`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: 'Новые заказы', callback_data: 'new_orders' }]],
            },
          },
        );

        // Устанавливаем флаг первого входа
        await this.setFirstLoginAfterVerification(userId, true);
      } else if (profile.status === ProfileStatus.REJECTED) {
        // ❌ Отклонение
        const reason = 'анкета не прошла модерацию';

        await bot.sendMessage(
          user.chatId,
          `❌ К сожалению, ваша анкета не прошла модерацию.\n\n` +
            `Причина: ${reason}\n\n` +
            `Вы можете исправить анкету и отправить на повторную проверку.`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: 'Изменить анкету', callback_data: 'edit_profile' }]],
            },
          },
        );
      }

      console.log(`📨 Уведомление отправлено няне ${userId} о статусе: ${profile.status}`);
    } catch (error) {
      console.error('❌ Ошибка отправки уведомления няне:', error);
    }
  }
  async getPendingProfiles() {
    return this.prisma.profile.findMany({
      where: { status: ProfileStatus.PENDING },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getProfilesByStatus(status: ProfileStatus) {
    return this.prisma.profile.findMany({
      where: { status },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getUsersByRole(role: Role) {
    return this.prisma.user.findMany({
      where: { role },
      include: {
        ordersAsParent: true,
        profile: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getAllOrders() {
    return this.prisma.order.findMany({
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
        this.prisma.user.count(),
        this.prisma.user.count({ where: { role: Role.NANNY } }),
        this.prisma.user.count({ where: { role: Role.PARENT } }),
        this.prisma.profile.count({ where: { status: ProfileStatus.PENDING } }),
        this.prisma.order.count(),
        this.prisma.order.count({ where: { status: 'COMPLETED' } }),
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

  // 🔥 ДОПОЛНИТЕЛЬНЫЕ МЕТОДЫ ДЛЯ СТАТИСТИКИ (если нужны)
  async getUserCount(): Promise<number> {
    return this.prisma.user.count();
  }

  async getUserCountByRole(role: Role): Promise<number> {
    return this.prisma.user.count({ where: { role } });
  }

  async getProfileCountByStatus(status: ProfileStatus): Promise<number> {
    return this.prisma.profile.count({ where: { status } });
  }

  async getOrderCount(): Promise<number> {
    return this.prisma.order.count();
  }

  async getAllNanniesWithPagination(skip: number, take: number) {
    return this.prisma.user.findMany({
      where: { role: Role.NANNY },
      include: {
        profile: true,
        ordersAsNanny: {
          include: {
            parent: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getNanniesCount(): Promise<number> {
    return this.prisma.user.count({
      where: { role: Role.NANNY },
    });
  }
}
