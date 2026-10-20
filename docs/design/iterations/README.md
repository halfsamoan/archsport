# GNOME 50.1 네이티브 시각 반복 · 2026-10-19

## 2026-10-20 Mac 노치 slab (Archsport v21 / matci v18)

격리 GNOME Shell 50.1에 합성 상태를 넣어 촬영했다(실제 세션 아님). 설계와 검증 내용은 [native-validation.md](../native-validation.md) 최상단 절.

| 상태 | 캡처 |
| --- | --- |
| 일정 | [22-v21-schedule.png](22-v21-schedule.png) |
| 라이브 | [23-v21-live.png](23-v21-live.png) |
| compact | [24-v21-compact.png](24-v21-compact.png) |
| 열림 20–230ms · 닫힘 20–260ms | [25-v21-open-close.png](25-v21-open-close.png) |

## 2026-10-20 v19 마무리 후보

격리된 GNOME Shell 50.1(1600×900 가상 모니터, `GSETTINGS_BACKEND=keyfile`)에
최종 소스를 그대로 설치하고, 실행 중인 복사본에만 Eval로 **합성 경기 상태**를
주입해 `Shell.Screenshot.screenshot_area()`로 촬영했다. 소스에는 합성 코드가
없다. 실제 사용자 세션·실제 경기·입력·배율 결과가 아니다.

| 상태 | 캡처 | 확인한 점 |
| --- | --- | --- |
| 일정 | [17-v19-schedule.png](17-v19-schedule.png) | 머리말은 아이콘 없이 `경기 정보`, 도구는 오른쪽 끝. 다음 3건·최근 2건이 상대 중심 행 |
| 라이브 | [18-v19-live.png](18-v19-live.png) | crest·점수·상대가 먼저 읽히고 일정은 접힘 |
| compact | [19-v19-compact.png](19-v19-compact.png) | 200×58, 목 아래 어깨 깊이 18 |
| 열림·닫힘 | [20-v19-open-close.png](20-v19-open-close.png) | 열림: 너비·높이가 함께 커지고 머리말→점수→보조 순서. 닫힘: 점수 영역(보조)이 먼저, 머리말이 45ms 뒤 사라지고 160ms 뒤 compact |
| 연속 클릭·모션 끔 | [21-v19-reverse-reduced.png](21-v19-reverse-reduced.png) | 90ms에 재클릭하면 현재 크기에서 되돌아감. `enable-animations=false`면 20ms에 완성 크기 |

v18 캡처(11–13)의 아래 모서리 바깥에는 블러 사각형이 희미하게 남아 있었다.
St가 스타일을 다시 계산할 때 CSS 기준으로 margin을 덮어써 블러 actor의
`margin_*` inset이 0이 되었고, BACKGROUND 블러가 표면 사각형 전체에 칠해졌기
때문이다. v19는 inset을 위젯 style에 두고 8px(22px 베지어 모서리 안쪽 최소값)로
줄였다. 블러를 켠 상태에서 모서리 바로 바깥 픽셀이 배경화면과 1 이내로 같다.
같은 원인으로 테마를 다시 불러오면 클릭 판정 영역의 margin도 0이 되어 투명한
상단 모서리가 클릭을 가로챘다. v19는 `style-changed`에서 판정 영역을 다시
계산하며, `Main.loadTheme()` 전후 모두 투명 모서리와 어깨 바깥은 배경
actor로, 목과 본문은 노치로 pick되었다.

## 2026-10-20 v18 실루엣 후보

격리된 GNOME Shell 50.1의 1600×900 가상 모니터에서 **임시 개발 복사본**에
합성 경기 상태를 넣고 `Shell.Screenshot.screenshot_area()`로 촬영했다.
실제 사용자 세션에 적용된 화면이나 실제 경기 기록이 아니다.

| 상태 | 실제 GJS 렌더 캡처 |
| --- | --- |
| 일정 | [11-v18-schedule.png](11-v18-schedule.png) |
| 라이브 | [12-v18-live.png](12-v18-live.png) |
| compact | [13-v18-compact.png](13-v18-compact.png) |
| 펼침 요청 후 75/130/230ms | [14-v18-morph-75ms.png](14-v18-morph-75ms.png), [15-v18-morph-130ms.png](15-v18-morph-130ms.png), [16-v18-morph-230ms.png](16-v18-morph-230ms.png) |

모션 사진의 시각은 GLib 타이머 요청 시각이며 실제 프레임 캡처 완료 시각이
아니다. 해당 실행에서는 compact→일정 전환의 요청 시각 20/75/130/230ms에
surface 크기가 각각 약 218×65, 232×73, 256×111, 388×322였다.
본문 텍스트는 작은 surface allocation 밖으로 나오지 않았다. 보이는 블러
영역을 본문 내부에 두었고 곡선 바깥의 직사각형 번짐은 캡처에서 보이지
않았다. 실제 사용자 화면의 배율·입력·성능은 별도로 검수해야 한다.

## 2026-10-20 Pretendard와 상단 앵커 등장 모션

현 기기의 `fc-match Pretendard`는 사용자 설치 Pretendard 1.3.9를 찾는다.
두 노치의 CSS 루트와 텍스트 컨트롤에 이 글꼴을 지정했다. 격리 GNOME
Shell에서 `get_theme_node().get_font()`가 Archsport 루트에
`Pretendard 14.666px`를 반환했다. 아래 시각 자료는 임시 개발 복사본에만
합성 일정을 넣고 캡처했다.

| 타이머 요청 시점 | 캡처 | 실제 관측 |
| --- | --- | --- |
| [20ms](08-pretendard-reveal-20ms.png) | 104×8, 상단 중앙 검은 시작 형태 | 알파 255, 폭과 높이 증가 전 |
| [130ms](09-pretendard-reveal-130ms.png) | 외곽 대부분 펼쳐짐 | 경기 행은 뒤따라 나타나는 중 |
| [360ms](10-pretendard-reveal-360ms.png) | 완성된 일정 노치 | 388×259, 상단 고정 |

표의 시간은 GLib 타이머 요청값이다. 스크린샷 작업 완료 시각이나 실제
디스플레이 프레임 시간이 아니다. `enable-animations=false`를 설정한 별도
격리 실행에서는 20ms 관측부터 완성 크기 388×259로 표시됐다.

아래 PNG는 1600×900 가상 모니터의 격리된 **GNOME Shell 50.1/GJS**에서
`Shell.Screenshot.screenshot_area()`로 직접 캡처했다. 경기·앱 내용은
`.dev`에 설치한 임시 개발 복사본에만 주입한 **합성 데이터**다. 사용자 세션의
실제 경기, 입력, 배율, 절전 결과로 해석하지 않는다.

| 순서 | 캡처 | 확인한 점 |
| --- | --- | --- |
| 1 | [일정](01-schedule-final.png) | 다음 경기 3건과 최근 결과 2건이 잘리지 않고 검은 상단 부착 표면에 보임 |
| 2 | [라이브](02-live-final.png) | 로고·점수·분이 우선이며 일정은 접힌 상태 |
| 3 | [라이브 문맥](03-live-context-final.png) | 명시적으로 펼치면 다른 일정/결과가 표시됨 |
| 4 | [compact](04-compact-final.png) | 패널 아래의 같은 중심축에 200px 표면 |
| 5 | [열림 약 40ms](05-opening-40ms.png), [약 130ms](06-opening-130ms.png), [약 360ms](07-opening-360ms.png) | 폭·높이가 상단 기준으로 변하고 점수가 초기에 보임. 시간은 타이머 요청값이며 실제 프레임 타임 측정은 아님 |

첫 일정 렌더는 GNOME의 `get_preferred_height()`가 실제 경기 행을 작게
예측해 최근 결과 한 줄이 잘렸다. 경기 행마다 작은 높이 여유를 주고 다시
캡처해 2건 모두 보이는 것을 확인했다. 첫 모션 캡처에서는 점수가 늦게
나타났다. 라이브 본문 지연을 없앤 뒤 약 40ms 캡처에서 점수가 보였다.

`Shell.BlurEffect`의 `BACKGROUND` 모드도 개발 복사본에서 시험했다. 루트에
직접 적용하면 둥근 아래 모서리 밖으로 직사각형 블러가 보여 채택하지 않았다.
소스에는 불투명도 0.97의 어두운 표면을 사용한다. 사용자 세션의 실제
성능·입력·125/150% 배율 검수는 별도다.
