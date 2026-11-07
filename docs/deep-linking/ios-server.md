# iOS 유니버설 링크 서버 설정 (nginx)

인증 메일의 `https://voda.ppiyakworld.com/auth/...` 링크를 iOS 앱으로 열기 위한 서버 설정.
iOS 는 아래 주소의 **허락 파일**을 읽어서 "이 앱이 이 도메인 링크를 열어도 되는지" 확인한다.

```
https://voda.ppiyakworld.com/.well-known/apple-app-site-association
```

## 현재 상태

✅ 2026-11-06 운영 반영 및 실기기 검증 완료.

웹 `nginx.conf`의 SPA fallback과 별도로 AASA 파일을 JSON으로 서빙하도록 설정했다.
운영 인증 메일의 `https://voda.ppiyakworld.com/auth/...` 링크가 iOS 앱으로 열리는 것을 확인했다.

## 적용된 설정

### 1. 파일

`fortune_web/public/.well-known/apple-app-site-association` (확장자 없음)

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["U4YJHU8SYV.com.ppiyakworld.voda"],
        "components": [{ "/": "/auth/*" }]
      }
    ]
  }
}
```

### 2. nginx.conf

`location /` **위에** 전용 응답 블록을 둔다.

```nginx
server {
  listen 80;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  # 추가
  location = /.well-known/apple-app-site-association {
    default_type application/json;   # 확장자가 없어서 JSON 타입 직접 지정
    try_files $uri =404;             # 없으면 index.html 말고 404
  }

  # 안드로이드 App Links (.json 이라 타입은 자동, 없을 때 fallback 만 막음)
  location = /.well-known/assetlinks.json {
    try_files $uri =404;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- 웹 컨테이너 안 nginx(`fortune_web/nginx.conf`)에 넣고 웹 재배포하면 된다.
- 서버 앞단에 nginx 가 따로 있어 컨테이너로 프록시만 하는 구조면 앞단은 건드릴 필요 없다.
  단, 앞단에 `location /.well-known/` 같은 블록(인증서 발급용 등)이 있어서 이 주소를 가로채지 않는지만 확인.

## 확인

```
curl -i https://voda.ppiyakworld.com/.well-known/apple-app-site-association
```

- `200` (301/302 리다이렉트면 안 됨)
- `content-type: application/json`
- 본문에 `U4YJHU8SYV.com.ppiyakworld.voda`

설정을 변경했다면 애플 쪽 캐시 갱신까지 시간이 걸릴 수 있다. 아이폰에서 앱을 지웠다 다시 설치하면 새로 확인한다.

## 안드로이드 (참고)

✅ 2026-11-07 운영 반영 및 내부 테스트 설치본 검증 완료.

`https://voda.ppiyakworld.com/.well-known/assetlinks.json`은 클라우드 nginx가 직접 JSON으로 응답한다.
Play Console의 **앱 서명 키 SHA-256 지문**을 사용하며, Google Digital Asset Links API 조회와
메모 앱의 `/auth/verified` 링크 → Voda 앱 열림을 확인했다.
