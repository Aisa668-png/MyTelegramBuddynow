import { Injectable } from '@nestjs/common';
import { BOT_CONSTANTS } from '../config/constants';

@Injectable()
export class MessageService {
  private constants = BOT_CONSTANTS;

  groupOrdersByDate(orders: any[]): { [date: string]: any[] } {
    return orders.reduce(
      (groups, order) => {
        const date = order.date;
        if (!groups[date]) {
          groups[date] = [];
        }
        groups[date].push(order);
        return groups;
      },
      {} as { [date: string]: any[] },
    );
  }

  formatScheduleDate(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Сегодня';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Завтра';
    } else {
      return date.toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    }
  }

  formatScheduleOrder(order: any): string {
    const parentName = order.parent?.fullName || 'Не указано';

    return `
✅ <b>${order.time}</b>
📅 <b>Дата:</b> ${order.date}
👤 <b>Родитель:</b> ${parentName}
👶 <b>Ребенок:</b> ${order.child}
📍 <b>Адрес:</b> ${order.address}
⏱️ <b>Длительность:</b> ${order.duration || 3} ч
${order.tasks ? `📝 <b>Задачи:</b> ${order.tasks.substring(0, 40)}${order.tasks.length > 40 ? '...' : ''}` : ''}
  `.trim();
  }

  formatActiveOrder(order: any, status: 'waiting' | 'confirmed'): string {
    const parentName = order.parent?.fullName || 'Не указано';
    const statusConfig = {
      waiting: {
        emoji: '⏳',
        title: 'Ожидает подтверждения родителя',
        note: '📞 <i>Родитель рассматривает вашу кандидатуру. Обычно ответ приходит в течение 1-2 часов.</i>',
      },
      confirmed: {
        emoji: '✅',
        title: 'Подтвержден, ожидает выполнения',
        note: '⚡ <i>Заказ активен! Готовьтесь к визиту.</i>',
      },
    };

    const config = statusConfig[status];

    return `
${config.emoji} <b>Заказ #${order.id}</b>
<b>${config.title}</b>

👤 <b>Родитель:</b> ${parentName}
📅 <b>Дата:</b> ${order.date}
⏰ <b>Время:</b> ${order.time}
⏱️ <b>Длительность:</b> ${order.duration || 3} ч
👶 <b>Ребенок:</b> ${order.child}
📍 <b>Адрес:</b> ${order.address}
${order.tasks ? `📝 <b>Задачи:</b> ${order.tasks.substring(0, 50)}${order.tasks.length > 50 ? '...' : ''}` : ''}

${config.note}
    `.trim();
  }

  createOrderKeyboard(orderId: number, status: 'waiting' | 'confirmed') {
    if (status === 'confirmed') {
      return {
        inline_keyboard: [
          [
            {
              text: this.constants.BUTTONS.COMPLETE_VISIT,
              callback_data: `complete_visit_${orderId}`,
            },
          ],
          [{ text: this.constants.BUTTONS.SUPPORT, callback_data: 'contact_support' }],
        ],
      };
    } else {
      return {
        inline_keyboard: [
          [
            {
              text: this.constants.BUTTONS.CANCEL_RESPONSE,
              callback_data: `cancel_response_${orderId}`,
            },
          ],
          [{ text: this.constants.BUTTONS.SUPPORT, callback_data: 'contact_support' }],
        ],
      };
    }
  }
}
