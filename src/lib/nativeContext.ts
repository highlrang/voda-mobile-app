import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { getGuestId } from './guestId';

// Assembled once and injected into the WebView as `window.__VODA_NATIVE__` before
// any page script runs, so the web app's request layer can read it and attach the
// device-identity headers itself. `source.headers` on the WebView only covers the
// initial document request, not the fetch/XHR/streaming calls the page makes for
// the consultation/trial APIs — those are the ones the server actually gates on.
//
// Contract mirrored by the web front-end (see NATIVE_DEVICE_IDENTITY.md):
//   window.__VODA_NATIVE__ = {
//     platform:   'ios' | 'android',
//     deviceId:   string | null,   // iOS: IDFV, Android: Settings.Secure.ANDROID_ID
//     guestId:    string,          // persisted UUID v4 (Keychain/Keystore)
//     appVersion: string | null,   // versionName, e.g. '1.0.1'
//     appBuild:   string | null,   // versionCode / CFBundleVersion, e.g. '10'
//   }
export type NativeContext = {
  platform: 'ios' | 'android';
  deviceId: string | null;
  guestId: string;
  appVersion: string | null;
  appBuild: string | null;
};

const NATIVE_PLATFORM: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';

// iOS: identifierForVendor (IDFV) — stable while the vendor has any app installed,
//   regenerated only after all of a vendor's apps are removed.
// Android: Settings.Secure.ANDROID_ID — stable per (app signing key, user, device)
//   and survives reinstall of a same-signed build.
// Either can legitimately be unavailable (IDFV briefly null right after boot); the
// web layer falls back to guestId-only in that case.
async function resolveDeviceId(): Promise<string | null> {
  try {
    if (Platform.OS === 'ios') {
      const idfv = await Application.getIosIdForVendorAsync();
      return idfv && idfv.length > 0 ? idfv : null;
    }
    if (Platform.OS === 'android') {
      const androidId = Application.getAndroidId();
      return androidId && androidId.length > 0 ? androidId : null;
    }
  } catch {
    return null;
  }
  return null;
}

let cachedNativeContext: NativeContext | null = null;
let pendingNativeContext: Promise<NativeContext> | null = null;

async function buildNativeContext(): Promise<NativeContext> {
  const [guestId, deviceId] = await Promise.all([
    getGuestId().catch(() => ''),
    resolveDeviceId(),
  ]);

  return {
    platform: NATIVE_PLATFORM,
    deviceId,
    guestId,
    appVersion: Application.nativeApplicationVersion ?? null,
    appBuild: Application.nativeBuildVersion ?? null,
  };
}

// Headers for requests the native layer makes itself (the WebView's initial
// document request, client-log reports). Empty values are omitted.
export function nativeContextHeaders(context: NativeContext): Record<string, string> {
  const headers: Record<string, string> = { 'X-Device-Platform': context.platform };
  if (context.deviceId) headers['X-Device-Id'] = context.deviceId;
  if (context.guestId) headers['X-Guest-Id'] = context.guestId;
  if (context.appVersion) headers['X-App-Version'] = context.appVersion;
  if (context.appBuild) headers['X-App-Build'] = context.appBuild;
  return headers;
}

// Resolves once per app session and caches the result. Always resolves (never
// rejects) — a failure to read the guest id still yields a usable context with
// guestId: '' so the WebView is not blocked from loading.
export function getNativeContext(): Promise<NativeContext> {
  if (cachedNativeContext) {
    return Promise.resolve(cachedNativeContext);
  }

  if (!pendingNativeContext) {
    pendingNativeContext = buildNativeContext()
      .then((context) => {
        cachedNativeContext = context;
        return context;
      })
      .catch((error) => {
        pendingNativeContext = null;
        throw error;
      });
  }

  return pendingNativeContext;
}

// QA/debug only — drops the in-memory cache so the next getNativeContext() call
// re-reads the guest id (used right after clearGuestId()).
export function resetNativeContextCache(): void {
  cachedNativeContext = null;
  pendingNativeContext = null;
}
