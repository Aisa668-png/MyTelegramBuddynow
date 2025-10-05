import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, ProfileStatus } from '../../generated/prisma';

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
      // Если роль уже установлена и отличается, не перезаписываем её здесь
      // (смена роли должна происходить через отдельный защищённый сценарий)
      return existing;
    }
    const user = await this.prisma.user.create({
      data: { chatId, username, role },
      include: { profile: true },
    });

    // Создаём профиль только для няни, если его нет
    if (role === Role.NANNY && !user.profile) {
      await this.prisma.profile.create({
        data: { userId: user.id, status: ProfileStatus.NEW },
      });
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

  // 🔹 Получить всех нянь (для админа)
  async getAllNannies() {
    return this.prisma.user.findMany({
      where: { role: Role.NANNY },
      include: { profile: true },
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

  async saveChild(
    userId: number,
    data: { name?: string; age?: number; notes?: string },
  ) {
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
  async updateChild(
    childId: number,
    data: { name?: string; age?: number; notes?: string },
  ) {
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
  async setFirstLoginAfterVerification(
    userId: number,
    value: boolean,
  ): Promise<void> {
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
  async saveParentAnswer(
    userId: number,
    field: 'fullName' | 'phone',
    value: string,
  ) {
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
}
