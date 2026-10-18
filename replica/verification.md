# 검증 기록

## 2026-10-19 worker·설정·설치 안정화

- `python3 tools/dev.py --check-only`: 공유 dock byte 동일, Archsport Python 65/65 및 Node 6/6, matci Python 51/51 및 Node 22/22 통과. 양쪽 ESLint 오류 0, strict GSettings schema dry-run 통과. ESLint에는 사용하지 않는 예외 변수 등의 경고가 남아 있다.
- Archsport GJS의 football-data.org 비밀번호 입력 UI는 API-Football 키와 같은 `Adw.PasswordEntryRow` 흐름을 사용한다. 저장 경로는 `~/.config/archsport/football-data-token`, 파일 권한 0600, 상위 폴더 0700이며 key-revision 변경으로 worker 재시작을 요청한다. GNOME Preferences 창에서 실제 입력은 아직 검수하지 않았다.
- 점수/상태 알림에 match ID와 kickoff를 붙이고 대기열을 `XDG_STATE_HOME/archsport/pending-alerts.json`에 저장한다. 2시간 이내의 레코드 중 현재 경기 문맥에서 ID와 kickoff가 일치하는 항목만 복원한다. Node 복원 테스트에서 stale/future/다른 fixture/mismatched kickoff가 거부됐다.
- 설치기는 Archsport v11, matci v8을 `extension-updates/`에 staging했다. doctor는 두 상태 marker와 `pending_relogin=true`, 각 worker 1개를 보고한다. 현재 Shell은 두 앱 모두 v7 `ACTIVE`다. 기존 GUI를 닫지 않도록 재로그인하지 않았으며, 새 UI가 현재 표시 중이라고 주장하지 않는다.
- 중첩 GNOME 50.1 headless는 시작됐으나 감시 세션을 종료하는 동안 확장 callback과 St actor teardown이 경합해 GJS/GLib critical을 출력했다. 이를 UI 수용 통과로 세지 않는다. 메인 데스크톱은 변경하지 않았다.
- VAR는 제품 acceptance 기준에서 제외했다. replay에 점수 정정 frame은 남아 있다. README와 인계서에는 팀 3개, football-data.org 일정, API-Football live, 300–600초 interval 및 무료 데이터의 통계/lineup 한계를 반영했다.
- 최종 audit 보강: 재로그인 표식은 확장 시작 시 설치 버전과 일치할 때만 정리하고 doctor는 읽기 전용으로 남겼다. Archsport 대기 알림은 항목별 최초 시각으로 2시간 만료를 계산하며, 다른 노치나 overview가 표시를 막는 동안에도 큐에서 만료한다. matci doctor는 `/proc/locks`에서 worker lock을 수동 조회해 시작 동작을 방해하지 않으며, 설치 레이아웃의 metadata exact-version 테스트를 추가했다. 이 GJS 시작 동작과 노치 입력/포커스는 GNOME 화면에서 확인하지 않았다.
- API-Football 공식 자료에서 `/fixtures?id=ID`가 lineups/events/statistics/player blocks를 주는 경로와 무료 100 requests/day를 확인했다. 무료 계정은 시즌 및 대회별 데이터 제한이 있고 데이터 availability도 달라진다. 사용자 키는 과거 2025시즌 요청이 거부됐으므로 Barcelona·Lazio·Como 실제 fixture에서 응답과 coverage를 확인하기 전까지 lineup/statistics는 미구현으로 둔다.

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
- 실제 API 키와 대상 경기: lineup/statistics availability, 레이턴시, 오류, 골·점수 정정·HT/FT 흐름
- ASUS 패널 실제 해상도/배율/주사율, 배터리·CPU·메모리·frame time
- 완성 제품의 날짜별 일정, 다중 경기, 라인업·통계, OS 방해금지·야간 정책

이 항목들은 완료로 표시하지 않았다. 실제 Ubuntu 검수표는 `architecture.md`에 있다.

## 2026-10-18 UI 오버레이 업데이트

- 노치 배치에서 `affectsStruts:true` 투명 예약 actor를 제거하고 두 노치를 작업영역을 바꾸지 않는 chrome 오버레이로 변경했다. 빈 surface는 click-through, 명시적 버튼만 입력을 받는다. Archsport 콘텐츠 높이는 최근 경기/일정/통계에 맞추고, 점수·사건 모션은 새 이벤트에서만 실행한다.
- 설치 스크립트로 버전 7 파일을 사용자 확장 경로에 배치했다. 현재 GNOME 50.1 프로세스는 메타데이터 버전 6을 계속 보고하며, D-Bus `ReloadExtension`은 `UnknownMethod: not implemented`로 반환했다. 따라서 새 GJS UI가 현재 화면에 로드됐다고 확인하지 않았다.
- Archsport Node geometry 2/2, JS syntax, strict schema dry-run, `git diff --check` 통과. 전체 Python 27개 중 25개 통과; `test_unchanged_polls_do_not_fetch_events`, `test_live_bounds` 두 provider/scheduler 기대 테스트는 실패했으며 UI 변경 경로와 무관하다.
- 새 UI의 GJS/GNOME 시각 검수는 다음 로그인 세션에서 남아 있다. 현재 세션을 로그아웃하거나 Shell을 재시작하지 않았다.

## 2026-10-18 무료 API 시즌 제한 및 v8

- 사용자 확장 경로에 설치된 Archsport/matci v7은 GNOME Shell 50.1에서 모두 `ACTIVE`로 올라왔다. 두 worker도 실행을 확인했다. 재로그인 전 matci v5 코드가 남아 있던 이전 세션의 예외 로그는 새 세션 이후 재현되지 않았다.
- 키 파일은 로컬 0600 권한으로 존재한다. 인증은 성공했지만 `team=529&date=2026-10-18&season=2026` 요청에서 무료 플랜이 2026 시즌을 차단했고, API 오류는 2022–2024만 허용한다고 응답했다. 현재 시즌 일정·최근 경기·통계는 이 키로 확인되지 않았다.
- 같은 키로 `fixtures?live=all`은 HTTP 200 / errors 없음이었다. 검사 시점에 전 세계 라이브 응답 213건 중 Barcelona 경기는 0건이라 실경기 표시 자체는 검수되지 않았다.
- v8은 팀 일정 요청에 시즌 시작 연도를 전송하고, 시즌 권한 제한을 24시간 캐시한다. 무료 플랜이 현재 시즌을 거부하면 Barcelona만 `live=all`에서 필터링해 live 점수만 추적하며, idle은 30분·경기 중 최소 180초로 요청량을 제한한다. 설정에서 API 키를 다시 저장하면 권한 검사를 즉시 재시도한다. 무료 플랜에서 예정 경기/최근 결과/통계는 제공되지 않는다.
- v8 소스 검증: Archsport Python 30/30, Node 2/2, matci Python 42/42, Node 15/15, 양쪽 schema strict dry-run 통과. GNOME 50.1 격리 headless 세션은 시작됐으나, 종료 시 격리 Shell이 worker callback을 정리하는 과정에서 GJS critical이 남아 시각/입력 검수는 완료로 기록하지 않는다.
- 독립 코드 심사에서 일일 요청 한도 복구 시점을 수정했다. API·로컬 한도 소진 시 24시간 뒤가 아니라 다음 UTC 자정 + 5초에 재시도한다. 라이브 대체 요청은 `live=all&team=529`로 범위를 줄이고 응답도 Barcelona ID로 다시 필터링한다. 키 파일 수정 시각도 권한 제한 캐시 키에 포함해, 현재 세션의 v7 GJS 코드가 키 revision 인자를 넘기지 않아도 키를 다시 저장하면 재검사된다.
- 보강 검증: Archsport Python 33/33, Node 2/2, matci Python 42/42, Node 15/15, 양쪽 schema strict dry-run 통과. 페이지가 2개 이상인 응답은 기존 정책대로 거부한다. 이전 실제 `live=all` 응답은 213건·단일 페이지였고 Barcelona 0건이었다. v8 설치 후 `live=all&team=529` 실요청도 오류 없이 idle 응답을 반환했지만, 경기 표시 자체는 검수되지 않았다. 모의 테스트는 다른 팀 fixture가 섞인 응답에서 Barcelona만 선택하는 동작을 확인한다.
- 사용자 경로에는 v8 파일을 설치했고, 두 Python worker는 실행 중이다. `health.json`은 v8의 무료 시즌 제한·실시간 전용 상태를 보고한다. 다만 GNOME 50.1은 현재 Shell 세션에서 Archsport GJS 메타데이터 버전 7을 계속 반환하며 `ReloadExtension` D-Bus 메서드는 `UnknownMethod: not implemented`다. 로그아웃 없이 진행했으므로 현재 화면의 JavaScript UI 교체는 확인되지 않았고, 다음 GNOME 세션에서 적용/시각 검수가 필요하다. 현재는 매치가 없어 노치가 숨김 상태다.
