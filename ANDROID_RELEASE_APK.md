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

내부 테스트용이면 npm 스크립트를 쓰는 게 안전하다. 개발 웹 오리진 주입 + `clean` 분리가
이미 처리돼 있다.

```bash
npm run build:apk:dev
```

Gradle 을 직접 부를 때는 **개발 APK 라도 오리진을 명시해야 한다.** 환경변수 없이
`./gradlew assembleRelease` 만 돌리면 릴리스 빌드라서 운영 웹(`voda.ppiyakworld.com`)에 붙는다
(결정 규칙은 [DEEP_LINKING.md](./DEEP_LINKING.md) 참고).

```bash
cd android
./gradlew clean
EXPO_PUBLIC_WEBVIEW_ORIGIN=https://voda-dev.ppiyakworld.com ./gradlew assembleRelease
```

> `clean` 과 `assembleRelease` 는 **별도 호출**로 나눈다. 한 호출에 묶으면
> (`./gradlew clean assembleRelease`) `react-native-reanimated` 의 CMake configure 가
> `react-native-worklets` 의 prefab 패키지 생성보다 먼저 돌아
> `prefab ... is not readable` 로 빌드가 깨진다.

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
cd android
./gradlew clean
./gradlew assembleRelease
```

`clean` 은 별도 호출로 나눈다 (아래 [Clean Build](#clean-build) 의 주의 참고).
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

또는 Gradle 직접 (`clean` 은 별도 호출):

```bash
cd android
./gradlew clean
./gradlew bundleRelease
```

산출물 위치:

```bash
android/app/build/outputs/bundle/release/app-release.aab
```

### 버전 올리기

업로드할 때마다 `android/app/build.gradle` 의 `versionCode` 를 이전 업로드보다 크게
올려야 한다 (현재 `versionCode 7`). 같은 `versionCode` 는 Play Console 이 거부한다.
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

### 로컬에서 AAB 설치해보기 (선택)

AAB 는 `adb install` 로 바로 안 되고 [bundletool](https://github.com/google/bundletool) 이 필요하다.

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

## Clean Build

이전 빌드 산출물 때문에 문제가 생기면:

```bash
cd android
./gradlew clean
./gradlew assembleRelease
```

> **`clean` 은 반드시 별도 호출로.** `./gradlew clean assembleRelease` 처럼 한 호출에 묶으면
> `react-native-reanimated` 의 CMake configure 태스크(`configureCMakeRelWithDebInfo`)가
> `react-native-worklets` 의 prefab 패키지가 만들어지기 전에 실행돼서 아래처럼 깨진다:
>
> ```
> [CXX1429] ... prefab ...
> Error: invalid value for <package_path>: directory
>   ".../react-native-worklets/android/build/intermediates/prefab_package/release/prefab"
>   is not readable.
> ```
>
> reanimated 4.x + worklets 0.5.x + RN 0.81 조합의 gradle 플러그인 태스크 의존성 누락 이슈다.
> `clean` 을 먼저 끝내면 다음 호출에서 worklets prefab 태스크가 reanimated 보다 먼저 스케줄된다.
> 그래도 안 되면 worklets 를 먼저 명시적으로 빌드한다:
>
> ```bash
> ./gradlew :react-native-worklets:assembleRelease
> ./gradlew assembleRelease
> ```

## Notes

- 앱 패키지명은 `com.ppiyakworld.voda`다.
- 현재 버전 정보는 `android/app/build.gradle` 기준 `versionCode 7`, `versionName "1.0.0"`이다.
- Play Store 제출 파일은 AAB다 → [Play Store 배포 (AAB)](#play-store-배포-aab).
