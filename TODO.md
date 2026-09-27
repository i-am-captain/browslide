# Browslide task list

# Round 2 (all requested together, work in listed order)

- [x] 8. Delete key removes selected shapes/textboxes.
- [x] 9. Multi-select: property changes (width/color/rotate/scale) apply to all selected items.
- [x] 10. Rotate handle + N/S edge scale handles on the selection box.
- [x] 11. Parametric shape geometry: arrows/line length (fixed head), square/triangle height, rectangle w+h, circle radius, ellipse w+h. Done, uncapped.
- [x] 12. Keyframe animation system: per-step positions, parallel groups, click/auto chaining with delay, easing modes (linear/accelerate/accel-decel), per-row step list UI, keyframes cover size/scale/rotation. (Replaces flat data-anim model; prerelease, no migration.) Done: rAF engine shared by presenter + export, data-anim JSON lists, start-hidden flag.
- [x] 13. Rotation always applied last in transforms (verified: already scale,scale,rotate effect order).
- [x] 14. Text alignment buttons broken: stay all selected, text doesn't always move. Done: alignment via direct DOM text-align (no execCommand); reflection reads DOM. Plus caret-safe sync (static selection snapshots; jsdom Range objects track live DOM).
- [x] 15. Text color selection in text settings (format bar). Done: color input, span-wrap + pending + reflection via cssColorToHex.
- [x] 16. Right toolbar cleanup/reorder: Slide menu, Presentation menu, notes bottom, textblock in Slide, Media & Sizes last with capital S. Done.
- [x] 17. Keyframe scrub-editing: selecting a step previews its pose; geometry edits land in that step, rest pose preserved. Done.
- [ ] 18. Viewport auto-fit: when a dragged/selected element nears the slide border and handles would clip, scale the slide view down so all handles of the largest selection stay visible and clickable. Handles must never be unreachable.

Conventions: commit per task, full suite (`cd tests && npm test`) green before each commit. No question tool while user is AFK — decide, document below, continue.

# Decisions & open points (for later review)

- Old flat animation model (data-anim="fade-in" etc.) is inert, not migrated (prerelease, per instruction). Old saved decks with those attrs lose their animations on open; content unaffected.
- `execCommand` remains only for bold/italic/underline/strike, lists, block type and removeFormat (collapsed typing style + structural ops). Font/size/color/align are manual DOM ops, so `<font>` tags cannot be created by the toolbar.
- Copy/paste of blocks is internal-only (no system clipboard use): no permissions, no cross-window copy.
- Pending-format display can lag one step behind exotic edits (e.g. Shift-only keyup clears it); DOM refresh always converges on next input.
- Paste cleanup handles `<font>` tags; other pasted junk (scripts, handlers) is stripped at model sync, not live.
- jsdom Range objects track live DOM mutations (spec deviation found during testing) — app stores static node+offset snapshots instead. If jsdom ever fixes this, the snapshots keep working unchanged.
- Nothing currently open: the earlier cut-off message ("the tex alignment buttons do …") turned out to be the alignment topic, now resolved as item 14.
- Move drags follow the mouse in screen space even on rotated items (counter-rotated dragging felt wrong).
- Keyframe `to` targets with no parseable position fall back to derived/current values; empty-`to` entries are dropped at play time, not at save.
- A missing regex group in keyframe capture silently produced NaN targets (caught by tests before shipping) — position animation would have been a silent no-op. Lesson: numeric parsing helpers need direct unit tests, which they now have.
