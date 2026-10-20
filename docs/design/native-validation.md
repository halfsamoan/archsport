# Native GNOME validation log

## 2026-10-20 마무리 후보 (Archsport v19 / matci v16)

격리된 `GSETTINGS_BACKEND=keyfile` GNOME Shell 50.1(1600×900 가상 모니터)에
최종 소스를 설치해 확인했다. 합성 경기·앱 상태는 실행 중인 복사본에만 Eval로
주입했고 소스에는 없다. [Archsport v19 캡처](iterations/README.md), [matci v16 캡처](../../../matci/docs/design/iterations/README.md). 실제 사용자 세션은 아직 v17/v14 ACTIVE다.

- 계획 격차 수정: matci 노치 루트를 St focus group으로 등록해 Tab·방향키가 행,
  보호 행(보호 이유 포함), `검토 N`에 닿는다. 새로고침은 worker 오류·갱신
  실패·worker 중단 때만 보이며 버전 불일치 안내를 덮지 않는다. Archsport 결과 행과
  다른 진행 경기의 접근성 이름은 스포일러 설정이면 점수를 숨기고, 두 팀 행에도
  홈/원정을 넣는다. 일정 머리말의 중복 아이콘을 없앴다. 두 노치는 닫힐 때
  보조정보를 먼저, 주정보를 45ms 뒤 거두고 160ms에 목으로 돌아간다. compact 어깨는
  목 아래 깊이 18(허용 18–26)이고, 점화 프레임(높이 ≤12)은 어깨 곡선이 교차하지
  않도록 목 사각형만 그린다.
- 블러 누출 수정: v18/v15 캡처의 아래 모서리 바깥에 블러 사각형이 희미하게
  보였다. St가 스타일을 다시 계산할 때 CSS 기준으로 margin을 덮어써 블러 actor의
  `margin_*` inset이 0이 되었고(할당 상자 0,0–388×322), BACKGROUND 블러가 표면
  사각형 전체에 칠해졌다. 블러를 끄면 모서리 바깥 픽셀이 (83,44,65)에서 배경화면
  (100,37,72)으로 돌아오는 것으로 원인을 확인했다. inset을 위젯 style로 옮기고
  8px로 줄였다(할당 24,34–364,298). 블러를 켠 여섯 상태 모두 모서리 바로 바깥
  픽셀과 배경화면의 차이가 5 이하다. `Shell.BlurEffect`는 두 확장 모두 BACKGROUND,
  반경 28, 밝기 0.73으로 붙어 있다.
- 클릭 판정 수정: `Main.loadTheme()`(밝기 테마 전환과 같은 경로) 후 판정 영역의
  margin이 0이 되어 투명 상단 모서리가 노치로 pick되었다. `style-changed`에서 다시
  계산하도록 고친 뒤에는 테마 재적용 전후 모두 투명 모서리·어깨 바깥·아래 모서리
  바깥은 `Meta_BackgroundActor`, 목과 본문은 노치로 pick되었다.
- 모션: 열림은 너비와 높이가 함께 커지고, 90ms 재클릭은 현재 크기에서
  되돌아간다. `enable-animations=false`면 20ms에 완성 크기다. 시간은 GLib 타이머
  요청값이며 실제 디스플레이 프레임 시간이 아니다.
- 검사: Python(Archsport 67, matci 52), Node(Archsport 19, matci 29), 스키마,
  `build_design.py --check`, 공유 파일 바이트 일치, ESLint(npx 캐시의 flat config
  eslint, 오류 0·기존 `_error` 미사용 경고만)를 통과했다. 격리 Shell 로그에
  `JS ERROR`와 `backdrop blur unavailable`가 없었다.

- RAM·수명주기(같은 격리 조건, 상태마다 새 Shell, 40초 안정화 후 5초 간격 8회
  중앙값): 두 확장이 gnome-shell에 더하는 RSS는 3–6MB이고 수정 전후 차이는 새
  Shell 간 잡음(±2MB) 안이다. 10회 켜고 끄기에서 actor는 Archsport +70/−70,
  matci +17/−17로 정확히 돌아오고 fd와 worker 수도 원상 복귀했다. 비용의 대부분은
  Python worker다. matci worker는 최근 snapshot 128개를 프로세스 목록째 보관해 실제
  /proc 기준 24MB에서 약 11분 동안 48.5MB(PSS 37MB)까지 늘었다. 지난 snapshot에서
  프로세스 목록을 빼고 응답 캐시를 압축하자 15분 동안 20.5MB(PSS 11.6MB)로
  평탄했다. Archsport worker는 약 27MB로 같고, 날마다 쌓이던 지난 football-data 창
  캐시 행과 오래된 라이브 snapshot을 정리해 장기 증가를 막았다. Shell 쪽에서는
  2초마다 반복되던 알림 파일 재기록, 대기 중 읽기 때문에 닫히지 않던 stdout 파이프,
  8KB마다 약 90KB 줄을 다시 인코딩하던 matci 수신 버퍼, 해제되지 않던 Cairo
  context와 스크롤 timeout을 정리했다.
- 실제 세션(v17/v14, 수정 전 코드) 45분 관찰: gnome-shell RSS+swap은 약 350.6MB에서
  평탄했다. `gnome-extensions disable matci@local` 뒤에도 matci가 ACTIVE로 남아 worker가
  계속 돌았다. GNOME Shell 50.1 `_callExtensionDisable`이 await 전에 계산한 순서
  인덱스로 `_extensionOrder`를 지우는 구조라, 겹친 enable/disable 이후 matci가 순서
  목록에서 빠진 것으로 보인다. 재로그인 전까지 이 세션의 matci 끔 측정은 유효하지
  않다.

아직 판정하지 않은 것: 실제 화면의 100/125/150% 배율, 실제 마우스·키보드·
스크린리더, overview·fullscreen·잠금·절전 복귀, 실제 디스플레이의 프레임 간격과
블러 켬/끔 5분 유휴 CPU. headless 가상 모니터는 유휴 중 다시 그리지 않으므로
유휴 CPU 비교 근거가 되지 않는다.

## 2026-10-20 목·어깨·본문 후보 (Archsport v18 / matci v15)

기존 미커밋 v17/v14를 먼저 기준 커밋으로 보존했다. GNOME 50.1의 실제
GI typelib을 조회해 `Shell.BlurEffect`에 `radius`, `brightness`, `mode`가
있고 `Shell.BlurMode.BACKGROUND`가 사용 가능함을 확인했다. 두 확장의
새 표면은 Cairo로 검은 실루엣과 내부 하이라이트를 그리며, 별도 blur actor는
본문 안쪽에만 놓는다. Cairo 영역을 블러의 마스크로 사용하지 않는다.

격리된 `GSETTINGS_BACKEND=keyfile` Shell에서 임시 개발 복사본의 합성
Archsport 3상태·matci 3상태를 촬영했다. [Archsport 캡처](iterations/README.md),
[matci 캡처](../../../matci/docs/design/iterations/README.md)를 참조한다.
최종 형태의 상단 투명 모서리는 `MetaBackgroundActor`, 목·어깨는 반응형
노치 actor로 pick된 것을 확인했다. 이 검사는 실제 마우스 클릭·키보드·배율
검증을 대신하지 않는다. 새 v18/v15를 다음 로그인용으로 함께 스테이징했고,
실제 사용자 Shell은 아직 v17/v14 ACTIVE다. 스테이징된 핵심 UI 파일은
각 저장소 소스와 SHA-256이 일치한다.

같은 격리 Shell·가상 화면에서 Archsport를 20회 열고 닫으며 `after-paint`
간격을 기록했다. 배경 블러 켬: 466프레임, 중앙값 16.57ms, 95백분위
19.91ms, 25ms 초과 19회. 블러 끔: 465프레임, 중앙값 16.63ms,
95백분위 19.86ms, 25ms 초과 20회였다. 100ms 이상 간격은 유휴 구간으로
제외했다. 이 비교에서는 뚜렷한 차이가 없었지만 headless 가상 모니터의
결과이며 실제 화면의 프레임 안정성·5분 유휴 CPU 판정은 아니다.

## 2026-10-20 Pretendard / reveal candidate (v17/v14)

재로그인 후 실제 사용자 Shell은 Archsport v16, matci v13을 ACTIVE로
보고했다. 두 저장소의 다음 후보 v17/v14에는 Pretendard 글꼴과 상단 중앙
104×8 시작 형태에서 폭·높이가 220ms 동안 펼쳐지는 등장 모션을 적용했다.
카드 전체 scale 효과는 사용하지 않는다. secondary 내용은 65ms 뒤에 나타난다.

격리 GNOME Shell 50.1에서 두 노치의 계산 글꼴이 Pretendard로 확인됐고,
matci 패널 숫자도 Pretendard Bold로 확인됐다. 두 확장의 20/130/360ms
요청 시점 캡처는 각각 [Archsport](iterations/README.md)와
[matci](../../../matci/docs/design/iterations/README.md)에 기록했다.
애니메이션 비활성화 시 Archsport는 첫 20ms 관측부터 완성 크기였다.
이는 합성 상태의 가상 모니터 결과이며 현재 사용자 Shell의 v17/v14
화면, 실제 입력, 125/150% 배율, 절전은 검증하지 않았다.
최종 소스의 Python(Archsport 65, matci 51), Node, ESLint(오류 0), schema와
공유 파일 일치를 다시 확인했다. 임시 합성 코드를 제거한 개발 복사본도 두
확장을 함께 띄웠을 때 `JS ERROR`가 없었다. 두 후보를 사용자 확장
`extension-updates/`에 함께 스테이징했으며 핵심 JS/CSS/토큰/공유 도크가
소스와 동일한지 확인했다. 실행 중인 Shell은 계속 v16/v13이다.

## 2026-10-19 격리 GNOME 렌더링 후 갱신

`matci/tools/dev.py --prepare-only`가 두 앱의 Python/Node/ESLint/schema와
공유 파일 일치를 통과한 뒤, 격리 XDG 경로와 `GSETTINGS_BACKEND=keyfile`의
GNOME Shell 50.1 가상 모니터(1600×900)에서 실제 St/GJS 화면을 캡처했다.
합성 경기·앱 상태는 `.dev` 설치 복사본에만 주입했고 저장소 소스나 사용자
데이터에는 넣지 않았다. [Archsport 상태·전환 캡처](iterations/README.md)와
[matci 목록·검토 캡처](../../../matci/docs/design/iterations/README.md)를 참조.

- 빈 matci 목록의 불필요한 스크롤 막대를 제거했고, 합성 앱 3개가 모두
  보이도록 목록 높이를 보정했다.
- Archsport 일정의 최근 결과 2번째 행 잘림을 고쳤고, 라이브 열림 약 40ms
  캡처에서 점수가 먼저 보이도록 전환을 수정했다.
- 공유 도크에서 전체 actor 확대 효과를 제거했다. 종료 때 없는
  `DockParticipant.shutdown()`을 호출하던 GJS 오류도 두 앱에서 수정했다.
- `Shell.BlurEffect(BACKGROUND)`를 루트에 적용한 실험은 둥근 모서리 밖의
  사각형 아티팩트로 기각했다. 블러 비용 비교는 채택한 디자인의 검증으로
  계산하지 않는다.

이는 가상 모니터의 네이티브 **시각** 검증이다. 현재 사용자 세션은 여전히
v15/v12이며 v16/v13 화면, 실제 마우스·키보드, 125/150% 배율,
overview/fullscreen/suspend, 장시간 성능은 확인하지 않았다.

최종 소스만 다시 설치한 격리 Shell에서는 두 확장이 시작하고 기록된
`JS ERROR`가 없었다. 이어 두 확장을 다음 로그인용 v16/v13 업데이트로
다시 스테이징했다. 준비 폴더의 JS/CSS/토큰/공유 도크 SHA-256이 저장소 소스와
일치하고 임시 합성 캡처 코드가 없는 것을 확인했다. 사용자 세션의 기존
v15/v12는 계속 ACTIVE다.

## 2026-10-19 reconstruction candidate

After the user's latest login, `gnome-extensions info` showed Archsport v15
and matci v12 ACTIVE, and the supplied screenshots show those versions' light
expanded surfaces. Both source trees now have v16/v13 dark-surface candidates.
Source checks passed, including byte parity for shared dock files and design
tokens. The browser denied access to the local HTML prototype, so no rendered
prototype comparison or three captured iterations were completed. Motion
reference videos were linked but their frames could not be inspected. These
are explicit visual/motion gates for the next native login. The later historical
notes below describe the prior v15/v12 candidate and should not be read as
validation of v16/v13.

Both candidates were staged with `tools/install_extension.py --upgrade` under
`~/.local/share/gnome-shell/extension-updates/`. Staged metadata is v16/v13,
and each staged `extension.js`, `stylesheet.css`, `designTokens.js`,
`notchDock.js`, and `dockModel.js` has the same SHA-256 as source. The running
Shell still reports v15/v12 ACTIVE, so there is no v16/v13 native screenshot
or interaction result yet. Each installer saved a backup of the active files.

2026-10-19, GNOME Shell 50.1, Wayland. Logical monitor reported as 1728×972. The user logged in again; `gnome-extensions info` confirms Archsport v14 and matci v11 are ACTIVE. The next source candidates are v15/v12 and require their own native reload after staging.

## Verification completed

- Source syntax, Python/Node tests, schema dry run, CSS generation check and local byte comparison of shared tokens passed.
- `Clutter.AnimationMode.EASE_OUT_QUART` and `EASE_OUT_CUBIC` are present in the installed Clutter 18 typelib.
- GNOME interface currently reports `color-scheme='default'`, `gtk-theme='Yaru-purple'`, and animations enabled. The code selects the light expanded variant in this appearance.
- Code inspection confirms the existing shared dock outside-click logic and matci `keepReview: true` path are preserved. Both dock implementations now use the same motion duration and easing tokens.
- After the screen unlocked, the screenshot portal captured the **old installed** v11/v8 panel. The cropped baseline is `docs/design/iterations/00-before-panel-gnome50.png`; the full-desktop capture was removed.
- The user supplied native crops of the v14/v11 expanded UI: excess blank space in matci and a gray rectangular shadow visible beside a rounded Archsport corner. The v15/v12 source reduces widths and padding, sizes the matci list viewport from its content, rounds all four outer corners, and removes the outer shadow. The visual outcome is still unverified.

## Native visual gate pending

The desktop initially reported `org.gnome.ScreenSaver.GetActive = true`. Both `gnome-screenshot` and the screenshot portal returned a black image while locked; those captures were discarded. After the user's relogin, the v14/v11 surfaces are loaded. The tighter v15/v12 source is not loaded yet, so its appearance and motion are not claimed.

After unlock and the staged update applies at the next GNOME login, capture and inspect at least three iterations of the following actual GNOME states, saving only cropped UI evidence under `docs/design/iterations/`:

| Archsport | matci |
| --- | --- |
| idle panel, compact live, expanded live, goal event, schedule, multiple games, error | panel, overview, app list, selected apps, review, result, error |

Then validate 100/125/150% scaling, input including right/middle/side clicks, repeated open/close, cross-app ownership, overview/fullscreen, suspend/resume, lifecycle and 30-minute CPU/GPU/RSS before producing `final-apple-audit.png`. The worker/API paths must remain unchanged. Inspect relevant redacted `journalctl --user -b -o short-precise` errors after the actual run.
