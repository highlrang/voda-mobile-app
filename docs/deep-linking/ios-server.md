# iOS 유니버설 링크 서버 설정 (nginx)

인증 메일의 `https://voda.ppiyakworld.com/auth/...` 링크를 iOS 앱으로 열기 위한 서버 설정.
iOS 는 아래 주소의 **허락 파일**을 읽어서 "이 앱이 이 도메인 링크를 열어도 되는지" 확인한다.

```
https://voda.ppiyakworld.com/.well-known/apple-app-site-association
```

## 현재 문제

웹 `nginx.conf` 가 모르는 주소를 전부 `index.html` 로 보내서(`try_files ... /index.html`),
이 주소도 파일 대신 웹 첫 화면(HTML)이 나온다 → iOS 가 "허락 없음"으로 보고 링크를 브라우저로 연다.

## 할 일

### 1. 파일 (웹 쪽에 요청함)

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

### 2. nginx.conf (직접 적용)

`location /` **위에** 블록 하나 추가. (로컬 `fortune_web/nginx.conf` 에는 이미 반영해 둠, 미커밋)

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

반영 후 애플 쪽 캐시 갱신까지 최대 하루. 아이폰에서 앱을 지웠다 다시 설치하면 새로 확인한다.

## 안드로이드 (참고)

`https://voda.ppiyakworld.com/.well-known/assetlinks.json` 도 같은 이유로 지금 HTML 이 나온다.
Play Console → 설정 → 앱 서명의 **앱 서명 키 SHA-256 지문**이 있어야 파일을 만들 수 있다.
`.json` 확장자라 nginx 는 기본 설정으로도 JSON 으로 내려간다 (파일만 있으면 됨).
