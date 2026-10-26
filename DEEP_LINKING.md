# 딥링크 (Deep Linking)

## 환경별 WebView 오리진

| 빌드 | 명령 | WebView 오리진 |
| --- | --- | --- |
| 개발 APK (내부 테스트) | `npm run build:apk:dev` | `https://voda-dev.ppiyakworld.com` |
| 운영 AAB (Play Store) | `npm run build:aab:prod` | `https://voda.ppiyakworld.com` |
| Metro / dev client | `npm start` | `https://voda-dev.ppiyakworld.com` |

결정 규칙 (`config.ts`):

1. 빌드 시점에 `EXPO_PUBLIC_WEBVIEW_ORIGIN` 환경변수가 있으면 그 값
2. 없고 `__DEV__` 이면 개발 오리진
3. 그 외에는 운영 오리진

즉 `./gradlew bundleRelease` 는 환경변수 없이 돌리면 자동으로 운영,
`./gradlew assembleRelease` 는 `EXPO_PUBLIC_WEBVIEW_ORIGIN=https://voda-dev.ppiyakworld.com` 를
앞에 붙여서 돌리면 개발이다. (`npm run build:apk:dev` 가 이걸 대신 해준다.)

> 환경변수를 바꾼 뒤 빌드가 이전 값을 물고 있으면 `npx expo start --clear` 로 Metro 캐시를 비운다.
> `build:apk:dev` / `build:aab:prod` 스크립트는 빌드 전에 JS 번들 산출물을 지워서, Gradle 이 이전
> 오리진이 박힌 번들을 재사용하지 않게 한다 ([ANDROID_RELEASE_APK.md](./ANDROID_RELEASE_APK.md#빌드-속도) 참고).

## 딥링크 URL

앱은 아래 딥링크를 받아 현재 환경의 WebView 오리진 뒤에 **경로 + 쿼리스트링 + 해시를 그대로**
붙여서 웹 페이지를 연다. `voda://auth/` 로 시작하는 링크만 허용된다 (`App.tsx` 의
`DEEP_LINK_ALLOWED_PATH_PREFIXES`).

| 용도 | 딥링크 URL | 열리는 웹 주소 (개발 예시) |
| --- | --- | --- |
| 이메일 인증 완료 | `voda://auth/verified` | `https://voda-dev.ppiyakworld.com/auth/verified` |
| 비밀번호 재설정 | `voda://auth/password-reset` | `https://voda-dev.ppiyakworld.com/password-reset` |

> 비밀번호 재설정은 웹 경로가 `/auth` 아래가 아니라 `/password-reset` 이라서, 앱이 경로를 바꿔서 연다
> (`App.tsx` 의 `DEEP_LINK_WEB_PATH_MAP`). 그 외 경로는 그대로 전달된다.

쿼리 파라미터(토큰 등)는 그대로 전달된다:

```
voda://auth/verified?token=abc123
voda://auth/password-reset?resetToken=abc123   → /password-reset?resetToken=abc123
```

백엔드 설정값 예시:

```
deep-link-url: voda://auth/verified
password-reset-deep-link-url: voda://auth/password-reset
```

### 운영 유니버설/앱링크 (https)

운영 빌드에 한해 아래 https 링크도 앱으로 열린다 (iOS Universal Links / Android App Links):

| 딥링크 URL |
| --- |
| `https://voda.ppiyakworld.com/auth/verified` |
| `https://voda.ppiyakworld.com/auth/password-reset` |

동작 조건:

- iOS: `https://voda.ppiyakworld.com/.well-known/apple-app-site-association` 서빙
- Android: `https://voda.ppiyakworld.com/.well-known/assetlinks.json` 서빙 (`autoVerify`)

`app.json` 설정:

- `ios.associatedDomains`: `applinks:voda.ppiyakworld.com`
- `android.intentFilters`: `https` / host `voda.ppiyakworld.com` / pathPrefix `/auth`
- 커스텀 스킴: `voda` (host `auth`)

> 개발 호스트(`voda-dev.ppiyakworld.com`)용 https 앱링크는 네이티브 빌드에 도메인이 박혀 있어서
> 지원하려면 Android product flavor / iOS configuration 분리가 필요하다. 개발 빌드에서는
> 커스텀 스킴(`voda://auth/...`)으로 딥링크를 받는다.

## 앱 내부 처리 흐름

`App.tsx`:

- `Linking.getInitialURL()` — 앱이 딥링크로 콜드 스타트된 경우
- `Linking.addEventListener('url', ...)` — 앱이 이미 실행 중일 때
- `getWebViewUrlFromDeepLink()` — 딥링크를 `${WEBVIEW_ORIGIN}<path><query><hash>` 로 변환
- 변환된 URL 로 WebView 를 리마운트 (`webViewKey` 증가)
- `lastHandledDeepLinkRef` 로 동일 링크 중복 처리 방지
