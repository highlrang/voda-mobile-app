# 버전 9 배포 전 실기기 테스트

versionCode 9는 네이티브 라이브러리 5개를 제거했고 R8 코드 축소도 켜져 있다. 개발 빌드에서는 멀쩡해도
릴리스 빌드에서만 크래시가 날 수 있으니, **업로드할 AAB와 같은 파일**을 실기기에 설치해서 확인한 뒤 배포한다.
versionCode 8의 수정 사항(외부 링크, 하단 여백, guest id)도 아직 실기기로 확인하지 않았다면 이번에 같이 본다.

- 대상 파일: `android/app/build/outputs/bundle/release/app-release.aab` (versionCode 9, 약 21MB)
- 변경 내역: [APP_IMPROVEMENTS.md](./APP_IMPROVEMENTS.md)
- 설치 방법 상세: [ANDROID_RELEASE_APK.md](./ANDROID_RELEASE_APK.md#로컬에서-aab-설치해보기-실기기-회귀-테스트)

> ⚠️ 이 AAB는 **운영 웹(`voda.ppiyakworld.com`)** 에 붙는다. 상담 등 테스트 중의 행동이 운영 데이터로 남으니,
> 테스트 계정으로 진행한다.

## 1. 준비

- [ ] bundletool 설치: `brew install bundletool`
- [ ] 폰에서 개발자 옵션 → **USB 디버깅** 켜기
- [ ] 폰을 USB로 연결하고 PC에서 확인:
  ```bash
  adb devices   # 기기가 "device" 상태로 보여야 함 (unauthorized면 폰에서 허용 팝업 승인)
  ```
- [ ] 가능하면 **3버튼 내비게이션** 기기(또는 설정에서 3버튼으로 전환)로 테스트한다. 하단 여백 확인용이다.

## 2. 설치

Play에서 받은 Voda가 깔려 있으면 서명 키가 달라 덮어쓸 수 없다. 먼저 삭제한다.
**앱 데이터(guest id 포함)도 함께 지워진다.**

```bash
adb uninstall com.ppiyakworld.voda
```

AAB에서 이 기기용 APK를 만들어 설치한다. keystore 경로와 alias는 `~/.gradle/gradle.properties`의
`VODA_UPLOAD_*` 값을 쓰고, 비밀번호는 실행 중에 입력한다.

```bash
cd android
bundletool build-apks \
  --bundle=app/build/outputs/bundle/release/app-release.aab \
  --output=/tmp/voda-v9.apks \
  --connected-device \
  --ks=app/voda-release-key.jks \
  --ks-key-alias=voda-key-alias
bundletool install-apks --apks=/tmp/voda-v9.apks
```

테스트하는 동안 크래시 로그를 따로 띄워둔다:

```bash
adb logcat -c && adb logcat '*:E' | grep -iE "FATAL|AndroidRuntime|ReactNativeJS|voda"
```

## 3. 테스트 항목

### 기본 동작 (v9: 라이브러리 제거 + R8)
- [ ] 앱이 크래시 없이 실행되고 웹 첫 화면이 뜬다
- [ ] 로딩 인디케이터가 뜨고, 로드가 끝나면 사라진다
- [ ] 페이지 이동, 스크롤, 터치 반응이 정상이다
- [ ] 아래로 당겨서 새로고침이 동작한다
- [ ] Android 뒤로 가기: 웹 이전 페이지로 이동하고, 첫 페이지에서는 앱이 종료된다
- [ ] 화면 회전 후에도 레이아웃이 깨지지 않는다
- [ ] 비행기 모드에서 실행하면 "페이지를 불러올 수 없습니다" 화면이 뜨고, 다시 연결한 뒤 [새로고침]으로 복구된다
- [ ] 앱을 백그라운드로 보냈다가 돌아와도 상태가 유지된다

### 상담 결과 이미지 저장
- [ ] 저장 버튼 → 사진 권한 요청 → 허용 → "저장 완료" 알림이 뜬다
- [ ] 갤러리의 `Voda` 앨범에 결과 **전체**(잘리지 않음)가 저장된다
- [ ] 저장 중 오버레이("이미지 저장 중...")가 저장된 이미지에 찍히지 않는다
- [ ] 저장 뒤 화면 스크롤이 정상으로 돌아온다
- [ ] 권한을 거부하면 "사진첩 접근 권한이 필요합니다" 알림이 뜬다

### 하단/상단 여백 (v8)
- [ ] **3버튼 내비게이션**에서 하단 버튼과 CTA가 내비게이션 바에 가려지지 않는다
- [ ] 제스처 내비게이션에서도 하단 여백이 과하지 않다
- [ ] 상단 헤더가 상태 표시줄에 가려지지 않는다

### 외부 링크 (v8)
- [ ] `tel:` 링크 → 전화 앱이 열린다 (앱이 에러 화면으로 바뀌지 않음)
- [ ] `mailto:` 링크 → 메일 앱이 열린다
- [ ] 카카오 등 앱 스킴이나 `intent://` 링크 → 해당 앱이 열리고, 앱이 없으면 Play 스토어로 이동한다
- [ ] 일반 https 링크는 지금처럼 웹뷰 안에서 열린다

### 딥링크
- [ ] 커스텀 스킴으로 이메일 인증 페이지가 열린다:
  ```bash
  adb shell am start -a android.intent.action.VIEW -d "voda://auth/verified?token=test" com.ppiyakworld.voda
  ```
- [ ] 비밀번호 재설정 링크가 웹의 `/password-reset` 페이지로 열린다:
  ```bash
  adb shell am start -a android.intent.action.VIEW -d "voda://auth/password-reset?resetToken=test" com.ppiyakworld.voda
  ```
- [ ] 앱 링크(https)도 앱으로 열린다 (브라우저 선택 창이 뜨지 않음):
  ```bash
  adb shell pm get-app-links com.ppiyakworld.voda   # voda.ppiyakworld.com: verified 인지 확인
  adb shell am start -a android.intent.action.VIEW -d "https://voda.ppiyakworld.com/auth/verified?token=test"
  ```
- [ ] 앱이 꺼진 상태와 켜진 상태 모두에서 딥링크가 동작한다

### 기기 식별 / guest id (v8)
- [ ] guest 체험이 정상 동작한다 (서버가 `X-Guest-Id`, `X-Device-Id`를 받음)
- [ ] 앱을 완전히 종료했다가 다시 켜도 guest id가 같다 (서버 로그나 체험 제한 상태로 확인)

## 4. 결과 기록

| 항목 | 결과 | 비고 |
|---|---|---|
| 테스트 날짜 | | |
| 기기 / Android 버전 | | |
| 내비게이션 방식 | 3버튼 / 제스처 | |
| 기본 동작 | ⬜ | |
| 이미지 저장 | ⬜ | |
| 하단/상단 여백 | ⬜ | |
| 외부 링크 | ⬜ | |
| 딥링크 | ⬜ | |
| guest id | ⬜ | |
| logcat 크래시 | ⬜ 없음 | |

## 5. 통과 후

1. Play Console → **비공개 테스트(closed)** 트랙 → 새 버전 → `app-release.aab` 업로드
   (내부 테스트 트랙은 프로덕션 신청 조건인 14일 테스트에 포함되지 않는다)
2. 출시 노트: [APP_IMPROVEMENTS.md](./APP_IMPROVEMENTS.md)의 "versionCode 9 — 버전 설명" 문구를 붙여 넣는다
3. `APP_IMPROVEMENTS.md`의 빌드별 변경 내역 표에서 9의 상태를 "배포됨"으로 바꾼다
4. 테스트로 지운 Play 버전은, 배포 후 Play 스토어에서 다시 설치하면 된다

## 문제가 생기면

- 릴리스에서만 크래시가 나면 logcat의 스택트레이스를 확인한다. R8이 클래스를 지운 경우가 많아서,
  `android/app/proguard-rules.pro`에 `-keep` 규칙을 추가하고 다시 빌드한다.
- 빌드가 이상하면 `npm run build:clean` 후 `npm run build:aab:prod`
- 새로 빌드하면 `versionCode`는 9 그대로 둔다 (아직 업로드 전이므로).
