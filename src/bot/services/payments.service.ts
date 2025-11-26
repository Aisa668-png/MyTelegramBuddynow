import { Injectable } from '@nestjs/common';
import { YookassaService } from './yookassa.service';

@Injectable()
export class PaymentsService {
  constructor(private readonly yookassaService: YookassaService) {}

  async createPayment(amount: number, description: string, orderId: string) {
    // ВСЕГДА используем реальную ЮKassa на сервере
    return await this.yookassaService.createPayment(amount, description, orderId);
  }
}
