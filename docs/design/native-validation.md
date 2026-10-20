# Native GNOME validation log

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
