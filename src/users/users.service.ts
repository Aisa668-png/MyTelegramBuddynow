import { Injectable } from '@nestjs/common';
import { PrismaClient, $Enums } from '../../generated/prisma';

@Injectable()
export class UsersService {
  private prisma = new PrismaClient();

  // Type guard для проверки, что значение действительно $Enums.Role
  private isRole(value: unknown): value is $Enums.Role {
    return value === 'PARENT' || value === 'NANNY' || value === 'ADMIN';
  }

  async createUser(chatId: string, username?: string, role?: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const safeRole: $Enums.Role = this.isRole(role) ? role : 'PARENT';
    return this.prisma.user.upsert({
      where: { chatId },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      update: { username, role: safeRole },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      create: { chatId, username, role: safeRole },
    });
  }

  async getByChatId(chatId: string) {
    return this.prisma.user.findUnique({ where: { chatId } });
  }

  async setRole(chatId: string, role: $Enums.Role) {
    return this.prisma.user.update({
      where: { chatId },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: { role },
    });
  }

  async getAllUsers() {
    return this.prisma.user.findMany();
  }
}
