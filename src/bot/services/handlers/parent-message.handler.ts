// src/bot/services/handlers/parent-message.handler.ts
import { Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { FsmService } from '../fsm.service';
import { RatingService } from '../rating.service';

@Injectable()
export class ParentMessageHandler {
  constructor(
    private readonly usersService: UsersService,
    private readonly fsmService: FsmService,
    private readonly ratingService: RatingService,
  ) {}

  async handle(
    bot: any,
    msg: any,
    chatId: string,
    user: any,
    text: string | undefined,
  ): Promise<boolean> {
    const fsmParent = await this.usersService.getParentFSM(chatId);

    // 🔹 Проверка текста или медиа
    const hasText = text && !text.startsWith('/');
    const hasMedia =
      Boolean(msg.photo?.length) || (msg.document && msg.document.mime_type?.startsWith('image/'));
    const hasContact = !!msg.contact;

    if (!hasText && !hasMedia && !hasContact) return false;

    // 🔹 ОБРАБОТКА FSM СОСТОЯНИЙ
    if (fsmParent) {
      const handled = await this.handleFsmStates(bot, msg, chatId, user, fsmParent, text);
      if (handled) return true;
    }

    // 🔹 ОБЫЧНЫЕ СООБЩЕНИЯ
    if (text && !fsmParent?.startsWith('EDIT_')) {
      // Временно закомментируем, нужно передать parentFsmSteps
      // await this.fsmService.handleParentMessage(
      //   bot,
      //   chatId,
      //   text,
      //   this.parentFsmSteps,
      //   false,
      // );
      console.log('📝 Обычное сообщение родителя:', text);
    }

    return false;
  }

  private async handleFsmStates(
    bot: any,
    msg: any,
    chatId: string,
    user: any,
    fsmParent: string,
    text: string | undefined,
  ): Promise<boolean> {
    // 🔹 ОБРАБОТКА ОТЗЫВОВ
    if (fsmParent.startsWith('REVIEW_COMMENT_') && text) {
      return await this.handleReviewComment(bot, chatId, user, fsmParent, text);
    }

    if (fsmParent.startsWith('awaiting_review_text_') && text) {
      return await this.handleAwaitingReviewText(bot, chatId, user, fsmParent, text);
    }

    // 🔹 ОБРАБОТКА РЕДАКТИРОВАНИЯ
    if (fsmParent.startsWith('EDIT_')) {
      return await this.handleEditStates(bot, msg, chatId, user, fsmParent, text);
    }

    // 🔹 ОБРАБОТКА ОТЗЫВОВ О СЕРВИСЕ
    if (fsmParent.startsWith('FEEDBACK_') && text) {
      return await this.handleFeedbackStates(bot, chatId, user, fsmParent, text);
    }

    // 🔹 ОБРАБОТКА ВОПРОСОВ
    if (fsmParent === 'ASK_QUESTION' && text) {
      return await this.handleAskQuestion(bot, chatId, user, text);
    }

    // 🔹 ОБРАБОТКА СОЗДАНИЯ ЗАКАЗА
    if (fsmParent.startsWith('ORDER_') && text) {
      await this.fsmService.handleOrderCreation(bot, chatId, text, fsmParent, user);
      return true;
    }

    return false;
  }

  private async handleReviewComment(
    bot: any,
    chatId: string,
    user: any,
    fsmParent: string,
    text: string,
  ): Promise<boolean> {
    const orderId = parseInt(fsmParent.replace('REVIEW_COMMENT_', ''));

    if (text.toLowerCase() === 'пропустить') {
      await bot.sendMessage(chatId, '✅ Рейтинг сохранен. Спасибо!');
    } else {
      await this.ratingService.handleReviewComment(bot, chatId, orderId, text);
    }

    await this.usersService.setParentFSM(chatId, null);
    return true;
  }

  private async handleAwaitingReviewText(
    bot: any,
    chatId: string,
    user: any,
    fsmParent: string,
    text: string,
  ): Promise<boolean> {
    console.log('📝 PROCESSING REVIEW TEXT STATE:', fsmParent);

    const parts = fsmParent.split('_');
    const orderId = parseInt(parts[3]);
    const nannyId = parseInt(parts[4]);
    const rating = parseInt(parts[5]);

    if (isNaN(rating) || isNaN(orderId) || isNaN(nannyId)) {
      console.error('❌ INVALID PARAMETERS:', { orderId, nannyId, rating });
      await bot.sendMessage(chatId, '❌ Ошибка: неверные данные отзыва. Попробуйте еще раз.');
      await this.usersService.setParentFSM(chatId, null);
      return true;
    }

    try {
      const savedReview = await this.usersService.createReview({
        orderId,
        nannyId,
        parentId: user.id,
        rating,
        comment: text,
      });

      console.log('✅ REVIEW SAVED SUCCESSFULLY:', savedReview);
      await this.usersService.setParentFSM(chatId, null);
      await bot.sendMessage(chatId, '✅ Спасибо за ваш отзыв!');
    } catch (error: any) {
      console.error('❌ ERROR SAVING REVIEW:', error);
      await bot.sendMessage(chatId, `❌ Ошибка при сохранении отзыва: ${error.message}`);
    }

    return true;
  }

  private async handleEditStates(
    bot: any,
    msg: any,
    chatId: string,
    user: any,
    fsmParent: string,
    text: string | undefined,
  ): Promise<boolean> {
    if (!text) return false;

    if (fsmParent === 'EDIT_PARENT_NAME') {
      await this.usersService.saveParentName(user.id, text);
      await this.usersService.setParentFSM(chatId, null);
      await bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
      return true;
    }

    if (fsmParent.startsWith('EDIT_CHILD_NAME_')) {
      const childId = fsmParent.replace('EDIT_CHILD_NAME_', '');
      await this.usersService.updateChild(parseInt(childId), { name: text });
      await this.usersService.setParentFSM(chatId, null);
      await bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
      return true;
    }

    if (fsmParent.startsWith('EDIT_CHILD_AGE_')) {
      const childId = fsmParent.replace('EDIT_CHILD_AGE_', '');
      const age = parseInt(text);
      if (isNaN(age) || age < 0) {
        await bot.sendMessage(chatId, '❌ Пожалуйста, введите возраст числом.');
        return true;
      }
      await this.usersService.updateChild(parseInt(childId), { age });
      await this.usersService.setParentFSM(chatId, null);
      await bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
      return true;
    }

    if (fsmParent.startsWith('EDIT_CHILD_INFO_')) {
      const childId = fsmParent.replace('EDIT_CHILD_INFO_', '');
      await this.usersService.updateChild(parseInt(childId), { notes: text });
      await this.usersService.setParentFSM(chatId, null);
      await bot.sendMessage(chatId, '✅ Готово! Ваш профиль отредактирован.');
      return true;
    }

    return false;
  }

  private async handleFeedbackStates(
    bot: any,
    chatId: string,
    user: any,
    fsmParent: string,
    text: string,
  ): Promise<boolean> {
    if (fsmParent === 'FEEDBACK_SERVICE') {
      await this.usersService.saveServiceFeedback(user.id.toString(), text);
      await this.usersService.setParentFSM(chatId, null);
      await bot.sendMessage(
        chatId,
        '✅ Спасибо за ваш отзыв о сервисе! Мы ценим ваше мнение и обязательно его учтем.',
        { reply_markup: { inline_keyboard: [] } },
      );
      return true;
    }

    if (fsmParent === 'FEEDBACK_NANNY') {
      await this.usersService.saveNannyFeedback(user.id.toString(), 'general', text);
      await this.usersService.setParentFSM(chatId, null);
      await bot.sendMessage(
        chatId,
        '✅ Спасибо за ваш отзыв о няне! Он поможет другим родителям в выборе.',
        { reply_markup: { inline_keyboard: [] } },
      );
      return true;
    }

    return false;
  }

  private async handleAskQuestion(
    bot: any,
    chatId: string,
    user: any,
    text: string,
  ): Promise<boolean> {
    await this.usersService.saveUserQuestion(user.id.toString(), text);
    await this.usersService.setParentFSM(chatId, null);

    await bot.sendMessage(
      chatId,
      '✅ Ваш вопрос принят! Мы ответим вам в ближайшее время.\n\nА пока можете ознакомиться с нашей статьей о работе сервиса:',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '📖 Читать статью',
                url: 'https://telegra.ph/FAQ-o-servise-Pomogator-10-09',
              },
            ],
            [{ text: '⬅️ В главное меню', callback_data: 'back_to_menu' }],
          ],
        },
      },
    );

    return true;
  }
}
