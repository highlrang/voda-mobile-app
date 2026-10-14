# 앱 개선 사항 (내부 비공개 테스트 기준)

내부 테스트(versionCode 7) 시점에 코드를 점검하면서 나온 개선 항목을 우선순위대로 정리했다.
상태: ✅ 반영 완료 · ⬜ 미반영

> 참고: `android/`, `ios/`는 `.gitignore` 대상이라 생성물이고, 원본은 `app.json`(config plugin)이다.
> 단, `android/app/build.gradle`의 릴리스 서명 설정은 손으로 고친 것이라 `npx expo prebuild --clean`을
> 돌리면 날아간다. 네이티브 설정을 바꿀 때는 `app.json`과 `android/`를 **둘 다** 맞춰야 한다.

## 빌드별 변경 내역

배포 위험을 나누려고 빌드마다 변경 범위를 작게 유지한다. 비공개 테스트 기간에 의미 있는 업데이트 이력을 남기는 데도 도움이 된다.

| versionCode | 상태 | 포함 항목 | 성격 |
|---|---|---|---|
| 7 | 배포됨 | — | 기준 빌드 |
| 8 | 빌드 완료 | 1, 2, 3, 5 | 테스터가 겪을 수 있는 버그 수정 |
| **9** | 빌드 중 | 4, 8 + 빌드 속도 개선 | 앱 용량 축소, 안정화 |
| 10 | 예정 | 6, 7 | 안정성 모니터링, QA 도구 |

### versionCode 8 — 버전 설명(출시 노트)
```
- 일부 기기에서 재설치·기기 이전 후 게스트 식별값이 비어 체험 제한이 적용되지 않던 문제 수정
- 전화·메일·카카오 등 외부 앱 링크를 누르면 "페이지를 불러올 수 없습니다" 화면이 뜨던 문제 수정 (외부 앱으로 연결)
- Android 3버튼 내비게이션 기기에서 하단 버튼이 내비게이션 바에 가려지던 문제 수정
- 보안 강화: 암호화되지 않은 HTTP 통신 허용 설정 제거
```

### versionCode 9 — 버전 설명(출시 노트)
```
- 사용하지 않는 내부 화면과 라이브러리를 정리해 앱 용량 축소
- 앱 안정성 개선
```
- 4. tarot 화면(`src/tarot/`)과 의존성 제거: `expo-linear-gradient`, `react-native-svg`,
  `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler`
  (`GestureHandlerRootView`는 일반 `View`로 교체, babel reanimated 플러그인과 ProGuard keep 규칙 제거)
- 8. 쓰지 않는 `isRefreshing` 상태와 "새로고침 중..." 문구 제거
- 빌드 속도: ARM 두 종류만 빌드, `--parallel`, 힙 4GB, `clean` 대신 JS 번들만 지움 (`package.json` 스크립트)
- **업로드 전 실기기 회귀 테스트 필수** (네이티브 모듈 제거 + R8): 앱 실행, 웹뷰 로드, 회전,
  뒤로 가기, 상담 결과 이미지 저장, 딥링크(`voda://auth/...`), 외부 링크(`tel:`, 카카오)

### versionCode 10 — 예정
- 6. 크래시/에러 수집 도구 도입
- 7. 내부 테스트 APK에 Guest ID 초기화 버튼 노출

## 🔴 긴급

### 1. ✅ SecureStore 자동 백업 제외 + 손상된 guest id 복구 (versionCode 8)
- **문제**: `app.json`에 `expo-secure-store` 플러그인이 있지만 `android/`가 그 이후로 다시 생성되지 않아,
  매니페스트에 백업 규칙(`fullBackupContent` / `dataExtractionRules`)이 빠져 있었다. `allowBackup="true"`라서
  재설치나 기기 이전 때 암호화된 SharedPreferences는 복원되고 Keystore 키는 복원되지 않을 수 있다.
  그러면 `getItemAsync`가 매번 실패하고 그 기기의 `guestId`가 영구히 `''`가 된다.
- **수정**
  - `android/app/src/main/AndroidManifest.xml`: secure-store 플러그인이 생성하는 것과 같은 백업 규칙을 추가했다
    (XML 리소스는 `expo-secure-store` 라이브러리에 포함돼 있음).
  - `src/lib/guestId.ts`: 저장된 값을 읽다 실패하면 그 키를 지우고 새 UUID를 발급한다.

### 2. ✅ 웹뷰가 처리할 수 없는 스킴(`intent:`, `tel:`, `mailto:`, 앱 스킴)을 외부 앱으로 넘기기 (versionCode 8)
- **문제**: `onShouldStartLoadWithRequest`가 없어서 이런 링크가 `ERR_UNKNOWN_URL_SCHEME`로 실패했고,
  `onError` 때문에 화면 전체가 "페이지를 불러올 수 없습니다"로 바뀌었다.
- **수정** (`App.tsx`)
  - `http(s)`, `about`, `data`, `blob`, `javascript`는 지금처럼 웹뷰 안에서 연다(외부 https 도메인도 웹뷰에 남김).
  - 그 밖의 스킴은 최상위 프레임에서 시작된 경우에만 `Linking.openURL`로 OS에 넘긴다.
  - Android `intent://`는 다음 순서로 시도한다: 앱 스킴 URL로 재구성 → `S.browser_fallback_url` → Play 스토어(`market://details?id=…`).

### 3. ✅ Android 하단 내비게이션 바에 웹 하단 UI가 가려지는 문제 (versionCode 8)
- **문제**: 하단 오프셋이 `16px`로 고정돼 있었다. targetSdk 36이라 Android 15 이상에서는 edge-to-edge가 강제되는데,
  3버튼 내비게이션(약 48dp) 기기에서 하단 CTA나 내비게이션이 가려질 수 있다.
  Android WebView는 `env(safe-area-inset-bottom)`를 대부분 0으로 준다.
- **수정** (`App.tsx`): Android에서는 `max(insets.bottom, 16)`을 `--native-webview-bottom-offset`으로 주입한다.

## 🟡 권장

### 4. ✅ 사용하지 않는 tarot 네이티브 화면과 의존성 제거 (versionCode 9)
- `src/tarot/`(약 1,600줄)를 `App.tsx`에서 import하지 않는다.
- `expo-linear-gradient`, `react-native-svg`는 tarot에서만 쓴다. `react-native-reanimated`도 앱 코드에서는 tarot에서만 쓴다.
  (`babel.config.js` 플러그인, `react-native-worklets` 함께 정리)
- AAB 크기와 빌드 시간이 줄어든다. `react-native-gesture-handler`는 `App.tsx`의 `GestureHandlerRootView`에서 쓰고 있으니
  이것도 뺄지 함께 판단한다.

### 5. ✅ `usesCleartextTraffic: true` 제거 (`app.json` → `expo-build-properties`) (versionCode 8)
- 운영/개발 오리진이 모두 https라 필요 없다. Play 사전 출시 보고서 경고 대상이다.
- 생성된 매니페스트에는 원래 반영돼 있지 않았기 때문에, `app.json`에서만 제거했다(다음 prebuild 때 들어가는 것을 막음).
  debug 매니페스트의 cleartext 허용(Metro 연결용)은 그대로 둔다.

### 6. ⬜ 크래시/에러 수집 도구 도입 (예: `@sentry/react-native`)
- 지금은 테스터 기기에서 생긴 네이티브 크래시나 JS 에러를 볼 방법이 없다.

### 7. ⬜ 내부 테스트 APK에서 Guest ID 초기화 버튼 노출
- 지금은 `__DEV__` 조건이라 release로 빌드한 내부 테스트 APK에서는 보이지 않는다.
- 예: `EXPO_PUBLIC_ENABLE_QA_TOOLS=true`를 `build:apk:dev`에서만 주입한다.

## ⚪ 사소한 것

### 8. ✅ `isRefreshing`이 true가 되는 경로가 없음 (versionCode 9, 상태 제거)
- "새로고침 중..." 문구가 표시되지 않는다. 쓰지 않을 거라면 상태를 제거한다.

### 9. ⬜ `onHttpError`가 화면 전체를 에러 화면으로 바꿈
- 메인 문서가 404/5xx를 받으면 앱 전체가 막힌다. 웹의 에러 페이지를 그대로 보여줄지 검토한다.

### 10. ⬜ 회전 시 상단/하단 inset 재주입
- `injectedJavaScript`는 로드할 때 한 번만 실행된다. 회전으로 inset이 바뀌면
  `injectJavaScript`로 CSS 변수를 다시 주입하는 게 좋다.
