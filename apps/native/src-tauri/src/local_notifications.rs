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
    category_id: Option<String>,
    extra_json: Option<String>,
) -> Result<(), String> {
    imp::schedule(id, title, body, fire_at_ms, category_id, extra_json)
}

/// Cancel a previously scheduled local notification by its identifier.
#[tauri::command]
pub fn cancel_local_notification(id: String) -> Result<(), String> {
    imp::cancel(id)
}

/// Register the notification action categories + install the delegate that
/// forwards button taps to JS. Called once at startup (A3). On non-Apple
/// platforms / unbundled dev it is a no-op.
///
/// Also wires an EVENT-based scheduling channel: the app is served over
/// http://localhost (for Clerk), so the webview is a "remote" origin and the
/// ACL blocks direct `invoke()` of our app commands. Events are NOT blocked
/// (core:event:default), so JS emits `ollie-schedule-notif` / `ollie-cancel-notif`
/// and we schedule here. This is what actually makes app-closed reminders fire.
pub fn install_notification_actions(app: tauri::AppHandle) {
    use tauri::Listener;

    #[derive(serde::Deserialize)]
    struct SchedulePayload {
        id: String,
        title: String,
        body: Option<String>,
        fire_at_ms: f64,
        category_id: Option<String>,
        extra_json: Option<String>,
    }

    app.listen("ollie-schedule-notif", |event| {
        if let Ok(p) = serde_json::from_str::<SchedulePayload>(event.payload()) {
            let _ = imp::schedule(p.id, p.title, p.body, p.fire_at_ms, p.category_id, p.extra_json);
        }
    });
    app.listen("ollie-cancel-notif", |event| {
        if let Ok(id) = serde_json::from_str::<String>(event.payload()) {
            let _ = imp::cancel(id);
        }
    });

    imp::install_actions(app);
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod imp {
    use std::sync::OnceLock;
    use std::time::{SystemTime, UNIX_EPOCH};

    use block2::DynBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, AllocAnyThread};
    use objc2_foundation::{
        NSArray, NSBundle, NSDictionary, NSSet, NSString,
    };
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationAction,
        UNNotificationActionOptions, UNNotificationCategory, UNNotificationCategoryOptions,
        UNNotificationRequest, UNNotificationResponse, UNNotificationSound,
        UNTimeIntervalNotificationTrigger, UNUserNotificationCenter,
        UNUserNotificationCenterDelegate,
    };
    use block2::RcBlock;
    use objc2_foundation::NSError;
    use tauri::{AppHandle, Emitter};

    pub const REMINDER_CATEGORY: &str = "OLLIE_REMINDER";
    pub const ACTION_COMPLETE: &str = "complete";
    pub const ACTION_SNOOZE: &str = "snooze";
    /// Tauri event the JS side listens on for native button taps.
    pub const ACTION_EVENT: &str = "ollie-notif-action";
    /// userInfo key under which we stash the JSON extra ({module, refId}).
    const USERINFO_KEY: &str = "ollie_extra";

    /// AppHandle so the delegate (an Obj-C object) can emit into the webview.
    static APP: OnceLock<AppHandle> = OnceLock::new();
    /// Keep the delegate retained for the app's lifetime.
    static DELEGATE: OnceLock<Retained<OllieNotifDelegate>> = OnceLock::new();

    fn now_ms() -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }

    /// `UNUserNotificationCenter::currentNotificationCenter()` throws an
    /// `NSException` ("bundleProxyForCurrentProcess is nil") and HARD-CRASHES the
    /// whole process when the binary is not a real `.app` bundle. That is exactly
    /// the case under `tauri dev`: `cargo run` produces a bare
    /// `target/debug/native` with no `Info.plist` and no bundle identifier. A
    /// packaged build always has one. So we gate every center access on the
    /// presence of a bundle identifier and no-op (rather than crash) when absent —
    /// the dev app stays alive; reminders simply aren't registered in dev.
    fn is_app_bundled() -> bool {
        NSBundle::mainBundle().bundleIdentifier().is_some()
    }

    pub fn schedule(
        id: String,
        title: String,
        body: Option<String>,
        fire_at_ms: f64,
        category_id: Option<String>,
        extra_json: Option<String>,
    ) -> Result<(), String> {
        // Unbundled dev binary → currentNotificationCenter() would crash. Skip.
        if !is_app_bundled() {
            eprintln!(
                "[local-notifications] not app-bundled (dev mode) — skipping schedule of '{id}'"
            );
            return Ok(());
        }

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

        // A3: attach the action category so the OS shows our buttons, and stash
        // the extra JSON in userInfo so the delegate can route the tap.
        if let Some(cat) = category_id {
            content.setCategoryIdentifier(&NSString::from_str(&cat));
        }
        if let Some(extra) = extra_json {
            let key = NSString::from_str(USERINFO_KEY);
            let val = NSString::from_str(&extra);
            let dict = NSDictionary::from_retained_objects(&[&*key], &[val]);
            // NSDictionary's generics are phantom (ZST) — the underlying object is
            // the same class, so a pointer cast to the API's expected
            // <AnyObject, AnyObject> instantiation is sound.
            let user_info: &NSDictionary<AnyObject, AnyObject> = unsafe {
                &*(&*dict as *const NSDictionary<NSString, NSString>
                    as *const NSDictionary<AnyObject, AnyObject>)
            };
            unsafe { content.setUserInfo(user_info) };
        }

        let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(delay, false);

        let identifier = NSString::from_str(&id);
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            // UNMutableNotificationContent is a subclass of UNNotificationContent.
            &content,
            Some(&trigger),
        );

        // Fire-and-forget add. A completion handler is required by the API shape
        // but we have nothing to do on success; errors are logged by the OS.
        let handler = RcBlock::new(move |_err: *mut NSError| {});
        center.addNotificationRequest_withCompletionHandler(&request, Some(&handler));

        Ok(())
    }

    pub fn cancel(id: String) -> Result<(), String> {
        // Same unbundled-dev guard as schedule — avoid the crashing center access.
        if !is_app_bundled() {
            return Ok(());
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let identifier = NSString::from_str(&id);
        let identifiers = NSArray::from_retained_slice(&[identifier]);
        center.removePendingNotificationRequestsWithIdentifiers(&identifiers);
        Ok(())
    }

    // ── A3: native action buttons (category + delegate) ──────────────────────

    define_class!(
        // A minimal NSObject that conforms to UNUserNotificationCenterDelegate so
        // we receive button taps even when the app was backgrounded / quit.
        #[unsafe(super(NSObject))]
        #[name = "OllieNotifDelegate"]
        struct OllieNotifDelegate;

        unsafe impl NSObjectProtocol for OllieNotifDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for OllieNotifDelegate {
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive_response(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion: &DynBlock<dyn Fn()>,
            ) {
                let action_id = unsafe { response.actionIdentifier() }.to_string();
                // Pull our JSON extra back out of userInfo.
                let extra = {
                    let content = unsafe { response.notification().request().content() };
                    let info = unsafe { content.userInfo() };
                    let key = NSString::from_str(USERINFO_KEY);
                    unsafe { info.objectForKey(&key) }
                        .and_then(|obj| obj.downcast::<NSString>().ok())
                        .map(|s| s.to_string())
                        .unwrap_or_default()
                };
                if let Some(app) = APP.get() {
                    let _ = app.emit(
                        ACTION_EVENT,
                        serde_json::json!({ "actionId": action_id, "extra": extra }),
                    );
                }
                // Must always call the completion handler.
                completion.call(());
            }
        }
    );

    fn make_category() -> Retained<UNNotificationCategory> {
        let empty = UNNotificationActionOptions::empty();
        let complete = unsafe {
            UNNotificationAction::actionWithIdentifier_title_options(
                &NSString::from_str(ACTION_COMPLETE),
                &NSString::from_str("Got it ✓"),
                empty,
            )
        };
        let snooze = unsafe {
            UNNotificationAction::actionWithIdentifier_title_options(
                &NSString::from_str(ACTION_SNOOZE),
                &NSString::from_str("Snooze 1h"),
                empty,
            )
        };
        let actions = NSArray::from_retained_slice(&[complete, snooze]);
        let none = NSArray::from_retained_slice(&[]);
        unsafe {
            UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                &NSString::from_str(REMINDER_CATEGORY),
                &actions,
                &none,
                UNNotificationCategoryOptions::empty(),
            )
        }
    }

    pub fn install_actions(app: AppHandle) {
        if !is_app_bundled() {
            return;
        }
        let _ = APP.set(app);
        let center = UNUserNotificationCenter::currentNotificationCenter();
        // Our UNUserNotificationCenter path needs its OWN authorization — the
        // Tauri plugin's permission grant may not cover it. Request alert + sound.
        let auth = UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge;
        let auth_handler = RcBlock::new(move |_granted: objc2::runtime::Bool, _err: *mut NSError| {});
        unsafe {
            center.requestAuthorizationWithOptions_completionHandler(auth, &auth_handler)
        };
        // Register the category (buttons).
        let category = make_category();
        let set = NSSet::from_retained_slice(&[category]);
        unsafe { center.setNotificationCategories(&set) };
        // Install the delegate (receives taps). Retain it for the app lifetime.
        let delegate: Retained<OllieNotifDelegate> =
            unsafe { msg_send![OllieNotifDelegate::alloc(), init] };
        let proto = objc2::runtime::ProtocolObject::from_ref(&*delegate);
        unsafe { center.setDelegate(Some(proto)) };
        let _ = DELEGATE.set(delegate);
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod imp {
    pub fn schedule(
        _id: String,
        _title: String,
        _body: Option<String>,
        _fire_at_ms: f64,
        _category_id: Option<String>,
        _extra_json: Option<String>,
    ) -> Result<(), String> {
        Err("local notifications unsupported on this platform".into())
    }

    pub fn cancel(_id: String) -> Result<(), String> {
        Err("local notifications unsupported on this platform".into())
    }

    pub fn install_actions(_app: tauri::AppHandle) {}
}
