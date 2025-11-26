import { Injectable } from '@nestjs/common';
import * as yookassa from 'yookassa';

@Injectable()
export class YookassaService {
  private yooKassa;

  constructor() {
    // Проверяем что ключи есть
    if (!process.env.YUKASSA_SHOP_ID || !process.env.YUKASSA_SECRET_KEY) {
      throw new Error('ЮKassa ключи не настроены!');
    }

    this.yooKassa = yookassa({
      shopId: process.env.YUKASSA_SHOP_ID,
      secretKey: process.env.YUKASSA_SECRET_KEY,
    });
  }

  async createPayment(amount: number, description: string, orderId: string) {
    try {
      console.log(`🔄 Создаем платеж в ЮKassa: ${amount} руб`);

      const payment = await this.yooKassa.createPayment({
        amount: {
          value: amount.toFixed(2),
          currency: 'RUB',
        },
        payment_method_data: {
          type: 'bank_card',
        },
        confirmation: {
          type: 'redirect',
          return_url: process.env.YUKASSA_RETURN_URL || 'https://t.me/your_bot',
        },
        description: description,
        capture: true,
        metadata: {
          orderId: orderId,
        },
      });

      console.log(`✅ Платеж создан: ${payment.id}`);
      return payment;

    } catch (error) {
      console.error('❌ Ошибка создания платежа:', error);
      throw new Error('Не удалось создать платеж в ЮKassa');
    }
  }
}
