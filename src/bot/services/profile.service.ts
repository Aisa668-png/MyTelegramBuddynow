import { Injectable } from '@nestjs/common';
import TelegramBot, { CallbackQuery } from 'node-telegram-bot-api';
import { UsersService } from '../../users/users.service';
import { Role, ProfileStatus } from '../../../generated/prisma';

@Injectable()
export class ProfileService {
  constructor(private readonly usersService: UsersService) {}

  /**
   * 👤 Показывает профиль родителя
   */
  async showParentProfile(bot: TelegramBot, chatId: string, user: any): Promise<void> {
    try {
      const children = await this.usersService.getChildrenByParentId(user.id);

      let profileText = `👤 *Мой профиль*\n\n`;
      profileText += `*Имя:* ${user.fullName || 'Не указано'}\n`;
      profileText += `*Номер тлф:* ${user.phone ? this.formatPhone(user.phone) : 'Не указано'}\n\n`;

      if (children.length > 0) {
        children.forEach((child, index) => {
          profileText += `*Ребенок ${index + 1}:*\n`;
          profileText += `*Имя ребенка:* ${child.name || 'Не указано'}\n`;
          profileText += `*Возраст ребенка:* ${child.age ? child.age + ' лет' : 'Не указано'}\n`;
          profileText += `*О ребенке:* ${child.notes || 'Не указано'}\n`;
          if (index < children.length - 1) profileText += `\n`;
        });
      } else {
        profileText += `*Дети:* не добавлены\n`;
      }

      await bot.sendMessage(chatId, profileText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '✏️ Редактировать', callback_data: 'edit_profile' }]],
        },
      });
    } catch (error) {
      console.error('Error showing parent profile:', error);
      await bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке профиля');
    }
  }

  /**
   * 👤 Показывает профиль няни
   */
  async showNannyProfile(bot: TelegramBot, chatId: string, user: any): Promise<void> {
    try {
      await this.usersService.ensureProfileForNanny(user.id);
      const userWithProfile = await this.usersService.getByChatId(chatId);

      if (!userWithProfile?.profile) {
        await bot.sendMessage(chatId, '❌ Профиль няни не найден');
        return;
      }

      const profile = userWithProfile.profile;
      const profileMessage = this.formatNannyProfile(profile, user);

      await bot.sendMessage(chatId, profileMessage, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Редактировать профиль', callback_data: 'edit_nanny_profile' }],
          ],
        },
        parse_mode: 'HTML',
      });
    } catch (error) {
      console.error('Error showing nanny profile:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке профиля');
    }
  }

  /**
   * 📋 Форматирует профиль няни в красивое сообщение
   */
  private formatNannyProfile(profile: any, user: any): string {
    const name = profile.name || 'Не указано';
    const occupation = profile.occupation || 'Не указана';
    const hasMedCard = profile.hasMedCard ? '✅ Есть' : '❌ Нет';
    const price = profile.price ? `${profile.price} руб/час` : 'Не указана';
    const phone = user.phone || 'Не указан';

    return `
👤 <b>Мой профиль няни</b>
📝 <b>Имя:</b> ${name}
📞 <b>Телефон:</b> ${phone}
💼 <b>Род деятельности:</b> ${occupation}
🏥 <b>Мед. карта:</b> ${hasMedCard}
💰 <b>Ставка:</b> ${price}
  `.trim();
  }

  /**
   * 🔄 Получает текстовое представление статуса няни
   */
  private getNannyStatusText(status: ProfileStatus): string {
    const statusMap = {
      [ProfileStatus.NEW]: '🆕 Новая анкета',
      [ProfileStatus.PENDING]: '⏳ На проверке',
      [ProfileStatus.VERIFIED]: '✅ Одобрена',
      [ProfileStatus.REJECTED]: '❌ Отклонена',
    };
    return statusMap[status] || 'Неизвестно';
  }

  /**
   * ✏️ Обработчик редактирования профиля няни
   */
  async handleEditNannyProfile(bot: TelegramBot, query: CallbackQuery): Promise<void> {
    try {
      if (!query.message) {
        console.error('Query message is undefined');
        return;
      }

      const chatId = query.message.chat.id.toString();
      const user = await this.usersService.getByChatId(chatId);

      if (!user || user.role !== Role.NANNY) {
        await bot.sendMessage(chatId, '❌ Доступ запрещен');
        return;
      }

      await bot.sendMessage(chatId, '📝 Что вы хотите изменить в профиле?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👤 Имя', callback_data: 'edit_nanny_name' }],
            [{ text: '💼 Опыт работы', callback_data: 'edit_nanny_experience' }],
            [{ text: '💰 Ставка', callback_data: 'edit_nanny_price' }],
            [{ text: '📅 Дата рождения', callback_data: 'edit_nanny_dob' }],
            [{ text: '🏥 Мед. карта', callback_data: 'edit_nanny_medcard' }],
          ],
        },
      });

      if ('message_id' in query.message) {
        await bot.deleteMessage(chatId, query.message.message_id);
      }
    } catch (error) {
      console.error('Error handling edit nanny profile:', error);
    }
  }

  /**
   * 🔹 Вспомогательный метод для форматирования телефона
   */
  private formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `+7 (${cleaned.substring(1, 4)}) ${cleaned.substring(4, 7)}-${cleaned.substring(7, 9)}-${cleaned.substring(9)}`;
    }
    return phone;
  }
}
