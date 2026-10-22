# 개발·검증 참고

[프로젝트 소개](README.md)

기존 README의 상세 실행·검증 내용을 이 문서로 옮겼습니다. 과거 실행 기록은 당시 환경의 결과이며 새 검증 결과를 뜻하지 않습니다.

## 데이터와 현재 범위

- [football-data.org](https://www.football-data.org/)는 La Liga, Serie A, Champions League 일정과 경기 결과를 제공한다. 일정은 6시간 캐시를 사용하며 공급사 데이터는 지연될 수 있다.
- API-Football은 경기 시간대에 live 점수·상태를 확인하고 점수/상태 변화 때 이벤트를 조회한다. 두 API 키는 별도 설정한다.
- 경기 중 poll 간격은 300–600초다. 진행 예정 경기가 없을 때는 일정 새로고침과 다음 킥오프에 맞춰 낮은 빈도로 대기한다. 무료 쿼터로 실시간 데이터나 알림을 보장하지 않는다.
- 최근 경기의 점수와 일정은 표시한다. 경기별 통계와 선발 라인업은 현재 무료 키에서 사용 가능한 범위가 확인되지 않아 제품 기능으로 제공하지 않는다.
- VAR 전용 알림은 제품 요구사항이 아니다. 데모에는 점수 정정 흐름이 남아 있어도 실기 합격 기준은 아니다.
- 실제 GNOME 화면·입력·절전·다중 노치 수용 검사는 자동 테스트와 구분한다. 현재 상태는 통합 구현 현황과 `replica/verification.md`를 확인한다.

## 재시작 뒤 득점 알림

화면 잠금 해제, 절전 복귀, 설정 변경 등으로 worker가 다시 시작되면 저장된 같은 경기 점수와 비교한다. 저장 상태가 있을 때 10분 이내의 가장 최근 득점 하나만 한 번 알린다. 더 오래된 득점과 하프타임·경기 종료 같은 상태 변화는 알림 없이 점수와 상태만 갱신한다.

## Ubuntu 설치 및 키 설정

```bash
gh repo clone halfsamoan/archsport
cd archsport
python3 -m unittest discover -s tests -v
python3 tools/doctor.py
sudo apt install python3 libglib2.0-bin gnome-shell-extension-prefs
python3 tools/install_extension.py
gnome-extensions enable archsport@local
gnome-extensions prefs archsport@local
```

설정의 **데이터** 항목에서 API-Football 키와 football-data.org 일정 키를 각각 입력하고 적용한다. 두 키는 `$XDG_CONFIG_HOME/archsport/api-key`와 `$XDG_CONFIG_HOME/archsport/football-data-token`에 `0600` 권한으로 저장되고, 상위 디렉터리는 `0700`으로 만든다. 적용하면 확장 worker가 다시 시작된다. 키 값은 GSettings, 로그, 저장소에 기록하지 않는다.

무료 API-Football 기본 할당량은 계정·요금제 정책에 따라 달라질 수 있다. Archsport 기본 요청 상한은 90회/일이며 경기 감시를 위한 간격은 최소 5분이다. 사용 전에 [공식 요금표](https://www.api-football.com/pricing)를 확인한다.

넘버패드 `Enter`로 노치를 열고 닫는다. Shell이 이 키를 가로채므로 일반 데스크톱에서는 앱에 전달되지 않는다. 바꾸려면 `gsettings --schemadir ~/.local/share/gnome-shell/extensions/archsport@local/schemas set org.gnome.shell.extensions.archsport archsport-toggle-shortcut "['<Super>a']"`처럼 지정한다.

## 업데이트

```bash
git pull --ff-only
python3 tools/install_extension.py --upgrade
python3 tools/doctor.py
```

가능한 GNOME 환경에서는 `--upgrade`가 새 버전을 업데이트 staging 경로에 두고 현재 세션을 유지한다. 실제 활성 버전이 설치 버전과 다르면 doctor가 재로그인 적용 대기 상태를 표시한다. 확장 모듈을 이미 불러온 GNOME Shell은 실행 중인 GJS를 교체하지 않을 수 있다. 새 UI는 다음 GNOME 세션에서 확인한다. 현재 데스크톱 세션의 앱을 닫고 싶지 않다면 재로그인은 미루고, staging 상태를 유지한다. 직접 파일을 교체하는 `--direct` 옵션도 있지만 현재 세션의 코드 갱신을 보장하지 않는다.

## 시연

API 키 없이 Python에서 합성 경기 흐름을 확인한다.

```bash
python3 -m archsport --demo --once
python3 -m archsport --replay data/replay-barcelona.json
```

GNOME 설정에서 데이터 모드를 `시연`으로 바꾸면 같은 replay를 쓴다. 대진·점수·선수·시간은 합성 데이터다.

## 개발용 웹 시제품

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory web
```

<http://127.0.0.1:4173>에서 화면 시제품을 볼 수 있다. 웹 설정은 GNOME 설정과 동기화되지 않는다.

## 주요 파일

| 경로 | 용도 |
|---|---|
| `archsport/` | 일정·live 공급자, polling, 상태와 캐시 |
| `extension/` | GNOME Shell UI, Preferences, GSettings |
| `tools/` | 설치·업데이트 staging·환경 진단 |
| `docs/LINUX_HANDOFF.md` | 작업 인계와 실제 Ubuntu 검수 절차 |
| `docs/TWO_APP_IMPLEMENTATION_STATUS.md` | Archsport·matci 전체 구현/검증 현황 |
| `replica/features.csv` | 기능별 구현 상태 |
| `replica/verification.md` | 수행한 검증과 아직 남은 실기 검사 |

구단 표장과 데이터 제공 범위는 각 권리자·공급사의 정책에 따른다. 개인 키, SQLite 상태, 세션 데이터, 진단 파일은 저장소에 포함하지 않는다.

## License

소스와 동봉된 문서는 [MIT License](LICENSE)로 제공한다. `web/assets/logos/`의 구단 엠블럼·로고와 기타 제3자 상표는 MIT 라이선스 대상이 아니며 각 권리자에게 권리가 있다. 출처와 파일 해시는 `web/assets/logos/manifest.json`에 기록했다.
