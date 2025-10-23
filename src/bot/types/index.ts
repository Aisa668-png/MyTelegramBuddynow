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
export enum Role {
  PARENT = 'parent',
  NANNY = 'nanny',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface User {
  id: number;
  chatId: string;
  username: string;
  role: Role;
  phone?: string;
  profile?: any;
}

// Добавьте другие необходимые типы
