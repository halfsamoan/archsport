# 인계용 데이터

- `provider-fixture.json`: 공급사 응답 **형식**을 재현한 수작업 테스트 fixture. 실제 API에서 받은 경기 기록이 아님.
- `replay-barcelona.json`: 경기 전 → 시작 → 골 → VAR 취소 → 재득점 → HT → 오프라인 → 후반 → 골 → FT의 가상 시나리오.
- `../web/assets/logos/529.png`, `505.png`: API-Sports 미디어 서비스에서 받은 실제 Barcelona·Inter 구단 마크. 원본 PNG, 무편집.
- `../web/assets/logos/manifest.json`: 로고 출처 URL, 취득 시각, SHA-256.
- `../replica/screens/`: 사용자가 제공한 원본 분석 참고 이미지.
- `../replica/design/reference-*.png`: 웹 시제품 화면 캡처.

실제 라이브 경기 데이터는 API 키가 없어 이 저장소에 없다. 로컬 API 키, 사용자 SQLite, dconf, 쿠키, 환경변수, 브라우저 세션을 데이터와 함께 넣지 않는다. 새 Linux의 실제 데이터는 개인 키로 조회해서 로컬 캐시에 쌓는다.

```bash
python3 -m archsport --replay data/replay-barcelona.json
```

CLI replay는 4초 간격으로 순서대로 내보낸다. 네트워크 오류 뒤 복구 프레임은 기준값으로 처리한다. 실제 5분 종료 정책은 scheduler 테스트로 별도 검증하며, 이 빠른 replay를 시계 정확도 검증으로 쓰지 않는다.
