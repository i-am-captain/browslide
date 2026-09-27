# Browslide task list

# Round 2 (all requested together, work in listed order)

- [x] 8. Delete key removes selected shapes/textboxes.
- [x] 9. Multi-select: property changes (width/color/rotate/scale) apply to all selected items.
- [x] 10. Rotate handle + N/S edge scale handles on the selection box.
- [x] 11. Parametric shape geometry: arrows/line length (fixed head), square/triangle height, rectangle w+h, circle radius, ellipse w+h.
- [x] 12. Keyframe animation system: per-step positions, parallel groups, click/auto chaining with delay, easing modes (linear/accelerate/accel-decel), per-row step list UI, keyframes cover size/scale/rotation. (Replaces flat data-anim model; prerelease, no migration.) Done: rAF engine shared by presenter + export, data-anim JSON lists, start-hidden flag.
- [x] 13. Rotation always applied last in transforms (verified: already scale,scale,rotate effect order).
- [ ] 14. Text alignment buttons broken: stay all selected, text doesn't always move. FIX.
- [ ] 15. Text color selection in text settings (format bar).
- [ ] 16. Right toolbar cleanup/reorder:
  - layout + transition → new "Slide" menu
  - aspect ratio + theme → Presentation settings menu, renamed to "Presentation"
  - speaker notes at bottom, above GitHub button
  - +Textblock button into Slide menu
  - Media & sizes as last menu below Shapes; "sizes" → "Sizes"

Conventions: commit per task, full suite (`cd tests && npm test`) green before each commit. No question tool while user is AFK — decide, document below, continue.

# Decisions & open points (for later review)

- (empty — filled as work progresses)
