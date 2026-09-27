# Browslide task list (round 3; rounds 1–2 done and archived)

Conventions: commit per task, full suite (`cd tests && npm test`) green before each commit.
Single file, zero dependencies, `file://`-compatible. No question tool while user is AFK —
decide, document below, continue.

- [ ] 1. Animation settings layout: every label sits left of its field on one row; widen sidebar as needed.
- [ ] 2. Default line width 3 for all items (template default, code fallbacks, presets).
- [ ] 3. Step delete refresh: deleting a step rebuilds the rows even when the ✕ button has focus.
- [ ] 4. Bottom stage scrub slider: global per-slide animation-stage preview with click/auto indication.
- [ ] 5. Size handles edit geometry values instead of literal scaling; rectangle/ellipse get 3 handles (corner = both, right = width, bottom = height).
- [ ] 6. Tight selection boxes: per-shape tight viewBoxes so the overlay hugs the icon.
- [ ] 7. Shape sizes participate in keyframes (capture/apply/play/scrub/present/viewer), so handle drags record into steps.
- [ ] 8. Docs (README) + full suite green + commits.

# Decisions (round 3)

- Scrub slider range is 0..maxGroup, 0 = rest pose (default on slide change). An item with no
  step at the selected stage shows its last step before that stage, else its rest pose.
  Selecting a step moves slider + global state to that step's stage; editing a group number
  moves global state to the new stage. A stage is a click stage if ANY entry in it is click
  (matches the existing presenter `every(auto)` chain logic — unchanged). Slider never dirties
  the deck (view-only). Scrub poses are restored before every model sync, like step previews.
- Geometry drags started while scrubbed auto-enter step-edit on the displayed step, so what you
  see is what you edit (same contract as scrub-editing). Plain text typing always edits rest.
- Shape panel Scale X/Y inputs are removed (literal scaling goes away for interactive editing);
  rotate stays. Keyframe `sx`/`sy` targets stay in the engine + step fields for playback compat.
- Shape keyframe keys: `slen` (arrow/line length), `sr` (circle radius), `sw`/`sh`
  (rect/ellipse width/height; square side and triangle height use `sh`).
- Single-param shape handles: corner uses dx except up/down arrows (dy); right-edge uses dx;
  bottom uses dy. Fixed-size shapes (star/check/cross) show no size handles.
- Tight viewBoxes are computed in `renderShape` (stroke-aware pad) and normalized on stage
  render, so older decks tighten on open. SVG `overflow:visible` already prevents clipping.
