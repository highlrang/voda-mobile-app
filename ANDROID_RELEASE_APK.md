# Android Release Build (APK / AAB)

이 프로젝트는 Expo 앱이지만 `android/` 네이티브 프로젝트가 포함되어 있어서, APK/AAB는 Gradle로 빌드하면 된다.

- **APK** (`.apk`): 기기에 바로 설치하는 내부 테스트용. `assembleRelease`.
- **AAB** (`.aab`): Play Store 에 제출하는 파일. `bundleRelease`. → [Play Store 배포 (AAB)](#play-store-배포-aab)

> **환경 (개발/운영)**: 내부 테스트 APK 는 개발 웹(`voda-dev.ppiyakworld.com`), Play Store AAB 는
> 운영 웹(`voda.ppiyakworld.com`)을 바라본다. `npm run build:apk:dev` / `npm run build:aab:prod`
> 스크립트가 이걸 처리한다. 자세한 규칙과 딥링크는 [DEEP_LINKING.md](./DEEP_LINKING.md) 참고.

## Prerequisites

- Node.js / npm 설치
- Android SDK 설치
- `JAVA_HOME` 설정
- 루트 경로에서 `npm install` 완료

## Quick Build

현재 `android/app/build.gradle`의 `release` 빌드는 `debug.keystore`로 서명되도록 설정되어 있다.

이 방식은 내부 테스트용 APK를 빠르게 만드는 데는 충분하지만, Play Store 배포용으로는 쓰면 안 된다.

내부 테스트용이면 npm 스크립트를 쓰는 게 안전하다. 개발 웹 오리진 주입과 빌드 속도 옵션이
이미 들어 있다 (아래 [빌드 속도](#빌드-속도) 참고).

```bash
npm run build:apk:dev
```

Gradle 을 직접 부를 때는 **개발 APK 라도 오리진을 명시해야 한다.** 환경변수 없이
`./gradlew assembleRelease` 만 돌리면 릴리스 빌드라서 운영 웹(`voda.ppiyakworld.com`)에 붙는다
(결정 규칙은 [DEEP_LINKING.md](./DEEP_LINKING.md) 참고).

```bash
cd android
rm -rf app/build/generated/assets/createBundleReleaseJsAndAssets app/build/generated/res/createBundleReleaseJsAndAssets
EXPO_PUBLIC_WEBVIEW_ORIGIN=https://voda-dev.ppiyakworld.com ./gradlew assembleRelease
```

> JS 번들 산출물을 먼저 지우는 이유: Gradle 은 `EXPO_PUBLIC_WEBVIEW_ORIGIN` 변경을 번들 태스크의
> 입력으로 보지 않는다. 그래서 개발 APK → 운영 AAB 를 연달아 빌드하면 이전 오리진이 박힌 번들이
> 재사용될 수 있다. 번들만 지우면 네이티브(C++) 캐시는 살리면서 이 문제를 피할 수 있다.

APK 생성 위치:

```bash
android/app/build/outputs/apk/release/app-release.apk
```

## Install On Device

USB 디버깅이 연결된 기기에 바로 설치하려면:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Production Signing

실서비스용 APK를 만들려면 릴리스 전용 keystore로 서명해야 한다.

### 1. Keystore 생성

```bash
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore voda-release-key.keystore \
  -alias voda-key-alias \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

생성한 keystore 파일은 보통 `android/app/` 아래에 둔다.

### 2. `gradle.properties`에 서명 정보 추가

`android/gradle.properties`에 아래 값을 추가한다.

```properties
VODA_UPLOAD_STORE_FILE=voda-release-key.keystore
VODA_UPLOAD_KEY_ALIAS=voda-key-alias
VODA_UPLOAD_STORE_PASSWORD=your_store_password
VODA_UPLOAD_KEY_PASSWORD=your_key_password
```

실제 비밀번호를 커밋하지 않으려면, 로컬 전용 `~/.gradle/gradle.properties`에 넣는 편이 더 안전하다.

### 3. `android/app/build.gradle` 수정

현재 `release`가 `signingConfigs.debug`를 사용 중이므로, 릴리스 서명 설정을 추가해야 한다.

예시:

```gradle
signingConfigs {
    debug {
        storeFile file('debug.keystore')
        storePassword 'android'
        keyAlias 'androiddebugkey'
        keyPassword 'android'
    }
    release {
        if (project.hasProperty('VODA_UPLOAD_STORE_FILE')) {
            storeFile file(VODA_UPLOAD_STORE_FILE)
            storePassword VODA_UPLOAD_STORE_PASSWORD
            keyAlias VODA_UPLOAD_KEY_ALIAS
            keyPassword VODA_UPLOAD_KEY_PASSWORD
        }
    }
}

buildTypes {
    debug {
        signingConfig signingConfigs.debug
    }
    release {
        signingConfig signingConfigs.release
        shrinkResources (findProperty('android.enableShrinkResourcesInReleaseBuilds')?.toBoolean() ?: false)
        minifyEnabled enableProguardInReleaseBuilds
        proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        crunchPngs (findProperty('android.enablePngCrunchInReleaseBuilds')?.toBoolean() ?: true)
    }
}
```

### 4. Release APK 다시 빌드

```bash
npm run build:apk:dev
```

개발 웹에 붙일 APK 면 `assembleRelease` 앞에
`EXPO_PUBLIC_WEBVIEW_ORIGIN=https://voda-dev.ppiyakworld.com` 를 붙인다.

## Play Store 배포 (AAB)

Play Store 에 올리는 파일은 APK 가 아니라 **AAB (Android App Bundle, `.aab`)** 다.
Google Play 가 이 번들에서 기기별 APK 를 생성·서명해서 배포한다.

### 전제

위 [Production Signing](#production-signing) 의 릴리스 keystore 설정이 끝나 있어야 한다.
AAB 도 같은 `signingConfigs.release` 로 서명된다.

### 빌드

```bash
npm run build:aab:prod
```

또는 Gradle 직접 (JS 번들 산출물을 먼저 지운다 — 위 Quick Build 참고):

```bash
cd android
rm -rf app/build/generated/assets/createBundleReleaseJsAndAssets app/build/generated/res/createBundleReleaseJsAndAssets
./gradlew bundleRelease --parallel -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
```

산출물 위치:

```bash
android/app/build/outputs/bundle/release/app-release.aab
```

### 버전 올리기

업로드할 때마다 `android/app/build.gradle` 의 `versionCode` 를 이전 업로드보다 크게
올려야 한다 (현재 `versionCode 9`). `android/` 는 git 대상이 아니므로 `app.json` 의
`android.versionCode` 도 **같이** 올린다. 버전별 변경 내역은 [APP_IMPROVEMENTS.md](./APP_IMPROVEMENTS.md) 참고. 같은 `versionCode` 는 Play Console 이 거부한다.
`versionName` ("1.0.0") 은 사용자에게 보이는 문자열이라 필수는 아니지만 같이 올리는 게 보통이다.

### 업로드

1. [Play Console](https://play.google.com/console) → 앱 선택
2. 테스트(내부/비공개) 또는 프로덕션 트랙 → **새 버전 만들기**
3. `app-release.aab` 업로드 → 출시 노트 작성 → 검토 후 출시

### Play App Signing

최초 등록 시 Google 이 **앱 서명 키**를 생성·보관하고, 우리가 만든 keystore 는
**업로드 키**가 된다. 즉 실제 배포 APK 의 최종 서명은 Google 이 다시 한다.
업로드 키를 잃어버리면 Play Console 에서 재설정 요청이 가능하지만, 앱 서명 키는 복구 불가다.
keystore 파일과 비밀번호는 안전한 곳에 백업해 둘 것.

### 로컬에서 AAB 설치해보기 (실기기 회귀 테스트)

AAB 는 `adb install` 로 바로 안 되고 [bundletool](https://github.com/google/bundletool) 이 필요하다.
업로드할 파일과 **같은 산출물**(R8 축소 포함)을 테스트할 수 있어서, 네이티브 의존성을 바꾼 빌드는
업로드 전에 이 방법으로 확인한다.

```bash
brew install bundletool   # 최초 1회
adb devices               # USB 디버깅 켠 폰이 보이는지 확인
```

> 이미 Play 에서 설치한 앱이 있으면 서명 키가 달라(Play 앱 서명 vs 업로드 키) 덮어쓰기가 안 된다.
> 먼저 `adb uninstall com.ppiyakworld.voda` 로 지운다. 이때 앱 데이터(guest id 포함)도 지워진다.

```bash
cd android
bundletool build-apks \
  --bundle=app/build/outputs/bundle/release/app-release.aab \
  --output=app-release.apks \
  --connected-device \
  --ks=app/voda-release-key.keystore \
  --ks-key-alias=voda-key-alias
bundletool install-apks --apks=app-release.apks
```

Play Console 의 **내부 앱 공유**(Internal app sharing)에 AAB 를 올리면, 심사 없이 설치 링크가 바로 나온다.
USB 연결 없이 다른 테스터 폰에 깔 때 편하다.

## 빌드 속도

`build:apk:dev` / `build:aab:prod` 스크립트에 들어 있는 옵션:

- `-PreactNativeArchitectures=armeabi-v7a,arm64-v8a`: 실제 폰(ARM)만 빌드한다. x86/x86_64 는
  에뮬레이터·일부 크롬북용이라 뺐다. 에뮬레이터용 빌드가 필요하면 이 옵션 없이 Gradle 을 직접 부른다.
- `--parallel`: 모듈을 병렬로 빌드한다.
- `-Dorg.gradle.jvmargs='-Xmx4g …'`: R8/리소스 축소를 켠 상태에서 기본 2GB 힙은 부족하다.
- `clean` 을 하지 않는다. C++ 캐시를 재사용하고, JS 번들 산출물만 지운다.

## Clean Build

네이티브 의존성을 추가/제거했거나 이전 빌드 산출물 때문에 문제가 생기면:

```bash
npm run build:clean
npm run build:aab:prod   # 또는 build:apk:dev
```

> `build:clean` 은 `gradlew clean` 전에 `android/app/.cxx`(CMake 캐시)를 먼저 지운다. 네이티브 라이브러리를
> 제거한 뒤에는 이 캐시가 없어진 라이브러리 경로를 참조해서 `externalNativeBuildCleanRelease` 가
> `GLOB mismatch` / `Configuring incomplete` 로 실패하기 때문이다.

> 예전에는 `clean` 과 빌드를 한 호출에 묶으면 reanimated/worklets 의 prefab 순서 문제로 빌드가
> 깨져서 별도 호출로 나눴다. versionCode 9 에서 두 라이브러리를 제거하면서 이 문제는 없어졌다.

## Notes

- 앱 패키지명은 `com.ppiyakworld.voda`다.
- 현재 버전 정보는 `android/app/build.gradle` 기준 `versionCode 7`, `versionName "1.0.0"`이다.
- Play Store 제출 파일은 AAB다 → [Play Store 배포 (AAB)](#play-store-배포-aab).
