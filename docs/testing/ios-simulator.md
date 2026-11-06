# iOS 시뮬레이터로 앱 보기

맥에서 가상 아이폰(iPhone 17 Pro Max)을 띄워 앱을 실행한다. 아이폰·아이패드 연결 필요 없음.
(안드로이드의 에뮬레이터와 같은 역할)

## 시뮬레이터 창 열기

- `⌘ + Space` → `Simulator` 입력 → Enter
- 또는 Xcode 메뉴바 → **Open Developer Tool → Simulator**
- 이미 실행 중이면 Dock 의 Simulator 아이콘 클릭

## 앱 설치 (빌드 + 설치)

터미널에서 프로젝트 폴더(`voda-mobile-app`)로 이동한 뒤 실행.
(Claude Code 입력창에서는 앞에 `! ` 를 붙여 실행해도 된다)

```sh
# 개발 웹 (voda-dev.ppiyakworld.com) + QA 도구(ID 초기화 버튼) — 안드로이드 개발 APK 와 같은 설정
EXPO_PUBLIC_WEBVIEW_ORIGIN=https://voda-dev.ppiyakworld.com EXPO_PUBLIC_ENABLE_QA_TOOLS=true npx expo run:ios --configuration Release --device "iPhone 17 Pro Max" --no-bundler

# 운영 웹 (voda.ppiyakworld.com) — 스토어 빌드와 같음
npx expo run:ios --configuration Release --device "iPhone 17 Pro Max" --no-bundler
```

- 빌드는 몇 분 걸린다 (처음엔 5~10분). 끝나면 자동으로 설치된다.
- 끝에 `com.ppiyakworld.voda://expo-development-client/...` 를 열지 못했다는 **에러가 나와도 무시**.
  Release 빌드엔 개발 클라이언트가 없어서 나는 메시지다. 앱은 설치돼 있으니 시뮬레이터에서 Voda 아이콘을 누르면 된다.
- 개발 앱인지 확인: 오른쪽 아래에 **ID 초기화** 버튼이 보이면 개발 웹 빌드.
- 개발 웹은 데이터가 운영과 달라서 운영 계정의 상담 이력은 안 보인다.
- Archive(스토어 업로드)는 이 설정과 상관없이 항상 운영 웹.

## 재설치 (깨끗하게 다시 설치)

1. 시뮬레이터 홈 화면으로 이동 (`⇧⌘H`)
2. **Voda 아이콘을 꾹** 누름 (마우스 누른 채 1~2초)
3. **앱 제거 → 앱 삭제 → 삭제**
4. 위 [앱 설치](#앱-설치-빌드--설치) 명령 실행

앱을 지우면 **로그인, 사진 권한, guest id 가 초기화**된다.
데이터는 그대로 두고 최신 코드만 반영하려면 1~3 은 건너뛰고 4 만 하면 된다.

## 언제 무엇을 하면 되나

| 상황 | 할 일 |
| --- | --- |
| 웹만 바뀜 (voda-dev 배포 등) | 다시 빌드 필요 없음. 앱을 껐다 켜기만 하면 된다 |
| 앱 코드(`App.tsx` 등)를 바꿈 | [앱 설치](#앱-설치-빌드--설치) 명령 다시 실행 |
| 개발 웹 ↔ 운영 웹 전환 | 해당 명령으로 다시 빌드 |
| 처음 상태에서 테스트 (권한 팝업 등) | [재설치](#재설치-깨끗하게-다시-설치) |

앱 끄기: `⇧⌘H` 를 두 번 빠르게 눌러 앱 전환 화면을 띄운 뒤 Voda 화면을 위로 밀어 올린다.

## 단축키

| 동작 | 단축키 |
| --- | --- |
| 홈 화면 | `⇧⌘H` |
| 스크린샷 (바탕화면에 저장) | `⌘S` |
| 창 크기 | `⌘1` / `⌘2` / `⌘3` |

iPhone 17 Pro Max 는 6.9인치라 **App Store 스크린샷**도 여기서 `⌘S` 로 찍으면 된다.
