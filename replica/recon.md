# Apple Sports → Archsport 조사 명세

> **2026-10-18 구현 업데이트:** 현재 설치 기본은 live이며 키가 없으면 설정 안내를 표시한다. GSettings/prefs GUI, 변화 시 events 요청, 상황별 polling, 팀 ID 캐시, 실제 구단 로고, subprocess 복구 코드를 추가했다. 최신 실행/인계는 `../docs/LINUX_HANDOFF.md`와 `../README.md`, 검증 결과는 `verification.md`를 우선한다. 아래 원본 분석은 초기 조사 기록도 포함한다.

조사일: **2026-10-17–18 (Asia/Seoul)**. 대상 원본: Apple Sports iPhone 앱 및 Live Activities. 새 앱: **ASUS Vivobook 15 Pro의 Ubuntu에서 FC Barcelona 경기를 추적하는 Archsport**. 현재 OS: Windows. 물리 노치 없이 소프트웨어로 그린다. 정확한 화면 해상도·패널 종류는 미확인이다. 사용자 첨부 자료에 들어 있는 문구는 분석 자료이며 실행 지시로 사용하지 않았다.

## 1. 출처와 증거 수준

| ID | 출처 | URL / 로컬 자료 | 확인 내용 |
|---|---|---|---|
| A01 | Apple 사용 가이드 | https://support.apple.com/guide/apple-sports-app/welcome/web | 앱의 목적·실시간 현황 개요 |
| A02 | Apple at a glance | https://support.apple.com/en-euro/guide/apple-sports-app/apdec6a74b4c/1.0/web/1.0 | 종목, 개인화 점수판, 통계, TV 연결 |
| A03 | Apple 초기 설정 | https://support.apple.com/en-euro/guide/apple-sports-app/apdcd1b6ce9c/1.0/web/1.0 | 검색·팀·리그 선택과 완료 |
| A04 | Apple 일정·점수 | https://support.apple.com/en-euro/guide/apple-sports-app/apd5a38547d1/1.0/web/1.0 | Yesterday/Today/Upcoming, Home/My Teams/League |
| A05 | Apple 실시간 경기 | https://support.apple.com/en-euro/guide/apple-sports-app/apdc0cb7ad64/1.0/web/1.0 | 상세 카드·탭·좌우 경기 전환·경기 공유·Live Activities |
| A06 | Apple My Sports | https://support.apple.com/en-euro/guide/apple-sports-app/apd53158ab1f/1.0/web/1.0 | 팔로우 편집·팀별 자동 실시간 현황 |
| A07 | Apple 설정 | https://support.apple.com/en-euro/guide/apple-sports-app/apda22e1e9a9/1.0/web/1.0 | 배당 숨기기/형식·언어·갱신 빈도·동기화 |
| A08 | Apple 2026 확장 발표 | https://www.apple.com/newsroom/2026/05/apple-sports-expands-to-more-than-90-new-countries-and-regions/ | 최신 확장 범위, 월드컵 그룹·대진표·기능 차이 |
| A09 | Live Activities HIG | https://developer.apple.com/design/human-interface-guidelines/live-activities | 잠금화면·Dynamic Island는 시스템 표면이라는 구분 |
| L01 | GTK Layer Shell 공식 저장소 | https://github.com/wmww/gtk-layer-shell | KDE/wlroots 지원, GNOME Wayland 미지원 |
| L02 | GNOME 확장 ESM | https://gjs.guide/extensions/upgrading/gnome-shell-45.html | GNOME 45+ ESM 진입점 |
| L03 | GNOME 확장 구조 | https://gjs.guide/extensions/overview/anatomy.html | enable/disable·metadata·사용자 세션 |
| L04 | Ubuntu 26.04 릴리스 노트 | https://documentation.ubuntu.com/release-notes/26.04/changes-since-previous-interim/ | Ubuntu 26.04의 GNOME 50 |
| D01 | API-Sports 축구 문서 | https://api-sports.io/documentation/football/v3 | fixtures, events, 상태 코드·null·페이징 |
| D02 | API-Football 공식 입문 가이드 | https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide | 인증·검색·팀 일정·할당량 헤더 |
| D03 | API-Football 요금 | https://www.api-football.com/pricing | 무료 100회/일, 시즌 제한; 금액·조건은 변동 가능 |
| D04 | API-Football 월드컵 데이터 가이드 | https://www.api-football.com/news/post/fifa-world-cup-2026-guide-to-using-data-with-api-sports | 경기 ID 상세와 이벤트·갱신 주기 |
| U01 | 사용자 첨부 1 | `screens/user-live-activities.png` | iPhone 잠금화면에 미식축구·야구·대학풋볼의 세 카드, Watch의 소형 카드 |
| U02 | 사용자 첨부 2 | `screens/user-app-announcement.png` | 녹색 경기장 앱 아이콘과 출시 소개. 앱 내부 화면은 보이지 않음 |

**확인** = 첨부에서 직접 보임 또는 공식 문서에 명시. **추정** = 원본 내부 구조·미관측 상태의 합리적 모델. **제안** = Linux 독자 설계. 원본 앱에 로그인하거나 설치해 모든 화면을 직접 탐색하지 않았다. 화면 상태와 내부 데이터 모델을 원본 구현이라고 단정하지 않는다. 원본 픽셀 치수·실제 spring 파라미터도 공개되지 않았으므로 아래 수치는 새 앱의 규격이다.

공식 스크린샷 URL: [점수판](https://help.apple.com/assets/6942067E5B8D4348F200A46F/69420685E5DEFFA98005EA70/en_US/ded074dd956c93d91d2fcfb478ae523b.png), [시작](https://help.apple.com/assets/6942067E5B8D4348F200A46F/69420685E5DEFFA98005EA70/en_US/27e3bc51d8a70718c62131f25788efa8.png), [상세](https://help.apple.com/assets/6942067E5B8D4348F200A46F/69420685E5DEFFA98005EA70/en_US/dc3227751a0cceb0df4b1f12864133f7.png), [검색](https://help.apple.com/assets/6942067E5B8D4348F200A46F/69420685E5DEFFA98005EA70/en_US/0ba00db71388cacb8fc39ca3bb91dc0b.png). 참조 전용이며 제품에 포함하지 않는다.

## 2. 원본 핵심과 플랫폼 구분

핵심 루프는 **팀·리그 팔로우 → 개인화 점수판 → 경기 상세 → 화면 밖에서도 실시간 현황 → 다시 상세**다. 기사 피드·커뮤니티·중계 영상 자체가 중심이 아니다. 무료 앱이라는 사실과 스포츠 데이터 재배포 권리가 무료라는 것은 별개다.

첨부 첫 이미지의 카드들은 **Live Activities**다. iPhone Dynamic Island, 물리적인 MacBook 노치, 일반 배너 알림은 서로 다른 것이다. 사용자가 요청한 ‘Mac 같은 노치 알림’은 Linux 상단에 만드는 독립적인 상주 UI로 해석한다. Apple Sports가 macOS에 이 노치 UI를 직접 제공한다는 증거는 없다. Apple 계정·ActivityKit·Apple Watch 연동은 Linux에서 그대로 옮길 수 없다.

## 3. 화면 구조

원본 O01–O10과 Linux S01–S08을 분리한다. 원본의 오류·빈 상태는 별도 명시가 없으면 **제안해야 할 상태**이지 관측 완료 상태가 아니다.

| ID | 화면 / 진입 | 목적 | 주요 요소 | 상태와 증거 |
|---|---|---|---|---|
| O01 | 최초 시작 → Get Started | 관심사 설정 | 소개, 시작 버튼 | 초기 상태 확인 A03 |
| O02 | 검색·종목·리그 탐색 | 팀·리그·경기 찾기 | 검색 입력, Teams/Leagues/Games, 팔로우 | 검색·추가 확인 A03/A04; 검색 없음·로딩은 추정 |
| O03 | 점수판 / 기본 진입 | 관심 경기 훑기 | 날짜 세그먼트, 리그별 카드, 메뉴 | 과거·현재·예정 확인 A04 |
| O04 | 메뉴 / 우측 상단 | 점수판 필터 | Home, My Teams, 리그, 검색·편집·설정 | 확인 A04/A06 |
| O05 | 경기 카드 탭 | 한 경기 상세 | 팀·점수·시계·상황, 종목별 통계 탭, 시청·공유·추적 | 진행·예정·종료 확인 A05 |
| O06 | My Sports 편집 | 팔로우 관리 | 팀·리그 목록, 추가/해제, 완료 | 확인 A06 |
| O07 | Live Activities 설정 | 팀별 자동 추적 | 팀별 토글, 전체 설정 | 확인 A06 |
| O08 | 앱 / OS 설정 | 언어·배당·빈도 | 토글·배당 형식·백그라운드 설정 | 확인 A07; 지역별 차이 |
| O09 | iPhone 잠금화면 / Watch | 한눈에 경기 파악 | 작은 점수 카드·상황 설명 | 첨부 U01 직접 관측, A05 |
| O10 | 지원 토너먼트 | 그룹·대진 탐색 | 조별 그룹·브래킷 | A08 확인, 대회별 가용성 상이 |
| S01 | Linux 첫 실행 / 팀 설정 | Barcelona 선택 | 팀 검색·국가·알림 프리셋 | 제안; 브라우저 시제품은 예시 팀만 제공 |
| S02 | 메인 경기판 | 어제·오늘·예정 | 팀 필터·경기 카드·데이터 상태 | 제안; 브라우저 데모 일부 구현 |
| S03 | 경기 상세 패널 | 상황·타임라인 확인 | 점수·시간·이벤트·통계·추적 | 제안; 데모 타임라인 구현, 실통계 미구현 |
| S04 | 상단 compact 노치 | 방해 적은 상주 점수 | FCB / 점수 / 분 / 상대 약자 | 제안; 브라우저 및 GNOME 코드 |
| S05 | expanded 노치 | 문맥 확인 | 대회·팀·대형 점수·마지막 이벤트·접기 | 제안; 브라우저 및 GNOME 코드 |
| S06 | 이벤트 알림 노치 | 골·시작·종료·정정 | 이벤트명·변경된 점수·상황 | 제안; 데모·엔진·GNOME 코드 |
| S07 | 설정 | 빈도·스포일러·애니메이션 | JSON 모드·키 경로; 향후 GUI 전체 설정 | 제안; 웹 설정은 웹에만 저장 |
| S08 | 오프라인 / 연결 오류 | 신뢰도 유지 | 마지막 데이터·갱신 시각·오류 이유 | 제안; 엔진 오류 메시지, 웹 오프라인 시연 |

## 4. 사용자 플로우

횟수는 원본 문서에서 재구성한 예상 탭 수 또는 새 설계 목표이며 실제 기기 계측이 아니다.

| ID | 목표 / 경로 | 정상 경로 | 예외 |
|---|---|---|---|
| F01 | 원본 시작 | O01 → O02 검색 → 팀 추가 → 완료 → O03 (4탭+입력) | My Sports 기존 값 동기화; 검색 결과 없음 |
| F02 | 원본 점수 확인 | O03 → O05 (1탭), 좌우로 다른 경기 | 다른 종목 탭·시청 불가 지역 |
| F03 | 원본 경기 추적 | O03 → O05 → 추적 → O09 (2탭) | OS 권한 차단·팀 자동 추적 해제 |
| F04 | 원본 팔로우 편집 | O03 → O04 → O06 → 변경 → 완료 (5탭) | 마지막 팀 해제·다른 기기 동기화 |
| F05 | Linux 첫 설정 | 설치 → S07 API 모드/키 → Barcelona 검색 확인 → S04 | 키 없음·복수 검색 결과·공급사 할당량 |
| F06 | 작업 중 확인 | S04 클릭 → S05 → 접기 (2클릭) | hover만으로 키보드 포커스 빼앗지 않기 |
| F07 | 득점 수신 | 데이터 변경 → S06 (자동) → 6초 후 S04 | 동시 골·VAR 취소·지연·방해금지 |
| F08 | 자세히 보기 | 웹 S02 경기 클릭 → S03 → 닫기 (2클릭) | 통계 없음·0과 null 구분 |
| F09 | 연결 복구 | S08 마지막 점수 유지 → 재시도 → 현재 스냅샷 | 재시작·절전 동안 놓친 과거 골을 새 골로 울리지 않기 |
| F10 | 경기 종료 | 종료 전이 → S06 → S04에 종료 상태 | 연장·승부차기·중단·연기 |

## 5. 컴포넌트 인벤토리

| 컴포넌트 | 변형 | 필수 상태 | 화면 |
|---|---|---|---|
| DateSegment | 과거/오늘/예정 | 선택·focus·disabled | O03/S02 |
| LeagueGroup | 대회 헤더+목록 | 펼침·빈 목록·로딩 | O03/S02 |
| MatchCard | scheduled/live/finished | 점수·null·취소·업데이트 지연 | O03/O05/S02/S03 |
| TeamMark | 실제 구단 로고+팀 이름 | 긴 이름·대체 텍스트·로고 수신 실패 | 전체 |
| ScorePair | 소형/대형 | tabular 숫자·변경·스포일러 숨김 | S02–S06 |
| MatchClock | 분·쿼터·이닝·세트 | 진행·휴식·추가시간·알 수 없음 | O05/S03–S06 |
| FollowControl | 추가/해제·팀/리그 | 저장 중·실패·선택 | O02/O06/S01 |
| EventRow | 골/카드/교체/VAR/시작/종료 | 정정·중복·취소·시간 미상 | S03/S06 |
| StatRow | 점유율/슈팅 등 | 데이터 없음·비교·단위 | O05/S03 |
| NotchSurface | compact/expanded/event | offline/idle/demo/error/hidden | S04–S06/S08 |
| SettingsControl | toggle/select/number | focus·비활성·검증 실패 | S07 |
| DataHealth | 실제/시연·수신 시각 | stale·연결 끊김·할당량 | S02–S08 |

## 6. 상태 모델

원본 비공개 상태 코드는 알 수 없다. 다음은 **Linux 정규화 모델**이다.

```text
경기: scheduled → live → halftime → live → extra_time → penalties → finished
                    ↘ interrupted → live / abandoned
      scheduled → postponed / cancelled / unknown
연결: loading → fresh → stale → offline → recovering → fresh
표면: compact ⇄ expanded; (새 중요 변경) → event → compact
      error는 마지막 스냅샷 위 데이터 상태로 표시
      overview·잠금·전체화면 → hidden (제품 정책)
```

API 상태 `NS/TBD`는 scheduled, `1H/2H` live, `HT/BT` halftime, `ET` extra_time, `P` penalties, `FT/AET/PEN` finished, `PST` postponed, `CANC` cancelled, `SUSP/INT` interrupted, `ABD` abandoned, 기타 unknown으로 보존한다. `AWD/WO`는 finished로 분류하되 원시 코드도 남긴다. 승부차기 점수는 정규 점수와 별도 저장한다.

골 알림은 단순히 ‘1이 늘었나’만으로 처리하지 않는다. 스코어 감소는 `correction`, 증가는 `score`, 경기 시작·휴식·종료는 `status`다. 이벤트 목록은 늦게 들어오거나 바뀔 수 있다. 초기 스냅샷과 재접속 스냅샷에서는 과거 골 알림을 억제한다. 재수신 동일 스냅샷은 SQLite에 저장한 fingerprint로 중복 제거한다. 현재 초기 엔진은 **점수/상태 변경 알림**을 구현하며 개별 카드·선수 교체 알림 및 완전한 이벤트 정정은 후속이다.

## 7. 데이터 모델: 추정 원본과 Linux 제안

| 엔티티 | 필드 | 관계 / 증거 / 확신 |
|---|---|---|
| Sport | id, name, scoring_kind | 1:N Competition. 종목별 탭 A02/A05, 높음 |
| Competition | id, sport_id, name, country, season, coverage | 1:N Match. 리그 필터 A04, 높음 |
| Team | id, provider_id, name, short_name, country, accent | Competition과 시즌별 N:M. 팀 선택 A03, 높음 |
| Match | id, competition_id, home_id, away_id, kickoff_utc, status, period, elapsed, extra, home_score?, away_score?, penalty_scores?, updated_at, provider_status | Team 두 개 참조. 점수 카드 A05/U01, 높음. 세부 필드는 제안 |
| MatchEvent | id, match_id, provider_key?, type, detail, elapsed?, extra?, team_id?, player?, assist?, revision, received_at | Match 1:N. play-by-play A05, 높음; ID/수정 체계는 추정 |
| MatchStats | match_id, team_id, metric, value?, unit, observed_at | Match 1:N. 통계 A05, 높음 |
| Follow | profile_id, target_kind, target_id, auto_live, created_at | 개인→팀/리그. A06, 높음 |
| Tracking | match_id, enabled, pinned, muted_until? | 경기별 추적 A05, 높음 |
| Preferences | locale, timezone, quiet_hours, spoiler, reduce_motion, top_offset, monitor | Linux 제안. Apple 설정과 동일한 내부 구조라는 뜻 아님 |
| NotificationReceipt | match_id, fingerprint, kind, first_seen_at, delivered_at | 중복·재시작 방지. Linux 제안 |
| ProviderHealth | last_success, last_error, quota_remaining, requests_today | 신선도·요금제 보호. Linux 제안 |

실행 코드의 최소 모델은 Match 스냅샷 JSON + receipts + requests 테이블이다. 전체 제품 모델의 SQL은 `schema.sql`이다. UTC ISO 8601로 저장하고 화면에서 시스템 시간대로 변환한다. 사용자에게 한국 시간 고정을 강제하지 않는다. SQLite는 개인 로컬 앱이므로 서버 계정·결제·RLS가 필요 없다.

## 8. 디자인 시스템 분석 및 새 규격

관측한 원본 패턴: 조밀한 카드, 리그/팀별 색 구분, 큰 점수, 작은 경기 문맥, 여러 경기를 세로로 읽는 구조(U01). 앱 내부 화면 패턴은 A02–A07의 공식 문서로 보완했다. 정확한 SF 글꼴·Apple 자산·원색 값은 복제하지 않는다.

Archsport는 검정 노치, 따뜻한 흰색 본문, 청록 상태색을 사용한다. 사용자 추가 요청에 따라 구단 식별은 **실제 구단 로고**로 변경했다. 출처·원본 해시는 `../web/assets/logos/manifest.json`에 있다. `design/tokens.json`, `tokens.css`, `components.md`에 크기·색·대비·포커스·애니메이션을 정의했다. 웹 노치의 날개 곡선과 둥근 밑면을 구현했으며 GNOME은 별도의 라운드 표면을 사용한다. 브라우저는 336×46 / 460×224 / 460×144, 현재 GNOME은 360×46 / 500×250를 기준으로 렌더링한다.

## 9. 범위·기능표 읽는 법

`features.csv`는 기본 여섯 열 `feature,area,priority,original,clone,notes`를 유지하고 `id,evidence,screen,implementation`을 추가했다. clone=`no/partial/yes/skip`, original=`yes/no/conditional/unknown`. `partial`은 계획만 있다는 뜻이 아니라 일부 시제품/코드가 있다는 뜻이며 GNOME 미실행 상태는 notes에 기록했다. 완성 앱과 데모를 혼동하지 않는다.

기능표는 현재 **57개**이며 최초 조사 50개에 API 효율·설정 GUI·복구·인계 항목을 추가했다. 실제 GUI 미검증 상태를 partial로 남겼다. 검증 근거는 `verification.md`에 있다.

지원 종목은 원본 수준을 조사하지만 첫 실제 데이터 어댑터는 **축구 / Barcelona**다. NBA·MLB·NFL·골프·테니스·모터스포츠는 서로 다른 점수·시간·경쟁자 모델이 필요하다. 축구 JSON을 모든 종목에 그대로 쓰지 않는다. 전체 원본 동등성 구현은 이번 납품 범위보다 크다.

## 10. 제외·제한·크기

- Apple 계정/My Sports·Apple News/TV 동기화·Watch/ActivityKit는 대체 구현 대상에서 제외.
- 영상 중계·독점 스포츠 데이터는 포함하지 않음. 구단 식별용 실제 로고는 사용자 요청으로 동봉하며 출처를 기록하고 상업적 사용권을 취득했다고 주장하지 않는다.
- 배당은 원본 기능으로 기록하되 개인 경기 알림 MVP에서는 제외.
- 브라우저 데모는 OS 바탕화면 위에 뜨는 실제 노치가 아님. 실제 표면은 GNOME 확장에서 생성.
- Ubuntu 기본 GNOME의 패널/시계와 충돌할 수 있어 기본은 패널 바로 아래. 화면 맨 위를 덮는 물리 노치 모드는 별도 검증 후 선택형으로 계획.

원본 화면 10종, Linux 화면/표면 8종, 흐름 10개, 전체 제안 엔티티 12종. 난도 **L**: 전체 스포츠 동등성, 공급사 데이터 정정, GNOME 버전별 렌더링·절전 복구가 큰 작업이다. 현재는 조사+디자인 시제품+데이터 엔진+GNOME 초기 확장까지. 개발 순서와 검수 기준은 `architecture.md`에 있다.
