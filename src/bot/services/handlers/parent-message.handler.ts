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

  // 🔥 ДОБАВИТЬ ЭТИ МЕТОДЫ В КЛАСС:
  private async handleAskTime(
    bot: any,
    msg: any,
    chatId: string,
    timeInput: string,
  ): Promise<boolean> {
    try {
      // 🔥 РАСЧЕТ ДЛИТЕЛЬНОСТИ
      const calculatedHours = this.calculateDurationFromTime(timeInput);

      console.log('🕒 Расчет длительности:', {
        input: timeInput,
        calculated: calculatedHours,
      });

      // Сохраняем время и РАССЧИТАННУЮ длительность
      await this.usersService.setTempOrderData(chatId, {
        time: timeInput,
        duration: calculatedHours,
      });

      // Показываем сообщение с подтверждением
      const durationMessage = `⏱️ **Проверьте длительность**: ${calculatedHours} ч.\n\n✅ _Если всё верно - нажмите "Подтвердить"\n✏️ Или введите другое количество часов_`;

      await bot.sendMessage(chatId, durationMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Подтвердить', callback_data: 'confirm_duration' }],
            [{ text: '✏️ Изменить длительность', callback_data: 'edit_duration' }],
          ],
        },
      });

      await this.usersService.setParentFSM(chatId, 'ASK_DURATION');
      return true;
    } catch (error) {
      console.error('Error handling ASK_TIME:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при обработке времени');
      return true;
    }
  }

  private async handleAskDuration(
    bot: any,
    msg: any,
    chatId: string,
    text: string,
  ): Promise<boolean> {
    try {
      // 🔥 ОБРАБОТКА РУЧНОГО ВВОДА ДЛИТЕЛЬНОСТИ
      if (text) {
        const customDuration = parseInt(text);
        if (isNaN(customDuration) || customDuration < 1) {
          await bot.sendMessage(chatId, '❌ Введите корректное число часов (от 1):');
          return true;
        }

        // Сохраняем РУЧНУЮ длительность
        await this.usersService.setTempOrderData(chatId, {
          duration: customDuration,
        });
      }

      // Переходим к следующему шагу
      await this.usersService.setParentFSM(chatId, 'ASK_CHILD');
      await bot.sendMessage(chatId, '👶 Теперь расскажите о ребенке:');
      return true;
    } catch (error) {
      console.error('Error handling ASK_DURATION:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при обработке длительности');
      return true;
    }
  }

  // 🔥 ДОБАВИТЬ МЕТОДЫ РАСЧЕТА В КОНЕЦ КЛАССА:
  private calculateDurationFromTime(timeInput: string): number {
    try {
      const cleanInput = timeInput.replace(/\s/g, '');
      const timeParts = cleanInput.split('-').filter((part) => part.length > 0);

      if (timeParts.length !== 2) return 3;

      const startTime = this.parseTime(timeParts[0]);
      const endTime = this.parseTime(timeParts[1]);

      if (!startTime || !endTime) return 3;

      let diffMs = endTime.getTime() - startTime.getTime();
      if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;

      return Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
    } catch (error) {
      return 3;
    }
  }

  private parseTime(timeStr: string): Date | null {
    try {
      const cleanTime = timeStr.replace(/[^0-9:]/g, '');

      let hours, minutes;

      if (cleanTime.includes(':')) {
        [hours, minutes] = cleanTime.split(':').map(Number);
      } else {
        if (cleanTime.length <= 2) {
          hours = Number(cleanTime);
          minutes = 0;
        } else {
          hours = Number(cleanTime.slice(0, 2));
          minutes = Number(cleanTime.slice(2));
        }
      }

      if (
        isNaN(hours) ||
        hours < 0 ||
        hours > 23 ||
        isNaN(minutes) ||
        minutes < 0 ||
        minutes > 59
      ) {
        return null;
      }

      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return date;
    } catch (error) {
      return null;
    }
  }

  private async handleFsmStates(
    bot: any,
    msg: any,
    chatId: string,
    user: any,
    fsmParent: string,
    text: string | undefined,
  ): Promise<boolean> {
    // 🔹 ПЕРЕДАЕМ ОБРАБОТКУ В FSM SERVICE
    if (text && fsmParent.startsWith('ORDER_')) {
      // Обработка создания заказа через FsmService
      await this.fsmService.handleOrderCreation(bot, chatId, text, fsmParent, user);
      return true;
    }

    // 🔹 ОБРАБОТКА РЕГИСТРАЦИОННЫХ СОСТОЯНИЙ
    if (text) {
      switch (fsmParent) {
        case 'ASK_TIME':
          return await this.handleAskTime(bot, msg, chatId, text);

        case 'ASK_DURATION':
          return await this.handleAskDuration(bot, msg, chatId, text);
        case 'ASK_NAME':
          console.log(`✅ Обрабатываем ФИО родителя: ${text}`);
          await this.usersService.saveParentName(user.id, text);
          await this.usersService.setParentFSM(chatId, 'ASK_CONSENT');
          await bot.sendMessage(
            chatId,
            'Минутка формальности. Подтвердите согласие с условиями обработки персональных данных.',
            {
              reply_markup: {
                inline_keyboard: [[{ text: 'Согласен', callback_data: 'consent_yes' }]],
              },
            },
          );
          return true;

        case 'ASK_CHILD_NAME':
          console.log(`✅ Обрабатываем имя ребенка: ${text}`);
          await this.usersService.saveChild(user.id, { name: text });
          await this.usersService.setParentFSM(chatId, 'ASK_CHILD_AGE');
          await bot.sendMessage(
            chatId,
            '✅ Имя ребенка сохранено! Укажите возраст вашего ребёнка:',
          );
          return true;

        case 'ASK_CHILD_AGE':
          console.log(`✅ Обрабатываем возраст ребенка: ${text}`);
          const age = parseInt(text);
          if (isNaN(age) || age < 0 || age > 18) {
            await bot.sendMessage(chatId, '❌ Пожалуйста, введите корректный возраст (0-18 лет):');
            return true;
          }
          const childrenAge = await this.usersService.getChildrenByParentId(user.id);
          const lastChildAge = childrenAge[childrenAge.length - 1];
          if (lastChildAge) {
            await this.usersService.updateChild(lastChildAge.id, { age });
          }
          await this.usersService.setParentFSM(chatId, 'ASK_CHILD_NOTES');
          await bot.sendMessage(
            chatId,
            '✅ Возраст сохранен! Расскажите о особенностях вашего ребёнка (аллергии, привычки и т.д.):',
            {
              reply_markup: {
                inline_keyboard: [[{ text: 'Пропустить', callback_data: 'skip_child_notes' }]],
              },
            },
          );
          return true;

        case 'ASK_CHILD_NOTES':
          console.log(`✅ Обрабатываем заметки о ребенке: ${text}`);
          const childrenNotes = await this.usersService.getChildrenByParentId(user.id);
          const lastChildNotes = childrenNotes[childrenNotes.length - 1];

          if (text.toLowerCase() !== 'пропустить' && lastChildNotes) {
            await this.usersService.updateChild(lastChildNotes.id, { notes: text });
          }

          const childName = lastChildNotes?.name || 'ребенок';
          await this.usersService.setParentFSM(chatId, 'FINISH');
          await bot.sendMessage(chatId, `✅ Готово! ${childName} добавлен в ваш профиль.`, {
            reply_markup: {
              inline_keyboard: [[{ text: '👶 Создать заказ', callback_data: 'create_order' }]],
            },
          });
          return true;
      }
    }

    // 🔹 ОСТАЛЬНАЯ ЛОГИКА (отзывы, редактирование и т.д.)
    if (fsmParent.startsWith('REVIEW_COMMENT_') && text) {
      return await this.handleReviewComment(bot, chatId, user, fsmParent, text);
    }

    if (fsmParent.startsWith('awaiting_review_text_') && text) {
      return await this.handleAwaitingReviewText(bot, chatId, user, fsmParent, text);
    }

    if (fsmParent.startsWith('EDIT_')) {
      return await this.handleEditStates(bot, msg, chatId, user, fsmParent, text);
    }

    if (fsmParent.startsWith('FEEDBACK_') && text) {
      return await this.handleFeedbackStates(bot, chatId, user, fsmParent, text);
    }

    if (fsmParent === 'ASK_QUESTION' && text) {
      return await this.handleAskQuestion(bot, chatId, user, text);
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
