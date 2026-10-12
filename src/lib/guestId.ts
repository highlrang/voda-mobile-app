import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// App-generated UUID v4 sent to the server as the `X-Guest-Id` header (and
// exposed to the web layer via `window.__VODA_NATIVE__.guestId`). It identifies
// a guest across reinstalls so guest-trial abuse can be rate-limited.
//
// Stored via expo-secure-store, which is backed by Keychain on iOS and
// EncryptedSharedPreferences/Keystore on Android — not AsyncStorage/localStorage,
// so it survives WebView storage clears and isn't reset by clearing app data on
// iOS (Keychain items persist across uninstall/reinstall unless explicitly
// removed). Android's Keystore-backed store does NOT survive uninstall, which is
// why the native context also carries `Settings.Secure.ANDROID_ID` as a separate
// device-level signal — see src/lib/nativeContext.ts.
//
// The storage key keeps its historical `voda-install-device-id` value on purpose:
// renaming it would orphan the UUID already persisted on testers' devices and
// hand them a fresh guest id. Only the header/scope name changed ("install" →
// "guest"), not the stored value.
const GUEST_ID_KEY = 'voda-install-device-id';

let cachedGuestId: string | null = null;
let pendingGuestId: Promise<string> | null = null;

async function readExistingGuestId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(GUEST_ID_KEY);
  } catch {
    // The stored value can no longer be decrypted — e.g. the encrypted prefs
    // came back from an Android backup/device transfer but the Keystore key
    // did not. Left alone it fails on every launch and pins guestId to ''
    // forever, so drop it and let a fresh id be issued.
    await SecureStore.deleteItemAsync(GUEST_ID_KEY).catch(() => {});
    return null;
  }
}

async function readOrCreateGuestId(): Promise<string> {
  const existing = await readExistingGuestId();
  if (existing) {
    return existing;
  }

  const generated = Crypto.randomUUID();
  await SecureStore.setItemAsync(GUEST_ID_KEY, generated);
  return generated;
}

// Resolves once per app session and caches the result — callers can invoke this
// as many times as they like without re-hitting Keychain/Keystore.
export function getGuestId(): Promise<string> {
  if (cachedGuestId) {
    return Promise.resolve(cachedGuestId);
  }

  if (!pendingGuestId) {
    pendingGuestId = readOrCreateGuestId()
      .then((id) => {
        cachedGuestId = id;
        return id;
      })
      .catch((error) => {
        pendingGuestId = null;
        throw error;
      });
  }

  return pendingGuestId;
}

// QA/debug only — deletes the stored id so the next getGuestId() call generates a
// fresh one. Lets testers re-trigger guest-trial flows without reinstalling.
// Never wire this into a release build's UI.
export async function clearGuestId(): Promise<void> {
  await SecureStore.deleteItemAsync(GUEST_ID_KEY);
  cachedGuestId = null;
  pendingGuestId = null;
}
