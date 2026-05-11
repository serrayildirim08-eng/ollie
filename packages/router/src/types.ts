export type ReminderStatus = 'scheduled' | 'fired' | 'cancelled' | 'dismissed';

export interface Reminder {
  id: string;
  module: string;
  action: string;
  datetime: number;
  body: string;
  status: ReminderStatus;
}

export type Unsubscribe = () => void;

/** Minimal event-bus interface — matches @ollie/events surface. */
export interface EventBus {
  emit(name: string, payload: unknown): void;
  on(name: string, handler: (payload: unknown) => void): Unsubscribe;
}
