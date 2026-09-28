# Browslide

A PowerPoint-like presentation tool in **one standalone HTML file**: plain HTML + CSS + plain JavaScript. No build step, no dependencies, no server. Double-click `browslide.html` and it works in every modern browser, even offline.

## Quick start

1. Open `browslide.html` in a browser (double-click works — `file://` is fine).
2. Click the slide and type. The second slide is a built-in cheat sheet.
3. **Save** downloads an updated copy of the file (e.g. `my-talk.html`). Keep that copy — it is your deck.
4. Reopen the copy anytime by double-clicking it, or via **Open** (file picker or drag-drop onto the window).
5. **Present** starts the fullscreen show.

Repo file vs. saved copies: `browslide.html` in this repo is the maintained **template** (starter slides only). Saved copies are generated artifacts containing your deck — don't commit them, don't hand-edit their code sections.

## Workflow

| Button | What it does |
|---|---|
| + Slide / Duplicate / Delete | Add after current, copy current, remove current — or use + below the list and 🗑 on each row (delete asks first; a deck always keeps ≥ 1 slide) |
| ◀ ▶ | Previous / next slide |
| Present | Fullscreen show (`Space`/`→` next, `←` prev, `Home`/`End`, `Esc` exit, click advances). Presentation settings (inspector): toolbar on/off, aesthetic border vs maximum fullscreen. |
| Export viewer | Downloads a small standalone copy (`<title>-viewer.html`) for sharing: slides + player only, no editor code, no notes. Works from `file://` everywhere. |
| Format bar | Paragraph style (H1–H3), font (system fonts only), size and text color, bold/italic/underline/strikethrough, alignment, bullet/numbered lists with bullet styles (Tab indents list items), clear formatting. Applies to selected text — or set it first, then type. |
| Blocks | Slide content lives in freely positionable blocks: click once to select, drag anywhere except text to move (text behaves as text: click for caret, drag to select), click again to edit text. Ctrl/Cmd/shift-click multi-selects (move/resize/animate together). Images land in blocks too; add more with + Text block under Insert. Copy/paste blocks with Ctrl+C / Ctrl+V. |
| Nudge / Duplicate | Arrow keys move the selection ~1px (Shift ×10); Ctrl+D duplicates. Nudges land in the displayed animation step, like drags. |
| Tables | Insert menu adds table blocks (cells edit natively, per-cell formatting, row/column controls); survives save and viewer export. |
| Charts | Insert menu builds bar/line/pie charts from pasted CSV data; selecting a chart loads it back into the editor; saved in the deck and viewer exports. |
| Arrange | Inspector menu: align edges/centers (one item aligns to the slide), distribute evenly, match width/height to the last-selected item. Step-aware like drags. |
| Snap guides | Dragged items catch the slide center/edges and other items' edges, with guide lines. |
| Colors | Screen eyedropper (where supported) beside text and stroke colors, plus a last-used palette. |
| Style painter | 🎨 in the format bar copies one item's look (text, alignment, stroke, sizes, rotation) onto others; Shift multi-applies, Esc cancels. |
| Undo/redo | Every deck change is undoable (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y, or the ↩/↪ toolbar buttons): slides, text, geometry, steps, settings. Text selections keep the browser's native undo; everywhere else one shortcut reverts the last change. |
| Shapes | 26 insertable vector symbols (arrows, line, circle, ellipse, square, rectangle, triangle, star, check, cross, plus 12 more: plus/minus, diamond, pentagon, hexagon, heart, right-triangle, smiley, note, bolt, block-arrow, target) as movable blocks; the Shapes panel only picks the kind and inserts. Everything else lives in the Animation panel's initial-state row: line width (default 3), line color, rotation, and the shape's own sizes — arrows/lines by length, circles by radius, rects/ellipses by width+height. The overlay handles edit the same size values (corner = both, right edge = width, bottom edge = height), never scale. Fixed heads, no size caps; selection boxes hug the icon. |
| Animations | Every item starts with an undeletable initial-state step (auto, group 1) that mirrors its rest pose — its group is the stage where the item appears. Further keyframe steps (position, shape sizes, rotation, opacity; plain blocks also scale) in numbered groups play together per click, or chained automatically with delay. Easing: linear, accelerate, accel-decel. Set in the Animation panel on any selected block or image; each step row shows only the fields that apply to that item. Click a step to preview its pose, then drag/handles to edit that step. Steps can also carry a drawn motion path (﹏ button, drag the item). Copy/paste steps between items (the target keeps its own initial state). A bottom slider previews any animation stage of the whole slide at once (minimum is stage 1; items without that stage show their last earlier stage), with click/auto indication per stage. Plays in Present and viewer exports. |
| Open | Load another saved copy (picker or drag-drop) |
| New | Fresh starter deck (asks first if you have unsaved changes) |
| Save (or Ctrl+S) | Downloads the whole deck as one `.html` file. Note: browsers can't silently overwrite the file you opened, so each Save is a new download — replace the old file with it. |

Right panel, top to bottom: Slide menu (layout, transition, text block), Presentation (aspect ratio, theme, toolbar, fullscreen), Animation (initial state + keyframe steps), Insert, Shapes (kind picker + insert only), save-size estimate, Media & Sizes, speaker notes, GitHub link.

Left list: click to jump, **drag to reorder**, `PageUp`/`PageDown`/`Home`/`End` navigate when not editing text. Rows with animation show click/auto stage badges.

Unsaved work additionally autosaves to the browser (IndexedDB) — if you close without saving, reopening offers to resume.

## Media & file size

Insert → Image/Video embeds the file as base64 inside the deck (fully portable, but ~33% larger than the original). Click an image or video to select it and drag the corner handle to resize (width stored as % of the slide, so it scales). Identical files are stored **once** automatically (content-hash dedup — inserting the same picture twice costs nothing extra). Slides reference shared files, so the deck stays small.

The inspector's **Media & sizes** panel shows every embedded file (name, type, size, how many slides use it, ⚠ flags above ~8 MB) plus a per-slide breakdown, and offers **Remove unused media** cleanup. The size meter warns above ~5 MB and strongly above ~20 MB. Big videos trigger an explicit confirm explaining the cost — trim/compress them before inserting.

Two optional size savers (both plain browser APIs, zero dependencies, offline):

- **Compress media on save** (on by default, lossless): text-like formats (SVG, WAV, JSON, text) are deflated with the native `CompressionStream` before base64 and transparently decoded on load. JPEG/PNG/MP4 etc. are already compressed and stay raw; files that don't shrink stay raw too. Each compressible file has an auto/raw override button. Browsers without the API (older than ~2023) save raw and skip undecodable files. Exports always embed raw (viewers need directly renderable data).
- **Downscale photos on insert** (off by default): raster images over the chosen max dimension (1280/1920/2560 px) are resized via `<canvas>` before embedding. GIF/SVG are never touched; undecodable images fall back to the original.

## Project layout

```
browslide.html   # the app template — the only maintained file
index.html       # landing page for GitHub Pages
AGENTS.md      # agent instructions (read this first)
README.md     # this file
tests/        # dev-only behavioral tests (jsdom; not part of the app)
```

## Testing

Requires Node.js (dev-only; the app itself needs nothing):

```
cd tests && npm install && npm test
```

This runs both suites: `roundtrip.mjs` (jsdom: boot → edit/format → save → reopen → presenter → delete → reorder → keyboard → resources → viewer export → compression → layout/fit → toolbar toggle → filmstrip buttons → format reflection → span model → exec-free guarantee → blocks → shapes → animations → scrub slider → size handles → shape keyframes → initial steps → row filtering → review guards → undo/redo) and `codec.mjs` (real native `CompressionStream` round-trips plus a zlib cross-check proving byte-level deflate interop).

## Browser support

Editable app and saved decks: Chrome, Edge, Firefox, Safari (current versions), from `file://` or any static host. Plain DOM (incl. contenteditable editing), Canvas, Compression Streams, IndexedDB and Blob download — no network, no dependencies.

## Roadmap

Done: viewer-only export, native compression + photo downscale, responsive layout with aspect control, free-position blocks, shapes, per-element step animations (see above).
