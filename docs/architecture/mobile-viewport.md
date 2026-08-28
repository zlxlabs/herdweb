# Mobile viewport handling

> Moved verbatim from `AGENTS.md` on 2026-08-28 (rules slim). Section body below is unchanged.

- Mobile viewport handling: lock document scroll and compute height from visual viewport (keyboard-aware); viewport meta uses `interactive-widget=resizes-content`, bottom chrome lifts above the soft keyboard via `--kb-inset`, `--wt-toolbar-height` is the measured toolbar height, and viewport-driven terminal resizes are debounced in `src/viewport/height.ts`. Target picker: `targets.length <= 1` does not create the picker or consume layout height; `> 1` puts the phone/coarse badge in the bottom toolbar and keeps the desktop/fine badge top-right.
