import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// Stored via expo-secure-store, which is backed by Keychain on iOS and
// EncryptedSharedPreferences/Keystore on Android — not AsyncStorage/localStorage,
// so it survives WebView storage clears and isn't reset by clearing app data on iOS
// (Keychain items persist across uninstall/reinstall unless explicitly removed).
const INSTALL_DEVICE_ID_KEY = 'voda-install-device-id';

let cachedInstallDeviceId: string | null = null;
let pendingInstallDeviceId: Promise<string> | null = null;

async function readOrCreateInstallDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALL_DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALL_DEVICE_ID_KEY, generated);
  return generated;
}

// Resolves once per app session and caches the result — callers can invoke this
// as many times as they like without re-hitting Keychain/Keystore.
export function getInstallDeviceId(): Promise<string> {
  if (cachedInstallDeviceId) {
    return Promise.resolve(cachedInstallDeviceId);
  }

  if (!pendingInstallDeviceId) {
    pendingInstallDeviceId = readOrCreateInstallDeviceId()
      .then((id) => {
        cachedInstallDeviceId = id;
        return id;
      })
      .catch((error) => {
        pendingInstallDeviceId = null;
        throw error;
      });
  }

  return pendingInstallDeviceId;
}

// QA/debug only — deletes the stored id so the next getInstallDeviceId() call
// generates a fresh one. Lets testers re-trigger guest-trial flows without
// reinstalling. Never wire this into a release build's UI.
export async function clearInstallDeviceId(): Promise<void> {
  await SecureStore.deleteItemAsync(INSTALL_DEVICE_ID_KEY);
  cachedInstallDeviceId = null;
  pendingInstallDeviceId = null;
}
