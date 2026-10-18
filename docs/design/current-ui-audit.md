# Current native UI audit · 2026-10-19

Source: Archsport v13 and matci v10 on `main`. Running installed extensions are older (v11/v8); this audit concerns repository code, not native screenshots.

| Area | Archsport source | matci source | Decision |
| --- | --- | --- | --- |
| Layout / hierarchy | Fixed 280/520 logical px widths; compact has crest/score/crest plus status dot; expanded live always appends upcoming, recent and stats beneath match. | Fixed 500 px expanded width; RAM hero, meter, explanatory row, app list and controls compete. | Make content width smaller and state-dependent; move secondary schedule/recent behind a disclosure in live view; retain clear review controls. |
| Typography | 30 px score but many 10–12 px labels and 700 weight in section text. | 30 px RAM and 10–12 px labels/count; dense app metric line. | Shared 11/12/14/28 scale as initial GNOME decision; test optical alignment natively. |
| Color | Normal live state uses red status icon/label; blue decorative context icons. | Normal state uses green dot/word and blue RAM bar; protection/action warnings always amber. | Normal states neutral; reserve warning and critical for actual state. Keep text labels for exceptional state. |
| Material / shape | Full border around island, shadow, pill buttons and count badges. | Same border/shadow; per-row border, pill count, rounded controls. | Remove default outer border, redundant count pills and routine row borders; keep visible keyboard focus. |
| Motion | Root width/height always 280 ms cubic, children rebuilt at once; score opacity/translation on event. | Root width/height 280 ms cubic; children rebuilt at once; panel is separate from surface. | Preserve one outer actor, distinguish expand/collapse tokens and sequence content where safe; avoid false claim of true continuously reflowed content. |
| Icons | Red record icon duplicates minute/status; redundant section icons. | Header icon repeats panel icon; normal green dot duplicates state. | Remove redundant decorations; keep GNOME symbolic controls with accessible names. |
| Interaction | Shared dock already guards ownership and outside button filtering. | Outside dismiss passes `keepReview: true`; owner click/explicit collapse currently clears review. | Preserve outside behavior; review owner toggle and Escape against user expectation. Test before changing safety flows. |

## Deletions chosen

- Remove Archsport's normal live dot/red status treatment, expanded live schedule/recent/stats by default, numeric count pill and routine section icons.
- Remove matci's normal green healthy dot/word, blue normal meter, count pill and per-row border.
- Remove default island outline in both apps; retain keyboard focus and state-specific separation.

## Limits

- The current source has no real GNOME screenshots for these versions. Visual conclusions are code-based hypotheses until native captures are inspected.
- Live data or app-close behavior cannot be inferred from static UI review. Existing provider, worker and safety logic remain separate acceptance gates.
