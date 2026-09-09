//! secure_db.rs — whole-database encryption (alpha blocker #3).
//!
//! Goal (Serra's locked decision, do NOT redesign):
//!   * Whole-DB encryption via SQLCipher.
//!   * The DB key is generated ONCE and stored in the OS Keychain
//!     (macOS Security.framework / iOS Keychain Services) via the `keyring`
//!     crate — never in a plaintext file.
//!   * Automatic unlock, zero user friction (no passphrase prompt).
//!
//! Why this file and not `sqlite.ts`:
//!   The JS chokepoint `Database.load('sqlite:ollie.db')` (apps/native/src/
//!   storage/sqlite.ts) flows through `tauri-plugin-sql`, whose sqlx pool opens
//!   up to 10 connections lazily and exposes NO per-connection key hook. A
//!   `PRAGMA key` run from JS would key only one pooled connection; the next
//!   unkeyed one fails ("file is not a database"). So the key MUST be applied
//!   on EVERY connection at the C layer. We do that WITHOUT forking the plugin
//!   by registering a SQLite auto-extension (`sqlite3_auto_extension`) — a hook
//!   SQLite invokes for every connection it opens process-wide — that runs the
//!   keying PRAGMAs. The key lives only in Rust and never crosses IPC to JS,
//!   which structurally avoids the prior attempt's failure (JS awaiting an
//!   unavailable secure store → unhandled rejection → silent persistence loss).
//!
//! Forcing the SQLCipher engine:
//!   `tauri-plugin-sql` pulls vanilla SQLite via sqlx → libsqlite3-sys. We add
//!   `rusqlite` + `libsqlite3-sys` with the `bundled-sqlcipher-vendored-openssl`
//!   feature; Cargo feature-unifies the single `libsqlite3-sys` build to
//!   SQLCipher, so sqlx's connections are SQLCipher too. (Verify on device with
//!   `PRAGMA cipher_version` returning non-empty.)
//!
//! NOTE: this whole file is Apple-only build-wise (keyring apple-native), and
//! cannot be verified headless here — it needs Serra's `cargo build` + on-device
//! run. See the device-test checklist in the PR description.

use std::ffi::{c_char, c_int, CString};
use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

/// Keychain coordinates. Service matches the app bundle id; one fixed account.
const KEYCHAIN_SERVICE: &str = "app.ollie.ollie";
const KEYCHAIN_ACCOUNT: &str = "db-key";

/// The SQLCipher key as the exact PRAGMA argument we run on every connection,
/// e.g. `x'<64 hex chars>'` (raw-key form → SQLCipher skips the KDF over our
/// already-high-entropy 32 random bytes). Stored once at startup; read by the
/// auto-extension callback for each new connection.
static KEY_PRAGMA_ARG: OnceLock<String> = OnceLock::new();

/// The DB filename the JS side opens via `Database.load('sqlite:ollie.db')`.
const DB_FILENAME: &str = "ollie.db";

// ── C symbols (provided by libsqlite3-sys built with SQLCipher) ─────────────
// We reach them through rusqlite's `ffi` re-export so the signatures stay in
// sync with the linked library.
use rusqlite::ffi;

/// SQLite calls this for EVERY connection opened in the process (registered via
/// `sqlite3_auto_extension`). We run the keying PRAGMAs immediately, before any
/// other statement touches the database, so every pooled sqlx connection is
/// keyed. Returning SQLITE_OK lets the open proceed.
unsafe extern "C" fn key_every_connection(
    db: *mut ffi::sqlite3,
    _pz_err_msg: *mut *mut c_char,
    _p_api: *const ffi::sqlite3_api_routines,
) -> c_int {
    let Some(arg) = KEY_PRAGMA_ARG.get() else {
        // No key available: do NOT silently open unencrypted. Return an error
        // so the connection fails loudly rather than reading/writing plaintext.
        return ffi::SQLITE_ERROR;
    };
    // PRAGMA key = "x'..'";  then cipher_compatibility for deterministic params.
    let sql = format!(
        "PRAGMA key = \"{arg}\"; PRAGMA cipher_compatibility = 4;",
        arg = arg
    );
    let Ok(c_sql) = CString::new(sql) else {
        return ffi::SQLITE_ERROR;
    };
    ffi::sqlite3_exec(
        db,
        c_sql.as_ptr(),
        None,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
    )
}

/// HARD runtime assertion that the linked SQLite is actually SQLCipher.
///
/// Why this is load-bearing (alpha blocker #3, GAP 2): vanilla SQLite treats an
/// unknown `PRAGMA key` as a NO-OP that returns OK. So if Cargo feature
/// unification ever resolves `libsqlite3-sys` to vanilla instead of SQLCipher,
/// the auto-extension's `PRAGMA key` silently succeeds and a FRESH install would
/// run entirely on PLAINTEXT while appearing to work — the migration path's
/// fail-closed check never fires because there is nothing to migrate. We close
/// that hole by asserting the *engine* itself: `PRAGMA cipher_version` returns a
/// non-empty version string ONLY on SQLCipher; on vanilla it returns no row.
/// This is a library-level capability (independent of any key or db file), so we
/// check it on a throwaway in-memory connection. Empty/absent ⇒ ABORT.
fn assert_sqlcipher_engine() -> Result<(), String> {
    let conn = rusqlite::Connection::open_in_memory()
        .map_err(|e| format!("open verify connection: {e}"))?;
    let version: rusqlite::Result<String> =
        conn.query_row("PRAGMA cipher_version", [], |r| r.get(0));
    match version {
        Ok(v) if !v.trim().is_empty() => Ok(()),
        _ => Err(
            "SQLCipher engine not active: `PRAGMA cipher_version` was empty. \
             The linked sqlite is vanilla, not SQLCipher — refusing to run on \
             plaintext (fail-closed)."
                .to_string(),
        ),
    }
}

/// Verify that a just-written encrypted DB file actually opens, keys, and reads
/// with our key — and that the engine is SQLCipher. Used before we trust the
/// migrated copy enough to swap it in and delete the plaintext backup (GAP 3).
fn verify_encrypted_readable(path: &PathBuf, key_pragma: &str) -> Result<(), String> {
    let conn =
        rusqlite::Connection::open(path).map_err(|e| format!("verify open: {e}"))?;
    conn.execute_batch(&format!(
        "PRAGMA key = \"{key}\"; PRAGMA cipher_compatibility = 4;",
        key = key_pragma,
    ))
    .map_err(|e| format!("verify key: {e}"))?;
    let cv: rusqlite::Result<String> =
        conn.query_row("PRAGMA cipher_version", [], |r| r.get(0));
    match cv {
        Ok(v) if !v.trim().is_empty() => {}
        _ => return Err("verify: cipher_version empty on migrated db".to_string()),
    }
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
        .map_err(|e| format!("verify read keyed db: {e}"))?;
    Ok(())
}

/// Best-effort secure deletion of a plaintext artifact. On copy-on-write
/// filesystems (APFS, the iOS/macOS default) overwriting in place is NOT a
/// guaranteed scrub — the FS may write the zeros to fresh extents — but it
/// removes the plaintext file and zeroes the current extents where the OS
/// allows, which is the most we can do from std without platform-specific
/// secure-erase APIs. The real protection is that the durable copy is now
/// SQLCipher-encrypted; this just stops the leftover plaintext from lingering.
fn secure_delete(path: &PathBuf) {
    use std::io::Write;
    if let Ok(meta) = std::fs::metadata(path) {
        let len = meta.len();
        if let Ok(mut f) = std::fs::OpenOptions::new().write(true).open(path) {
            let zeros = [0u8; 64 * 1024];
            let mut remaining = len;
            while remaining > 0 {
                let n = remaining.min(zeros.len() as u64) as usize;
                if f.write_all(&zeros[..n]).is_err() {
                    break;
                }
                remaining -= n as u64;
            }
            let _ = f.flush();
            let _ = f.sync_all();
        }
    }
    let _ = std::fs::remove_file(path);
}

/// Resolve the on-disk path of `ollie.db`, mirroring tauri-plugin-sql's
/// `path_mapper`: it pushes the connection-string suffix onto `app_config_dir`.
fn db_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join(DB_FILENAME))
}

/// Idempotency marker so the one-shot plaintext→encrypted migration runs at
/// most once. A simple sidecar file next to the DB (no extra plugin needed).
fn marker_path(db: &PathBuf) -> PathBuf {
    db.with_file_name(".ollie_db_encrypted")
}

/// Get-or-create the 32-byte DB key in the OS keychain, returning the
/// `x'<hex>'` PRAGMA argument. Generated once; thereafter read back. Any
/// failure is surfaced (Err) — we fail closed rather than fall back to
/// plaintext.
fn get_or_create_key_pragma() -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("keychain entry: {e}"))?;

    let key_bytes: Vec<u8> = match entry.get_password() {
        Ok(b64) => B64
            .decode(b64.as_bytes())
            .map_err(|e| format!("keychain key decode: {e}"))?,
        Err(keyring::Error::NoEntry) => {
            // First run: generate a fresh 32-byte key and persist it.
            let mut buf = [0u8; 32];
            getrandom::getrandom(&mut buf).map_err(|e| format!("getrandom: {e}"))?;
            entry
                .set_password(&B64.encode(buf))
                .map_err(|e| format!("keychain set: {e}"))?;
            buf.to_vec()
        }
        Err(e) => return Err(format!("keychain get: {e}")),
    };

    if key_bytes.len() != 32 {
        return Err(format!("unexpected key length {}", key_bytes.len()));
    }

    // Hex-encode → raw-key PRAGMA form  x'....'  (64 hex chars).
    let mut hex = String::with_capacity(64);
    for b in &key_bytes {
        hex.push_str(&format!("{b:02x}"));
    }
    Ok(format!("x'{hex}'"))
}

/// One-shot, idempotent migration of a pre-existing PLAINTEXT `ollie.db` into a
/// SQLCipher-encrypted database, preserving all data. Safe to call on every
/// boot: it no-ops when the marker exists, when there is no DB (fresh install),
/// or when the DB is already encrypted.
///
/// Strategy (the standard SQLCipher `sqlcipher_export` recipe):
///   1. Open the existing file with NO key. If `SELECT count(*) FROM
///      sqlite_master` succeeds → it is plaintext and must be migrated.
///      If it fails → already encrypted (or unreadable) → mark + skip.
///   2. ATTACH a new keyed db `ollie.enc.db`, `SELECT sqlcipher_export('enc')`
///      to copy every table/index/trigger, DETACH.
///   3. Back up the plaintext file to `ollie.db.bak`, atomically rename the
///      encrypted file over `ollie.db`, then write the marker. The `.bak` is
///      kept until the first successful keyed open (Serra deletes after device
///      verification).
///
/// IMPORTANT: this runs BEFORE the auto-extension is installed, so its own
/// rusqlite opens are NOT auto-keyed — keying here is explicit per-connection.
fn migrate_plaintext_if_needed(db: &PathBuf, key_pragma: &str) -> Result<(), String> {
    let marker = marker_path(db);
    if marker.exists() {
        return Ok(());
    }
    if !db.exists() {
        // Fresh install: nothing to migrate. The auto-extension will key the
        // brand-new DB on creation. Mark so we skip next boot.
        let _ = std::fs::write(&marker, b"fresh");
        return Ok(());
    }

    // Step 1: is it plaintext?
    let plaintext_conn = rusqlite::Connection::open(db)
        .map_err(|e| format!("open existing db: {e}"))?;
    let is_plaintext = plaintext_conn
        .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
        .is_ok();

    if !is_plaintext {
        // Already encrypted (or a non-DB file). Don't touch it; just mark.
        drop(plaintext_conn);
        let _ = std::fs::write(&marker, b"already-encrypted");
        return Ok(());
    }

    // Step 2: export plaintext → keyed copy.
    let enc_path = db.with_file_name("ollie.enc.db");
    if enc_path.exists() {
        // Leftover from an interrupted prior run — remove before re-exporting.
        std::fs::remove_file(&enc_path).map_err(|e| format!("rm stale enc: {e}"))?;
    }
    // SQL string interpolation of the key/path is unavoidable for ATTACH ...
    // KEY; the key is our own hex constant and the path is app-local, so there
    // is no untrusted input here.
    let enc_str = enc_path.to_string_lossy().replace('\'', "''");
    plaintext_conn
        .execute_batch(&format!(
            "ATTACH DATABASE '{enc}' AS enc KEY \"{key}\";\n\
             SELECT sqlcipher_export('enc');\n\
             DETACH DATABASE enc;",
            enc = enc_str,
            key = key_pragma,
        ))
        .map_err(|e| format!("sqlcipher_export: {e}"))?;
    drop(plaintext_conn);

    // Step 2.5: VERIFY the encrypted copy is readable with our key BEFORE we
    // touch the original. If verification fails we abort with the plaintext
    // original still in place (rollback safety) and remove the bad enc file.
    if let Err(e) = verify_encrypted_readable(&enc_path, key_pragma) {
        let _ = std::fs::remove_file(&enc_path);
        return Err(format!("encrypted copy failed verification, kept plaintext: {e}"));
    }

    // Step 3: backup + atomic swap + marker.
    let bak_path = db.with_file_name("ollie.db.bak");
    std::fs::rename(db, &bak_path).map_err(|e| format!("backup rename: {e}"))?;
    if let Err(e) = std::fs::rename(&enc_path, db) {
        // Roll back the backup so the app still has its plaintext data.
        let _ = std::fs::rename(&bak_path, db);
        return Err(format!("swap encrypted db: {e}"));
    }
    std::fs::write(&marker, b"migrated").map_err(|e| format!("write marker: {e}"))?;

    // Step 4: the swap is done and the encrypted db verified readable, so the
    // plaintext `ollie.db.bak` is now a pure RESIDUAL plaintext copy of all the
    // sensitive data on disk (GAP 3). Re-verify the live db once more (belt &
    // suspenders), then securely delete the backup. We only delete after
    // success is confirmed; if the re-verify fails we KEEP the backup so the
    // user can roll back, and surface the error.
    if let Err(e) = verify_encrypted_readable(db, key_pragma) {
        return Err(format!(
            "post-swap verification failed, kept plaintext backup for rollback: {e}"
        ));
    }
    secure_delete(&bak_path);
    Ok(())
}

/// Register the keying auto-extension so every subsequent SQLite connection
/// (including sqlx's pool inside tauri-plugin-sql) is keyed. The libsqlite3-sys
/// binding for `sqlite3_auto_extension` is already typed with the entry-point
/// ABI, so we can pass the fn pointer directly (no transmute).
fn install_auto_extension() {
    unsafe {
        ffi::sqlite3_auto_extension(Some(key_every_connection));
    }
}

/// Entry point called from `lib.rs` setup(). Fails CLOSED: if anything goes
/// wrong (no keychain, bad key, failed migration) it returns Err so the caller
/// aborts startup with a visible error instead of silently running on plaintext.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // GAP 2 (fail-closed on a vanilla-SQLite build): assert the engine is
    // SQLCipher BEFORE anything else. On vanilla, `PRAGMA key` is a silent
    // no-op, so a fresh install would otherwise run on plaintext undetected.
    assert_sqlcipher_engine()?;

    let key_pragma = get_or_create_key_pragma()?;

    if let Some(db) = db_path(app) {
        // Ensure the parent dir exists (mirrors the plugin's create_dir_all).
        if let Some(parent) = db.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        migrate_plaintext_if_needed(&db, &key_pragma)?;
    }

    // Stash the key for the auto-extension, then register it. Order matters:
    // the key must be set before any connection is opened.
    KEY_PRAGMA_ARG
        .set(key_pragma)
        .map_err(|_| "db key already initialised".to_string())?;
    install_auto_extension();
    Ok(())
}
