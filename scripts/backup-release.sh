#!/bin/sh
# Voda 릴리스 백업 (새 버전 출시 후 실행): 업로드 키, 버전별 매핑 파일, 손으로 고친 네이티브 설정을 iCloud Drive로 복사한다.
# 비밀번호는 복사하지 않는다 (비밀번호 관리자에 따로 보관).
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)
DEST="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Voda-release-backup"

mkdir -p "$DEST/native-config/android/app/src/main"
cp "$SRC/android/app/voda-release-key.jks" "$DEST/"
cp -R "$SRC/release-artifacts" "$DEST/"
cp "$SRC/android/app/build.gradle" "$SRC/android/app/proguard-rules.pro" "$DEST/native-config/android/app/"
cp "$SRC/android/gradle.properties" "$DEST/native-config/android/"
cp "$SRC/android/app/src/main/AndroidManifest.xml" "$DEST/native-config/android/app/src/main/"

cat > "$DEST/README.md" <<'EOF'
# Voda 릴리스 백업

- voda-release-key.jks: Play 업로드 키 (원래 위치 android/app/). alias: voda-key-alias
  비밀번호는 여기 없음 → 비밀번호 관리자 참고.
  복구 시 ~/.gradle/gradle.properties에 VODA_UPLOAD_STORE_FILE / KEY_ALIAS / STORE_PASSWORD / KEY_PASSWORD 4줄 추가.
  분실 시 Play Console → 앱 무결성 → 업로드 키 재설정 요청.
- native-config/: gitignore된 android/ 중 손으로 고친 파일 (서명 설정, R8, keep 규칙, 백업 제외 규칙).
  expo prebuild로 다시 만든 뒤 비교해서 되살린다.
- release-artifacts/: 버전별 R8 mapping.txt, JS source map (+ v9 AAB). 새 버전 빌드 후 다시 복사한다.
EOF

echo "백업 완료: $DEST"
find "$DEST" -type f | sed "s|$DEST/||" | sort
