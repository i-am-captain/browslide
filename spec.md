# Browslide feature specs (ordered by build preference)

## Session state (update when switching tasks/sessions)

- Status: items 1-14 DONE and committed (573 checks). Next: item 15
  (canvas zoom/pan).
- Conventions: commit per item, suite green before each commit, flip that item's
  `[ ]` to `[x]` when committed.

Global constraints for every item: single `browslide.html`, zero dependencies,
`file://`-compatible (no modules/fetch/CDN), full suite (`cd tests && npm test`)
green before each commit, commit per item, agent-map anchors stay resolving
(tests enforce), slide HTML stays sanitizable.

## [x] 1. Undo/redo (build first: safety net for everything below)

- Goal: Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) plus toolbar buttons undo/redo any
  deck mutation: slides, text, geometry, steps, settings, tables, charts.
- UX: browser-native undo wins for field focus and non-collapsed text selections
  (don't hijack); a collapsed caret uses deck undo (typed bursts revert as one
  entry, so drag-then-undo always works); elsewhere Ctrl+Z undoes deck ops.
  Toolbar `↩`/`↪` buttons with disabled state.
- Model: snapshot stack of `{ json, active, n }` (`stable(App.model)` +
  `activeId` + slide count). Push in `refreshDirty` (the single shared sink, so
  slide-structural ops that bypass `persistSlide` are covered too) when json
  differs from top; coalesce when <2s since last push, same active slide, same
  slide count (typing/nudge bursts collapse) — but the saved state is never
  absorbed (save points stay reachable). Cap 30 entries AND ~12MB total (drop
  oldest, keep >=1). New edits clear redo. `loadModel` and boot reset stacks
  to `[initial]`.
- Implementation: snapshots come from the live (decoded) model, so restore is
  `normalizeModel(JSON.parse(json))` + clamp active + `clearSelection` +
  `renderAll` + `refreshDirty` (dirty-vs-saved falls out naturally) — no
  re-decode, no push during restore (guard flag). Buttons' disabled state
  updates in `refreshDirty`.
- Tests: mutate->undo reverts (slide add, text, move, step add), redo reapplies,
  undo-to-saved shows Saved flag, coalescing collapses rapid persists, caps
  trim, Ctrl+Z keeps native behavior in text caret, stacks reset on load.

## [x] 2. Nudge + Duplicate (tiny, daily value)

- Goal: arrows move selection ~1px (Shift = x10); Ctrl+D duplicates.
- UX: only when selection exists and caret is NOT in stage text (text keeps
  native arrows/delete). Prevent browser Ctrl+D bookmarking.
- Model: none (plain geometry edits).
- Implementation: step = `100/slideClientWidth` % (~1px, fallback 0.5%);
  route through `maybeAutoStepEdit` + move + `commitStepGeometries` so nudges
  land in the displayed step like drags (and share one undo entry via
  coalescing). Duplicate = `copySelection` + `pasteClipboard` (+5% offset).
- Tests: nudge math/fallback, caret guard keeps native keys, duplicate offsets
  and selects the copy, step-editing nudge writes the step.
- Findings: new `inFormField` helper folds inputs + filmstrip focus into the guard
  (arrow keys must stay native in row fields and not fight filmstrip nav).
  jsdom `clientWidth` stubs drop on every stage rebuild — tests re-stub after
  undo/redo. `caretInStageText` needs a real text-node anchor (starter HTML
  wraps text in styled spans).

## [x] 3. Align / distribute / match size

- Goal: Arrange menu (inspector): align L/C/R/T/M/B, distribute H/V, match W/H.
- UX: align works with 1 item (relative to slide) or many (relative to their
  union); distribute/match need >=2, else no-op with hint.
- Model: none.
- Implementation: pure layout fns over `% {left,top,width,height}` boxes plus a
  thin apply (set styles, `maybeAutoStepEdit` + `commitStepGeometries`).
  Slide-relative metrics come from `clientWidth/Height` (guard 0 in jsdom).
- Tests: pure-fn units (centering, equal gaps, width copy), apply writes %,
  single-item slide-relative align, no-op guards.
- Findings: "primary" for match = `resizer.el` (last-selected), documented in the
  Arrange hint and README. Arrange routes through the step machinery, so it
  obeys scrub context like drags. Distribute returns null on overlap instead of
  stacking. Test isolation rules that bit twice: scrub slider back to 1 before
  geometry assertions, `syncInitialStep` after live-only setup writes (else
  scrub re-applies stale initials), defeat coalescing + re-query after
  undo/redo.

## [x] 4. Snap guides while dragging

- Goal: dragged items snap to slide center/edges and other items' edges/centers
  with visible guide lines (~6px threshold).
- UX: guides are transient divs in `#stage-wrap`, cleared on drop/cancel.
- Model: none.
- Implementation: pure `snapDelta(movingPxBoxes, staticPxBoxes, slidePx)`
  returning adjusted dx/dy + guide segments; move path applies it before
  `moveItemsBy`. No-layout environments skip (slidePx 0).
- Tests: pure snap math (center/edge attraction, threshold miss, multi-box),
  guides render/clear around a drag.
- Findings: snap uses unrotated boxes (rotation ignored — documented limit, feels
  fine in practice). The no-layout guard doubles as the jsdom bypass, so all
  existing drag tests pass unchanged. Guides live in `#stage-wrap` (survive
  stage rebuilds), hence explicit clearing on drop + re-render.

## [x] 5. Eyedropper + recent colors

- Goal: pick any on-screen color; last-used palette near color inputs.
- UX: dropper buttons beside text-color (formatbar) and step-row stroke color
  (guard `window.EyeDropper`, hide button when absent). Recent swatches (max 8)
  apply on click.
- Model: `settings.recentColors` (normalize: array of `#rrggbb`, else `[]`);
  helper pushes (dedup, unshift, cap).
- Implementation: picked/applied colors flow through existing `applySpanStyle`
  / step-row commit paths so undo + presets keep working.
- Tests: normalize fallback, push dedup/cap, swatch apply writes span color.
- Findings: recent colors record in the UI handlers (not inside `applySpanStyle`,
  which is also a read-path callee), so picks record even with no selection.
  Step-row stroke commits re-push the current color (dedup keeps the list
  stable). `pickColor` never throws: null without API or on deny. Normalize
  dedups (saves from other copies could repeat).

## [x] 6. Style painter

- Goal: copy one item's look onto others (text style, alignment, stroke, sizes).
- UX: painter button toggles pick mode (Esc cancels): click source samples,
  next click(s) apply (Shift keeps mode for multi-apply), then mode exits.
- Model: none (ephemeral descriptor).
- Implementation: pure `sampleLook(el)` -> descriptor + `applyLook(el, desc)`
  reusing span-style/align/stroke/geometry writers; shape geometry only applies
  across same-kind shapes, rest skipped per-field.
- Tests: sample/apply units (text, shape, cross-kind geometry skip), mode
  enter/cancel/apply transitions.
- Findings: apply goes through `setSingleSelection` + `commitStepGeometries`,
  so painter edits are step/scrub/undo-consistent for free. `sampleLook`
  returns null when nothing is samplable (bare media) which disarms pick mode.
  Edit discipline that bit 3 times: anchor insertions on the END of the previous
  block, never on a bare next-function header (headers get eaten).

## [x] 7. Tables

- Goal: Insert -> Table (R x C dialog in Insert menu), native cell editing,
  add/remove row/col, survives save/export.
- UX: table lives in a `.blk` as `table.btable`; cells edit natively;
  Tab moves between cells natively.
- Model: none (plain slide HTML + CSS class).
- Implementation: add TABLE/TR/TD/TH/TBODY/THEAD to block-level handling so
  cell text gets styled spans and alignment/color work per cell; base table CSS
  (collapsed borders, padding, header row); row/col ops via selected-table
  buttons. Sanitizer already keeps plain table elements.
- Tests: insert shape, cell edit + format round-trip, save/export keeps table,
  row/col add/remove, sanitizer keeps tables while stripping handlers.
- Findings: TD/TH joined both `BLOCK_TAGS` (span-wrap recursion reaches cells)
  and `BLOCK_TAGS_ALIGN`, plus a dedup exemption — otherwise the `.blk` DIV
  swallows cells and align hits the whole block. New cells get styled spans via
  `tableTouch` (which also persists, so row/col ops are undoable). Rapid table
  ops coalesce in undo; tests force `lastPushAt = 0` for undo targets.

## [x] 8. Lists, bullets, shrink-to-fit

- Goal: Tab/Shift-Tab indent/outdent in lists, bullet-style picker,
  per-slide shrink-text-to-fit.
- UX: style picker (disc/circle/square/decimal) in formatbar applies to the
  current list; shrink toggle lives in the Slide menu (per-slide setting).
- Model: `slide.shrinkText` bool (normalize default false).
- Implementation: indent tries `execCommand('indent'/'outdent')`, falls back to
  stepped `padding-left`; shrink loop reduces block font on input until content
  fits (guarded, min 50%).
- Tests: picker writes `list-style-type`, indent fallback path, shrink flag
  round-trips and shrinks overflowing text in a stubbed layout.
- Findings: jsdom has no `execCommand`, so the suite pins the padding fallback;
  real browsers take the native path first. Shrink sizes are written into the
  model by the editor loop, so presenter + viewer need no measuring code.
  `selectOption` leaves stale values on exotic input — guarded with an explicit
  reset. CSS serializes `0.50em` to `0.5em` (test expectation, not app).

## [x] 9. Symbol shapes

- Goal: +12 insertable symbols (plus, minus, diamond, pentagon, hexagon,
  heart, right-triangle, smiley, note, bolt, arrow-curved?, block-arrow).
- UX: new entries in the existing shape select; fixed size like star/check.
- Model: none (new `SHAPE_DEFS` entries: `params: []`, geo fn).
- Implementation: follow the star/check pattern (fixed 100-frame coords,
  stroke-only, `shapeSizeKeys` returns `[]` automatically).
- Tests: library contains all kinds, markup inert, insert + save round-trip,
  no size handles for fixed symbols.
- Findings: all 12 drawn from primitive tags only (no `<path>`) so the
  geometry→screen overlay math keeps working — verified per-glyph by test.

## [x] 10. Copy/paste animation steps

- Goal: "Copy steps" / "Paste steps" buttons in the Animation panel.
- UX: copies selected item's full step list to an internal clipboard; pasting
  onto a target replaces its non-initial steps, preserving the target's own
  initial entry (rest never forks).
- Model: none (ephemeral clipboard var, like block clipboard).
- Implementation: paste = target initial + copied non-initial entries
  (renumbered untouched), then `persistSlide` + `rebuildScrub`.
- Tests: paste preserves target initial, copies steps verbatim, empty
  clipboard no-ops, scrub range accounts for pasted groups.
- Findings: paste forces a row rebuild (`animRowsFor = null`) since the row
  count changes shape; the paste button disables on empty clipboard (plus a
  handler guard, since disabled buttons still fire programmatic clicks).

## [x] 11. Filmstrip stage badges

- Goal: each filmstrip row shows its click/auto stage counts at a glance.
- UX: tiny badge (e.g. `3▸ 2●`) on rows that have animation; none otherwise.
- Model: none (derived).
- Implementation: pure `slideStageCounts(html)` parsing `data-anim` lists
  (initial entries excluded from click counts? No — counted like the player:
  a stage is click if ANY entry is click); render into row buttons on
  `renderFilmstrip`.
- Tests: count units (mixed triggers, no anim, malformed JSON), badges render
  and refresh after step add/delete.
- Findings: initial-only stages are excluded from counts (every item carries
  one — otherwise every slide would badge). Badges refresh in place on every
  persist (`refreshStageBadges`, no list rebuild) so filmstrip focus and scroll
  survive typing and drags.

## [x] 12. Motion paths

- Goal: a step can move its item along a drawn path, not just to one pose.
- UX: select a step -> "Draw path" -> drag the item; pointer trail is sampled
  (min 2% move, cap 50 points); Esc cancels; path shows as faint overlay while
  its row/step is active.
- Model: entry gains optional `path: [{x,y}...]` (% offsets from start;
  `cleanAnimEntry` sanitizes numbers/ranges/cap, drops empties).
- Implementation: `kfWrite`/`kfCurrent` interpolate position along the polyline
  by eased t (final point == `to.left/top`, so plain playback is unaffected);
  player string gains the same interpolation; scrub `applyKeyframeState` shows
  the end pose.
- Tests: polyline interpolation units (ends exact, midpoint sane), clean keeps/
  drops paths, playback with fake rAF follows path, viewer player carries it.
- Findings: the trail lives in `to.path` (the engine reads `to.*` uniformly) —
  an early draft wrote top-level `entry.path` and reparsing silently dropped
  it; the overlay test caught it. End-forcing in `cleanAnimEntry` keeps
  playback, scrub-end and overlay consistent by construction. The Draw button
  exists only on non-initial rows (motion on a rest-mirror is meaningless).
  Player string grew ~1.3k, still under the export size guard.

## [x] 13. Basic charts

- Goal: Insert -> Chart (bar/line/pie) from pasted CSV, editable later.
- UX: CSV textarea dialog; chart renders as SVG in a `.blk`; selecting it
  shows "Edit data" reopening the dialog.
- Model: `data-chart='{"type":..,"csv":..}'` attr on the svg (sanitizer keeps
  `data-*`); geometry re-rendered from data on load.
- Implementation: pure parse-CSV + render-bar/line/pie SVG fns; dialog writes
  attr + re-renders + persists.
- Tests: CSV parse (quotes/commas/bad rows), renderers emit sane SVG for fixed
  input, save round-trip preserves data attr, malformed CSV rejected with alert.
- Findings: pie is a donut of dasharray circles (not path arcs) so the overlay
  bbox math keeps working. The editor auto-loads the selection through
  `refreshSelectionUI` with a typing guard; a redundant Load button was added
  then removed. `data-chart` survives the sanitizer and both exports; stage
  render re-renders charts from data, normalizing older decks.

## [x] 14. Slide masters (custom layouts)

- Goal: save any slide's block arrangement as a named reusable template.
- UX: Templates menu in the Slide section: save current (name prompt), apply
  to current slide (keeps text? No — geometry + styles only, text reset to
  placeholders), delete.
- Model: `model.templates = { name: html }` (normalize: object or `{}`).
- Implementation: save stores current html; apply swaps html (initial steps
  regenerate via `ensureSlideInitials` on next sync), then `persistSlide`.
- Tests: save/apply/delete round-trip, apply regenerates initials, templates
  persist in save file, bad templates map dropped.
- Findings: text reset uses `closest('h1,h2'/'li')` because real text lives in
  styled spans (parent-tag checks miss). `data-anim` (incl. initials) survives
  templating, so masters carry motion too — initials stay valid since geometry
  is preserved. Serialized attrs use `&quot;`, which test regexes must match.

## [ ] 15. Canvas zoom/pan

- Goal: 50-200% canvas zoom (Ctrl+=/-/0 + control), pan via native scroll.
- UX: zoom is session-only (not saved); percentage readout near aspect controls.
- Model: none (`App.zoom`, default 1).
- Implementation: `fitStage` scales computed px by zoom; all drag deltas are
  divided by zoom before `%` conversion (screen px vs unscaled `clientWidth`);
  overlay math is rect-based, already zoom-safe.
- Tests: zoom factor plumbing (deltas scale, fit scales), zoom resets control,
  zoom never dirties the deck or persists.

## [ ] 16. Search & replace

- Goal: find/replace text across all slides with match count.
- UX: toolbar button opens a small dialog (find, replace, Replace-all button,
  live count); Enter jumps to next match (selects slide + caret).
- Model: none (operates on slide HTML strings).
- Implementation: pure `replaceInHtml(html, find, repl)` via per-slide DOM
  parse + text-node walk (case-sensitive plain match, whole deck in one undo
  entry); jump-to-match sets slide + text selection.
- Tests: replace units (multi-node, no-match, special chars literal), count
  accuracy, one undo entry reverts all, jump selects the slide.

## [ ] 17. Rehearse timer + per-slide timings

- Goal: record how long each slide takes; optionally auto-advance on time.
- UX: Present gets a timer readout; "Use timings" checkbox (Presentation menu)
  auto-advances after the recorded duration in show AND viewer export.
- Model: `slide.timing` seconds (normalize: finite >0 or null).
- Implementation: rehearse mode timestamps advances into `slide.timing`;
  `showPresent` arms a timer cleared by manual advance; player string gains the
  same arm/clear.
- Tests: timing resolution helper, arm/clear on advance, export carries
  timings + player auto-advances with fake timers, off-by-default.

## [ ] 18. Presenter view (second window)

- Goal: audience sees clean slides on screen 2; you see current + notes +
  next + timer.
- UX: "Present on second screen" opens the viewer doc in a new window plus a
  local console (notes/next/timer); console buttons drive the stage window.
- Model: none (reuses slides + notes).
- Implementation: build a presenter HTML string (slides + notes embedded,
  same player core + console pane); cross-window control via held window
  reference (same `file://` origin rules as `window.open` allow); graceful
  alert if popups blocked.
- Tests: builder emits notes/next/console and no editor code; console advance
  drives stage index (headless via function-level test); blocked-popup path.

## [ ] 19. Slide sorter overview

- Goal: grid overview of all slides for rearranging the big picture.
- UX: toggle button switches filmstrip to a scaled-clone grid; click jumps,
  existing drag-reorder keeps working, Esc/button exits.
- Model: none (view-only).
- Implementation: render scaled non-interactive clones (`pointer-events:none`,
  transform scale of slide px); reuse `moveSlideBefore` for drops; badges from
  item 11 show through.
- Tests: grid renders N clones with titles, click navigates, reorder moves
  model order, toggle restores list mode.
