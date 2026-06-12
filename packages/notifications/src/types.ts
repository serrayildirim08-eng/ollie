/**
 * @ollie/notifications · public types
 */

/**
 * Constitutional rule (Decision #12 + CLAUDE.md "Notification Scope"):
 * notifications must fall into one of these three categories. Anything
 * else is banned — re-engagement, "you haven't…", streak guilt, etc.
 * have no category to live in by design.
 */
export type NotificationCategory =
  | 'REMINDER'         // functional deadline · bill due, vet med, appt tomorrow
  | 'PATTERN_ALERT'    // detected pattern surfaced quietly (Canva sub, savings digest)
  | 'CONTENT_DELIVERY'; // user-requested content delivery (morning digest, opt-in)

export interface NotificationSpec {
  /** One-line headline. Brand voice: lowercase, factual, no shouting. */
  title: string;
  /** Optional body copy. Same voice rules. */
  body?: string;
  /** Constitutional category. Required. */
  category: NotificationCategory;
  /**
   * Stable id for dedupe + cancel. Required so the same logical event
   * doesn't fire twice (e.g. cycle:period_logged dispatched twice).
   */
  dedupe_key: string;
  /** Optional deep link the notification opens on tap. */
  action_url?: string;
  /**
   * Optional registered action-category id (A3). When set, APNs delivers it as
   * `aps.category` so the device shows the matching action buttons (the device
   * must have registered the category via registerActionTypes at boot).
   */
  notification_category?: string;
  /**
   * Optional schedule. If set, the notification fires at this ts.
   * If omitted, fires immediately. ISO date string or ms epoch.
   */
  schedule_at?: number | string;
  /**
   * Optional aggregation hint. Notifications sharing the same window
   * may be coalesced into a single digest push.
   */
  aggregation_group?: string;
  /**
   * Optional payload merged into the platform-native payload (e.g.
   * APNs custom keys). Backends may ignore.
   */
  extra?: Record<string, unknown>;
}

export interface NotificationDispatchResult {
  /** false when budget / mute / dedupe suppressed the notification. */
  delivered: boolean;
  reason?: 'dedupe' | 'muted' | 'budget' | 'scheduled' | 'aggregated' | 'no-backend';
  /** Backend-assigned id (e.g. macOS notification id, APNs apns-id). */
  platform_id?: string;
}

/** Each platform implements this; default is a console-log fallback. */
export interface NotificationBackend {
  name: 'web' | 'electron' | 'capacitor' | 'noop';
  /** Deliver immediately. Returns the platform id (if any). */
  deliver(spec: NotificationSpec): Promise<string | undefined> | string | undefined;
  /** Schedule for a future ts. Implementations may emulate via setTimeout. */
  schedule(spec: NotificationSpec, fireAt: number): Promise<string | undefined> | string | undefined;
  /** Cancel a scheduled or sticky notification by dedupe_key. */
  cancel(dedupeKey: string): void | Promise<void>;
  /** Request user permission, if applicable. Resolves to 'granted' / 'denied' / 'default'. */
  requestPermission?(): Promise<'granted' | 'denied' | 'default'>;
  /** Read current permission WITHOUT prompting. Resolves to 'granted' / 'denied' / 'default'. */
  checkPermission?(): Promise<'granted' | 'denied' | 'default'>;
}

export interface NotificationLogEntry {
  ts: number;
  dedupe_key: string;
  category: NotificationCategory;
  title: string;
  delivered: boolean;
  reason?: NotificationDispatchResult['reason'];
  aggregation_group?: string;
}

export interface NotificationBudget {
  /** Daily cap (calendar-day, local). Default 4. */
  daily_cap: number;
  /** Per-category mute toggles. */
  muted_categories: NotificationCategory[];
  /** Aggregation window in ms. Default 30 min. */
  aggregation_window_ms: number;
}
