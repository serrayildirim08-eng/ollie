//! App Group shared container (A4 / A7).
//!
//! Writes a JSON snapshot into the App Group container so a future WidgetKit
//! extension / App Intents (Siri) can read today's state WITHOUT launching the
//! main app. The container is shared between the app and its extensions by the
//! `com.apple.security.application-groups` entitlement (Entitlements.plist).
//!
//! macOS (Developer ID) prefixes the group id with the Team ID.

/// App Group id. macOS form (Team-ID-prefixed). iOS uses the bare
/// `group.app.ollie.ollie` — adjust when the iOS widget target lands.
pub const GROUP_ID: &str = "LA5J9BSPKL.group.app.ollie.ollie";
/// File the widget/Siri reads.
pub const SNAPSHOT_FILE: &str = "snapshot.json";

/// Wire an event listener so the webview (a "remote" localhost origin that the
/// ACL blocks from invoking app commands) can write the snapshot by emitting
/// `ollie-write-snapshot` with a JSON string payload. Also writes a boot probe
/// so A4 can be verified from the shell.
pub fn install(app: tauri::AppHandle) {
    use tauri::Listener;

    app.listen("ollie-write-snapshot", |event| {
        // payload is a JSON string (the snapshot itself, already serialised).
        if let Ok(json) = serde_json::from_str::<String>(event.payload()) {
            let _ = imp::write_snapshot(&json);
        } else {
            // Or the raw payload is the JSON object directly.
            let _ = imp::write_snapshot(event.payload());
        }
    });

    // A4 boot probe — proves the container is reachable + writable.
    let _ = imp::write_named(
        "a4_probe.json",
        &format!("{{\"probe\":true,\"group\":\"{GROUP_ID}\"}}"),
    );
}

/// Return the App Group container path (for diagnostics / tests).
pub fn container_path() -> Option<String> {
    imp::container_path()
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod imp {
    use objc2_foundation::{NSFileManager, NSString};

    use super::{GROUP_ID, SNAPSHOT_FILE};

    pub fn container_path() -> Option<String> {
        let fm = unsafe { NSFileManager::defaultManager() };
        let gid = NSString::from_str(GROUP_ID);
        let url = unsafe { fm.containerURLForSecurityApplicationGroupIdentifier(&gid) }?;
        unsafe { url.path() }.map(|p| p.to_string())
    }

    pub fn write_named(name: &str, contents: &str) -> Result<(), String> {
        let dir = container_path().ok_or_else(|| "no group container".to_string())?;
        let path = std::path::Path::new(&dir).join(name);
        std::fs::write(&path, contents).map_err(|e| e.to_string())
    }

    pub fn write_snapshot(json: &str) -> Result<(), String> {
        write_named(SNAPSHOT_FILE, json)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod imp {
    pub fn container_path() -> Option<String> {
        None
    }
    pub fn write_named(_name: &str, _contents: &str) -> Result<(), String> {
        Err("app group unsupported on this platform".into())
    }
    pub fn write_snapshot(_json: &str) -> Result<(), String> {
        Err("app group unsupported on this platform".into())
    }
}
