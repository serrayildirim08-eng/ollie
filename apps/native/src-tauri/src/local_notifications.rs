//! OS-level local notifications via Apple's UNUserNotificationCenter.
//!
//! Unlike the Tauri notification plugin (whose `Schedule.at` fires immediately on
//! desktop because scheduling is unimplemented there), these notifications are
//! registered with the operating system through a `UNTimeIntervalNotificationTrigger`.
//! The OS holds the request and delivers it at the scheduled wall-clock time even
//! after the app has been quit. No APNs, no push entitlement, no server — purely
//! local notifications.
//!
//! The same `UNUserNotificationCenter` API exists on macOS 10.14+ and iOS, so a
//! single `cfg(any(macos, ios))` implementation covers both platforms.

/// Schedule an OS-level local notification that fires at a future wall-clock time
/// and survives the app being quit.
///
/// `fire_at_ms` is the absolute fire time in epoch milliseconds. The delay is
/// computed as `max(1.0, (fire_at_ms - now_ms) / 1000.0)` seconds. The `id` is
/// used as the notification request identifier so it can be cancelled or deduped.
#[tauri::command]
pub fn schedule_local_notification(
    id: String,
    title: String,
    body: Option<String>,
    fire_at_ms: f64,
) -> Result<(), String> {
    imp::schedule(id, title, body, fire_at_ms)
}

/// Cancel a previously scheduled local notification by its identifier.
#[tauri::command]
pub fn cancel_local_notification(id: String) -> Result<(), String> {
    imp::cancel(id)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod imp {
    use std::time::{SystemTime, UNIX_EPOCH};

    use objc2_foundation::{NSArray, NSString};
    use objc2_user_notifications::{
        UNMutableNotificationContent, UNNotificationRequest, UNNotificationSound,
        UNTimeIntervalNotificationTrigger, UNUserNotificationCenter,
    };

    fn now_ms() -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }

    pub fn schedule(
        id: String,
        title: String,
        body: Option<String>,
        fire_at_ms: f64,
    ) -> Result<(), String> {
        // Delay in seconds; the OS requires a strictly positive time interval,
        // so clamp to at least 1 second.
        let delay = ((fire_at_ms - now_ms()) / 1000.0).max(1.0);

        // UNUserNotificationCenter is documented to be usable from any thread, and
        // these objc2 message sends are sound as long as we hold valid `Retained`
        // references for the duration of the calls (which we do below).
        let center = UNUserNotificationCenter::currentNotificationCenter();

        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&title));
        if let Some(body) = body {
            content.setBody(&NSString::from_str(&body));
        }
        content.setSound(Some(&UNNotificationSound::defaultSound()));

        let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(delay, false);

        let identifier = NSString::from_str(&id);
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            // UNMutableNotificationContent is a subclass of UNNotificationContent.
            &content,
            Some(&trigger),
        );

        // Fire-and-forget add; we pass no completion handler. If the OS rejects the
        // request it logs internally — there is no synchronous error to surface here.
        center.addNotificationRequest_withCompletionHandler(&request, None);

        Ok(())
    }

    pub fn cancel(id: String) -> Result<(), String> {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let identifier = NSString::from_str(&id);
        let identifiers = NSArray::from_retained_slice(&[identifier]);
        center.removePendingNotificationRequestsWithIdentifiers(&identifiers);
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod imp {
    pub fn schedule(
        _id: String,
        _title: String,
        _body: Option<String>,
        _fire_at_ms: f64,
    ) -> Result<(), String> {
        Err("local notifications unsupported on this platform".into())
    }

    pub fn cancel(_id: String) -> Result<(), String> {
        Err("local notifications unsupported on this platform".into())
    }
}
