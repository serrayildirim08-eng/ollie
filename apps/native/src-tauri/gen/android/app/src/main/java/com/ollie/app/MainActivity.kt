package com.ollie.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Unwrap the SQLCipher key from Android Keystore BEFORE super.onCreate
    // starts the Rust side, which reads it once (see DbKeyVault).
    DbKeyVault.exportDbKey(this)
    super.onCreate(savedInstanceState)
  }
}
