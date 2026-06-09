mod calendar;
mod local_notifications;

use calendar::{
    calendar_add_event, calendar_list_events, calendar_request_access, reminders_add,
    reminders_list, reminders_request_access,
};
use local_notifications::{cancel_local_notification, schedule_local_notification};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Serve the bundled frontend over http://localhost:<port> instead of the
    // default `tauri://localhost` custom protocol. Clerk (and OAuth redirects +
    // Turnstile captcha) only trust http(s) origins; the custom scheme makes the
    // dev instance reject sign-in. Matches the window `url` in tauri.conf.json.
    const LOCALHOST_PORT: u16 = 9527;
    tauri::Builder::default()
        .plugin(tauri_plugin_localhost::Builder::new(LOCALHOST_PORT).build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            schedule_local_notification,
            cancel_local_notification,
            calendar_request_access,
            calendar_add_event,
            calendar_list_events,
            reminders_request_access,
            reminders_add,
            reminders_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
