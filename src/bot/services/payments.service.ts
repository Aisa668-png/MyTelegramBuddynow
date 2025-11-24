// payments.service.ts (ДЛЯ ЛОКАЛЬНОЙ РАЗРАБОТКИ)
import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentsService {
  async createPayment(amount: number, description: string, orderId: string) {
    console.log(`💰 [TEST] Платеж ${amount} руб за заказ ${orderId}`);

    // ЗАГЛУШКА - работает без интернета
    return {
      id: 'test_payment_' + Date.now(),
      status: 'pending',
      confirmation: {
        confirmation_url: 'https://example.com/test-payment',
      },
      amount: { value: amount, currency: 'RUB' },
    };
  }
}
