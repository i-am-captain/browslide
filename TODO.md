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
- [x] 10. Initial-step model: every item carries undeletable `initial:true` step 1 (auto) mirroring rest; initial group = appear stage (presenter hides earlier); slider min is 1. Done.
- [x] 11. Step-UI cleanup: per-kind field filtering; line width/color + geometry + rotate live in step rows (initial row owns rest-only stroke); Shapes panel keeps select + insert only. Done.
- [x] 12. Docs (README) + full suite green + commits. Done: 424 checks pass.

# Round 5 (drop jump-back fix)

- [x] 13. Step-edit drops keep showing the edited step (canvas no longer strands at rest; consecutive edits work without deselect). Done: 427 checks pass.

# Round 6 (full review pass, fresh-eyes from disk)

- [x] 14. Dead code removed, duplication reduced, anchors verified. Done: 428 checks pass.

# Decisions (round 6)

- Removed: `selectedShapeSvg` (no callers), `snapToFirst` (no-op since initial steps —
  stage HTML is always rest at `showPresent`, and the viewer player never had it),
  dead `#shapes-wrap .srow input[type="number"]` CSS rule.
- Unified: `onGripDown` delegates to `startItemDrag(e, false)` (was a 30-line duplicate);
  `trackDrag` owns pointer-listener lifecycle for all four drag kinds;
  `refreshSelectionUI` is the single selection-change path;
  `SHAPE_KEYS` is the one keyframe-key <-> attr table (4 inline pair-lists rewritten as loops);
  `removeAnimStep` is the single step-delete path (button + emptied-row).
- Kept deliberately: `PLAYER_JS` engine duplication (the viewer export must be one
  self-contained string; the no-editor-code regex + size guard is the real check),
  `SHAPES` global (built in app, consumed by tests as the library contract),
  `moveTargetTo` (app helper exercised by tests as an interaction proxy).
- Fixed stale size comments: map header (~1150 -> ~3700) and AGENTS.md (~2200 -> ~3700).
- All map anchors re-verified at 2 hits each; no duplicate element IDs (dup-id hits are
  map-comment mentions by design); no stray console/TODO markers in app code.

# Decisions (round 5)

- `commitStepGeometry` re-applies the written step pose after saving rest, because the
  scrub layer deliberately skips step-edited elements (step preview wins) — without the
  re-apply the canvas sat at rest while the step stayed active, and the next drag
  started from the wrong pose. Overlay follows via `positionResizer` in commit,
  step enter/exit, and `scrubApply`.
- Follow-up (jump-back persisted in real browsers, jsdom-green): every handle `onUp`
  saved TWICE — once inside the commit, once right after — and the second save
  restored rest over the re-applied pose. Drops now go through `commitStepGeometries`
  (split `captureStepGeometry` + exactly one `persistSlide`, then re-show all edited
  steps). Same class of bug in initial-row field edits with an active preview: the
  sync saved the stale `stepEdit.rest` snapshot, so the row now refreshes `stepEdit.rest`
  after applying the fields.

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
- Fixed frame: viewBox stays `0 0 100 100` so size params change rendered size instead of
  rescaling content (the old tight viewBox re-fit the drawing and thinned strokes).
  The selection overlay hugs via `svgContentBox` (geometry bounds in local units) mapped
  through the live `getScreenCTM` (`mapBoxClient`), stroke-aware pad, falling back to the
  element box when no CTM exists (e.g. jsdom).
- Initial-step model: `initial:true` entries are rest mirrors. They are prepended on render
  (live DOM) and before every model sync, so old decks gain them without dirtying the
  template data block. Rest edits outside step-edit re-mirror via `syncInitialStep`;
  `commitStepGeometry` on a non-step drag does the same and drops the stale scrub
  snapshot. Scrubbed drags auto-enter the displayed non-initial step; initial rows are
  never auto-entered, and rest is restored on first real movement so a clean click never
  disturbs the scrubbed canvas. Presenter + viewer skip no-op stages per click, and the
  initial entry never fights a real move on the same element in one group.
- Step rows are kind-filtered: shapes show only their own geometry params (via
  `shapeSkeyFor`), plain blocks show scale instead; rotate everywhere. The initial shape
  row additionally owns Line width/Line color (presets follow: new shapes inherit the
  last-used stroke). The Shapes panel keeps kind select + insert only.
- Shape keyframe limits widened to the uncapped range (`slen/sw/sh` ≤ 500, `sr` ≤ 250).
- Viewer export player-size guard raised 12000 → 16000 chars (shape geo + keyframes are
  legit player code; the no-editor-code regex is the real guard).
