# Browslide task list (user order, work through one by one)

- [x] 1. Agent-map anchors human-readable (full banner per line). Done in `e610244`.
- [x] 2. Media resizing/scaling: drag handle preferred, else percentage field. Done: corner drag handle storing width as % of slide width.
- [x] 3. Free positioning for text and media blocks (drag & drop); default slides and layouts use these blocks. Done: `.blk` divs with % coords, grip to move, layouts/skeletons emit blocks (old flow content still renders).
- [x] 4. Insertable arrow and symbol graphics for slides. Done: 12 inline SVGs (currentColor) in movable blocks.
- [x] 5. Animations: fade in, fade out, move, rotate for text, graphics and media files. Done: data-anim/step/dir attrs, Animation panel on selection, click-advance steps in presenter + viewer export.
- [x] 6. Help slide: fix arrow-key text (PageUp/PageDown is what works). Done.
- [x] 7. Full code review: remove obsolete/dead code, unused methods/variables, legacy comments, old-format support (prerelease, no backwards compat needed); shorten where sensible without behavior change; review and clean up tests. Done: removed dead `appendMedia`/`convertFontTags`/unused var/`(Phase 5)` tags/`.cols` rule, factored `selectOption`, fixed docs (README roadmap/panel lists, AGENTS line count), fixed stale test headers. No dead functions/variables remain; all CSS selectors and element ids resolve.

Conventions: commit per task, full suite (`cd tests && npm test`) green before each commit.
