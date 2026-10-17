# Archsport 현재 구조와 구현 계획

업데이트: 2026-10-18. 실제 대상: **ASUS Vivobook 15 Pro, Ubuntu GNOME, Barcelona**. 현재 개발은 Windows + WSL이며 실제 GNOME50·라이브 API는 아직 검증 전이다. Linux에서 이어받는 절차는 [인계서](../docs/LINUX_HANDOFF.md).

## 스택과 경계

**GNOME Shell GJS/St/Clutter + Python3 표준 라이브러리 + SQLite + 공개 API-Football v3**. 브라우저 HTML/CSS/JS는 Windows용 시제품이고 실제 오버레이는 GNOME 확장이 생성한다. 일반 Electron/Tauri 창을 GNOME Wayland 상단에 놓는 것으로 대체하지 않는다. [Layer Shell의 GNOME 미지원](https://github.com/wmww/gtk-layer-shell), [GNOME 확장 설정 가이드](https://gjs.guide/extensions/development/preferences.html)를 기준으로 정했다.

```text
prefs.js → GSettings → extension.js → Python CLI (비밀키 제외)
                               ↓ spawn / JSON Lines
API-Football → provider → engine / SQLite → service → stdout
실제 구단 PNG → 로컬 캐시 → 로고 경로 → St.Icon
```

기본 데이터 모드는 live. 비밀키는 사용자 개인 파일이며 prefs에서 저장한다. 계정·서버·웹호스팅·결제·systemd 서비스는 없다. enable된 GNOME 확장이 로그인 때 시작하고 worker 수명을 소유한다. worker가 종료되면 제한된 backoff로 다시 띄운다. 절전시 종료하고 복귀시 기준값부터 재개한다.

## 구현된 API 정책

| 호출 | 용도 | 빈도 |
|---|---|---|
| GET /teams?search=Barcelona | 정확한 이름+Spain으로 ID 확정 | SQLite 캐시에 없을 때 한 번 |
| GET /fixtures?team=id&date=UTC오늘 | 진행/예정/최근 경기 탐색 | 최초 또는 선택 경기 없음 |
| GET /fixtures?team=id&date=UTC어제 | 자정 넘긴 진행 경기 보완 | 최초 탐색이 UTC00–04시인 경우 |
| GET /fixtures?team=id&next=1 | 다음 경기 | 오늘 경기 없거나 FT관측5분 경과 |
| GET /fixtures?id=선택경기 | 점수와 상태 | 상황별 polling |
| GET /fixtures/events?fixture=id | 사건·선수 문맥 | 점수/상태 변경 때만 한 번; 실패하면 다음 tick 재시도 |

첫 snapshot에서는 events를 가져오지 않고 기준값만 정한다. 변화 없는 polling은 fixtures 한 번이다. events 오류는 이미 받은 점수 업데이트를 취소하지 않는다. 오래된 선수 정보를 추정해서 골 주인공이라고 단정하면 안 된다. events가 성공 응답 후 늦게 갱신되는 상황에 대한 정교한 scorer 보완은 후속이다.

인증/응답 근거: [공식 입문 가이드](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide), [v3 문서](https://api-sports.io/documentation/football/v3). HTTP200+errors, 401/403/429, timeout, 응답 크기, 다중 페이지를 다룬다. 키나 원시 인증 헤더는 stdout에 내보내지 않는다.

## 폴링과 비용

| 경기 상황 | 정책 |
|---|---|
| 없음 | 1800초 |
| 먼 예정 경기 | 최대1800초; 경기15분전 경계를 지나지 않게 단축 |
| 경기15분전 | 최대120초; kickoff 가까우면 단축 |
| live/HT/연장/PK/중단 | 설정한15–60초 |
| FT 관측 직후 | 60초 간격, 300초간 |
| FT 관측5분 후 | 해당 경기 반복 조회 중단, 다음 일정 탐색/저빈도 |

이전 구현은 fixtures+events를 매번 호출해 120분/60초 기준 약240회였다. 현재는 **fixtures 약120회 + 점수/상태 변화의 events + 최초 탐색**으로 감소한다. 무료100회/일에는 여전히 부족할 수 있다. 기본 일일 예산90은 보호 상한이며 무료로 전체 경기·연장까지 추적된다는 의미가 아니다. [요금과 시즌 제한](https://www.api-football.com/pricing)은 사용자 본인 요금제에서 확인한다.

모든 API 요청은 실패도 포함해 SQLite에서 먼저 예산을 예약한다. 공급사 일일 잔여 헤더가0이면 중지한다. 로컬일자는 UTC이며 다음 UTC날에 공급사 잔여 제한 상태를 초기화한 뒤 헤더로 다시 확인한다. 여러 앱/기기가 같은 키를 사용하면 로컬 카운터는 전체 사용량을 알 수 없다. 자격·시즌·대회 커버리지는 실API 검수 필요.

## 상태와 저장소

engine의 score/status/revision 알고리즘을 유지했다. 스코어 감소는 correction, 증가는 score, HT/FT 등은 status. 최초 실행·프로세스 재시작·네트워크 오류 후 첫 복구는 baseline만 저장한다. 120초 넘는 수신 공백에서도 과거 골 재생을 억제한다. revision은 VAR 이후 같은 점수로 재득점한 정당한 알림을 구분한다.

실행 DB: snapshots / receipts / requests / cache. cache에는 team name+country별 ID와 fixture별 FT최초관측시각을 저장한다. 마지막 snapshot은 재시작시 복구하되 수신 오류라면 마지막 정보라는 문구로 보여준다. 전체 제품 모델은 `schema.sql`이며 초기 실행 DB와 별개다.

IPC는 한 줄 JSON이며 `mode,health,updated_at,match,alert,visible,next_poll_seconds`를 포함한다. 오류는 message+마지막 match+alert:null. null 스코어를0으로 바꾸지 않는다. 정규점수/PK는 별도다.

## GUI와 표면

GSettings에 mode, 팀/국가, poll-seconds, daily-budget, show-notch, expand-on-event, event-seconds, monitor-index, hide-fullscreen, show-upcoming, spoiler가 있다. 키 문자열은 GSettings에 없다. prefs가 개인 파일로 키를 저장하고 revision만 올린다. 데이터 설정 변경시 worker재시작, 표시 설정은 즉시 UI에 적용한다.

소프트웨어 노치는 기본 모니터의 GNOME 패널 아래, 보조 모니터는 화면 상단에 놓는다. 사용자 모니터 인덱스 선택을 지원하며 사라지면 primary로 복귀한다. fullscreen·overview·잠금은 숨김 정책. 웹은 접힘336×46/펼침460×224/이벤트460×144, native는 가독성을 위해360×46/500×250. native날개곡선·정확한 spring은 완전 일치 구현이 아닌 후속 실기기 조정 대상이다.

실제 구단 이미지는 공급사 팀 ID의 PNG로 표시한다. Barcelona/Inter는 clone즉시 오프라인 사용 가능하게 동봉한다. 임의 URL을 받아 fetch하지 않고 정수 ID에서 공급사 URL을 구성한다. PNG서명·크기 제한. 이미지 오류시 평문 이름으로 fallback한다. 출처/해시는 `web/assets/logos/manifest.json`.

## 단계와 검수

| 단계 | 현재 | 완료 조건 |
|---|---|---|
| 조사·기능 명세 | 파일 완료 | 근거와 추정/제안 구분 |
| 웹 디자인 | 실제 로고와 동작 시제품 | 주요 상태·자동접힘·설정·반응형 확인 |
| 엔진 | Windows/WSL 테스트 | 변화 조회·캐시·예산·정정·복구·scheduler |
| 네이티브 설정 | 코드+schema strict 검증 | 실제 GTK4/Adwaita창·키저장·즉시반영 |
| GNOME표면 | 코드 제공 | GNOME46/50 enable/disable·scale·fullscreen·로그인 |
| 실제 경기 | 미검증 | 사용자 개인키로 Barcelona goal/VAR/HT/FT |
| 안정화 | 계획 | 자원/latency·동시사건·중복worker·업그레이드 |

P0체크리스트는 인계서에 있다. 실제 ASUS의125/150%배율, 로그인 자동시작, suspend/resume, 인터넷복구는 아직 통과로 처리하지 않는다. systemduser+socket/DBus는 위검증 이후 필요하면 도입한다. statistics/lineups/다중팀/quiet-hours는 후속이며 첫1.0에 모두 넣지 않는다.
