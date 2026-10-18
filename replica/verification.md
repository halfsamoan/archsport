# 검증 기록

## 2026-10-18 Ubuntu 26.04.1 사용자 세션 적용

- ASUS Vivobook M6500QC, GNOME Shell 50.1, Wayland, eDP-1 논리 1728×972를 확인했다.
- 이 Ubuntu에서 Python 27/27, GSettings schema strict dry-run, Node 구문 검사, Archsport 공용 노치 배치 Node 2/2가 통과했다. 임시 XDG 상태에서 `--demo --once`는 demo/fresh/첫 alert null을 반환했다.
- matci와 함께 쓰는 공용 `dockModel.js`/`notchDock.js`를 Archsport에 연결했다. 설치 버전 3을 사용자 확장 폴더에 배치했다.
- GNOME 자동 시작 목록에 UUID를 추가했지만 현재 로그인 세션의 Shell은 새 확장을 아직 발견하지 못했다. 로그아웃·재로그인 후 실제 enable, 표시, worker, 동시 배치 검수가 필요하다.
- API 키는 없고 실제 경기 수신·알림은 미검증이다. 원래 P0 표의 완료 상태를 변경하지 않았다.

### 재로그인 후 초기 화면 진단

- GNOME Shell 50.1에서 버전 3이 `ACTIVE`로 로드됐고 사용자 스크린샷에서 패널 아래 Archsport와 matci 노치가 동시에 보였다. Archsport worker 1개가 실행 중이며 health는 키 없음 오류를 표시한다. 스크린샷의 API 키 설정 안내와 일치한다.
- 기본 표시 확인은 P0-01/11의 일부다. enable/disable 반복, 설정창, 수동 전환·이벤트 우선순위, 배율·절전 및 실제 경기 데이터는 별도 검수가 필요하다.

## 2026-10-18 업데이트 — 실제 구단 로고·효율·Linux 인계

- Windows Python3.12: **27/27 테스트 통과**.
- WSL Ubuntu Python3.12: 같은 **27/27 테스트 통과**. 실제 GNOME Shell 실행 검증은 아님.
- WSL의 `glib-compile-schemas --strict --dry-run extension/schemas`: 성공.
- `node --check extension/extension.js`, `extension/prefs.js`: 성공. GJS import와 화면 검증을 대체하지 않음.
- `python -m archsport --demo --once`: 성공. 실제 구단 PNG 경로 포함, mode=demo, 첫 alert=null.
- 브라우저의 실제 로고8개 모두 PNG로 로드되는 것 확인, 득점 이벤트 전환 확인.
- 실제 로고로 데스크톱/득점/390px 레퍼런스를 새로 저장했고 390px 문서 가로 overflow 없음.
- 현재 기능표57행: must34 / should13 / could5 / skip5, 상태 yes8 / partial29 / no15 / skip5.
- 신규 테스트: 변경 없는poll은 events0회, score/status변화시1회, 사건실패시점수유지, ID캐시재사용, FT관측시각영속, 키없음오류, idle/pre-game/live/FT정책, 재연결baseline, 재시작cache복구.
- 기본은 live로 변경. 개인 API키가 없어 실제 Barcelona 데이터 수신은 미검증.
- GNOME GUI·logind·worker 재시작·125/150%·로그인 자동시작은 실제 ASUS/Ubuntu에서 검수 필요. `docs/LINUX_HANDOFF.md`의 P0표를 따른다.

아래는 최초 시제품 검사 기록이며 현재 구현 범위는 위 업데이트와 인계서를 우선한다.

일시: 2026-10-18, Asia/Seoul. 실행 호스트: Windows. 대상 하드웨어 정보: 사용자 제공 ASUS Vivobook 15 Pro. Ubuntu GNOME은 아직 이 환경에서 실행하지 않았다.

## 통과한 검사

| 검사 | 결과 | 범위 |
|---|---|---|
| `python -m unittest discover -s tests -v` | **12/12 통과** | 최초 스냅샷, 중복, 재시작, VAR 정정·재득점, 수신 공백, null, 종료, 예산, API 200 오류, 페이징, PK·unknown 정규화 |
| `python -m archsport --demo --once` | 성공 | 시연 JSON 1줄, mode=demo, 첫 알림 null |
| `node --check web/app.js` | 성공 | JS 구문 |
| `node --check extension/extension.js` | 성공 | ESM 구문만. GJS import/API 호환성을 실행 검증한 것이 아님 |
| replica-design 대비 검사 | **15개 조합, AA 실패 0** | tokens.json에 선언된 주요 색 조합만 |
| 브라우저 동작 | **12개 확인** | 아래 목록 |
| 문서 가로 overflow | 없음 | 390/1366/1520px 폭 |
| 노치 화면 이탈 | 없음 | 390/1366px 폭의 expanded 상태 |
| DOM 중복 ID | 0개 | 설정 dialog와 SVG icon ID 충돌 수정 후 재확인 |

브라우저 확인: 접힘, Enter로 펼침, 상세 dialog, 득점 event, 6초 후 접힘, 변경된 점수 유지, 스포일러에서 이벤트 차단, 모션 감소, 검색 결과 없음, 한국어 팀 검색, 오프라인 표시, Escape로 설정 닫기.

브라우저 검사 중 설정 dialog와 SVG symbol의 중복 ID를 발견해 수정했다. 검색 입력의 첫 Escape는 브라우저가 검색어 지우기에 사용할 수 있어 검색 dialog는 닫기 버튼도 함께 확인했다. 모션 프레임률·스크린리더 전체 적합성·모든 해상도의 완전한 접근성을 검증한 것은 아니다.

## 레퍼런스

- `design/reference-desktop.png`: 1520×1080 전체 디자인
- `design/reference-goal.png`: 실제 웹 시제품의 득점 노치
- `design/reference-mobile.png`: 390px 반응형 시제품

수치·팀 대진·선수는 가상 시연이다. 실제 경기를 촬영한 이미지가 아니다. 원본 Apple 스크린샷도 아니다.

## 기능표 집계

총 50행. 우선순위 must 26 / should 13 / could 5 / skip 6. clone 상태 yes 5 / partial 24 / no 15 / skip 6. yes는 주로 테스트한 엔진 동작이며 전체 앱 완성을 뜻하지 않는다. partial의 native 항목은 Ubuntu 실행 검증 전이다.

## 미검증

- GNOME 46/50에서 확장 설치·렌더링·enable/disable·잠금·전체화면·모니터 변경
- 실제 API 키와 Barcelona 경기: 커버리지, 레이턴시, 오류, 골·VAR 알림
- ASUS 패널 실제 해상도/배율/주사율, 배터리·CPU·메모리·frame time
- 완성 제품의 날짜별 일정, 다중 경기, 라인업·통계, OS 방해금지·야간 정책

이 항목들은 완료로 표시하지 않았다. 실제 Ubuntu 검수표는 `architecture.md`에 있다.

## 2026-10-18 UI 오버레이 업데이트

- 노치 배치에서 `affectsStruts:true` 투명 예약 actor를 제거하고 두 노치를 작업영역을 바꾸지 않는 chrome 오버레이로 변경했다. 빈 surface는 click-through, 명시적 버튼만 입력을 받는다. Archsport 콘텐츠 높이는 최근 경기/일정/통계에 맞추고, 점수·사건 모션은 새 이벤트에서만 실행한다.
- 설치 스크립트로 버전 7 파일을 사용자 확장 경로에 배치했다. 현재 GNOME 50.1 프로세스는 메타데이터 버전 6을 계속 보고하며, D-Bus `ReloadExtension`은 `UnknownMethod: not implemented`로 반환했다. 따라서 새 GJS UI가 현재 화면에 로드됐다고 확인하지 않았다.
- Archsport Node geometry 2/2, JS syntax, strict schema dry-run, `git diff --check` 통과. 전체 Python 27개 중 25개 통과; `test_unchanged_polls_do_not_fetch_events`, `test_live_bounds` 두 provider/scheduler 기대 테스트는 실패했으며 UI 변경 경로와 무관하다.
- 새 UI의 GJS/GNOME 시각 검수는 다음 로그인 세션에서 남아 있다. 현재 세션을 로그아웃하거나 Shell을 재시작하지 않았다.
