// Типы для FSM состояний
export interface FsmStep {
  key: string;
  message: string;
  field: string | null;
  options?: any;
}

export interface OrderCreationStep {
  key: string;
  message: string;
}

// Типы для команд меню
export interface BotCommand {
  command: string;
  description: string;
}

// Типы для обработки callback данных
export interface CallbackData {
  action: string;
  orderId?: number;
  nannyId?: number;
  parentId?: number;
}
