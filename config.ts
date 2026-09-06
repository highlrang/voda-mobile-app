// WebView가 로드하는 웹 앱 오리진.
//
// 우선순위:
//   1. 빌드 시점에 주입된 EXPO_PUBLIC_WEBVIEW_ORIGIN 환경변수 (있으면 무조건 이 값)
//   2. 개발 빌드(__DEV__: Metro / dev client) → 개발 오리진
//   3. 그 외 릴리스 빌드 → 운영 오리진
//
// 즉 기본값만 놓고 보면:
//   - `./gradlew bundleRelease` (Play Store AAB) → 운영(voda.ppiyakworld.com)
//   - `EXPO_PUBLIC_WEBVIEW_ORIGIN=... ./gradlew assembleRelease` (내부 테스트 APK) → 개발
//   - `expo start` → 개발
export const PROD_WEBVIEW_ORIGIN = 'https://voda.ppiyakworld.com';
export const DEV_WEBVIEW_ORIGIN = 'https://voda-dev.ppiyakworld.com';

function resolveWebViewOrigin(): string {
  const injected = process.env.EXPO_PUBLIC_WEBVIEW_ORIGIN;
  if (injected) {
    return injected.replace(/\/+$/, '');
  }
  return __DEV__ ? DEV_WEBVIEW_ORIGIN : PROD_WEBVIEW_ORIGIN;
}

export const WEBVIEW_ORIGIN = resolveWebViewOrigin();
export const WEBVIEW_URL = WEBVIEW_ORIGIN;
