# Browslide task list (round 3; rounds 1–2 done and archived)

Conventions: commit per task, full suite (`cd tests && npm test`) green before each commit.
Single file, zero dependencies, `file://`-compatible. No question tool while user is AFK —
decide, document below, continue.

- [x] 1. Animation settings layout: every label sits left of its field on one row; widen sidebar as needed. Done.
- [x] 2. Default line width 3 for all items (template default, code fallbacks, presets). Done.
- [x] 3. Step delete refresh: deleting a step rebuilds the rows even when the ✕ button has focus. Done.
- [x] 4. Bottom stage scrub slider: global per-slide animation-stage preview with click/auto indication. Done.
- [x] 5. Size handles edit geometry values instead of literal scaling; rectangle/ellipse get 3 handles (corner = both, right = width, bottom = height). Done.
- [x] 6. Tight selection boxes: per-shape tight viewBoxes so the overlay hugs the icon. Done.
- [x] 7. Shape sizes participate in keyframes (capture/apply/play/scrub/present/viewer), so handle drags record into steps. Done.
- [x] 8. Docs (README) + full suite green + commits. Done: 402 checks pass.

# Round 4 (user report: thinning handles + rest/step fighting)

- [x] 9. Fix thinning: fixed `0 0 100 100` viewBox (size params change rendered size); overlay hugs via geometry→screen mapping instead. Done.
- [ ] 10. Initial-step model: every item carries undeletable `initial:true` step 1 (auto) mirroring rest; initial group = appear stage (presenter hides earlier); slider min is 1.
- [ ] 11. Step-UI cleanup: per-kind field filtering; line width/color + geometry + rotate live in step rows (initial row owns rest-only stroke); Shapes panel keeps select + insert only.
- [ ] 12. Docs (README) + full suite green + commits.

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
- Stroke width/color edits are rest-only: they leave step-edit mode and drop scrub previews
  before applying, so a step preview can never leak into the saved rest pose.
- Viewer export player-size guard raised 12000 → 16000 chars (shape geo + keyframes are
  legit player code; the no-editor-code regex is the real guard).
