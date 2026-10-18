# matci + Archsport 구현·검증·운영 총정리

기준일: 2026-10-19 (Asia/Seoul)
이 문서는 두 앱의 현재 코드, 검증 근거, 미완료 항목, 사용자 세션 적용 상태를 한곳에 모은 기준 문서다. 화면 스크린샷이나 과거 계획 문서는 제품 요구를 이해하는 참고 자료이며, 실제 동작 여부는 여기 적힌 소스·테스트·런타임 증거로 구분한다.

## 한눈에 보는 상태

| 구분 | Archsport | matci |
|---|---|---|
| 역할 | Barcelona·Lazio·Como 축구 일정, 경기 중 점수·이벤트, 노치 알림 | 시스템 RAM·앱 메모리 관찰, 사용자가 고른 앱 창의 정상 닫기 요청 |
| 구조 | GNOME Shell 확장 + Python worker + football-data.org 일정 + API-Football 라이브 | GNOME Shell 확장 + Python `/proc` worker + UID 범위 SQLite 기록 |
| 소스 버전 | 13 | 10 |
| 현재 GNOME 상태(2026-10-19 확인) | 설치/GJS v11 ACTIVE; workspace v13은 GitHub 반영 후 새 UI 적용 검수 대기 | 설치/GJS v8 ACTIVE; workspace v10은 GitHub 반영 후 새 UI 적용 검수 대기 |
| 자동 검증 | Python 65/65, Node 12/12, ESLint 0 errors, strict schema 통과 | Python 51/51, Node 27/27, ESLint 0 errors, strict schema 통과 |
| 실기 범위 | football-data 일정 3개·최근 결과 5개, API-Football 라이브 경기 1개 수신 확인; v11 worker 실행 확인. 새 버전의 화면 모양·실제 알림은 시각 검수 전 | 현재 Ubuntu `/proc` smoke 통과; 실제 GUI 창 닫기와 두 노치 배치는 미검증 |

두 코드는 별도 저장소다. Archsport는 `/home/k/workspace/arch/archsport`, matci는 `/home/k/workspace/arch/matci`에 있다. 두 앱은 Python worker나 SQLite를 공유하지 않는다. GNOME Shell의 작은 노치 배치 등록부만 공유한다.

2026-10-19 UI/수명주기 변경과 제한된 PNG 캡처 분석은 [디자인 검토 보고서](docs/design-review/2026-10-19-review.md)를 따른다. 현재 실행 중인 GNOME 확장은 이전 설치 버전이다. 사용자 로그아웃/재로그인 없이 저장소 소스를 갱신했으므로 실제 GJS 화면·입력·종료 동작은 아직 새 코드 검수가 아니다.

## 목표와 결정

- 스포츠 대상은 최신 구성에서 Barcelona, Lazio, Como 세 팀이다. 이전 단일 Barcelona 안내는 과거 상태다.
- 경기가 없을 때 Archsport 노치를 숨기고, 경기가 시작되거나 일회성 일정 알림이 있을 때만 표면에 표시한다. 사용자는 패널 메뉴에서 일정을 직접 열 수도 있다.
- 2시간 전·15분 전 알림은 각 경기마다 한 번 기록한다.
- 일정은 무료 football-data.org, 점수·시간·상태·이벤트는 API-Football로 나눴다. 내부 경기 식별자와 공급사 ID도 분리했다.
- football-data.org 키도 Preferences의 비밀번호 입력란에서 저장할 수 있다. API-Football 키와 함께 `0600`으로 저장되고 변경 시 worker를 재시작한다.
- VAR 알림은 사용자가 제외하기로 한 제품 요구사항이므로 acceptance test에서 제외한다. 데모의 점수 정정 frame/test는 유지한다.
- matci는 관찰·검토 도구다. 앱 프로세스를 종료하거나 캐시를 지우지 않고, 사용자가 확정한 현재 창에 일반 닫기 요청만 보낸다.
- 공유 화면 우선권은 matci 수동 검토 100, Archsport 경기 알림 80이다. 스포츠 알림이 matci 검토 중 도착하면 대기 후 표시한다.
- 외부 코드 심사에서 발견한 matci 우선권 중 스포츠 알림 유실, 유휴 live polling의 무료 quota 낭비, 일정 공급사 장애 시 live 탐색 중단을 각각 알림 대기열, 경기 시간대 제한 polling, 장애·빈 일정의 30분 live fallback으로 보완하고 회귀 테스트를 추가했다.
- macOS의 Dynamic Island를 시각 참고로 삼았지만 실제 구현은 Ubuntu GNOME용 `affectsStruts:false` 오버레이다. 기본 패널·기존 창 위치를 예약하거나 이동시키지 않는 것이 코드 목표다.

## 시스템 구성

```mermaid
flowchart TD
  Shell[GNOME Shell]
  AExt[Archsport 확장 · GJS]
  APy[Archsport Python worker]
  FD[football-data.org · 일정/결과]
  AF[API-Football · live/events]
  ADB[(Archsport SQLite cache/state)]
  MExt[matci 확장 · GJS]
  MPy[matci Python worker]
  Proc[/proc · 같은 UID 프로세스]
  MDB[(matci UID 전용 SQLite)]
  Dock[Main.layoutManager 노치 등록부]

  Shell --> AExt --> APy
  APy --> FD
  APy --> AF
  APy --> ADB
  APy --> AExt
  Shell --> MExt --> MPy
  MPy --> Proc
  MPy --> MDB
  MPy --> MExt
  AExt --> Dock
  MExt --> Dock
```

GJS는 화면·설정·수명주기를 담당한다. 네트워크 요청과 `/proc` 수집은 각자 소유한 Python 자식 프로세스에서 수행하고 JSON Lines로 결과를 넘긴다. systemd 서비스, 외부 서버, 계정 로그인을 추가하지 않았다.

## Archsport 구현

### 데이터 흐름

1. **일정 조회:** football-data.org에서 La Liga(`PD`), Serie A(`SA`), Champions League(`CL`)를 조회한다. 오늘을 기준으로 28일 전부터 28일 후까지 7일 이하 구간 9개로 나눠 무료 API 날짜 범위 제한을 맞춘다.
2. **캐시:** 각 기간 결과를 SQLite에 6시간 캐시한다. 공급사 오류 시 기존 구간 캐시가 있으면 일정은 계속 표시하고, 없으면 일정 상태와 오류를 분리한다. football-data.org 분당 한도는 별도 SQLite 요청 기록으로 10회/분 이하로 관리한다.
3. **팀 정규화:** `FC Barcelona`/`Barcelona`, `SS Lazio`/`Lazio`, `Como 1907`/`Como` 별칭을 내부 키로 맞춘다. 결과 목록은 각 팀의 다음 경기와 최근 경기 최대 9개를 정규화한다. 두 관심 팀이 서로 경기하면 같은 경기 행을 중복하지 않는다.
4. **내부 경기 ID:** `match:<home>:<away>:<UTC 날짜>` 형태로 구성한다. football-data.org 경기 ID와 API-Football fixture ID는 `source_ids`에 각각 보관한다. 양 공급사의 팀 방향과 킥오프가 20분 이내로 일치할 때 같은 경기로 연결한다.
5. **라이브 탐색:** 라이브 worker는 경기와 관계없이 계속 질의하지 않는다. 알려진 킥오프 5분 전부터 킥오프 후 30분 사이에 `fixtures?live=all`을 탐색한다. 시작 뒤 라이브 경기가 확인되면 설정된 5~10분 간격으로 업데이트하고 마지막 라이브 응답이 사라진 뒤 15분간만 재확인한다. worker가 경기 시간 중 새로 켜지면 최근 4시간 안의 일정 경기에 대해 시작 시 한 번 확인한다. 일정 공급사가 오류를 반환하거나 일정 없이 시작한 경우에는 라이브 피드를 시작 시 한 번, 이후 30분 간격으로만 확인한다. 알려진 일정의 킥오프 구간은 이 장애 대기보다 우선한다. API-Football의 일일 요청 예산은 90회이며 초과 예약은 worker가 차단한다.
6. **경기 이벤트:** 감시 팀의 live fixture만 정규화한다. 점수·상태가 바뀌면 API-Football fixture ID로 events를 한 번 요청한다. 이벤트 요청이 실패해도 새 점수는 저장하고 다음 변경 시 다시 상세를 시도한다. 첫 관측은 과거 골을 새 알림으로 오인하지 않도록 기준값만 저장한다.
7. **알림·표시:** 2시간·15분 알림은 SQLite 영수증으로 중복을 막는다. 점수/상태 이벤트는 match snapshot과 fingerprint로 중복을 막는다. 스포츠 노치는 진행 경기가 있을 때만 보이고, 알림은 기본 6초 유지한다. 현재 안정화 범위에는 spoiler 설정이 남아 있다. 명세의 spoiler 제거와 VAR UX 정리는 기능 안정화 뒤 별도 제품 정리 작업으로 미뤘다.

### 요청량과 제한

- API-Football 무료 기본 허용량은 공식 요금표 기준 100회/일이며 Archsport 기본 로컬 상한은 90회/일이다. 무료 계정은 endpoint를 쓸 수 있어도 허용 season이 제한된다. 일정이 있을 때만 라이브를 요청하고 live 최소 간격은 300초다. 이벤트 상세 요청은 별도 API 호출로 예산을 사용한다.
- football-data.org 일정은 9회 요청/6시간 캐시 갱신이며 10회/분 한도와 별도로 계산된다. 전체 구간을 처음 새로 채울 때 실제 요청은 연속된 9회이므로 다른 football-data.org 사용량이 같은 키에 더해지면 분당 제한에 걸릴 수 있다.
- 화면 설정의 라이브 간격은 300~600초다. 300초보다 더 빠른 스포츠 갱신은 무료 일일 할당량을 세 팀이 나눠 쓰는 조건과 맞지 않아 허용하지 않는다.
- CPU/프로세스 전체 polling은 API 조회 간격과 별개다. Python worker 한 개가 상태를 갱신하고 다음 일정을 기다린다.
- API가 `retry_seconds`를 주면 그 시각 전까지 live endpoint를 다시 호출하지 않는다. worker는 그동안에도 예정된 2시간/15분 알림과 최대 6시간 일정 캐시 갱신은 계속한다. 경기 중 갱신 주기는 설정의 300~600초를 사용한다.
- provider 쿨다운이 해당 경기의 live 감시 구간보다 길면 그 경기의 실시간 점수/이벤트를 놓칠 수 있다. 일정·결과와 예정 알림은 계속 제공되지만, 경기 종료 후 live 이벤트를 복구해 알리지는 않는다.

### 노치 화면·상호작용

- Archsport 접힌 상태는 클럽 문장/이름, 스코어와 분·상태를 한 줄로 보여준다. 펼친 상태는 경기 카드, 다음 경기, 최근 결과와 이벤트를 표시하며 일정은 달력 아이콘, 최근 결과는 기록 아이콘, 설정·접기는 접근성 이름이 있는 아이콘 버튼으로 제공한다.
- 경기 상태가 없으면 노치를 숨기고 진행 중인 경기 또는 일회성 알림에서만 나타난다. 화면 너비에 따라 280px compact / 최대 520px expanded로 제한하고, 280ms cubic ease 크기 전환을 사용한다. overview, 잠금, 설정된 전체화면, 절전 때는 숨긴다.
- 매치 이벤트는 득점 아이콘/상태와 짧은 자동 접힘으로 표시한다. spoiler 설정 시 점수·자동 확장 알림을 감춘다. data error는 offline 아이콘/문구로 구분한다. spoiler 옵션은 후속 제품 정리 작업에서 제거 예정이다.
- 수동 펼침 중 matci가 우선권을 가지면 스포츠 알림은 재시도 대기한다. 대기 알림은 `XDG_STATE_HOME/archsport/pending-alerts.json`에 저장하고, 최초 대기 시각 기준 2시간 이내이며 현재 payload의 경기 ID·킥오프가 일치하는 항목만 복원한다. 다른 노치·overview·fullscreen이 표시를 막는 동안에도 만료하며, 실제 GNOME Shell 재시작 후 표시 여부는 아직 기기에서 확인하지 않았다.

### 코드 지도

| 경로 | 책임 |
|---|---|
| `archsport/football_data.py` | 경기 일정·결과, 인증 헤더, 구간/캐시·분당 제한, stale cache |
| `archsport/provider.py` | API-Football live fixture·events, provider ID 기준 상세 요청 |
| `archsport/composite.py` | 두 공급사 수명·오류 분리, 킥오프 기준 live 조회 일정 |
| `archsport/identity.py`, `archsport/teams.py` | 공급사 중립 경기 식별·팀 별칭·감시 팀 목록 |
| `archsport/engine.py` | SQLite snapshot, 알림 receipt, 하루 요청 상한, 공급사 요청 시간 기록 |
| `archsport/scheduler.py`, `archsport/service.py` | 경기 전 깨우기·라이브 간격·다중 경기 ingest·중복 알림 방지 |
| `archsport/__main__.py` | CLI 구성, JSON Lines worker, XDG 상태/health 파일 |
| `extension/extension.js` | 노치·경기 카드·일정/최근 결과·알림 대기·worker 수명 관리 |
| `extension/notchDock.js`, `extension/dockModel.js` | matci와 화면 배치·점유 우선권 계산 |
| `extension/prefs.js`, `extension/schemas/` | 팀, 데이터 모드, 키 상태, 갱신 간격, 예산, spoiler 및 모니터 설정 |
| `tools/install_extension.py` | 사용자 확장 폴더 설치·이전 확장 백업 |
| `tests/` | 공급사, 다중 경기, schedule, receipt, polling, 배치 우선권 검사 |

### 현재 남은 Archsport 기능

| 기능 | 상태 | 이유/범위 |
|---|---|---|
| 세 팀의 지원 리그·UCL 일정과 최근 결과 점수 | 구현·실 API 확인 | 무료 일정 응답은 지연될 수 있음 |
| 경기 전 2시간/15분 알림 | 코드·단위 테스트 완료 | 장기간 실제 GNOME 알림 수신은 미검증 |
| 라이브 점수·시간·상태 및 변경 이벤트 | 코드·실 API 응답 확인 | 실제 Como 라이브 fixture 한 건을 adapter에서 받음; 실제 득점 이벤트와 노치 화면은 별도 경기 때 확인 필요. VAR 알림은 제품 요구사항에서 제외 |
| 최근 경기 세부 통계 | 미구현 | API-Football은 fixture ID로 경기 통계를 제공하지만 competition·season coverage와 계정의 시즌 권한에 좌우된다. 현재 사용 키는 2025시즌 요청을 제한해 실제 경기 통계를 검증하지 못했다. |
| 선발 lineup·라인업 발표 알림 | 구현 경로 확인, 미구현 | football-data 일정에서 날짜 후보를 찾고 API-Football `/fixtures?date=YYYY-MM-DD` 결과를 팀·UTC kickoff로 대조해 fixture ID를 얻은 뒤 `/fixtures?id=ID`로 lineups/events/statistics를 요청할 수 있다. 무료 플랜은 100 calls/day이고 시즌 권한 및 대회 coverage에 제한이 있어 현재 키에서 실제 경기 응답을 확인하기 전까지 제품 기능으로 완료 처리하지 않는다. [API-Football fixture 안내](https://www.api-football.com/news/post/fifa-world-cup-2026-guide-to-using-data-with-api-sports), [요금제](https://www.api-football.com/pricing/), [coverage](https://www.api-football.com/coverage) |
| 국내 컵 일정 | 미구현 | 무료 football-data.org coverage에 확실히 포함되지 않는다. 제안에 있던 ESPN endpoint는 비공식이라 제품 의존성으로 추가하지 않았다. |
| 네트워크 복구·요금 제한·캐시 fallback | 구현·모의 응답 테스트 완료 | GNOME 알림 UI까지 실기 재연은 미완료 |

### 스포츠 provider 조사에서 확인한 제약

- football-data.org 무료 제공 대회 목록은 La Liga, Serie A, Champions League를 포함한다. 경기 일정/점수는 지연될 수 있으며 lineups, substitutions, scorers/cards 같은 세부 항목은 무료 범위가 아니다.
- 실제 테스트에서 football-data.org의 7일 요청은 성공했다. API-Football `fixtures?team=529&next=1`과 `fixtures?team=529&season=2025&last=3`은 사용자 무료 계정의 season 제한 오류로 거절됐다. 따라서 일정과 live를 분리했다. 최근 경기 세부 통계는 현재 무료 키에서 최신 시즌 데이터를 확인할 수 없어 미구현으로 남겼다.
- 실제 팀 ID는 API-Football에서 Barcelona 529, Lazio 487, Como 895로 확인했다. 현재 API key 파일은 사용자 전용 `0600`이다.
- football-data 키가 과거 `/home/k/workspace/arch/football data api.md`에 평문으로 들어 있어 그 문서는 안전한 로컬 파일 경로만 남기도록 고쳤고, 실제 키는 `~/.config/archsport/football-data-token`으로 이동했다. 키 값은 이 문서와 Git에 싣지 않는다. 해당 파일을 다른 곳에 공유했거나 커밋했다면 공급사에서 키를 교체하는 편이 안전하다.

## matci 구현

### 관측과 창 닫기 흐름

1. matci Python worker는 Linux `/proc`에서 `MemTotal - MemAvailable` 전체 RAM을 읽는다. 5초마다 현재 UID 프로세스만 수집하고 PID, 시작 tick, UID를 함께 확인해 PID 재사용/레이스/권한 누락을 구분한다.
2. 프로세스는 최대 256개까지 보고하고 각 sample에서 PSS 측정은 최대 20개, 동일 프로세스 PSS는 최대 10초 캐시한다. PSS를 못 읽으면 RSS로 남긴다. 서로 다른 metric의 수치를 합산해 앱 메모리라고 표현하지 않는다. CPU는 두 샘플 간 tick 차이, memory PSI는 커널이 제공할 때만 표시한다.
3. 기본 화면은 패널 RAM 사용률이다. 사용자가 열 때만 상세 overlay를 띄워 전체 RAM, 관측 가능한 앱별 메모리, 보호·불명확 상태를 보여준다. 제안 팝업은 opt-in이며 기본 꺼짐이다.
4. 앱을 사용자가 선택하고 요청을 확정하면 GJS가 해당 앱의 현재 GNOME 창에 `Meta.Window.delete()` 일반 닫기 요청을 보낸다. worker가 요청을 먼저 저장하고, 새 sample에서 앱/창/PID/UID/start tick을 다시 확인한다. 이후 최대 10초 동안 창이 닫혔는지 관찰하고 결과를 기록한다.
5. 보호 앱, 개발·터미널 작업, 불명확한 PID 매핑, 부분 관측, stale sample, PID가 재사용된 창은 닫기 요청에서 거부된다. 앱에 signal/kill/SIGKILL을 보내지 않는다. 창 닫힘 확인은 프로세스 전체 종료를 뜻하지 않는다.

### 개인 정보와 보존

- 앱은 네트워크 요청을 하지 않는다. 원시 명령줄과 창 제목을 저장하지 않는다. same-UID 수집과 GNOME 창/PID mapping을 사용한다.
- `~/.local/state/matci/`는 소유자 UID 검증·symlink 거부·단일 worker lock을 적용하고 폴더 0700, 파일 0600 권한으로 유지한다.
- sample은 24시간, action receipt는 30일 또는 1000개까지 보존한다. 설정 UI용 요약은 최근 100개/최대 120KiB이며, 앱 목록 관측 전체를 매 5초 영구 기록하지 않는다. 앱 view 분류는 사용자가 닫기 요청을 확인할 때 action receipt에 포함된다.
- worker는 종료된 창을 자동으로 정리하거나 디스크를 비우지 않는다. `force_exit()`는 matci가 소유한 Python worker를 정리하는 수단이다.

### 노치 화면·상호작용

- 패널에는 RAM 사용률을 상시 짧게 표시하고 클릭하면 세부 화면을 연다. 확장 화면은 정상 관측 시 작은 상태 점과 `정상`, 그 외에는 `시연`·`연결 오류`·`연결 중` 상태를 표시한다. 사용률·가용/전체 메모리, 사용량 막대, 앱별 창 수·메모리 metric·관측 나이·마지막 입력 나이도 표시한다.
- 앱 아이콘과 체크/보호 아이콘, 설정·접기·새로고침 버튼을 사용하고 키보드 접근성 이름을 제공한다. 목록이 길면 내부 스크롤한다. 화면 폭 최대 500px, 높이 최대 350px이며 확장 geometry는 GNOME 모션 설정을 따라 280ms cubic ease다.
- RAM 사용 제안은 opt-in이다. 임계치 이상 30초 유지 후 쿨다운을 지키고, 사용자가 펼쳐둔 상태에는 자동으로 열지 않는다. 앱 종료 대신 닫기 검토/확정 흐름으로 이어진다.
- 노치 UI는 코드/단위 테스트에는 있지만 실제 GNOME 창 매핑, 클릭·애니메이션, 설정창 영향은 실기 검수 전이다.

### 코드 지도

| 경로 | 책임 |
|---|---|
| `matci/procfs.py` | `/proc/meminfo`, processes, PSS/RSS, CPU delta, PSI 수집 |
| `matci/model.py`, `matci/policy.py` | metric contract, identity, 보호/안전 분류 |
| `matci/worker.py`, `matci/__main__.py` | JSON Lines 명령 검증, snapshot과 승인→창 닫기 action 순서 |
| `matci/store.py`, `migrations/001_initial.sql` | UID 제한 SQLite, lock, receipt·retention·요약 |
| `extension/extension.js`, `extension/actions.js` | panel/overlay와 GJS window close gateway |
| `extension/policy.js`, `extension/prefs.js` | 창 후보 보호·사용자 설정 |
| `extension/notchDock.js`, `extension/dockModel.js` | Archsport와 겹침 방지·수동 화면 우선 |
| `tests/` | parser, identity, safety gates, crash/ack/receipt, package 검증 |

### 현재 남은 matci 검수

| 기능 | 코드/자동검사 | 실제 GNOME 기기 |
|---|---|---|
| 패널 RAM 표시·상세 overlay | 구현됨 | 새 source와 현재 v7 화면의 전체 동작은 재검수 필요 |
| 실제 `/proc` 읽기 | Ubuntu smoke 통과 | 5초 장시간 성능·절전/복귀 영향 미측정 |
| 앱별 PSS/RSS 표시 | 부분 관측으로 설계 | Shell app↔PID mapping 정확도는 앱별 편차가 남음 |
| 안전 승인 뒤 정상 창 닫기 | Node 통합 테스트 통과 | 실제 unsaved dialog, 창 거부, 앱 background process는 미검증 |
| 자동 메모리 제안 | opt-in 코드 | 실제 화면·오탐률 장시간 검수 미실시 |
| 시스템 CPU, swap, GPU 사용률·온도 수집/화면 | 미구현 | 최종 제품 명세의 후속 P1. 현재 process CPU만 관측하며 `/proc/meminfo` 전체 swap과 하드웨어 provider는 없음 |
| 파일/폴더 정리, package 제거, 브라우저 탭 통합 | 미구현 | 별도 후속 제품 범위 |

## 공유 노치 동작

- 양 확장은 서로 다른 Python worker와 저장소를 유지한다. GNOME Shell `Main.layoutManager`에 버전이 붙은 작은 registry 하나를 두어 actor의 화면 위치와 현재 조작 권한만 공유한다.
- 노치는 상단 패널 아래 `addChrome(..., {affectsStruts:false})`로 배치한다. registry는 두 노치를 가운데에 8 logical px 간격으로 두고, 화면이 좁아지면 수동으로 연 화면을 우선하고 나머지를 숨기는 정책을 계산한다.
- matci는 사용자가 상세 화면을 열 때 우선순위 100, Archsport 경기 알림은 80이다. Archsport는 우선순위를 빼앗지 않고 메모리 검토가 끝날 때까지 알림을 대기시킨다. 유효한 sports 대기 알림은 사용자 상태 디렉터리에 저장되며 fixture 문맥이 일치하지 않으면 복원하지 않는다.
- 자동 geometry·priority는 Node 단위 검사로 확인했다. 하지만 GNOME 50 실 화면에서 클릭 hit-test, 패널 메뉴, 125/150% 배율, 전체화면, 좁은 창 충돌은 검수되지 않았다. 스크린샷은 디자인 참고 근거지 새 버전의 실행 증거가 아니다.

## 설정·데이터 위치

| 앱 | 경로/설정 | 내용 |
|---|---|---|
| Archsport | `~/.config/archsport/api-key` | API-Football 키, 0600 |
| Archsport | `~/.config/archsport/football-data-token` | football-data.org 키, 0600 |
| Archsport | `~/.local/state/archsport/state.db` | 경기 snapshot, receipt, 요청 budget, schedule/id cache |
| Archsport | `~/.local/state/archsport/health.json` | UI용 마지막 상태·오류 요약 |
| Archsport | `~/.cache/archsport/logos/` | 공급사 로고 캐시 |
| Archsport | `~/.local/share/gnome-shell/extensions/archsport@local/` | 사용자 확장 설치본 |
| matci | `~/.local/state/matci/` | UID 범위 DB, worker lock, 비공개 요약 |
| matci | GSettings `org.gnome.shell.extensions.matci` | 표시·보호 규칙 등 UI 설정 |
| matci | `~/.local/share/gnome-shell/extensions/matci@local/` | 사용자 확장 설치본 |

`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`이 지정되면 앱별 코드가 각각 그 위치를 사용한다. 저장소에는 어떤 사용자 key, sqlite DB, process sample도 넣지 않는다.

## 검증 기록

### 이번 구현의 자동검사

| 저장소 | 검사 | 결과 |
|---|---|---|
| Archsport | `python3 -m unittest discover -s tests -v` | 65/65 통과 |
| Archsport | `node --test tests/dock.test.mjs` | 11/11 통과: 노치 배치, owner/outside hit test, 모니터 높이 스크롤, 알림 대기·만료·복원 |
| Archsport | `npx eslint@9 --no-config-lookup -c eslint.config.mjs extension/*.js` | 오류 0, 경고 39개(미사용 catch 매개변수) |
| Archsport | `node --check extension/extension.js`, `prefs.js` | 통과 |
| Archsport | `glib-compile-schemas --strict --dry-run extension/schemas` | 통과 |
| Archsport | `git diff --check` | 통과 |
| matci | `python3 -m unittest discover -s tests -v` | 51/51 통과 |
| matci | `node --test tests/*.mjs` | 26/26 통과 |
| matci | `npx eslint@9 --no-config-lookup -c eslint.config.mjs extension/*.js` | 오류 0, 경고 38개(미사용 catch 매개변수) |
| matci | GJS/prefs 구문 검사와 strict schema dry-run | 통과 |
| matci | `python3 tools/smoke_worker.py` | live `/proc` 179 processes, memory valid, PSI available; GNOME runtime 아님 |

Node 검사 경고는 `.js` 파일이 Node package의 `type=module`로 선언되지 않아 ESM으로 재분석된다는 안내다. 테스트는 모두 통과했지만 GJS import 또는 GNOME Shell API 호환성 실행을 대신하지 않는다.

### 현재 실제 데이터 연결 검사

- football-data.org 일정 adapter는 실제 키를 읽어 3개 예정 경기와 최근 완료 경기 5개를 반환했다. `schedule_delayed=true`, `stats_available=false`; 키 값은 출력하지 않았다.
- API-Football `fixtures?live=all` 실제 응답은 오류 없이 왔다. 세 팀 필터 적용 adapter가 Como live fixture 1개를 반환했다. 경기의 실제 노치 표시, 골 이벤트, API 지연 품질은 GNOME 화면에서 시험하지 않았다.
- `fixtures?team=529&next=1`, `fixtures?team=529&season=2025&last=3`은 무료 요금제 season 제한 오류를 반환했다. 실제 일정은 football-data.org가 맡는다.
- API probe는 `Store(':memory:')`로 실행해 현재 활성 worker의 SQLite 상태와 로컬 예산을 건드리지 않았다. 외부 요청은 API-Football 계정 quota를 소비하며 시즌 제한 응답도 한 요청으로 계산된다.
- matci smoke는 실제 `/proc` 입력을 읽었지만 현재 GNOME의 창 닫기 동작을 수행한 검사가 아니다.

## 설치·현재 세션 상태

2026-10-19 재로그인 후 GNOME Shell 50.1에서 설치 경로와 실행 GJS 버전이 Archsport v11, matci v8로 일치하고 두 확장 모두 `ACTIVE`다. 이 turn에서 `gnome-extensions info`로 해당 버전/상태를 재확인했다. workspace 소스는 이제 Archsport v13/matci v10이며, 두 확장 UI를 다시 로드하지 않았다.

이전 Shell 종료 로그에는 matci v7의 UI actor가 이미 dispose된 뒤 callback에서 접근했다는 경고가 남았다. 새 Shell의 확장 활성 상태와 worker 실행은 확인됐지만 화면 모양과 입력 반응은 별도 시각 검수가 아니다. 새 Shell 시작 뒤 수집한 로그에서는 두 확장의 새 오류를 확인하지 못했다.

## 미완료·위험과 다음 작업

| 우선순위 | 미완료 항목 | 완료 증거 |
|---|---|---|
| P0 | staged Archsport v13·matci v10을 GNOME Shell 50.1에서 실제 화면/입력으로 검수 | 사용자 작업창을 닫지 않는 안전한 확장 재적용 뒤 양 확장 source hash와 ACTIVE 버전, 노치/일정/경기 상태 스크린샷, 오류 로그 확인 |
| P0 | matci 일반 창 닫기 실제 동작 | 저장하지 않은 대화상자 취소, 창 거부, 창 닫힘, background process 잔존을 Ubuntu에서 직접 확인 |
| P1 | 경기 알림 priority queue 실기 | matci를 수동으로 연 동안 골/킥오프 알림 발생 후 matci 닫은 뒤 Archsport가 표시되는지 확인 |
| P1 | 지난 경기 세부 스탯 | football-data.org 무료 데이터는 점수까지만 제공하고 실제 API-Football key는 2025시즌 fixture 조회를 거절했다. 현재 무료 key가 허용하는 시즌 범위를 확인하거나 다른 사용 허가된 공급원을 확보해야 구현 가능 |
| P1 | API 쿨다운과 경기 시간 겹침 | 쿨다운 중에는 호출하지 않아 quota를 지키지만, 쿨다운이 live 감시 구간을 넘으면 그 경기의 실시간 점수/이벤트는 놓칠 수 있다. 다음 경기 전 실제 계정 quota 응답으로 발생 빈도 확인 |
| P1 | 실제 lineup/선발 알림 | 경기 일정 ID와 API-Football fixture ID를 연결하고 무료 계정의 `/fixtures/lineups` 권한 확인. 현재 미구현 |
| P2 | domestic cup 일정 fallback | 공급사의 이용 조건/쿼터/안정성을 먼저 검토. ESPN 비공식 endpoint는 현재 배제 |
| P2 | 고배율·화면 잠금·절전·전체화면·모니터 변경 | ASUS 실기 GNOME 50.1에서 표준 수동 절차 수행 |
| P1 | matci 수동 검토 중 sports 알림 대기·복원 GNOME 검수 | 두 노치 수동 조작, Shell 재시작, fixture 문맥이 유효한 알림의 1회 표시를 GNOME 50.1에서 확인 |
| P1 | matci 전체 CPU·swap·GPU 사용률·온도 | 최종 제품 명세에 포함됐지만 native snapshot/provider/UI에 미구현. 별도 제품 작업 필요 |

테스트 통과는 이 표의 GNOME 기기 수용 검사를 완료했다는 뜻이 아니다. 제품 브리프의 CPU/GPU/swap 확장, 파일 정리, lineup, 전체 세부 통계는 계획 또는 미구현으로 구분한다.

## 사용한 공식 데이터 문서

- [football-data.org 공식 대회 coverage](https://www.football-data.org/coverage): free 커버리지에 PD, SA, CL이 포함되는지 확인.
- [football-data.org 공식 요금제](https://www.football-data.org/pricing): 무료 요청 한도/지연 데이터/상세 라인업·득점자 범위 확인.
- [football-data.org 공식 API 정책](https://docs.football-data.org/general/v4/policies.html): 인증·분당 요청 정책.
- [football-data.org 팀 조회](https://docs.football-data.org/general/v4/team.html), [경기 조회](https://docs.football-data.org/general/v4/match.html): 일정 API 계약.
- [API-Football 공식 요금표](https://www.api-football.com/pricing/): 무료 100회/일 및 시즌 범위 제한.
- [요청량 최적화 가이드](https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage): 일일·분당 한도와 라이브 조회 설계.

요금제와 커버리지는 바뀔 수 있으므로 새 API 항목을 추가하기 전 공식 제공 범위를 다시 확인한다.
