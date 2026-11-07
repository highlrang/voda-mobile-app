# TODO

진행 중이거나 앞으로 할 작업을 모아 둔다. 완료하면 남겨야 할 운영 지식만 `docs/`로 옮기고, 특정 버전에만 해당하는 자료는 `docs/archive/`로 옮긴다.

## 진행 중

- [iOS 출시](./ios-release.md) — `1.0.1 (4)` 심사 제출 완료, 결과 대기 중
- [Meta 광고 딥링크](./ad-deep-linking.md) — Android 검증 완료·v11 운영 심사 제출 예정, iOS 출시 뒤 통합 테스트

## 현재 상태

1. Android `assetlinks.json`, 인증 HTTPS 앱링크, 광고 `/go/home` 설치·미설치·재호출 검증 완료.
2. Android v11 운영 심사 제출 예정.
3. iOS `1.0.1 (4)` 심사 결과 대기 중.

iOS 광고 딥링크의 App Store 이동과 앱 열기는 iOS 출시 후 최종 테스트한다.

## 다음 배포

- [앱 개선 문서의 `다음 순서`](../releases/improvements.md#다음-순서) — Android v11 광고 딥링크 배포·검증 절차

## 상태 규칙

- 실제로 할 일이 남아 있는 문서만 이 폴더에 둔다.
- 완료된 설정·배포 방법은 `docs/`의 해당 분류로 옮긴다.
- 다시 볼 가능성이 낮고 Git 이력만으로 추적할 수 있는 문서는 삭제한다.
