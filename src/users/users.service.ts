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

  async getAllUsers() {
    return this.prisma.user.findMany({
      include: { profile: true },
    });
  }

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

  async updateNannyStatus(userId: number, status: ProfileStatus) {
    return this.prisma.profile.update({
      where: { userId },
      data: { status },
    });
  }

  async savePhoneNumber(userId: number, phone: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { phone },
    });
  }

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
    const name = data.name?.trim();
    if (!name) {
      throw new Error('Child name is required');
    }

    const age = typeof data.age === 'number' && data.age >= 0 ? data.age : null;

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

  async updateChild(childId: number, data: { name?: string; age?: number; notes?: string }) {
    return this.prisma.child.update({
      where: { id: childId },
      data,
    });
  }

  async getFirstLoginAfterVerification(userId: number): Promise<boolean> {
    const user = await this.getById(userId);
    return user?.profile?.firstLoginAfterVerification || false;
  }

  async setFirstLoginAfterVerification(userId: number, value: boolean): Promise<void> {
    await this.prisma.profile.update({
      where: { userId },
      data: { firstLoginAfterVerification: value },
    });
  }

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

  private tempOrderStorage = new Map<string, any>();

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

  async getCompletedOrders(parentId: string) {
    return true;
  }

  async saveServiceFeedback(parentId: string, feedback: string) {
    console.log(`Отзыв о сервисе от пользователя ${parentId}: ${feedback}`);
    // TODO: Реализовать сохранение в БД
    return true;
  }

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

  async saveUserQuestion(parentId: string, question: string) {
    console.log(`Вопрос от пользователя ${parentId}: ${question}`);
    // TODO: Реализовать сохранение в БД или отправку администратору
    return true;
  }

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

  async getUserCount(): Promise<number> {
    return this.prisma.user.count();
  }

  async getUserCountByRole(role: Role): Promise<number> {
    return this.prisma.user.count({ where: { role } });
  }

  async getProfileCountByStatus(status: ProfileStatus): Promise<number> {
    return this.prisma.profile.count({ where: { status } });
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
