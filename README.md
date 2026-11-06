# Voda Mobile App

Voda WebView 앱의 네이티브 프로젝트와 운영 문서를 함께 관리한다.

## 문서 안내

진행 중이거나 앞으로 할 작업은 [todo 목록](./docs/todo/README.md)에서 한눈에 확인한다.

### 배포·버전

- [Android APK/AAB 빌드와 Play Store 배포](./docs/releases/android.md)
- [앱 개선 및 버전별 변경 이력](./docs/releases/improvements.md)

### 딥링크

- [딥링크 구조와 환경별 WebView 오리진](./docs/deep-linking/README.md)
- [iOS 유니버설 링크 서버 설정](./docs/deep-linking/ios-server.md)

### 설계·테스트

- [네이티브 기기 식별 계약](./docs/architecture/native-device-identity.md)
- [iOS 시뮬레이터 실행법](./docs/testing/ios-simulator.md)

### 보관 문서

- [v9 배포 전 실기기 테스트](./docs/archive/v9-device-test.md) — 완료된 특정 버전의 체크리스트

## 문서 배치 규칙

- 현재 유효한 배포 절차와 운영 상태는 `docs/releases/`
- 딥링크와 도메인 연동은 `docs/deep-linking/`
- 앱과 웹 사이의 기술 계약은 `docs/architecture/`
- 반복 사용하는 QA 방법은 `docs/testing/`
- 특정 버전에만 해당하는 완료 자료는 `docs/archive/`
- 진행 중이거나 아직 시작하지 않은 작업은 `docs/todo/`
