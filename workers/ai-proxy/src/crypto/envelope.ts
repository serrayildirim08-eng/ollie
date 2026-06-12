/**
 * App-layer envelope encryption (A6b, decision D1).
 *
 * Keys NEVER live in the database. The worker holds one Key-Encryption-Key (KEK)
 * as a secret (`ENVELOPE_KEK`, base64 32 bytes). Per record we:
 *   1. generate a random Data-Encryption-Key (DEK, AES-GCM-256),
 *   2. encrypt the plaintext payload with the DEK  → ciphertext + iv,
 *   3. wrap (encrypt) the DEK with the KEK         → wrapped_dek + dek_iv,
 *   4. store only ciphertext, iv, wrapped_dek, dek_iv. Postgres sees ciphertext.
 *
 * Rotation: re-wrap each row's DEK under a new KEK without touching ciphertext
 * (rewrapDek). Access logging: every decrypt emits a structured log line
 * (user + record + ts) so reads are auditable (risk #2).
 */

export interface EnvelopeFields {
  ciphertext: string; // base64
  iv: string; // base64
  wrapped_dek: string; // base64
  dek_iv: string; // base64
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The worker's TS DOM lib types Uint8Array as Uint8Array<ArrayBufferLike>, which
// doesn't structurally satisfy BufferSource (it wants ArrayBuffer). The bytes
// are identical at runtime; cast at the WebCrypto boundary.
function buf(u: Uint8Array | ArrayBuffer): BufferSource {
  return u as unknown as BufferSource;
}

async function importKek(kekB64: string): Promise<CryptoKey> {
  const raw = b64decode(kekB64);
  if (raw.length !== 32) throw new Error('ENVELOPE_KEK must be base64 of 32 bytes');
  return crypto.subtle.importKey('raw', buf(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt a JSON-serialisable payload. Returns the four envelope fields. */
export async function envelopeEncrypt(kekB64: string, payload: unknown): Promise<EnvelopeFields> {
  const kek = await importKek(kekB64);
  // Fresh DEK per record.
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv) },
    dek,
    buf(enc.encode(JSON.stringify(payload))),
  );
  // Wrap the DEK under the KEK.
  const rawDek = await crypto.subtle.exportKey('raw', dek);
  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(dekIv) }, kek, buf(rawDek));
  return {
    ciphertext: b64encode(ciphertext),
    iv: b64encode(iv),
    wrapped_dek: b64encode(wrapped),
    dek_iv: b64encode(dekIv),
  };
}

/** Decrypt an envelope back to the original payload. Emits an access-log line. */
export async function envelopeDecrypt<T = unknown>(
  kekB64: string,
  fields: EnvelopeFields,
  audit?: { userId: string; recordId: string },
): Promise<T> {
  const kek = await importKek(kekB64);
  // Unwrap the DEK.
  const rawDek = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf(b64decode(fields.dek_iv)) },
    kek,
    buf(b64decode(fields.wrapped_dek)),
  );
  const dek = await crypto.subtle.importKey('raw', buf(rawDek), { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf(b64decode(fields.iv)) },
    dek,
    buf(b64decode(fields.ciphertext)),
  );
  if (audit) {
    // Access logging (risk #2) — every plaintext read is auditable.
    console.log(
      '[envelope:decrypt]',
      JSON.stringify({ user: audit.userId, record: audit.recordId, at: new Date().toISOString() }),
    );
  }
  return JSON.parse(dec.decode(plain)) as T;
}

/** KEK rotation: re-wrap the DEK under a new KEK, ciphertext untouched. */
export async function rewrapDek(
  oldKekB64: string,
  newKekB64: string,
  fields: Pick<EnvelopeFields, 'wrapped_dek' | 'dek_iv'>,
): Promise<Pick<EnvelopeFields, 'wrapped_dek' | 'dek_iv'>> {
  const oldKek = await importKek(oldKekB64);
  const newKek = await importKek(newKekB64);
  const rawDek = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf(b64decode(fields.dek_iv)) },
    oldKek,
    buf(b64decode(fields.wrapped_dek)),
  );
  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(dekIv) }, newKek, buf(rawDek));
  return { wrapped_dek: b64encode(wrapped), dek_iv: b64encode(dekIv) };
}
