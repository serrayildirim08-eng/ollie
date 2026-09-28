/**
 * HomeScreen — the reminder-first shell (design v2, 2026-09-28).
 *
 *   day (light phone)  "Paper": big serif date, small status dot
 *   night (dark phone) "Night orb": big glowing green orb, centered
 *
 *   status line   the dot tells the truth: "Ollie is here" idle, "Thinking…"
 *                 while a message is being handled. ("I'm listening" lives only
 *                 on the mic's full-screen overlay, when the mic is really on.)
 *   greeting      "Good afternoon, Serra. Two things left today."
 *   plan          today / this week / this month — check · task · time
 *   chat          what you said + what Ollie did, with the real reminder time
 *   composer      pill: text, mic, send
 *
 * The plan is read-only over the module repos + reminder ledger; the chat is
 * a local log. Ollie's replies are built by the harness from what actually
 * happened (copy.ts) — no LLM writes them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useUser } from '@clerk/clerk-react';
import { DumpScreen, type TurnCallbacks, type TurnDone } from '../dump/DumpScreen';
import { loadTodayTodos } from '../todo/loadTodos';
import { markComplete } from '../todo/TodoScreen';
import { loadLedger } from '../notify/reminderLedger';
import { REMINDER_SCHEDULED_EVENT, type ReminderScheduledDetail } from '../notify/taskReminder';
import { buildUpcoming, whenLabel, type Horizon, type HorizonId, type UpcomingItem } from './upcoming';
import { EXAMPLES, INTRO, buildReply, greeting, hello, whenPhrase } from './copy';
import { chatId, loadChat, needsStamp, saveChat, stampLabel, type ChatMessage } from './chat';
import styles from './HomeScreen.module.css';

const POLL_MS = 6000;
const DONE_LINGER_MS = 700;

const HORIZON_LABEL: Record<HorizonId, string> = {
  today: 'Today',
  thisWeek: 'This week',
  thisMonth: 'This month',
  anytime: 'Anytime',
};

function formatDate(d: Date): { weekday: string; date: string } {
  return {
    weekday: d.toLocaleDateString('en-GB', { weekday: 'long' }),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }),
  };
}

// ─── plan rows ────────────────────────────────────────────────────────────

function PlanRow({
  item,
  horizon,
  done,
  onDone,
}: {
  item: UpcomingItem;
  horizon: HorizonId;
  done: boolean;
  onDone: (item: UpcomingItem) => void;
}): JSX.Element {
  const checkable = item.todo.kind === 'task';
  const when = whenLabel(item, horizon);
  return (
    <li className={`${styles.row} ${done ? styles.rowDone : ''}`}>
      {checkable ? (
        <button
          type="button"
          className={styles.check}
          aria-label={`mark done: ${item.text}`}
          aria-pressed={done}
          disabled={done}
          onClick={() => onDone(item)}
        >
          {done && '✓'}
        </button>
      ) : (
        <span className={styles.checkGhost} aria-hidden />
      )}
      <span className={styles.what}>{item.text}</span>
      {when && (
        <span className={`${styles.when} ${item.hasTime ? styles.whenTimed : ''} ${when === 'overdue' ? styles.overdue : ''}`}>
          {when}
        </span>
      )}
    </li>
  );
}

// ─── screen ───────────────────────────────────────────────────────────────

export function HomeScreen(): JSX.Element {
  const { user } = useUser();
  const [horizons, setHorizons] = useState<Horizon[] | null>(null);
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [seed, setSeed] = useState<{ text: string; nonce: number }>({ text: '', nonce: 0 });
  const chatLoaded = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reminders the harness armed during the current turn (null = no turn open).
  const turnReminders = useRef<number[] | null>(null);

  // ── plan ──
  const refresh = useCallback(async () => {
    try {
      const [todos, ledger] = await Promise.all([loadTodayTodos(), loadLedger()]);
      setHorizons(buildUpcoming(todos, ledger));
    } catch (err) {
      console.warn('[home] load failed', err);
      setHorizons((prev) => prev ?? []);
    }
    setNow(new Date());
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    const onFocus = (): void => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  const onDone = useCallback(
    (item: UpcomingItem) => {
      // Tick + strike through first, then fold the row away.
      setDoneIds((s) => new Set(s).add(item.id));
      setTimeout(() => setHiddenIds((s) => new Set(s).add(item.id)), DONE_LINGER_MS);
      void markComplete(item.todo)
        .catch((err) => {
          console.warn('[home] complete failed', err);
          const drop = (s: ReadonlySet<string>) => {
            const n = new Set(s);
            n.delete(item.id);
            return n;
          };
          setDoneIds(drop);
          setHiddenIds(drop);
        })
        .finally(() => void refresh());
    },
    [refresh],
  );

  // ── chat ──
  useEffect(() => {
    void loadChat().then((stored) => {
      chatLoaded.current = true;
      setMessages((live) => [...stored, ...live]);
    });
  }, []);

  useEffect(() => {
    if (chatLoaded.current) saveChat(messages);
    // Keep the newest message in view.
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const say = useCallback((from: ChatMessage['from'], text: string) => {
    setMessages((m) => [...m, { id: chatId(), from, text, ts: Date.now() }]);
  }, []);

  // Every reminder the harness arms: buffered into the open turn's reply, or —
  // outside a turn (e.g. a time picked on the "when?" card) — its own bubble.
  useEffect(() => {
    const onScheduled = (ev: Event): void => {
      const detail = (ev as CustomEvent<ReminderScheduledDetail>).detail;
      if (!detail) return;
      if (turnReminders.current) {
        turnReminders.current.push(detail.fireAt);
      } else {
        say('ollie', `Okay — I'll remind you ${whenPhrase(detail.fireAt, Date.now())}.`);
      }
      void refresh();
    };
    window.addEventListener(REMINDER_SCHEDULED_EVENT, onScheduled);
    return () => window.removeEventListener(REMINDER_SCHEDULED_EVENT, onScheduled);
  }, [say, refresh]);

  const turn: TurnCallbacks = {
    start: (text) => {
      turnReminders.current = [];
      say('me', text);
      setThinking(true);
    },
    done: (outcome: TurnDone) => {
      const reminders = turnReminders.current;
      if (reminders === null) return; // already closed (crisis fires twice)
      turnReminders.current = null;
      setThinking(false);
      // Crisis: the crisis banner speaks; Ollie must not chirp "saved".
      if (!outcome.crisis) {
        say('ollie', buildReply({ ...outcome, reminders }, Date.now()));
      }
      void refresh();
    },
    error: (message) => {
      turnReminders.current = null;
      setThinking(false);
      say('ollie', `I couldn't take that in — ${message}.`);
    },
  };

  // ── derived ──
  const visible = (horizons ?? [])
    .map((h) => ({ ...h, items: h.items.filter((i) => !hiddenIds.has(i.id)) }))
    .filter((h) => h.items.length > 0);
  const openToday =
    visible.find((h) => h.id === 'today')?.items.filter((i) => !doneIds.has(i.id)).length ?? 0;
  const { weekday, date } = formatDate(now);
  const status = thinking ? 'Thinking…' : 'Ollie is here';
  // First open: nothing planned and nothing said yet → Ollie introduces itself.
  const firstOpen = horizons !== null && visible.length === 0 && messages.length === 0 && !thinking;

  return (
    <div className={styles.screen}>
      <div className={styles.scroll} ref={scrollRef}>
        <header className={styles.header}>
          <Link to="/settings" className={styles.settings} aria-label="settings">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </Link>

          {/* night: the orb is the hero */}
          <div className={styles.orbWrap}>
            <span className={`${styles.orb} ${thinking ? styles.thinking : ''}`} />
          </div>

          {/* day: the date is the hero */}
          <h1 className={styles.date}>
            {weekday},<br />
            {date}
          </h1>

          <p className={styles.status} aria-live="polite">
            <span className={`${styles.dot} ${thinking ? styles.thinking : ''}`} />
            {status}
          </p>
          <p className={styles.greet}>
            {firstOpen ? hello(now, user?.firstName) : greeting(now, user?.firstName, openToday)}
          </p>
        </header>

        {firstOpen && (
          <div className={styles.intro}>
            <p className={styles.ollie}>
              <span className={styles.mini} aria-hidden />
              <span>{INTRO}</span>
            </p>
            <div className={styles.chips}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className={styles.chip}
                  onClick={() => setSeed((s) => ({ text: ex, nonce: s.nonce + 1 }))}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {visible.map((h) => (
          <section key={h.id} className={styles.section}>
            <h2 className={styles.heading}>{HORIZON_LABEL[h.id]}</h2>
            <ul className={styles.list}>
              {h.items.map((item) => (
                <PlanRow key={item.id} item={item} horizon={h.id} done={doneIds.has(item.id)} onDone={onDone} />
              ))}
            </ul>
          </section>
        ))}

        {(messages.length > 0 || thinking) && (
          <div className={styles.chat}>
            {messages.map((m, i) => (
              <div key={m.id} className={styles.turn}>
                {needsStamp(messages[i - 1], m) && <p className={styles.stamp}>{stampLabel(m.ts)}</p>}
                <p className={m.from === 'me' ? styles.me : styles.ollie}>
                  {m.from === 'ollie' && <span className={styles.mini} aria-hidden />}
                  <span>{m.text}</span>
                </p>
              </div>
            ))}
            {thinking && (
              <p className={`${styles.ollie} ${styles.typing}`} aria-label="Ollie is thinking">
                <span className={styles.mini} aria-hidden />
                <span className={styles.dots}>
                  <i />
                  <i />
                  <i />
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className={styles.composer}>
        <DumpScreen variant="dock" turn={turn} seed={seed} />
      </div>
    </div>
  );
}
