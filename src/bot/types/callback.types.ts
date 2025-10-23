// src/bot/types/callback.types.ts
export enum CallbackType {
  CONFIRM_ORDER = 'confirm_order',
  ROLE_SELECT = 'role_',
  LEAVE_REVIEW = 'leave_review_',
  SET_RATING = 'set_rating_',
  PARENT_CONFIRM_ORDER = 'parent_confirm_order_',
  PARENT_REJECT_ORDER = 'parent_reject_order_',
  SELECT_CHILD = 'select_child_',
  EDIT_CHILD = 'edit_child_',
  COMPLETE_VISIT = 'complete_visit_',
  ACCEPT_ORDER = 'accept_order_',
  MENU_ACTION = 'menu_action', // для простых кнопок меню
}

export interface CallbackData {
  type: CallbackType;
  params: string[];
  originalData: string;
}
