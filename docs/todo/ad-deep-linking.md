# 광고 딥링크 (Meta 광고 랜딩)

Meta 광고 관리자의 **랜딩 페이지 → 웹사이트 URL** 칸에 넣을 링크를 만드는 계획이다.
기존 딥링크 구조는 [딥링크 개요](../deep-linking/README.md) 참고.

> 상태: 광고 랜딩 화면은 **홈**으로 결정 (웹 루트 `/` 와 `/home` 모두 홈). Android 내부 테스트 완료, v11 운영 심사 제출 예정.
> iOS는 `1.0.1 (4)` 심사 결과 대기 중이며, 출시 후 광고 딥링크를 적용·테스트한다.

## 목표

광고 링크 하나로:

- 앱이 **있는** 사람 → 앱의 특정 화면이 열린다
- 앱이 **없는** 사람 → 스토어 설치 페이지로 간다

## 현재 상태 (2026-11-07 기준)

| 항목 | 상태 |
| --- | --- |
| 앱이 받는 딥링크 경로 | `/auth/`와 정확히 `/`, `/home`을 허용 (`App.tsx`의 허용 목록). 그 외 경로는 앱만 열리고 무시된다 |
| https 앱링크 경로 | `app.json`의 Android intentFilter는 `pathPrefix: "/auth"`만 등록. 광고 홈은 커스텀 스킴과 중간 페이지를 사용한다 |
| `apple-app-site-association` | 운영 반영 및 iOS 실기기 인증 링크 검증 완료 |
| `assetlinks.json` | 운영 nginx 직접 응답, Play 앱 서명 키 SHA-256 및 Google Digital Asset Links 조회 확인 완료 |
| Meta SDK / MMP | 없음 |
| OTA 업데이트 (expo-updates) | 없음. JS만 바꿔도 스토어 출시가 필요하다 |
| 출시 플랫폼 | Android 출시됨. iOS `1.0.1 (4)` 심사 결과 대기 중 |

Android 광고 딥링크 구현·검증은 완료했다. iOS는 App Store 출시 후 검증한다.

## 왜 `voda://` 나 https 앱링크만으로는 안 되나

| 광고에 넣는 링크 | 앱 있음 | 앱 없음 | 비고 |
| --- | --- | --- | --- |
| `voda://home` | 앱 화면 | 아무 반응 없음 | 웹사이트 URL 칸이 커스텀 스킴을 받아줄지도 불확실 |
| `https://voda.ppiyakworld.com/home` (앱링크) | 앱 화면* | **웹 페이지** (스토어 아님) | *페이스북/인스타 인앱 브라우저는 앱링크를 무시하고 웹으로 여는 경우가 많다 |
| `https://voda.ppiyakworld.com/go/home` (중간 페이지) | 앱 화면 | **스토어** | 채택안 |

## 채택안: 웹 중간(리다이렉트) 페이지

광고 URL:

```
https://voda.ppiyakworld.com/go/home?utm_source=meta&utm_medium=paid_social&utm_campaign=<캠페인명>
```

중간 페이지는 열리자마자 플랫폼별로 넘긴다.

- **Android**

  ```
  intent://home#Intent;scheme=voda;package=com.ppiyakworld.voda;S.browser_fallback_url=<URL 인코딩한 Play Store URL>;end
  ```

  앱이 있으면 `voda://home` 로 앱이 열리고, 없으면 `browser_fallback_url`(Play Store)로 간다.
  Play Store URL 에 `&referrer=<URL 인코딩한 utm 파라미터>` 를 붙이면 설치 경로를 Play Console 에서 볼 수 있다.

- **iOS** (앱스토어 출시 후)

  `voda://home` 로 이동을 시도하고, 약 1.5초 뒤에도 페이지가 보이면(`document.hidden === false`)
  App Store URL 로 보낸다. iOS 미출시 동안에는 웹 페이지로 보낸다.

- **데스크톱 등 그 외**: 웹 페이지로 보낸다.

이 방식은 `.well-known` 파일이 없어도 동작한다. (기존 `/auth` 앱링크를 위해 `.well-known` 은 별도로 고쳐야 한다.)

## 작업 목록

### 앱 (v11 출시 필요)

- [x] `App.tsx` `DEEP_LINK_ALLOWED_EXACT_PATHS` 에 `'/'`, `'/home'` 추가 (`voda://`, `voda://home`). 접두어가 아니라 정확히 일치할 때만 허용
- [x] 실행 중에 같은 링크를 다시 눌러도 다시 열리게 수정. 기존에는 마지막으로 처리한 링크와 같으면 무시해서 같은 광고를 두 번 누르면 이동하지 않았다. 이제는 콜드 스타트 때 2초 안에 겹쳐 들어오는 중복만 막는다
- [x] 쿼리스트링(UTM)이 WebView URL 로 그대로 넘어가는지 확인 (`voda://home?utm_source=meta` → `${WEBVIEW_ORIGIN}/home?utm_source=meta`)
- [x] Android에서 앱 종료 / 실행 중 두 경우 모두 테스트 (11-07, 내부 테스트 설치본)
  - `adb shell am start -a android.intent.action.VIEW -d "voda://home?utm_source=test" com.ppiyakworld.voda`
- [x] Android `versionCode` 11 빌드 및 내부 테스트 업로드·검증
- [ ] Android v11 운영 심사 제출·출시
- [ ] iOS 출시 후 TestFlight/App Store 설치본에서 `voda://home` 및 웹 중간 페이지 테스트

> 커스텀 스킴 `voda` 는 Android/iOS 모두 이미 등록돼 있어서, 중간 페이지 방식만 쓰면 네이티브 설정(`app.json` intentFilter) 변경은 필요 없다.

### 웹 (nginx / 프론트)

- [x] `/go/home` 중간 페이지 구현 및 운영 배포 (`fortune_web` `4bfed2c`)
- [x] 홈 경로가 웹에서도 단독으로 열리는지 확인
- [x] `/.well-known/assetlinks.json` 운영 nginx 직접 응답 및 검증
  - 패키지명 / 번들 ID: `com.ppiyakworld.voda`
  - Android SHA256: Play Console → 앱 무결성 → **앱 서명 키 인증서** (업로드 키 아님)
  - 리다이렉트 없이 `application/json` 으로 서빙
- [x] `apple-app-site-association` 운영 서빙 및 iOS 실기기 확인

## 작업 순서

### Android 완료 (11-07)

1. `/auth/verified` HTTPS 앱링크가 내부 테스트 설치본에서 앱으로 열림 확인
2. `/go/home?utm_source=test` 앱 종료·실행 중 모두 홈 이동 확인
3. 앱 미설치 상태에서 `/go/home`이 Play Store로 이동하는 것 확인
4. v11 운영 심사 제출·출시만 남음

웹의 iOS 분기는 App Store 출시 전에는 앱스토어가 아닌 홈으로 보낸다.

### iOS 출시 후

1. App Store 설치본에서 `voda://home`이 홈을 여는지 확인
2. `/go/home`을 Safari와 Meta 인앱 브라우저에서 열어 앱 설치/미설치 분기 확인
3. 확인 후 광고 관리자 랜딩 URL에 적용

## 한계

- 앱이 없던 사람이 설치 후 처음 열면 광고 화면이 아니라 **홈**으로 시작한다.
  설치 후에도 해당 화면으로 보내려면(디퍼드 딥링크) Meta SDK 또는 MMP(AppsFlyer 등) 연동이 필요하다.
- 앱 설치 기여도(광고 → 설치 전환)를 Meta 에서 측정하려면 마찬가지로 Meta SDK 또는 MMP 가 필요하다.
  웹 중간 페이지 방문까지는 Meta 픽셀/UTM 으로 측정할 수 있다.

## 정해야 할 것

1. ~~광고로 열 앱 화면(경로)~~ → 홈 (`voda://home`)
2. ~~iOS 배포 여부와 시점~~ → App Store 출시 후 광고 딥링크 적용·테스트
