//! macOS / iOS Calendar (EventKit) integration via Apple's EKEventStore.
//!
//! Two-way bridge for the upcoming "Schedule" feature: read events out of and
//! write events into the system Calendar. Mirrors `local_notifications.rs`:
//! the same `cfg(any(macos, ios))` module split, the same `is_app_bundled()`
//! guard (EventKit prompts and store access can crash / hang an unbundled dev
//! binary that has no `Info.plist` usage description), the same fire-and-forget,
//! never-panic posture. Every objc2 message send holds a valid `Retained` ref
//! for the duration of the call.
//!
//! The same EventKit API surface exists on macOS 10.14+ and iOS, so one
//! `cfg(any(macos, ios))` implementation covers both. On macOS 14+ /
//! iOS 17+ access is requested via `requestFullAccessToEventsWithCompletion`;
//! older OSes fall back to the deprecated `requestAccessToEntityType:completion:`.

/// Request Calendar access from the OS. Returns `Ok(true)` if the user granted
/// full event access, `Ok(false)` if denied (or if we're an unbundled dev
/// binary with no usage description, where prompting is unsafe).
#[tauri::command]
pub async fn calendar_request_access() -> Result<bool, String> {
    imp::request_access()
}

/// Create an event on the default calendar and return its persistent
/// `eventIdentifier`. `start_ms` / `end_ms` are epoch milliseconds.
///
/// `alarm_offset_min`, when present, attaches a single relative alert that fires
/// that many minutes BEFORE the event start (e.g. `30.0` → 30 minutes before).
/// `None` means no alarm. Backward compatible: existing callers that omit it get
/// the previous no-alarm behaviour.
#[tauri::command]
pub async fn calendar_add_event(
    title: String,
    start_ms: f64,
    end_ms: f64,
    notes: Option<String>,
    alarm_offset_min: Option<f64>,
) -> Result<String, String> {
    imp::add_event(title, start_ms, end_ms, notes, alarm_offset_min)
}

/// List events overlapping `[start_ms, end_ms)` across all calendars, returned
/// as a JSON array string of `{ id, title, start_ms, end_ms, notes }`.
#[tauri::command]
pub async fn calendar_list_events(start_ms: f64, end_ms: f64) -> Result<String, String> {
    imp::list_events(start_ms, end_ms)
}

/// Request Apple Reminders access from the OS. Returns `Ok(true)` if the user
/// granted full reminders access, `Ok(false)` otherwise (or in unbundled dev).
#[tauri::command]
pub async fn reminders_request_access() -> Result<bool, String> {
    imp::reminders_request_access()
}

/// Create a reminder on the default reminders list and return its
/// `calendarItemIdentifier`. `due_ms` (epoch ms) is optional; when present it
/// sets the reminder's due date and, if `alarm_offset_min` is also given, an
/// absolute alarm that fires that many minutes BEFORE the due time.
#[tauri::command]
pub async fn reminders_add(
    title: String,
    due_ms: Option<f64>,
    notes: Option<String>,
    alarm_offset_min: Option<f64>,
) -> Result<String, String> {
    imp::reminders_add(title, due_ms, notes, alarm_offset_min)
}

/// List incomplete reminders (and, when `include_completed`, completed ones too)
/// across all reminders lists, as a JSON array string of
/// `{ id, title, due_ms, completed, notes }`.
#[tauri::command]
pub async fn reminders_list(include_completed: bool) -> Result<String, String> {
    imp::reminders_list(include_completed)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod imp {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool};
    use objc2_event_kit::{EKAlarm, EKEvent, EKEventStore, EKReminder, EKSpan};
    use objc2_foundation::{
        NSArray, NSBundle, NSCalendar, NSCalendarUnit, NSDate, NSError, NSString,
    };
    use serde::Serialize;

    #[derive(Serialize)]
    struct EventOut {
        id: String,
        title: String,
        start_ms: f64,
        end_ms: f64,
        notes: Option<String>,
    }

    #[derive(Serialize)]
    struct ReminderOut {
        id: String,
        title: String,
        due_ms: Option<f64>,
        completed: bool,
        notes: Option<String>,
    }

    /// Same rationale as `local_notifications::is_app_bundled`: under `tauri dev`
    /// the binary is a bare `target/debug/native` with no `Info.plist` and no
    /// bundle identifier. EventKit requires the `NSCalendarsUsageDescription`
    /// key to prompt; without a bundle the prompt would fail / abort. Gate every
    /// store access on a present bundle identifier and no-op (never crash) when
    /// absent — the dev app stays alive; calendar access simply isn't available.
    fn is_app_bundled() -> bool {
        NSBundle::mainBundle().bundleIdentifier().is_some()
    }

    /// `[[EKEventStore alloc] init]`. EKEventStore is safe to construct on any
    /// thread; we keep the `Retained` alive for the whole call.
    fn new_store() -> Retained<EKEventStore> {
        // SAFETY: standard construction of a framework class.
        unsafe { EKEventStore::new() }
    }

    /// epoch milliseconds → `NSDate` (EventKit dates are seconds since 1970).
    fn ns_date(ms: f64) -> Retained<NSDate> {
        NSDate::dateWithTimeIntervalSince1970(ms / 1000.0)
    }

    /// `NSDate.timeIntervalSince1970` is seconds → epoch milliseconds.
    fn date_to_ms(date: &NSDate) -> f64 {
        date.timeIntervalSince1970() * 1000.0
    }

    pub fn request_access() -> Result<bool, String> {
        if !is_app_bundled() {
            eprintln!("[calendar] not app-bundled (dev mode) — skipping access request");
            return Ok(false);
        }

        let store = new_store();

        // The EventKit access request is asynchronous: it invokes a completion
        // block off the calling thread. We bridge it back to this synchronous
        // command via a one-shot channel and block briefly for the callback.
        // The block must outlive the call, so we hold the `RcBlock` until after
        // we've received (or timed out waiting for) the result.
        let (tx, rx) = mpsc::channel::<bool>();
        let handler = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            // Ignore send errors: if the receiver timed out and dropped, there
            // is nothing to deliver to.
            let _ = tx.send(granted.as_bool());
        });

        // macOS 14+ / iOS 17+ full-access request. (Ollie targets modern Apple
        // OSes; on older systems this selector would be unrecognized — if we ever
        // lower the deployment target, gate this behind a `respondsToSelector:`
        // check and fall back to the deprecated `requestAccessToEntityType:`.)
        // SAFETY: `handler` is a valid block pointer held alive past this call;
        // the completion handler param type is `*mut DynBlock<...>`.
        unsafe {
            store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&handler));
        }

        // Block for the OS callback. A generous timeout keeps the command from
        // hanging forever if the user never answers a prompt that is somehow
        // suppressed; in practice the system returns the remembered decision
        // immediately after the first grant.
        match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(granted) => Ok(granted),
            Err(_) => Ok(false),
        }
    }

    pub fn add_event(
        title: String,
        start_ms: f64,
        end_ms: f64,
        notes: Option<String>,
        alarm_offset_min: Option<f64>,
    ) -> Result<String, String> {
        if !is_app_bundled() {
            return Err("calendar unavailable in dev (unbundled binary)".into());
        }

        let store = new_store();

        // SAFETY: all sends below operate on live `Retained` objects held in
        // scope; EKEvent is created from the same store it is saved into.
        unsafe {
            let event = EKEvent::eventWithEventStore(&store);
            event.setTitle(Some(&NSString::from_str(&title)));
            event.setStartDate(Some(&ns_date(start_ms)));
            event.setEndDate(Some(&ns_date(end_ms)));
            if let Some(notes) = notes {
                event.setNotes(Some(&NSString::from_str(&notes)));
            }

            // Optional relative alert: NSTimeInterval is seconds, and a negative
            // offset fires BEFORE the start date — so 30 min before = -1800s.
            // `EKAlarm::alarmWithRelativeOffset` returns a retained alarm we keep
            // alive through `addAlarm`, which retains it on the event itself.
            if let Some(min) = alarm_offset_min {
                let alarm = EKAlarm::alarmWithRelativeOffset(-(min * 60.0));
                event.addAlarm(&alarm);
            }

            let calendar = store
                .defaultCalendarForNewEvents()
                .ok_or_else(|| "no default calendar for new events".to_string())?;
            event.setCalendar(Some(&calendar));

            store
                .saveEvent_span_error(&event, EKSpan::ThisEvent)
                .map_err(|e| format!("saveEvent failed: {e:?}"))?;

            match event.eventIdentifier() {
                Some(id) => Ok(id.to_string()),
                None => Err("event saved but has no identifier".into()),
            }
        }
    }

    pub fn list_events(start_ms: f64, end_ms: f64) -> Result<String, String> {
        if !is_app_bundled() {
            return Err("calendar unavailable in dev (unbundled binary)".into());
        }

        let store = new_store();

        // SAFETY: predicate, NSArray, and each EKEvent are live `Retained`
        // values held for the duration of the loop; getters are pure reads.
        let events: Vec<EventOut> = unsafe {
            let predicate = store.predicateForEventsWithStartDate_endDate_calendars(
                &ns_date(start_ms),
                &ns_date(end_ms),
                None, // all calendars
            );
            let matches: Retained<NSArray<EKEvent>> = store.eventsMatchingPredicate(&predicate);

            matches
                .iter()
                .map(|event| {
                    // title / startDate / endDate are non-optional on EKEvent.
                    let title = event.title().to_string();
                    let start_ms = date_to_ms(&event.startDate());
                    let end_ms = date_to_ms(&event.endDate());
                    let id = event
                        .eventIdentifier()
                        .map(|s| s.to_string())
                        .unwrap_or_default();
                    let notes = event.notes().map(|s| s.to_string());
                    EventOut {
                        id,
                        title,
                        start_ms,
                        end_ms,
                        notes,
                    }
                })
                .collect()
        };

        serde_json::to_string(&events).map_err(|e| format!("serialize events failed: {e}"))
    }

    // ───────────────────────────── Apple Reminders ──────────────────────────
    //
    // Reminders reuse the SAME EKEventStore as events, only with the reminders
    // entity (EKReminder). Access is a SEPARATE grant from calendar access, so
    // `reminders_request_access` calls `requestFullAccessToReminders…` even after
    // calendar access was granted.

    /// Calendar-unit mask we extract from a due date. EKReminder stores its due
    /// time as `NSDateComponents`, not an absolute `NSDate`, so we decompose the
    /// instant into year/month/day/hour/minute against the current calendar.
    fn due_unit_flags() -> NSCalendarUnit {
        NSCalendarUnit::Year
            | NSCalendarUnit::Month
            | NSCalendarUnit::Day
            | NSCalendarUnit::Hour
            | NSCalendarUnit::Minute
    }

    pub fn reminders_request_access() -> Result<bool, String> {
        if !is_app_bundled() {
            eprintln!("[reminders] not app-bundled (dev mode) — skipping access request");
            return Ok(false);
        }

        let store = new_store();

        // Same one-shot mpsc bridge as `request_access`: the completion block
        // fires off-thread; hold the `RcBlock` alive until we've received (or
        // timed out waiting for) the granted flag.
        let (tx, rx) = mpsc::channel::<bool>();
        let handler = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });

        // macOS 14+ / iOS 17+ full reminders access. (Same modern-OS assumption
        // as events; gate behind `respondsToSelector:` if the target lowers.)
        // SAFETY: `handler` is a valid block pointer held alive past this call.
        unsafe {
            store.requestFullAccessToRemindersWithCompletion(RcBlock::as_ptr(&handler));
        }

        match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(granted) => Ok(granted),
            Err(_) => Ok(false),
        }
    }

    pub fn reminders_add(
        title: String,
        due_ms: Option<f64>,
        notes: Option<String>,
        alarm_offset_min: Option<f64>,
    ) -> Result<String, String> {
        if !is_app_bundled() {
            return Err("reminders unavailable in dev (unbundled binary)".into());
        }

        let store = new_store();

        // SAFETY: reminder is created from and saved into the same store; every
        // objc2 object touched below is a live `Retained` held in scope.
        unsafe {
            let reminder = EKReminder::reminderWithEventStore(&store);
            reminder.setTitle(Some(&NSString::from_str(&title)));
            if let Some(notes) = notes {
                reminder.setNotes(Some(&NSString::from_str(&notes)));
            }

            let calendar = store
                .defaultCalendarForNewReminders()
                .ok_or_else(|| "no default calendar for new reminders".to_string())?;
            reminder.setCalendar(Some(&calendar));

            if let Some(due_ms) = due_ms {
                let due_date = ns_date(due_ms);
                // Decompose the absolute due instant into date components, which
                // is the only form EKReminder accepts for a due date.
                let comps = NSCalendar::currentCalendar()
                    .components_fromDate(due_unit_flags(), &due_date);
                reminder.setDueDateComponents(Some(&comps));

                // Optional alarm: an ABSOLUTE alarm at (due − offset). Absolute is
                // the right choice for reminders because a relative offset on a
                // reminder is anchored to its *start* date, which we don't set.
                if let Some(min) = alarm_offset_min {
                    let alarm_date = ns_date(due_ms - min * 60_000.0);
                    let alarm = EKAlarm::alarmWithAbsoluteDate(&alarm_date);
                    reminder.addAlarm(&alarm);
                }
            }

            store
                .saveReminder_commit_error(&reminder, true)
                .map_err(|e| format!("saveReminder failed: {e:?}"))?;

            // calendarItemIdentifier is non-optional on EKCalendarItem.
            Ok(reminder.calendarItemIdentifier().to_string())
        }
    }

    pub fn reminders_list(include_completed: bool) -> Result<String, String> {
        if !is_app_bundled() {
            return Err("reminders unavailable in dev (unbundled binary)".into());
        }

        let store = new_store();

        // `predicateForRemindersInCalendars(None)` matches reminders in ALL
        // calendars regardless of completion; we filter completed ones out in the
        // mapping unless the caller asked to include them.
        // SAFETY: predicate + store live through the fetch; the completion block
        // is held in an `RcBlock` until after we receive (or time out).
        let reminders: Vec<ReminderOut> = unsafe {
            let predicate = store.predicateForRemindersInCalendars(None);

            // fetchReminders… is callback-only: bridge it back with the same
            // one-shot channel + timeout pattern used for access requests.
            let (tx, rx) = mpsc::channel::<Vec<ReminderOut>>();
            let cal = NSCalendar::currentCalendar();
            let handler = RcBlock::new(move |arr: *mut NSArray<EKReminder>| {
                let mut out: Vec<ReminderOut> = Vec::new();
                if !arr.is_null() {
                    // SAFETY: EventKit hands us a valid (non-null) array here; we
                    // only read from it inside this block's lifetime.
                    let arr: &NSArray<EKReminder> = &*arr;
                    for reminder in arr.iter() {
                        let completed = reminder.isCompleted();
                        if completed && !include_completed {
                            continue;
                        }
                        let title = reminder.title().to_string();
                        let id = reminder.calendarItemIdentifier().to_string();
                        let notes = reminder.notes().map(|s| s.to_string());
                        // Due date is stored as components; reconstruct an
                        // absolute NSDate against the current calendar to report
                        // epoch ms. Missing components → no due date.
                        let due_ms = reminder
                            .dueDateComponents()
                            .and_then(|comps| cal.dateFromComponents(&comps))
                            .map(|d| date_to_ms(&d));
                        out.push(ReminderOut {
                            id,
                            title,
                            due_ms,
                            completed,
                            notes,
                        });
                    }
                }
                let _ = tx.send(out);
            });

            let _request: Retained<AnyObject> = store
                .fetchRemindersMatchingPredicate_completion(&predicate, &handler);

            match rx.recv_timeout(Duration::from_secs(30)) {
                Ok(list) => list,
                Err(_) => Vec::new(),
            }
        };

        serde_json::to_string(&reminders).map_err(|e| format!("serialize reminders failed: {e}"))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod imp {
    pub fn request_access() -> Result<bool, String> {
        Ok(false)
    }

    pub fn add_event(
        _title: String,
        _start_ms: f64,
        _end_ms: f64,
        _notes: Option<String>,
        _alarm_offset_min: Option<f64>,
    ) -> Result<String, String> {
        Err("calendar unsupported on this platform".into())
    }

    pub fn list_events(_start_ms: f64, _end_ms: f64) -> Result<String, String> {
        Err("calendar unsupported on this platform".into())
    }

    pub fn reminders_request_access() -> Result<bool, String> {
        Ok(false)
    }

    pub fn reminders_add(
        _title: String,
        _due_ms: Option<f64>,
        _notes: Option<String>,
        _alarm_offset_min: Option<f64>,
    ) -> Result<String, String> {
        Err("reminders unsupported on this platform".into())
    }

    pub fn reminders_list(_include_completed: bool) -> Result<String, String> {
        Err("reminders unsupported on this platform".into())
    }
}
