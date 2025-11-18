// src/bot/services/handlers/command.handler.ts
import { Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { MenuService } from '../menu.service';
import { OrderService } from '../order.service';
import { ProfileService } from '../profile.service';
import { RatingService } from '../rating.service';
import { Role } from 'src/bot/types';

@Injectable()
export class CommandHandler {
  constructor(
    private readonly usersService: UsersService,
    private readonly menuService: MenuService,
    private readonly orderService: OrderService,
    private readonly profileService: ProfileService,
    private readonly ratingService: RatingService,
  ) {}

  async handle(bot: any, msg: any, chatId: string, user: any, text: string): Promise<void> {
    console.log('🔧 CommandHandler обрабатывает:', text);

    switch (text) {
      case '/create_order':
        await this.handleCreateOrder(bot, chatId, user);
        break;

      case '/my_profile':
        await this.handleMyProfile(bot, chatId, user);
        break;

      case '/tariffs':
        await this.handleTariffs(bot, chatId, user);
        break;

      case '/feedback':
        await this.handleFeedback(bot, chatId, user);
        break;

      case '/my_orders':
        await this.handleMyOrders(bot, chatId, user);
        break;

      case '/faq':
        await this.handleFaq(bot, chatId, user);
        break;

      case '/new_orders':
        await this.handleNewOrders(bot, chatId, user);
        break;

      case '/my_schedule':
        await this.handleMySchedule(bot, chatId, user);
        break;

      case '/my_rating':
        await this.handleMyRating(bot, chatId, user);
        break;

      case '/edit_profile':
        await this.handleEditProfile(bot, chatId, user);
        break;

      case '/support':
        await this.handleSupport(bot, chatId, user);
        break;

      default:
        console.log('❌ Неизвестная команда:', text);
        break;
    }
  }

  private async handleCreateOrder(bot: any, chatId: string, user: any): Promise<void> {
    console.log(`🔍 handleCreateOrder: проверяем роль пользователя`, user.role);

    const isParent = user.role === Role.PARENT || user.role === 'PARENT';

    if (isParent) {
      console.log('✅ Пользователь - родитель, создаем заказ');
      await this.usersService.setParentFSM(chatId, 'ORDER_ASK_DATE');
      await bot.sendMessage(chatId, '📅 Укажите дату, когда нужно присмотреть за вашим ребенком?');
    } else {
      console.log('❌ Пользователь не родитель:', user.role);
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
    }
  }

  private async handleMyProfile(bot: any, chatId: string, user: any): Promise<void> {
    const isParent = user.role === Role.PARENT || user.role === 'PARENT';
    const isNanny = user.role === Role.NANNY || user.role === 'NANNY';

    if (isParent) {
      await this.profileService.showParentProfile(bot, chatId, user);
    } else if (isNanny) {
      await this.profileService.showNannyProfile(bot, chatId, user);
    } else {
      await bot.sendMessage(chatId, '❌ Команда не доступна');
    }
  }

  private async handleTariffs(bot: any, chatId: string, user: any): Promise<void> {
    const isParent = user.role === Role.PARENT || user.role === 'PARENT';

    if (isParent) {
      await this.menuService.showTariffsMenu(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
    }
  }

  private async handleFeedback(bot: any, chatId: string, user: any): Promise<void> {
    const isParent = user.role === Role.PARENT || user.role === 'PARENT';

    if (isParent) {
      await this.menuService.showFeedbackMenu(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
    }
  }

  private async handleMyOrders(bot: any, chatId: string, user: any): Promise<void> {
    console.log(`🔍 handleMyOrders: проверяем роль пользователя`, {
      role: user.role,
      type: typeof user.role,
      RoleParent: Role.PARENT,
      typeRoleParent: typeof Role.PARENT,
    });

    // 🔹 ПРАВИЛЬНАЯ ПРОВЕРКА (работает и с enum и со строкой)
    const isParent = user.role === Role.PARENT || user.role === 'PARENT';
    const isNanny = user.role === Role.NANNY || user.role === 'NANNY';

    if (isParent) {
      console.log('✅ Пользователь - родитель, показываем меню заказов');
      await this.menuService.showMyOrdersMenu(bot, chatId);
    } else if (isNanny) {
      console.log('✅ Пользователь - няня, показываем меню няни');
      await this.menuService.showNannyOrdersMenu(bot, chatId);
    } else {
      console.log('❌ Неизвестная роль:', user.role);
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей и нянь');
    }
  }

  private async handleFaq(bot: any, chatId: string, user: any): Promise<void> {
    const isParent = user.role === Role.PARENT || user.role === 'PARENT';

    if (isParent) {
      await this.menuService.showFaqMenu(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для родителей');
    }
  }

  private async handleNewOrders(bot: any, chatId: string, user: any): Promise<void> {
    if (user.role === 'NANNY') {
      await this.orderService.showNewOrdersToNanny(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для нянь');
    }
  }

  private async handleMySchedule(bot: any, chatId: string, user: any): Promise<void> {
    if (user.role === 'NANNY') {
      await this.orderService.showNannySchedule(bot, chatId, user.id);
    } else {
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для нянь');
    }
  }

  private async handleMyRating(bot: any, chatId: string, user: any): Promise<void> {
    if (user.role === 'NANNY') {
      await this.ratingService.showNannyRating(bot, chatId, user.id);
    } else {
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для нянь');
    }
  }

  private async handleEditProfile(bot: any, chatId: string, user: any): Promise<void> {
    if (user.role === 'NANNY') {
      await bot.sendMessage(chatId, '✏️ Раздел "Редактировать профиль" в разработке');
    } else {
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для нянь');
    }
  }

  private async handleSupport(bot: any, chatId: string, user: any): Promise<void> {
    if (user.role === 'NANNY') {
      await bot.sendMessage(chatId, '🆕 Раздел "Поддержка" в разработке');
    } else {
      await bot.sendMessage(chatId, '❌ Эта команда доступна только для нянь');
    }
  }
}
