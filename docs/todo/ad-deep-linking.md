# 광고 딥링크 (Meta 광고 랜딩)

Meta 광고 관리자의 **랜딩 페이지 → 웹사이트 URL** 칸에 넣을 링크를 만드는 계획이다.
기존 딥링크 구조는 [딥링크 개요](../deep-linking/README.md) 참고.

> 상태: 광고 랜딩 화면은 **홈**으로 결정 (웹 루트 `/` 와 `/home` 모두 홈). 앱 수정은 반영됨, v11 출시 전.
> iOS 배포 여부와 시점은 아직 정하지 않았다.

## 목표

광고 링크 하나로:

- 앱이 **있는** 사람 → 앱의 특정 화면이 열린다
- 앱이 **없는** 사람 → 스토어 설치 페이지로 간다

## 현재 상태 (2026-11-01 기준)

| 항목 | 상태 |
| --- | --- |
| 앱이 받는 딥링크 경로 | `/auth/` 만 허용 (`App.tsx` 의 `DEEP_LINK_ALLOWED_PATH_PREFIXES`). 다른 경로는 앱만 열리고 무시된다 |
| https 앱링크 경로 | `app.json` intentFilter `pathPrefix: "/auth"` 만 등록 |
| `/.well-known/assetlinks.json`, `apple-app-site-association` | 운영 도메인에서 실제 파일이 아니라 SPA `index.html` 이 200(text/html)으로 응답한다. 기존 `/auth` https 앱링크도 검증되지 않는 상태다 |
| Meta SDK / MMP | 없음 |
| OTA 업데이트 (expo-updates) | 없음. JS만 바꿔도 스토어 출시가 필요하다 |
| 출시 플랫폼 | Android (Play Store) 만 |

그래서 **지금 바로 광고에 넣을 수 있는 딥링크는 없다.**

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
- [ ] 콜드 스타트 / 실행 중 두 경우 모두 테스트
  - `adb shell am start -a android.intent.action.VIEW -d "voda://home?utm_source=test" com.ppiyakworld.voda`
- [ ] v11 빌드 후 Play Store 출시

> 커스텀 스킴 `voda` 는 Android/iOS 모두 이미 등록돼 있어서, 중간 페이지 방식만 쓰면 네이티브 설정(`app.json` intentFilter) 변경은 필요 없다.

### 웹 (nginx / 프론트)

- [ ] `/go/<경로>` 중간 페이지 구현 (위 플랫폼별 분기)
- [ ] 광고로 여는 경로가 웹에서도 단독으로 열리는지 확인 (이전 단계 상태가 필요한 페이지는 피한다)
- [ ] (별도) `/.well-known/assetlinks.json`, `apple-app-site-association` 실제 파일 서빙
  - 패키지명 / 번들 ID: `com.ppiyakworld.voda`
  - Android SHA256: Play Console → 앱 무결성 → **앱 서명 키 인증서** (업로드 키 아님)
  - iOS Team ID: Apple Developer 계정 (iOS 출시 시)
  - AASA 는 확장자 없이, 리다이렉트 없이 `application/json` 으로 서빙

## 한계

- 앱이 없던 사람이 설치 후 처음 열면 광고 화면이 아니라 **홈**으로 시작한다.
  설치 후에도 해당 화면으로 보내려면(디퍼드 딥링크) Meta SDK 또는 MMP(AppsFlyer 등) 연동이 필요하다.
- 앱 설치 기여도(광고 → 설치 전환)를 Meta 에서 측정하려면 마찬가지로 Meta SDK 또는 MMP 가 필요하다.
  웹 중간 페이지 방문까지는 Meta 픽셀/UTM 으로 측정할 수 있다.

## 정해야 할 것

1. ~~광고로 열 앱 화면(경로)~~ → 홈 (`voda://home`)
2. iOS 배포 여부와 시점
