// src/bot/services/handlers/nanny-message.handler.ts
import { Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class NannyMessageHandler {
  constructor(private readonly usersService: UsersService) {}

  async handle(
    bot: any,
    msg: any,
    chatId: string,
    user: any,
    text: string | undefined,
  ): Promise<boolean> {
    const fsmNanny = await this.usersService.getNannyFSM(chatId);

    if (!fsmNanny) return false;

    // 🔹 ОБРАБОТКА FSM НЯНИ
    if (fsmNanny === 'ASK_RATE_CUSTOM' && text) {
      await this.handleRateCustom(bot, chatId, user, text);
      return true;
    }

    // 🔹 ОБРАБОТКА ФОТО
    const photoId = this.extractPhotoId(msg);
    if (fsmNanny === 'ASK_PHOTO' && photoId) {
      await this.handlePhoto(bot, chatId, user, photoId);
      return true;
    }

    // 🔹 ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
    if (text) {
      await this.handleTextStates(bot, chatId, user, fsmNanny, text);
      return true;
    }

    return false;
  }

  private extractPhotoId(msg: any): string | undefined {
    if (msg.photo?.length) {
      return msg.photo[msg.photo.length - 1].file_id;
    } else if (msg.document) {
      const docMime = msg.document.mime_type?.toLowerCase();
      if (!docMime || docMime.startsWith('image/')) {
        return msg.document.file_id;
      }
    }
    return undefined;
  }

  private async handleRateCustom(bot: any, chatId: string, user: any, text: string): Promise<void> {
    const rate = parseInt(text, 10);
    if (!isNaN(rate)) {
      await this.usersService.updateNannyProfile(user.id, { price: rate });
      await this.usersService.setNannyFSM(chatId, 'ASK_PHOTO');
      await bot.sendMessage(
        chatId,
        'Заключительный шаг! 📷 Пришлите фото из галереи для аватарки.',
      );
    } else {
      await bot.sendMessage(chatId, 'Введите число, например 450.');
    }
  }

  private async handlePhoto(bot: any, chatId: string, user: any, photoId: string): Promise<void> {
    await this.usersService.updateNannyProfile(user.id, { avatar: photoId });
    await this.usersService.setNannyFSM(chatId, null);
    await bot.sendMessage(
      chatId,
      '🎉 Ура, ваша анкета у нас! Мы уже отправили ее на проверку. Обычно мы справляемся в течении 24 часов. Как только все будет готово-вам прийдет смс уведомление. Осталось совсем немного! спасибо что выбрали наш сервис! ✅',
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

  private async handleTextStates(
    bot: any,
    chatId: string,
    user: any,
    fsmNanny: string,
    text: string,
  ): Promise<void> {
    switch (fsmNanny) {
      case 'ASK_NAME':
        await this.usersService.updateNannyProfile(user.id, { name: text });
        await this.usersService.setNannyFSM(chatId, 'ASK_DOB');
        await bot.sendMessage(chatId, 'Укажите вашу дату рождения (дд.мм.гггг):');
        break;

      case 'ASK_DOB':
        const success = await this.usersService.updateDob(user.id, text);
        if (!success) {
          await bot.sendMessage(chatId, '❌ Неверный формат даты. Введите в формате дд.мм.гггг');
          return;
        }
        await this.usersService.setNannyFSM(chatId, 'ASK_OCCUPATION');
        await bot.sendMessage(
          chatId,
          'Укажите род деятельности (например: студент, мама в декрете):',
        );
        break;

      case 'ASK_OCCUPATION':
        await this.usersService.updateNannyProfile(user.id, { occupation: text });
        await this.usersService.setNannyFSM(chatId, 'ASK_MEDCARD');
        await bot.sendMessage(chatId, 'Есть ли у вас действующая медицинская карта?', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Да', callback_data: 'medcard_yes' }],
              [{ text: '❌ Нет', callback_data: 'medcard_no' }],
            ],
          },
        });
        break;
    }
  }
}
