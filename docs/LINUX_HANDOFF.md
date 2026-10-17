# Linux Codex 인계서 — Archsport

작성: 2026-10-18, Asia/Seoul. **이 파일과 저장소만으로 작업을 이어갈 수 있어야 한다. 다른 Codex 채팅·Windows 실행 서버·로컬 경로를 필요로 하지 않는다.**

## 1. 사용자와 제품 결정

- 실제 컴퓨터는 Mac이 아닌 **ASUS Vivobook 15 Pro**. 현재 개발 OS는 Windows, 사용할 OS는 **Ubuntu**. 정확한 모델 SKU·패널 해상도·주사율은 아직 확인 안 됨.
- 주로 볼 팀은 **FC Barcelona**. 다양한 스포츠 전체 구현보다 축구 단일 팀의 안정적인 실시간 노치를 우선한다.
- Apple Sports의 팀 선택 → 경기 점수/상황 → 화면 밖 알림 흐름을 참고한다. 물리 노치·Apple ActivityKit·Apple 계정이 필요하지 않은 소프트웨어 UI다.
- **실제 축구 구단 로고를 원한다는 명시적인 지시가 있다. 임의 약자 배지로 되돌리지 말 것.** 현재 Barcelona(529)/Inter(505)는 공급사 미디어 원본 PNG로 동봉했고 실제 상대 ID의 PNG도 캐시한다.
- 위치는 **GNOME 상단 패널 아래** 유지. 시계와 겹치는 패널 통합은 향후 실험 기능. 기본 패널을 숨기거나 바꾸지 않는다.
- 첫 MVP는 **Extension → Python subprocess** 유지. systemd user service + IPC는 안정화 후속으로만 계획한다.
- 사용자는 작업 중 불필요한 확인 질문보다 구현을 원한다. 실제 비밀키·데스크톱 권한 등 없으면 필요한 부분만 요청한다. 키를 채팅·GitHub에 붙이게 하지 않는다.

## 2. GitHub에서 그대로 받기

이 저장소는 사용자 `halfsamoan` 계정의 `archsport`로 업로드한다. 공개를 요청하지 않았으므로 비공개를 기본으로 한다.

```bash
gh auth login
gh repo clone halfsamoan/archsport
cd archsport
git status --short --branch
git log -3 --oneline
```

GitHub ZIP 다운로드로 받아도 된다. 현재 채팅이 없는 Linux Codex에 아래 지시를 전달하면 된다:

> 이 저장소의 AGENTS.md와 docs/LINUX_HANDOFF.md를 먼저 읽고, 실제 Ubuntu GNOME에서 P0 검수 표를 진행해줘. 기존 구현과 데이터는 저장소에 있다. 목표는 ASUS Vivobook 15 Pro에서 Barcelona 경기 알림 노치를 매일 쓰는 것이다. 키가 필요한 단계는 설정창에서 로컬 입력하게 하고 비밀키를 저장소에 넣지 마. 통과한 검증만 기록해줘.

## 3. 현재 실행 구조

```text
GNOME extension.js
  ├─ GSettings: 사용자 표시/데이터 설정
  ├─ prefs.js: GTK4/Adwaita 설정 GUI, API 키는 개인 파일에 저장
  ├─ logind PrepareForSleep: sleep 시 child 정리, resume 시 재시작
  ├─ EOF/crash: 5→10→20→40→60초 제한 재시작
  └─ python3 -u -m archsport [설정 CLI, 비밀키 제외]
        ├─ API-Football 공개 v3 API
        ├─ fixtures: 기본 polling (선택 경기 id)
        ├─ events: 점수/상태가 바뀌면 1회 (실패한 상세만 다음 tick 재시도)
        ├─ SQLite: snapshot/receipt/request budget/team ID cache/finished_at
        ├─ 팀 로고: 동봉 PNG 또는 media.api-sports.io의 정수 ID PNG
        └─ stdout JSON Lines → GNOME UI
```

실제 default는 이제 **live**다. 키가 없으면 오류/설정 안내이며 demo로 바꾸지 않는다. `config.example.json`은 CLI용 예시다. GNOME은 JSON이 아니라 GSettings를 읽고 CLI 인수로 worker에 전달한다. 따라서 예전 JSON의 `mode=demo` 값을 편집하는 안내는 현재 GUI 흐름에 해당하지 않는다.

Python은 표준 라이브러리만 사용한다. `pip install`이나 Node 빌드가 필요 없다. Node는 JS 구문 검사에만 선택 사용한다. GJS 런타임의 St/Clutter/Meta API는 Node로 실행할 수 없다.

## 4. 첫 실행 절차

```bash
python3 tools/doctor.py --output local-diagnostics/doctor.json
gnome-shell --version
echo "$XDG_SESSION_TYPE"
python3 -m unittest discover -s tests -v
glib-compile-schemas --strict --dry-run extension/schemas
```

GNOME 46(24.04)와 50(26.04)을 대상으로 metadata를 선언했다. 선언은 실제 동작 검증 증거가 아니다. 실제 버전이 다르면 먼저 해당 버전 API 변경을 확인하고 metadata를 무작정 넓히지 않는다.

필요하면:

```bash
sudo apt install python3 libglib2.0-bin gnome-shell-extension-prefs
python3 tools/install_extension.py
```

일반 데스크톱 사용자로 실행한다. 설치 스크립트는:

1. 사용자 확장 폴더 안에 staging을 만든다.
2. extension, Python 패키지, 동봉 로고, replay 데이터를 복사한다.
3. GSettings schema를 strict compile한다.
4. 새 설치를 배치한다. `--upgrade`면 기존 UUID 확인·확장 disable 후 이전 설치를 state/backups에 보존한다.
5. 사용자 키·DB·dconf를 덮어쓰지 않는다.

실패하면 staging을 임의 삭제하지 말고 원인을 읽는다. 기존 설치가 있었다면 backup 경로로 복구할 수 있다. Wayland는 Alt+F2 r 대신 로그아웃·로그인한다.

```bash
gnome-extensions enable archsport@local
gnome-extensions prefs archsport@local
```

확장 활성화가 GNOME 로그인 자동 시작 경로다. systemd 서비스나 별도 Autostart 항목을 동시에 만들어 worker 두 개를 띄우지 않는다.

## 5. API 키와 실데이터 연결

**Windows 작업 시 API-Football 키는 존재하지 않았으며 실경기 수신을 검증하지 못했다. API 키를 새로 발급/결제한 것도 아니다.**

설정창에서:

1. 응원 팀 `Barcelona`, 국가 `Spain`을 유지한다.
2. API 키 입력 후 적용한다. 0600 파일에 저장되고 키 revision 신호로 worker가 재시작된다.
3. 모드는 `실제 경기`로 둔다.
4. 서비스 상태 새로고침과 실제 표시를 확인한다.
5. 본인 요금제에 맞춰 일일 예산/경기 중 간격을 정한다.

CLI로 분리 진단할 때는 확장을 먼저 꺼서 두 worker가 같은 상태 DB/예산/health 파일을 쓰지 않게 한다:

```bash
gnome-extensions disable archsport@local
python3 -m archsport --mode live --once
gnome-extensions enable archsport@local
```

키를 stdout·스크린샷·진단 보고서에 넣지 않는다. `doctor.py`는 존재 여부만 보고한다. `api-key`나 `.env`를 Git에 추가하지 않는다.

API 공식 자료:

- https://api-sports.io/documentation/football/v3
- https://www.api-football.com/pricing
- https://www.api-football.com/news/post/how-to-get-all-teams-and-their-ids

무료 100회/일은 전체 실시간 경기 추적을 보장하지 않는다. 60초×120분이면 **fixtures 약 120회 + 변화 횟수만큼 events + 최초 탐색**이다. 예산90은 보호 상한이며 무료로 전체 경기를 커버한다고 주장하지 않는다. 전반·후반·VAR·추가시간·연장에 따른 요청 수도 다르다.

## 6. 주요 파일과 계약

| 파일 | 역할 / 지켜야 할 계약 |
|---|---|
| `archsport/provider.py` | 정확한 팀 검색·ID 영속 캐시·경기 선택·변화 시 events; HTTP 200 errors도 오류 |
| `archsport/scheduler.py` | 시각 의존 정책을 순수 함수로 테스트; FT는 최초 관측 시점부터 5분 |
| `archsport/engine.py` | 스코어 감소 정정·중복·revision; 기존 알고리즘 유지 |
| `archsport/service.py` | 첫 성공/재시작/오류 뒤 첫 복구는 baseline; 저장된 마지막 값은 error로 표시 |
| `archsport/__main__.py` | CLI·상황별 대기·health 저장; wall/monotonic 차이로 CLI 절전/시계변경 감지 |
| `archsport/assets.py` | 정수 팀 ID만 미디어 URL로 구성; PNG 크기 제한; 구단 로고 대체 생성 금지 |
| `extension/extension.js` | UI·설정 변경 적용·수명·프로세스·절전; 네트워크는 Shell 밖 |
| `extension/prefs.js` | 팀/키/간격/예산/스포일러/모니터 GUI; 비밀키는 GSettings에 저장 안 함 |
| `extension/schemas/` | GSettings XML 원본. compiled는 Linux 설치 때 생성 |
| `tools/install_extension.py` | 사용자 설치·upgrade backup |
| `tools/doctor.py` | 비밀 없는 환경 진단 |
| `data/` | 가상 응답과 replay. 실제 경기 녹화 아님 |
| `web/assets/logos/manifest.json` | 실제 로고 URL·시각·SHA256 |

영속 데이터 위치:

- 설정 키: `~/.config/archsport/api-key`
- GSettings: `org.gnome.shell.extensions.archsport`
- DB: `~/.local/state/archsport/state.db`
- 상태: `~/.local/state/archsport/health.json`
- 로고 캐시: `~/.cache/archsport/logos/`
- 확장: `~/.local/share/gnome-shell/extensions/archsport@local/`

XDG_CONFIG_HOME / XDG_STATE_HOME / XDG_CACHE_HOME / XDG_DATA_HOME이 있으면 그것을 따른다. 로컬 DB를 이 저장소에 복사할 필요 없다. 처음 API 조회로 ID와 snapshot을 다시 구성한다.

JSON Lines의 `mode`, `health`, `updated_at`, `match`, `alert`, `visible`, `next_poll_seconds`를 유지한다. null 점수와 0을 구별한다. PK는 별도 필드. 오류 응답은 마지막 정보를 유지하고 live로 위장하지 않는다.

## 7. 동봉한 데이터로 키 없이 검사

```bash
python3 -m archsport --demo --once
python3 -m archsport --replay data/replay-barcelona.json
```

GNOME 설정에서 `시연`을 선택해도 같은 replay가 재생된다. 경기 전/시작/득점/VAR 취소/재득점/HT/오프라인/후반/득점/FT를 빠르게 확인한다. 선수는 `시연 선수`, 날짜는 가상이다. 5분 FT 정책은 빠른 replay가 아닌 scheduler 테스트와 실제 GNOME에서 따로 검증한다.

Windows 프리뷰:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory web
```

http://127.0.0.1:4173 에서 디자인을 확인한다. Windows에 있던 서버가 계속 돌아야 할 필요가 없다. 네트워크 없이도 동봉 로고와 시연 화면을 볼 수 있다.

## 8. P0 실제 Ubuntu 검수 표

아래는 **미완료**다. 작업한 Linux Codex가 실행 날짜·GNOME 버전·증거를 넣어야 한다.

| ID | 검사 | 합격 기준 | 상태 |
|---|---|---|---|
| P0-01 | GNOME50 실제 enable/disable | 노치/설정창 표시, 시계·패널 클릭 유지 | 미검증 |
| P0-02 | 실제 API·Barcelona ID | 올바른 팀/국가, 재시작 뒤 teams 호출 없음 | 미검증 |
| P0-03 | 실제 goal/VAR/HT/FT | 골·정정·시간·상태 정확, 반복 알림 없음 | 미검증 |
| P0-04 | suspend→resume | 오래된 골 억제, worker 1개, 새 값 갱신 | 미검증 |
| P0-05 | 인터넷 끊김→복구 | 마지막 정보와 오류 표시, 복구 baseline, 다음 골 알림 | 미검증 |
| P0-06 | 배율 125%/150% | ASUS 화면에서 텍스트/로고 잘림·위치 이탈 없음 | 미검증 |
| P0-07 | 로그아웃→로그인 | 수동 명령 없이 확장·worker 정상 시작 | 미검증 |
| P0-08 | 전체화면/overview/잠금 | 설정대로 숨김, 복귀 시 중복 actor 없음 | 미검증 |
| P0-09 | worker 강제 종료 | 5초부터 재시도, 중복 프로세스·이전 callback 없음 | 미검증 |
| P0-10 | FT 이후 | 5분 후 해당 경기 반복 요청 종료, 다음 일정 저빈도 전환 | 미검증 |

진단 예:

```bash
gnome-extensions info archsport@local
journalctl --user -b --no-pager | rg 'Archsport|archsport|JS ERROR'
pgrep -af 'python3.*archsport'
```

시스템 로그 전체를 그대로 GitHub에 올리지 않는다. 관련 오류만 비밀값을 제거해 `local-diagnostics/`에 보관한다. 계정 메일·다른 프로그램 정보도 확인한다.

## 9. 남은 개선과 알려진 경계

- 실제 GNOME 50에서는 St/Clutter 속성과 신호가 달라질 수 있다. Node 구문 통과를 실행 성공으로 오해하지 말 것. 필요 시 GNOME 공식 porting 문서로 수정.
- 최초 스냅샷은 기준값만 저장해 과거 골을 새 알림으로 울리지 않는다. 따라서 기존 득점자 전체 목록을 처음부터 불러오는 동작은 현재 없다.
- 공급사 events가 늦게 도착했는데 요청이 성공한 경우, 나중에 선수 이름만 바뀌어도 다시 조회하는 정교한 보완은 후속이다. 잘못된 득점자 추정보다 점수만 표시.
- `finished_at`은 공식 종료 시각이 아닌 처음 FT를 관측한 시간이다. 새 설치에서 오래된 오늘 경기를 FT로 처음 받으면 5분간 보여줄 수 있다.
- 30분 idle 일정 탐색은 갑자기 추가된 경기의 시작을 즉시 알 수 없다. 이미 알고 있는 일정은 경기 15분 전을 넘기지 않게 대기시간을 줄인다.
- 표시 모니터 선택은 GNOME monitor index다. 케이블 재연결로 순서가 바뀌면 primary fallback; 커넥터 ID 영속화는 후속.
- 구단 로고 다운로드 실패 시 이름을 보여준다. 가짜 마크로 대체하지 않는다. 실패한 ID는 해당 worker 재시작까지 재시도하지 않는다.
- 전체 statistics/lineup, 여러 팀·여러 경기, 독립 중계 앱, GNOME 방해금지/quiet hours는 후속. 이번 1.0에 무리해서 전부 추가하지 말 것.
- systemd user service는 현재 설치하지 않는다. 안정화 단계에서 별도 IPC·권한·단일 인스턴스 정책을 갖춘 뒤 도입.

## 10. 완료/기록 원칙

Windows와 WSL에서 실행한 결과는 `replica/verification.md`. Linux에서 P0를 검증한 뒤 같은 파일에 실제 결과를 추가한다. 기능표의 partial/no를 근거 없이 yes로 바꾸지 않는다. 실제 경기 데이터가 없는 상태를 ‘라이브 연결 완료’라고 쓰지 않는다.

전체 원본 조사, 기능표, 스키마, 디자인 토큰, 시제품, 소스, 테스트, 가상 데이터, 실제 로고, 참고 이미지는 모두 저장소에 있다. 비밀키와 기기별 실행상태를 제외하면 이 대화에서만 알 수 있는 필수 정보는 이 인계서에 남겼다.
