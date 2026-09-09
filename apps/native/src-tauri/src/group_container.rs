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

/// Expected shape of the snapshot the webview writes — mirrors `OllieSnapshot`
/// in apps/native/src/snapshot/writeSnapshot.ts. Used only to validate incoming
/// payloads before persisting; unknown extra fields are tolerated, the four
/// required keys are not. We deserialize-to-validate and re-write the original
/// (already valid) JSON string rather than re-serialising.
#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct SnapshotPick {
    text: String,
    #[serde(rename = "hasAction")]
    has_action: bool,
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct OllieSnapshot {
    #[serde(rename = "generatedAt")]
    generated_at: f64,
    #[serde(rename = "quietState")]
    quiet_state: bool,
    picks: Vec<SnapshotPick>,
    // `answers` is an open bag of optional sub-objects; we only require it to be
    // a JSON object, not any particular inner shape, so the canned-ASK answers
    // can evolve without breaking snapshot validation.
    answers: serde_json::Map<String, serde_json::Value>,
}

/// Wire an event listener so the webview (a "remote" localhost origin that the
/// ACL blocks from invoking app commands) can write the snapshot by emitting
/// `ollie-write-snapshot` with a JSON string payload. Also writes a boot probe
/// so A4 can be verified from the shell.
/// Largest snapshot we'll ever persist. The real snapshot is a handful of short
/// strings + small numbers (a few KB at most); anything past this is malformed
/// or hostile and is rejected rather than written to the shared container.
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024;

pub fn install(app: tauri::AppHandle) {
    use tauri::Listener;

    app.listen("ollie-write-snapshot", |event| {
        // The webview emits `emit('ollie-write-snapshot', JSON.stringify(snapshot))`,
        // so the Tauri event payload is a JSON *string literal* whose contents are
        // the serialised snapshot. Accept that form first, then fall back to a raw
        // JSON object payload. In BOTH cases we validate the inner JSON against the
        // expected OllieSnapshot shape and enforce a size cap before touching disk —
        // never persist arbitrary/oversized bytes into the shared App Group container.
        let inner: String = match serde_json::from_str::<String>(event.payload()) {
            Ok(s) => s,                              // payload was a JSON string literal
            Err(_) => event.payload().to_string(),   // payload was the JSON object directly
        };

        if inner.len() > MAX_SNAPSHOT_BYTES {
            eprintln!(
                "[group_container] rejecting snapshot: {} bytes exceeds {} byte cap",
                inner.len(),
                MAX_SNAPSHOT_BYTES
            );
            return;
        }

        match serde_json::from_str::<OllieSnapshot>(&inner) {
            Ok(_) => {
                let _ = imp::write_snapshot(&inner);
            }
            Err(e) => {
                eprintln!("[group_container] rejecting snapshot: invalid shape: {e}");
            }
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
