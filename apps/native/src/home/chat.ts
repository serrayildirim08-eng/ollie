/**
 * chat — the home conversation log, kept on device.
 *
 * Only what the user typed and what Ollie answered. Capped so the local store
 * never grows without bound; the plan above the chat is the source of truth
 * for what's still to do, this is just the running conversation.
 */

import { kv } from '../storage';

const KEY = 'home_chat_v1';
export const MAX_MESSAGES = 40;

export interface ChatMessage {
  readonly id: string;
  readonly from: 'me' | 'ollie';
  readonly text: string;
  readonly ts: number;
  /** Ask Ollie answer card: the big number, when the answer has one. */
  readonly headline?: string | null;
  /** Ask Ollie: tappable example questions (the "can't answer yet" reply). */
  readonly examples?: readonly string[];
  /** Ask Ollie: the quiet "worked out on your phone" line — only ever on the first answer. */
  readonly note?: string;
}

const NOTE_KEY = 'ask_note_shown_v1';

/** True exactly once: the first time Ollie answers a question from the person's data. */
export async function takeFirstAnswerNote(): Promise<boolean> {
  try {
    if (await kv.get<boolean>(NOTE_KEY)) return false;
    await kv.set(NOTE_KEY, true);
    return true;
  } catch {
    return false;
  }
}

export async function loadChat(): Promise<ChatMessage[]> {
  try {
    const stored = await kv.get<ChatMessage[]>(KEY);
    return Array.isArray(stored) ? stored.slice(-MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

export function saveChat(messages: readonly ChatMessage[]): void {
  void kv.set(KEY, messages.slice(-MAX_MESSAGES)).catch((err: unknown) => {
    console.warn('[chat] save failed', err);
  });
}

let seq = 0;
export function chatId(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}`;
}

/** "Today 13:02" / "Yesterday 09:15" / "28 Sep 18:40" — shown above a turn
 *  when it starts a new day or follows a long gap. */
export function stampLabel(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day0 = (t: number) => {
    const x = new Date(t);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  };
  const diff = Math.round((day0(now) - day0(ts)) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${time}`;
}

/** Show a stamp before `msg` when it's the first, or 30+ min after the last. */
export function needsStamp(prev: ChatMessage | undefined, msg: ChatMessage): boolean {
  return prev === undefined || msg.ts - prev.ts > 30 * 60_000;
}
