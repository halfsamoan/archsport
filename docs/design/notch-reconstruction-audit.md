# Notch visual reconstruction audit · 2026-10-19

## 2026-10-20 후속 구현

재로그인으로 v16/v13이 실제 Shell에서 ACTIVE인 것을 확인했다. 이 문서의
v15/v12 및 이전 후보 설명은 작업 당시의 기록이다. 다음 후보 v17/v14에는
사용자 설치 Pretendard 1.3.9를 두 노치에 지정하고, 숨김→등장 시 상단
중앙 104×8에서 목표 크기로 펼쳐지는 기하 모션을 구현했다. 격리 GNOME
50.1의 계산 글꼴과 20/130/360ms 요청 프레임은
[네이티브 캡처](iterations/README.md)에 기록했다. 실제 세션의 새 후보
적용과 입력 검수는 별도다.

## Evidence and gate

The user subsequently supplied the four requested images. Copies are preserved
under `docs/design/reference/`. The two Mac references are small video crops
(543×336 and 673×251); the two current native crops are 984×664. They show
the actual v15/v12 expanded surfaces after relogin. The Mac images establish
silhouette and visual hierarchy, but are too compressed to measure precise
logical dimensions, blur radius, or motion duration.

After the 2026-10-19 relogin, GNOME Shell 50.1 reports Archsport v15 and matci
v12 ACTIVE. Installed `extension.js`, `stylesheet.css`, `notchDock.js`, and
`dockModel.js` SHA-256 values match each respective source file. Shared dock
files are byte-identical between the two source repositories. Thus the active
version has caught up with current source. This checks file identity and Shell
metadata; the user-supplied captures establish the expanded appearance.

## Ten mismatches seen in images and source

1. **Silhouette / attachment:** both current surfaces visibly have rounded top
   corners and float below the clock strip. The references read as one black
   mass connected to the top black region. Source uses `border-radius: 24px`
   on all corners.
2. **Width:** current tokens are 200 compact, 344/388 Archsport expanded, and
   368 matci expanded. These are already below the pasted 400–440/400–430
   proposal; increasing them without reference comparison would be unjustified.
3. **Height / density:** matci still computes up to 350 px and Archsport's
   scroll viewport can grow substantially. Normal states should be measured
   separately from review/error states, where more height may be necessary.
4. **Dark material:** both current screenshots show a light gray expanded
   surface under this session's default Yaru theme. Both references are dark.
5. **Blur / tint / highlight / shadow:** current surfaces are solid `#111214`
   or light `#f7f7f9`; there is no isolated material actor or blur. Shadow is
   already disabled, so adding a prominent shadow would reverse a recent fix.
6. **Typography:** 30 px hero metrics exist, but several bold 11–12 px labels
   and full date/team strings compete in the narrow width. Native baseline and
   truncation need visual review.
7. **Toolbar:** settings/collapse are visibly filled gray circles, 34×34 in CSS.
   Transparent 28×28 controls with 14–15 px glyphs are a concrete prototype
   candidate, subject to keyboard focus and touch target validation.
8. **Scrollbar:** both current screenshots show a prominent gray vertical bar.
   Archsport uses a 4 px slider rule but the visible bar is wider at the shown
   scale/theme; matci uses a 140 px list viewport. Reducing default content is
   preferable to only thinning the bar.
9. **Primary / secondary content:** Archsport live score already hides other
   fixtures behind disclosure, but idle view still offers 3 upcoming, 6 recent,
   stats, and notices. Matci normal view still shows basis text, input age,
   protection reasons, and a separate refresh control.
10. **Spatial continuity / motion:** the root morphs width and height while
    children are destroyed and rebuilt. The shared dock also animates whole
    actor opacity and scale. This can look like a popover even though the root
    is shared. A delayed secondary-content reveal is only a hypothesis until
    repeated native reversal is tested.

## Design decision for prototype

Start with the existing narrower widths, a top-attached near-black silhouette,
default transparent toolbar icons, and less normal-state text. Keep explicit
review and error information reachable. Do not apply the pasted 70/20/10 split
as a measured law; it is a useful qualitative priority. Blur remains optional
until GNOME Shell 50.1 runtime support and performance are checked. The
prototype uses CSS backdrop blur only to express visual intent; it is not GJS
compatibility proof.

## Implementation gates

1. Compare the four supplied images in `docs/design/reference/` against the
   prototype. Motion still needs a live reference because these are stills.
2. Iterate the visual prototype at least three times and record crops and
   decisions. Confirm normal, live, review, error, and narrow-width states.
3. Port approved geometry/tokens to both GJS surfaces together. Preserve
   worker/provider/action/shared dock lifecycle and byte parity.
4. Stage both extensions atomically for the next login. Check ACTIVE versions,
   actual native screenshots, 100/125/150% scaling, input/lifecycle, and blur
   on/off cost before claiming completion.

## Candidate status after source changes

The v16/v13 source now contains the dark attached surface, smaller toolbar
controls, and a shorter normal-state information hierarchy. The local HTML
prototype could not be rendered in the available browser because local-file
access was denied. A later isolated GNOME Shell 50.1 virtual-monitor run
produced [native visual iterations](iterations/README.md) for both apps,
including compact/opening frames. This verifies synthetic-state GJS rendering,
not the user's active session, real input, or scale behavior. The running GNOME
versions must be checked after a later login before claiming those results.
