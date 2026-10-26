# Native Device Identity (Phase 1)

상담/체험 어뷰징을 막기 위한 기기 식별 값을 네이티브 앱이 WebView에 주입한다.
헤더를 실제 API 요청에 붙이는 일은 **웹 프론트**가 담당한다(아래 계약 참고).

## 네이티브가 하는 일

`src/lib/nativeContext.ts` 가 아래 값을 한 번 조립해서, `App.tsx` 의
`injectedJavaScriptBeforeContentLoaded` 로 전역 주입한다.

### 전역 객체

- 이름: **`window.__VODA_NATIVE__`** (고정)
- 순수 브라우저에는 존재하지 않음 → `typeof window.__VODA_NATIVE__ === 'object'` 로 앱 판별.
  단, Android 는 주입이 페이지 스크립트보다 늦을 수 있으니 UA 병행 판별 권장(아래 "주입 시점").

```js
window.__VODA_NATIVE__ = {
  platform:   'ios' | 'android',   // 소문자 리터럴 2종. 네이티브는 'web' 을 절대 안 보냄
  deviceId:   string | null,       // 아래 필드 스펙
  guestId:    string,              // 항상 존재. 실패 시 '' (빈 문자열)
  appVersion: string | null,       // Application.nativeApplicationVersion, 예 '1.0.0'
  appBuild:   string | null,       // Application.nativeBuildVersion, 예 '10' (v10부터)
};
```

### 필드 스펙

| 필드 | 타입 | 소스 | 형식 / 예시 | 안정성 |
| --- | --- | --- | --- | --- |
| `platform` | `'ios'\|'android'` | `Platform.OS` | 소문자 리터럴 | — |
| `deviceId` (iOS) | `string\|null` | `Application.getIosIdForVendorAsync()` (IDFV) | 대문자 UUID, 하이픈 4개. `E5F6A7B8-1234-4C5D-9E0F-1A2B3C4D5E6F` | vendor 앱이 **하나라도** 설치돼 있으면 유지. 전부 삭제 후 재설치 시 변경 |
| `deviceId` (Android) | `string\|null` | `Application.getAndroidId()` = `Settings.Secure.ANDROID_ID` | 소문자 hex 16자, 하이픈 없음. `9774d56d682e549c` | (앱 서명키, 사용자, 기기) 고정. 같은 서명키 재설치엔 유지, 팩토리 리셋 시 변경. 일부 불량 단말은 전 기기 동일값 → 서버 과신 금지 |
| `guestId` | `string` | 앱 생성 UUID v4, `expo-secure-store` 영속 | 소문자 UUID, 하이픈 4개. `3f2a…` | iOS: 앱 삭제·재설치에도 유지(Keychain). Android: 재설치 시 소실(Keystore) |
| `appVersion` | `string\|null` | `Application.nativeApplicationVersion` | iOS `CFBundleShortVersionString` / Android `versionName`. `'1.0.0'` | — |
| `appBuild` | `string\|null` | `Application.nativeBuildVersion` | iOS `CFBundleVersion` / Android `versionCode`. `'10'`. 웹은 `X-App-Build` 헤더로 보낸다 | v10부터. 이전 버전에는 필드 없음 |

`deviceId` 가 `null` 인 경우: 조회 실패, 또는 IDFV 미할당(부팅 직후 등). → `X-Device-Id` 헤더 생략.
`guestId` 가 `''` 인 경우: SecureStore 읽기 실패. → `X-Guest-Id` 헤더 생략.

추가로, **최초 문서 요청에만** 아래 헤더를 같이 보낸다(`WebView source.headers`).
페이지가 이후에 던지는 fetch/XHR/스트리밍에는 적용되지 않으므로 이건 보조 채널일 뿐이다.

| 헤더 | 값 |
| --- | --- |
| `X-Device-Platform` | `ios` / `android` |
| `X-Device-Id` | IDFV / ANDROID_ID (없으면 생략) |
| `X-Guest-Id` | 영속 UUID v4 (없으면 생략) |

### guestId 영속성

- `expo-secure-store` 에 저장 → iOS Keychain / Android Keystore(EncryptedSharedPreferences).
- iOS: Keychain 항목은 **앱 삭제 후에도 남으므로** 재설치해도 같은 guestId.
- Android: Keystore 저장소는 재설치 시 사라진다 → 그래서 `ANDROID_ID`(같은 서명키
  재설치에도 유지)를 `deviceId` 로 별도 제공한다.
- 저장 키는 히스토리상 `voda-install-device-id` 를 그대로 유지한다(기존 테스터의
  UUID 를 새로 발급하지 않기 위함). 헤더/스코프 이름만 `install` → `guest` 로 변경.

### 주입 시점 (페이지 스크립트 실행 전 보장 여부)

react-native-webview 13.15.0 의 `injectedJavaScriptBeforeContentLoaded` 구현 기준:

- **iOS — 보장됨.** `WKUserScript` + `WKUserScriptInjectionTimeAtDocumentStart`,
  `forMainFrameOnly = YES`. 문서 엘리먼트 생성 직후·다른 리소스/스크립트 로드 전에 실행.
- **Android — 보장 안 됨.** `WebViewClient.onPageStarted` 콜백에서 `evaluateJavascript`
  로 실행한다(`WebViewCompat.addDocumentStartJavaScript` 미사용). 보통 페이지 스크립트보다
  먼저지만, `<head>` 최상단 인라인 스크립트와는 레이스가 생길 수 있다.

그래서 웹 인터셉터는:

1. `window.__VODA_NATIVE__` 를 **모듈 로드 시 1회 캡처하지 말고 매 호출 시점에 읽는다.**
2. 앱 컨텍스트 판별은 UA 로 한다 — 앱이 `applicationNameForUserAgent` 로 UA 에
   **`MY_APP`** 토큰을 붙인다. UA 에 `MY_APP` 이 있는데 `__VODA_NATIVE__` 가 아직 없으면,
   짧게(예: 50ms×최대 10회) 재시도하거나 첫 API 호출을 그만큼 지연시킨다.
3. UA 에 `MY_APP` 이 없으면 순수 웹으로 확정 처리(대기 불필요).

## 웹 프론트가 해야 하는 일 (계약)

axios/fetch 인터셉터에서:

- 앱(UA 에 `MY_APP`) → `window.__VODA_NATIVE__` 값 사용(위 "주입 시점" 재시도 규칙).
  순수 웹 → `X-Guest-Id` 는 `localStorage` 에서 생성·영속, `X-Device-Platform: web`,
  `X-Device-Id` 생략. (`platform: 'web'` 은 웹이 자기 쪽에서 채운다 — 네이티브는 안 보냄)
- **API 오리진 화이트리스트에만** 3개 헤더 + `credentials: 'include'` 부착.
  전역 부착 금지(애널리틱스·CDN 등 서드파티로 기기 ID 유출 방지).
- `/api/consult/stream` 은 `EventSource` 대신 fetch-스트리밍(`ReadableStream`)으로.
  `EventSource` 는 커스텀 헤더를 지원하지 않는다.
- 커스텀 헤더는 non-simple 이라 매 호출에 `OPTIONS` preflight 가 붙는다(서버는
  이미 `OPTIONS /** permitAll` + `allowedHeaders: "*"` 로 통과).

## QA

우하단 "ID 초기화" 버튼 → guestId 삭제 후 재발급 + 웹뷰 리로드.
`__DEV__` 빌드와 `EXPO_PUBLIC_ENABLE_QA_TOOLS=true`로 만든 내부 APK(`build:apk:dev`)에서만 보인다.
스토어 AAB(`build:aab:prod`)에는 노출되지 않는다.

## 빌드

`expo-application` 네이티브 모듈이 추가되었다.

- iOS: `cd ios && pod install` (`EXApplication` pod). 완료됨.
- Android: Expo autolinking 이 다음 gradle 빌드에서 자동 링크. 별도 설정 불필요.
- `app.json` 변경 없음(config plugin 불필요).
