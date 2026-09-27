# AGENTS.md

Browslide is a single-file presentation app: `browslide.html` (HTML + CSS + plain JS, zero dependencies, works from `file://`). The repo copy is the template (starter deck only); user decks are saved copies of the same file with a filled JSON data block.

## Context budget (binding)

- `browslide.html` is ~2200 lines. NEVER read it whole into a small context.
- Read only the first 500 lines (agent map + styles + markup + deck data block + start of the JS), then locate areas by anchor:
  `grep -nF 'ANCHOR' browslide.html` returns two hits — the map line itself, then the target. Use the later match, and read only that range.
- The authoritative section map lives in the comment at the top of `browslide.html`. It uses anchors, never line numbers — do not add line numbers back.

## When modifying `browslide.html`

- If you rename or remove a banner anchor, update the map. (`tests/roundtrip.mjs` asserts every anchor still resolves — keep it green.)
- Slide HTML is sanitized (no scripts/iframes, no `on*`, no `javascript:`/`blob:` URLs) — respect it.
- Media: single copy in `model.resources` (data: URIs), `res://rN` refs in slide HTML. Never inline duplicates.
- Run `cd tests && npm install && npm test` (needs Node.js). All checks must pass before commit.
- Keep the app dependency-free and `file://`-compatible: no modules, no fetch, no CDN.
