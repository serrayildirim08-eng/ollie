package com.ollie.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.Os
import android.util.Base64
import android.util.Log
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeps the SQLCipher database key wrapped by a hardware-backed Android
 * Keystore key, so the key is never stored in the clear on disk.
 *
 *   .ollie_db_key.wrapped   iv (12 bytes) || AES-GCM ciphertext of the 32-byte DB key
 *
 * The wrapping key ("ollie-db-wrap") lives in AndroidKeyStore and can't be
 * exported. Runs in MainActivity BEFORE the Rust side starts and hands the
 * unwrapped key to Rust through a process environment variable (memory only);
 * src-tauri/src/secure_db.rs reads it once and removes it.
 *
 * Migration: builds up to 1.1.3 kept the key as plain base64 in
 * `.ollie_db_key`. That exact key is wrapped (the DB key does NOT change, so
 * no data is lost), the wrap is verified by unwrapping, and only then is the
 * plain file deleted.
 *
 * On any failure nothing is exported; Rust then falls back to a still-present
 * legacy file or refuses to start (fail closed). A new key is never minted
 * while a wrapped or legacy key exists.
 */
object DbKeyVault {
  const val ENV_VAR = "OLLIE_DB_KEY_HEX"
  private const val TAG = "OllieDbKeyVault"
  private const val ALIAS = "ollie-db-wrap"
  private const val WRAPPED = ".ollie_db_key.wrapped"
  private const val LEGACY = ".ollie_db_key"
  private const val IV_LEN = 12
  private const val TAG_BITS = 128

  fun exportDbKey(context: Context) {
    try {
      val dir = context.dataDir
      val key = loadOrCreate(File(dir, WRAPPED), File(dir, LEGACY))
      Os.setenv(ENV_VAR, key.joinToString("") { "%02x".format(it) }, true)
      key.fill(0)
    } catch (e: Exception) {
      Log.e(TAG, "keystore unavailable; not exporting db key", e)
    }
  }

  private fun loadOrCreate(wrapped: File, legacy: File): ByteArray {
    if (wrapped.exists()) return unwrap(wrapped.readBytes())

    val dbKey: ByteArray = if (legacy.exists()) {
      Base64.decode(legacy.readText().trim(), Base64.DEFAULT)
    } else {
      ByteArray(32).also { SecureRandom().nextBytes(it) }
    }
    require(dbKey.size == 32) { "unexpected db key length ${dbKey.size}" }

    val blob = wrap(dbKey)
    val tmp = File(wrapped.parentFile, "$WRAPPED.tmp")
    tmp.writeBytes(blob)
    if (!tmp.renameTo(wrapped)) throw IllegalStateException("could not store wrapped key")
    // Prove the stored blob round-trips before dropping the plain copy.
    require(unwrap(wrapped.readBytes()).contentEquals(dbKey)) { "wrapped key failed verification" }
    if (legacy.exists() && !legacy.delete()) Log.w(TAG, "could not delete legacy plain key")
    return dbKey
  }

  private fun wrappingKey(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  private fun wrap(plain: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
    return cipher.iv + cipher.doFinal(plain)
  }

  private fun unwrap(blob: ByteArray): ByteArray {
    require(blob.size > IV_LEN) { "wrapped key too short" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(TAG_BITS, blob, 0, IV_LEN))
    return cipher.doFinal(blob, IV_LEN, blob.size - IV_LEN)
  }
}
