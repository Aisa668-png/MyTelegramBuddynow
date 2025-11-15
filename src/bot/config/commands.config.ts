export const parentCommands = [
  { command: 'create_order', description: 'Создать заказ' },
  { command: 'my_orders', description: 'Мои заказы' },
  { command: 'my_profile', description: 'Мой профиль' },
  { command: 'tariffs', description: 'Тарифы и оплата' },
  { command: 'faq', description: 'Вопросы и ответы' },
  { command: 'support', description: 'Поддержка' },
  { command: 'feedback', description: 'Оставить отзыв' },
];

export const nannyCommands = [
  { command: 'new_orders', description: 'Новые заказы' },
  { command: 'my_schedule', description: 'Мое расписание' },
  { command: 'my_orders', description: 'Мои заказы' },
  { command: 'my_rating', description: 'Мой рейтинг' },
  { command: 'my_profile', description: 'Мой профиль' },
  { command: 'support', description: 'Связаться с поддержкой' },
  { command: 'faq', description: 'Вопросы и ответы' },
];

export interface BotCommand {
  command: string;
  description: string;
}

export const adminCommands: BotCommand[] = [
  { command: '/start', description: 'Перезапустить бота' },
  { command: '/pending_profiles', description: '📋 Новые анкеты' },
  { command: '/all_nannies', description: '👩‍🍼 Все анкеты' },
  { command: '/new_orders', description: 'Новые заказы' },
  { command: '/all_orders', description: 'Все заказы' },
  { command: '/rejected_profiles', description: 'Отклоненые заказы нянь' },
  { command: '/parent_profiles', description: 'Профили родителей' },
];
