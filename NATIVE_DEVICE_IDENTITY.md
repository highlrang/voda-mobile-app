# Native Device Identity (Phase 1)

상담/체험 어뷰징을 막기 위한 기기 식별 값을 네이티브 앱이 WebView에 주입한다.
헤더를 실제 API 요청에 붙이는 일은 **웹 프론트**가 담당한다(아래 계약 참고).

## 네이티브가 하는 일

`src/lib/nativeContext.ts` 가 아래 값을 한 번 조립해서, 페이지 스크립트보다
먼저(`injectedJavaScriptBeforeContentLoaded`) 전역으로 주입한다.

```js
window.__VODA_NATIVE__ = {
  platform:   'ios' | 'android',
  deviceId:   string | null,   // iOS: identifierForVendor(IDFV), Android: Settings.Secure.ANDROID_ID
  guestId:    string,          // 앱이 생성한 UUID v4 (아래 "guestId 영속성")
  appVersion: string | null,   // Application.nativeApplicationVersion
};
```

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

### 주입 타이밍 (Android 주의)

`injectedJavaScriptBeforeContentLoaded` 는 iOS(`WKUserScript(.atDocumentStart)`)
에서는 확실히 첫 스크립트보다 먼저지만, Android react-native-webview 에서는
문서 로드 극초반에 약간 늦을 수 있다. 웹 인터셉터는 `window.__VODA_NATIVE__` 가
아직 없을 가능성을 감안해 **호출 시점에 lazy 하게 읽어야** 한다(모듈 로드 시 1회
캡처 금지).

### deviceId 가 null 일 수 있는 경우

부팅 직후 IDFV 가 잠깐 null 이거나 조회 실패 시. 이 경우 `deviceId: null` 로 주입하고
`X-Device-Id` 헤더는 생략한다. 웹은 guestId 만으로 폴백한다.

## 웹 프론트가 해야 하는 일 (계약)

axios/fetch 인터셉터에서:

- `window.__VODA_NATIVE__` 가 있으면 그 값 사용. 없으면 순수 웹으로 취급 →
  `X-Guest-Id` 는 `localStorage` 에서 생성·영속, `X-Device-Platform: web`,
  `X-Device-Id` 생략.
- **API 오리진 화이트리스트에만** 3개 헤더 + `credentials: 'include'` 부착.
  전역 부착 금지(애널리틱스·CDN 등 서드파티로 기기 ID 유출 방지).
- `/api/consult/stream` 은 `EventSource` 대신 fetch-스트리밍(`ReadableStream`)으로.
  `EventSource` 는 커스텀 헤더를 지원하지 않는다.
- 커스텀 헤더는 non-simple 이라 매 호출에 `OPTIONS` preflight 가 붙는다(서버는
  이미 `OPTIONS /** permitAll` + `allowedHeaders: "*"` 로 통과).

## QA

`__DEV__` 빌드에서만 우하단 "ID 초기화" 버튼 → guestId 삭제 후 재발급 + 웹뷰 리로드.
릴리스 빌드 UI 에는 노출되지 않는다.

## 빌드

`expo-application` 네이티브 모듈이 추가되었다.

- iOS: `cd ios && pod install` (`EXApplication` pod). 완료됨.
- Android: Expo autolinking 이 다음 gradle 빌드에서 자동 링크. 별도 설정 불필요.
- `app.json` 변경 없음(config plugin 불필요).
