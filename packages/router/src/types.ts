export type ReminderStatus = 'scheduled' | 'fired' | 'cancelled' | 'dismissed';

export interface Reminder {
  id: string;
  module: string;
  action: string;
  datetime: number;
  body: string;
  status: ReminderStatus;
}
