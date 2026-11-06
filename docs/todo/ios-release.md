# iOS 출시 진행 상황

> 마지막 정리: 2026-11-06 (처음 정리 11-02). 다음 작업 때 **"다음에 할 일"**부터 이어서 하면 된다.
> 서버(nginx) 유니버설 링크 설정은 [iOS 유니버설 링크 서버 설정](../deep-linking/ios-server.md),
> 시뮬레이터 사용법은 [iOS 시뮬레이터](../testing/ios-simulator.md).

## 한눈에 보기

| 단계 | 상태 |
| --- | --- |
| App ID 등록 (`com.ppiyakworld.voda`, Associated Domains 켬) | ✅ 완료 |
| App Store Connect 앱 생성 (이름 `Voda - 운세보다`, Play 와 동일) | ✅ 완료 |
| Xcode 서명 (팀 `U4YJHU8SYV`, 아이패드 등록) | ✅ 완료 |
| 아이폰 전용 설정 | ✅ 완료 |
| 첫 업로드 `1.0.1 (1)` | ✅ 완료. 단 실제 버전은 `1.0.0` 으로 올라갔을 가능성 큼 ([문제 2](#문제-2-버전이-100-으로-고정돼-있었음)) |
| 사진 저장 시 앱 꺼짐 | ✅ 수정, 시뮬레이터 확인 ([문제 1](#문제-1-상담-결과-이미지-저장하면-앱이-꺼짐)) |
| 저장 이미지가 보이는 화면만 찍힘 (iOS) | ✅ 수정, 시뮬레이터 확인 ([문제 3](#문제-3-저장-이미지가-화면만큼만-찍히고-아래가-잘림-ios)) |
| 저장 후 하단 메뉴바 사라짐 (iOS) | ✅ 수정, 시뮬레이터 확인 (11-06), 임시 진단 코드 제거 ([문제 4](#문제-4-저장-후-하단-메뉴바가-사라짐-ios)) |
| 저장 이미지 하단 도메인 제거 | ✅ 개발 웹 반영 확인 (11-06), 운영 배포 대기 |
| 유니버설 링크 허락 파일 | ✅ 운영 인증 메일 링크로 앱 열림 확인 (11-06) |
| 유니버설 링크 nginx 설정 | ✅ 운영 실기기 동작 확인 (11-06) ([문제 5](#문제-5-인증-메일-링크가-앱이-아니라-브라우저로-열림)) |
| 수정사항 커밋 | ✅ 앱 저장소 완료 (`c02dc24`), 웹 저장소는 별도 확인 필요 |
| 빌드 `2` 업로드 → TestFlight 확인 | ✅ `1.0.1 (2)` 업로드·아이패드 설치 완료 (11-06) |
| TestFlight 실기기 이미지 저장 종료 | ✅ 빌드 `4` 아이패드 저장 성공 확인 (11-06) |
| 스토어 정보 입력 (스크린샷, 설명, 개인정보 등) | ✅ 완료 (11-06) |
| 심사 제출 | ✅ `1.0.1 (4)` 제출 완료 (11-06), 심사 결과 대기 |

## 다음에 할 일 (순서대로)

1. App Store Connect에서 `1.0.1 (4)` 심사 상태와 메시지를 확인한다.
2. 승인되면 출시 방식에 따라 수동으로 출시하거나 자동 출시를 확인한다.
3. 출시 후 App Store 설치·로그인·딥링크·이미지 저장을 최종 확인한다.

## 시뮬레이터로 앱 보기

설치·재설치·단축키는 **[iOS 시뮬레이터](../testing/ios-simulator.md)** 에 정리했다.

## 문제 1. 상담 결과 이미지 저장하면 앱이 꺼짐

✅ 수정 완료, 시뮬레이터에서 확인 (권한 팝업 → 허용 → 저장 성공).

- **원인**: iOS 는 사진첩에 접근하려면 `Info.plist` 에 **"왜 사진첩이 필요한지" 안내 문구**가 꼭 있어야 하고,
  없으면 앱을 강제로 종료한다. 문구는 `app.json`(`expo-media-library` 플러그인)에 있었지만 `ios/` 폴더가
  그 설정 전에 만들어진 채 갱신되지 않아서 빠져 있었다.
- **수정**: `ios/Voda/Info.plist` 에 `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` 추가
  ("상담 결과 이미지를 사진첩에 저장하기 위해 접근 권한이 필요합니다.").
- 참고: 첫 저장 시도에서 권한 팝업 → "저장 실패" 가 뜨는 건 정상 흐름이 아닐 수 있음.
  (사용자 확인: "처음에 권한 없어서 실패했는데, 허용 후 성공") 권한 허용 직후 바로 저장되게 할지는 나중에 검토.

## 문제 2. 버전이 `1.0.0` 으로 고정돼 있었음

✅ 수정 완료.

- `ios/Voda/Info.plist` 에 버전이 `1.0.0` / 빌드 `1` 로 **직접 적혀 있어서**, Xcode 에서 `1.0.1` 로 바꿔도
  무시됐다. 첫 업로드 빌드도 `1.0.0 (1)` 로 올라갔을 가능성이 크다 (App Store Connect 에서 확인).
- **수정**: Xcode 설정값을 따르도록 `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` 으로 변경.
  시뮬레이터 빌드에서 `1.0.1` 확인.

## 문제 3. 저장 이미지가 화면만큼만 찍히고 아래가 잘림 (iOS)

✅ 수정 완료, 시뮬레이터에서 확인 (전체 길이, 하단 메뉴바 없음, 카드 하단 테두리까지 포함).

- **동작 원리**: 웹이 결과 패널 높이를 앱에 보내면 → 앱이 웹뷰를 그 높이로 늘려서 → 통째로 캡처.
- **원인 1 (화면만 찍힘)**: iOS 에서 웹뷰를 감싼 뷰의 `flex: 1` 때문에 지정한 높이가 무시돼 화면 높이로 고정됐다.
  → 캡처하는 동안만 iOS 에서 `flex: 0` 으로 바꿔 높이가 적용되게 함 (`App.tsx`).
- **원인 2 (아래가 잘림)**: 웹이 보내는 높이는 패널 자체 높이(동적)인데, 캡처는 페이지 맨 위부터 하고
  패널 위에는 상단 여백(노치 영역 `insets.top`)이 있다. 그만큼 아래(카드 테두리·브랜드 푸터)가 잘렸다.
  → iOS 에서 `insets.top + 24pt` 를 더해서 캡처 (`SNAPSHOT_IOS_BOTTOM_MARGIN`).
- 안드로이드는 잘 된다고 해서 **iOS 에만 적용**했다.

## 문제 4. 저장 후 하단 메뉴바가 사라짐 (iOS)

✅ 수정 완료 (11-06). 저장 중 1300 → 저장 후 956 으로 복귀, 메뉴바 화면 안(837~956) 확인. 임시 진단 코드 제거함.

- **증상**: 이미지 저장 후 실제 화면에서 하단 메뉴바가 안 보임. 상담 이력 목록 등 다른 화면으로 가도 계속 안 보임.
  앱을 완전히 껐다 켜면 돌아옴. (문제 3 수정으로 생긴 부작용. TestFlight·안드로이드에는 영향 없음)
- **진단 결과**: 저장이 끝나도 웹이 화면 높이를 **1445**(캡처용으로 늘린 높이)로 알고 있었다. 실제 화면은 956.
  메뉴바가 화면 아래 바깥(1326~1445)에 그려져서 안 보이는 것.
- **추정 원인**: 캡처 후 되돌릴 때 늘렸던 높이 값이 지워지지 않고 남음 (스타일 값을 "빼기만" 하면 iOS 네이티브 뷰에 이전 값이 남는 현상).
- **수정**: 되돌릴 때 `flex: 1, flexShrink: 1, height: 'auto'` 를 **명시적으로 다시 지정** (`App.tsx`).
- **확인 결과 (11-06)**: 저장 중 컨테이너 1300 → 저장 후 956, 웹뷰 화면 높이 956, 메뉴바 837~956 (화면 안).
  사용자 화면에서도 메뉴바 정상 확인. 임시 진단 코드(`TEMP(ios-snapshot-nav)`)는 삭제함.

## 문제 5. 인증 메일 링크가 앱이 아니라 브라우저로 열림

**쉽게 말하면**: 인증 메일의 `https://voda.ppiyakworld.com/auth/...` 링크를 앱으로 열려면, iOS·안드로이드가
웹사이트의 정해진 주소에 있는 **허락 파일**을 확인한다. 지금은 그 주소에서 파일 대신 웹 첫 화면(HTML)이 나와서
"허락 없음"으로 보고 브라우저로 연다. (`voda://` 링크는 상관없이 지금도 잘 열림)

| 할 일 | 담당 | 상태 |
| --- | --- | --- |
| 허락 파일 `public/.well-known/apple-app-site-association` | 웹 쪽 | 🔶 요청함 (11-04) |
| `nginx.conf` 에 JSON 응답 블록 추가 | 직접 | ❌ 적용 예정 |
| 안드로이드 `assetlinks.json` | 웹 쪽 + 지문 전달 | ❌ Play Console → 설정 → 앱 서명의 **앱 서명 키 SHA-256** 확인 필요 |

파일 내용, nginx 블록, `curl` 확인 방법: **[iOS 유니버설 링크 서버 설정](../deep-linking/ios-server.md)**.

## 웹 쪽에 요청한 것 (11-04)

1. 저장 이미지 하단 푸터에서 도메인 제거, 로고만 가운데 (`src/app/components/ConsultationShareFooter.tsx`).
   지금 값 `vodada.ppiyakworld.com` 은 실제 도메인과 달라 오타로 보임.
2. iOS 유니버설 링크 허락 파일 (`public/.well-known/apple-app-site-association`).
3. (참고) 안드로이드 `assetlinks.json` 도 없음 — 지문은 앱 쪽에서 전달 예정.

## 이번에 바꾼 파일

**앱 저장소 (`voda-mobile-app`)** — `c02dc24`까지 커밋 완료. 이후 `app.json`에 iOS 빌드 번호 `2` 기록.

- `app.json`: `supportsTablet: false` (아이폰 전용), `ios.config.usesNonExemptEncryption: false` (수출 규정 질문 생략)
- `App.tsx`: iOS 전체 길이 캡처 + 하단 여유 (문제 3), 캡처 후 크기 복원 (문제 4)
  (+ 이 작업 전부터 하던 광고 딥링크 수정이 같은 파일에 섞여 있음)
- `docs/todo/ios-release.md`, `docs/deep-linking/ios-server.md`, `docs/testing/ios-simulator.md`: 문서
- (`docs/deep-linking/README.md`, `docs/todo/ad-deep-linking.md` 는 이 작업 전부터 수정 중이던 파일)

**`ios/` 폴더 — ⚠️ git 에서 제외(`.gitignore`)돼 있어서 커밋되지 않는다**

- `ios/Voda/Info.plist`: 사진첩 문구 2개, `ITSAppUsesNonExemptEncryption = false`, 버전이 Xcode 값을 따르도록
- `ios/Voda.xcodeproj/project.pbxproj`: 팀 `U4YJHU8SYV`, 버전 `1.0.1`, 아이폰 전용
- `ios/Podfile.lock`, `ios/Pods`: `react-native-svg` 제거 (`pod install`)

`ios/` 는 `app.json` 으로 다시 만들어지는(`npx expo prebuild`) 폴더라, **다시 만들면 위 수정이 사라질 수 있다.**
사진첩 문구·버전·암호화·아이폰 전용은 `app.json` 에도 있어서 다시 만들어도 반영되지만,
**팀 ID** 는 `app.json` 에 없다 → 필요하면 `ios.appleTeamId: "U4YJHU8SYV"` 추가 검토.
빌드 번호는 `app.json` 의 `ios.buildNumber` 로 관리할 수도 있다.

**웹 저장소 (`fortune_web`)** — 11-02 에 로컬에서 만들어 둔 것 (스테이징됨, 미커밋)

- `public/.well-known/apple-app-site-association`, `nginx.conf` (안드로이드 `assetlinks.json` 블록도 추가돼 있음)
- 웹 쪽 작업과 겹치면 정리 필요.

## 참고: Xcode 로 Archive·업로드하는 방법

1. 터미널에서 `open ios/Voda.xcworkspace` (`.xcodeproj` 말고 `.xcworkspace`)
2. 상단 가운데 기기 선택 메뉴(`Voda ›` 오른쪽) → **Any iOS Device (arm64)**
3. TARGETS Voda → General → **Build 번호 올리기**
4. 메뉴바 **Product → Clean Build Folder** (`⇧⌘K`), 그다음 **Product → Archive** (Xcode Cloud 아님)
5. Organizer → **Distribute App → App Store Connect → Distribute**
6. 10~30분 뒤 App Store Connect → TestFlight 에 빌드 표시

막혔던 것들:

- "Your team has no devices": 아이패드를 USB(C to C)로 연결 → 개발자 사이트 Devices 에 UDID
  `00008103-000E65991130801E` 직접 등록 → Xcode 완전 종료 후 재실행으로 해결.
- `Any iOS Device` 가 안 보임: Xcode 에 iOS 26.5 플랫폼이 없어서 → 기기 메뉴의 **Get** 으로 설치.
- `The manual build cannot be created because the branch ... is not associated with the workflow`:
  Xcode Cloud 메뉴를 누른 것. 무시하고 **Product → Archive** 를 누르면 된다.
- `RNSVG...metallib` 파일 없음: v9 에서 지운 `react-native-svg` 가 iOS 라이브러리 목록에 남아 있었음 →
  `cd ios && pod install` 후 Clean Build Folder 로 해결.
