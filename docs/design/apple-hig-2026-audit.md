# Apple HIG 2026 → GNOME Shell 50.1 design audit

2026-10-19. Archsport v13 / matci v10 source; GNOME Wayland 50.1. This is a translation of design guidance, not an assertion that a GNOME extension implements Apple APIs. Apply this shared document to both repositories.

## Official sources reviewed

| Apple source | Direct guidance relevant here | GNOME translation |
| --- | --- | --- |
| [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles/) | Purpose, Agency, **Responsibility, Familiarity**, Flexibility, Simplicity, Craft, Delight. The brief omits the two bold principles; the current official page includes eight. | Put live match or memory condition first; keep dismissals reversible; preserve GNOME input conventions and protection policy. |
| [Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities) | Current activity at a glance; compact and expanded presentations; readable primary information; compact margins and only needed width. | Archsport compact = crests, score, minute/status. Expanded = match, salient event, optional details. An idle island stays hidden. |
| [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Motion conveys state and feedback, stays brief, can be omitted and cancelled. | Animate surface geometry and reveal order; honor `enable-animations`; fast repeated clicks must settle to the requested state. |
| [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | Hierarchy uses size, weight and color. Official macOS default/minimum is **13/10 pt**, but those are macOS points, not GNOME logical pixels. Prefer readable regular/medium/semibold and test at viewing distance. | Use GNOME system UI font and test optical sizes on the actual display. No SF binary in the repositories. Reserve bold for scores/key state. |
| [Color](https://developer.apple.com/design/human-interface-guidelines/color) | Use color consistently to communicate meaning and verify light/dark and increased contrast. | Semantic surface/label/status tokens. Neutral memory readings stay neutral; warning/critical colors appear only when justified by state. |
| [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | Material separates content and controls; Liquid Glass serves a functional navigation/control layer. | Use a restrained GNOME surface. Background blur is an optional measured experiment, never a required visual dependency. |
| [Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/) | One popover, content-sized, smooth size changes, outside dismiss, one click to switch, and **preserve work on automatic dismissal**. | Shared dock retains one owner. Outside left/right click closes without consuming the original action. matci review selection survives dismissal. |
| [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Group related items, allow vital information room and adapt to context and text size. | Content-based width; narrower monitor and 100/125/150% visual checks; no crowded nested cards. |
| [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode) | Foreground/elevated surfaces need separation; custom backgrounds can obscure system distinctions. | Keep Archsport compact dark if useful, but map expanded surfaces to GNOME appearance and maintain contrast. |
| [iOS/iPadOS 27 and macOS 27 design resources](https://developer.apple.com/design/resources/) | Official kits include current components and states. | Study proportions and hierarchy only. Do not copy Apple's asset files, SF Symbols, or platform-specific components into GNOME. |
| [WWDC26 Live Activities essentials](https://developer.apple.com/videos/play/wwdc2026/223/) | Tailor presentations to available space, structure static/dynamic content, update timely. | Distinguish match identity from changing score/event; keep compact stable; never imply synthetic replay is live. |
| [Liquid Glass overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) and [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) | System components adapt material and motion; custom effects should be sparse and tested with accessibility settings. | St/Clutter cannot inherit AppKit/SwiftUI Liquid Glass. Implement legible opaque fallback first; consider blur only on the small expanded control surface after performance measurement. |

## Shared implementation decisions (ours, **not Apple specifications**)

These values are design starting points for GNOME and must be tuned after native screenshots. Do not cite them as official Apple measurements.

| Token family | Initial GNOME choice | Reason / trade-off |
| --- | --- | --- |
| Typography | System UI font; hero 30 logical px; compact score 18; primary 14; secondary 12; caption 11 | More readable than dense 9–10 px labels; may increase surface width. |
| Spacing | 2, 4, 8, 12, 16, 20, 24 logical px | A short rhythm across both apps; visual QA can change individual values. |
| Surface | `surfacePrimary`, `surfaceElevated` plus light appearance variants; Archsport compact near-black | Keeps compact glanceability while respecting GNOME theme. |
| Labels | `labelPrimary`, `labelSecondary`, `labelTertiary` | Hierarchy by contrast, not an extra badge or border. |
| Status | `accentPositive`, `accentWarning`, `accentCritical`; neutral normal | Color has a consistent meaning and is not the sole state signal. |
| Shape | Shared 24 px fully rounded outer radius; inner radius derives from inset where practicable | A continuous notch silhouette on all four corners. |
| Motion | `micro` 100 ms, `response` 160 ms, `expand` 260 ms, `collapse` 175 ms, `event` 210 ms; distinct curves | Supports purpose and reversibility; actual duration requires native inspection. |
| Control/icon | Shared visual and hit sizes; GNOME symbolic icons | GNOME assets remain available and accessible, without copying Apple artwork. |
| Shadow/material | No outer shadow; low contrast border only where needed; opaque fallback | The actual GNOME capture showed a rectangular gray shadow outside a rounded corner, so a clean silhouette takes priority. |

## Boundaries and acceptance

- Apple ActivityKit, Dynamic Island hardware placement, SF font rendering, SF Symbols, system Liquid Glass and automatic iOS accessibility adaptation have no direct GNOME equivalent. The GNOME extension must recreate only the useful information behavior with St/Clutter and GNOME settings.
- Apple HIG guidance does not provide a GNOME radius, pixel spacing, easing duration or blur budget. Any numeric GNOME token remains our implementation decision.
- Real native screenshots and device input/lifecycle checks determine acceptance. A browser preview, Node parse or Python test cannot prove GNOME rendering, GPU cost or Shell lifecycle.
- Preserve worker protocol, API providers, shutdown/close protections, pending alerts, shared dock ownership and selection persistence throughout visual changes.

The token source is `docs/design/design-tokens.json` in each repository. `tools/build_design.py` generates native CSS and GJS token modules; `tools/check_shared_design.py` compares the two JSON files byte-for-byte locally and against the peer repository on CI pushes.
