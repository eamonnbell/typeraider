# TypeRaider TODO

## Spec: PWA + Mobile Input Fix + Share Target

### Problem Statement

1. **Mobile keyboard input broken**: The type editor uses `keydown` events with
   `e.preventDefault()`. Android virtual keyboards (confirmed: DuckDuckGo browser)
   often fire `keydown` with `e.key === "Unidentified"` or skip `keydown` entirely,
   using `beforeinput`/`input` and composition events instead. The guard at
   `type-editor.js:81` (`e.key.length !== 1`) silently drops these events.
   Fruity Lorem works because it bypasses the keyboard path entirely.

2. **No PWA support**: No manifest, no service worker, no offline capability,
   no install prompt. The app is purely static and a good PWA candidate.
   (Tesseract already runs in a Web Worker via its built-in architecture — no
   change needed there.)

3. **No share target**: On mobile, users can't share images directly into the app
   from camera, gallery, or scanning apps. This is the most natural mobile workflow
   for "raiding" letterforms from real-world signage and documents. High priority.

### A. Fix Mobile Keyboard Input

**Approach**: Replace `contenteditable` + `keydown` with a hidden `<textarea>`
that captures input via the `beforeinput` event — unified for both mobile and
desktop. No dual code paths.

**Why a hidden textarea?** This is the standard pattern used by VS Code, Monaco,
CodeMirror, ProseMirror, and most custom web editors. The browser's virtual
keyboard needs a focusable text element to attach to — there's no "open keyboard"
API. `contenteditable` is the alternative but brings DOM mutations we don't
control. Since we render images not text, hidden input is cleaner.

**Design**:
- Add a `<textarea id="hidden-input">` styled to be invisible but focusable
  (opacity: 0, position: absolute, within the editor area — NOT `display:none`)
- Tapping the editor area focuses the hidden textarea, opening the virtual keyboard
- Listen for `beforeinput` events on the textarea. The `inputType` field tells us
  what happened:
  - `insertText` with `data`: character typed — render glyph
  - `deleteContentBackward`: backspace — remove last element
  - `insertLineBreak` / `insertParagraph`: enter — add newline
- After processing each event, clear the textarea value so it stays fresh
- Remove the old `keydown` handler entirely — `beforeinput` works on desktop too
- Show a blinking cursor / focus indicator on the editor div when the hidden
  textarea has focus

**Scope**: `type-editor.js` only. No changes to repertoire, fragment extraction,
or app.js.

### B. PWA Manifest + Service Worker

**Manifest** (`manifest.json`):
- `name`: "TypeRaider"
- `short_name`: "TypeRaider"
- `start_url`: "/"
- `display`: "standalone"
- `background_color`: "#f5f0e8"
- `theme_color`: "#c0392b"
- `icons`: simple lowercase "t" in theme colors, SVG-based, rendered to PNG sizes
- `share_target`: see section C

**Service Worker** (`sw.js`):
- **Strategy**: Cache-first for app shell (HTML, CSS, JS), network-first for
  external resources (Tesseract worker, IIIF images, Google Fonts)
- **Precache**: `index.html`, `css/style.css`, `js/app.js`, `js/repertoire.js`,
  `js/type-editor.js`, `js/fragment.js`
- **Runtime cache**: Tesseract.js CDN assets (core, worker, language data) —
  cached on first use (not install — ~15MB is too aggressive upfront, revisit later)
- **IIIF images**: Network-only (random, no point caching)
- **Update strategy**: On activate, delete old caches. Stale-while-revalidate
  for the app shell.
- **No workbox** — hand-written, keeping with the no-build-tools philosophy

**Registration**: Add `<script>` block at bottom of `index.html` to register SW.

### C. Web Share Target API

**Goal**: Appear in Android's "Share" sheet so users can share images directly
from Camera, Google Photos, Files, scanning apps (e.g. Adobe Scan), etc. into
TypeRaider. This is purely additive — the existing upload/drop zone and IIIF
random page remain fully functional.

**Manifest entry**:
```json
"share_target": {
  "action": "/",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "files": [{
      "name": "image",
      "accept": ["image/png", "image/jpeg", "image/webp", "image/gif"]
    }]
  }
}
```

**How it works**:
- When a user shares an image to TypeRaider, the browser POSTs multipart form
  data to `action` URL ("/")
- The service worker intercepts this POST in its `fetch` handler
- SW extracts the file from the FormData, stashes it in a temporary cache
- SW responds with a redirect to `/?shared=1` (303)
- On page load, `app.js` checks for `?shared` param and picks up the image
  from the cache, feeding it into the existing processing pipeline
- Cleans up the cache entry and strips the query param from the URL

**Future (low priority)**: accept `text/plain` shares (image URLs) to enable
sharing from web browsers directly.

### D. Icons

- SVG icon: lowercase "t" in Source Serif 4, `#c0392b` on `#f5f0e8` background
- Export as `icons/icon-192.png` and `icons/icon-512.png`
- Also include the SVG directly in the manifest for browsers that support it

### E. Implementation Status

1. [x] **Mobile input fix** (section A) — hidden textarea + `beforeinput`, unified
2. [x] **Icons** (section D) — SVG "t" in theme colors + 192/512 PNGs
3. [x] **Manifest + service worker** (section B) — precache shell, runtime cache Tesseract/fonts
4. [x] **Share target** (section C) — SW intercepts POST, app.js picks up from cache

### F. Resolved Questions

- **Input handling**: Unified `beforeinput` for both mobile and desktop
- **Tesseract caching**: After first use, not on install (~15MB too aggressive)
- **text/plain shares**: Maybe later, low priority
- **Icons**: Quick SVG "t" in theme colors, don't block on design

---

## Current Tasks

### 1. Preview image inside the upload area
- [x] Move preview canvas inside the `#upload-area` label
- [x] Hide upload prompt text when preview is showing
- [x] Both file upload and IIIF random page show preview in the dotted stage

### 2. Side-by-side repertoire and editor
- [x] Wrap repertoire-section and editor-section in a flex row container
- [x] Each takes ~50% width, stacking on narrow screens

### 3. Fruity lorem ipsum button
- [x] Add a button to editor controls that types out fruity lorem ipsum
- [x] Use the existing type-editor keystroke logic to render glyphs

## Plan: Export font file (OTF) from repertoire

### Approach
Take the best glyph variant per character from the filtered repertoire, trace each
raster image to vector outlines using Potrace, assemble into an OTF font using
opentype.js, and offer for download.

### Pipeline
1. **Pick variants** — for each character in the repertoire, select the highest-confidence
   variant that passes current filters (or let the user pick)
2. **Threshold to 1-bit** — convert the glyph PNG alpha channel to a binary mask
3. **Trace to vectors** — run Potrace (JS port) on the bitmap to get bezier path contours
4. **Build font** — use opentype.js to create an OTF with a glyph per character:
   - Map contours to opentype Path commands (moveTo/lineTo/curveTo)
   - Set advance width from glyph aspect ratio, scaled to a 1000-unit UPM
   - Set ascender/descender from bbox data
   - Map to Unicode codepoints (A-Z, 0-9, plus lowercase as copies)
5. **Download** — serialize to ArrayBuffer, wrap in Blob, trigger download as .otf

### Tasks
- [ ] Add opentype.js and a Potrace JS library (CDN or vendor)
- [ ] Write `font-export.js`: given the filtered repertoire, pick best variant per char
- [ ] Implement bitmap→1-bit threshold (from glyph PNG alpha channel to a W×H bit array)
- [ ] Implement Potrace tracing → convert output paths to opentype.js Path commands
- [ ] Set font metrics: UPM 1000, ascender/descender from glyph data, advance widths
      from aspect ratios, map A-Z + 0-9 to codepoints (duplicate to lowercase)
- [ ] Add "Download Font" button to editor controls, wire up the pipeline
- [ ] Add a .notdef glyph (required by spec — simple empty rectangle)

## Open Issues — Glyph Extraction Quality

### 1. Fuzzy edges / spurious colors from flood fill
- The flood fill bg removal leaves soft fringes and color artifacts at glyph edges
- Root cause: the tolerance + soft alpha ramp is a blunt instrument — pixels near the threshold get partial alpha with their original (bg-tinted) color rather than being cleanly separated

### 2. Multi-line crop misses
- Tesseract sometimes returns bboxes that span two lines, producing garbage crops with fragments of characters from adjacent lines
- This is an OCR bbox quality issue — we're trusting Tesseract's symbol-level bboxes uncritically

### 3. Neighboring characters bleeding into glyph cells
- The biggest issue. Tesseract bboxes are tight to the detected character but adjacent characters sit right at the edge, especially for thin glyphs (l, i, t, 1) where the bbox is narrow and neighbors are close
- The padding (currently 4px) makes it worse — it's there to avoid clipping the target glyph but pulls in neighbors
- The flood fill can't remove neighbors because they're ink-colored, not bg-colored

## Baseline alignment plan

**What we have:** Each glyph in the repertoire stores `baseline` — the y-coordinate
of the text baseline at that glyph's position in the source image (interpolated from
Tesseract's line baseline). We also have `bbox` with y0/y1.

**The idea:** When baseline mode is on, position each glyph image so that its baseline
sits on a common line within each editor row. Without it, glyphs just sit flush at the
bottom of the flex container (current behavior).

**How baseline offset works:**
- For each glyph, `baselineDrop = bbox.y1 - baseline` = how far the bottom of the
  bbox extends below the baseline (descenders on g, p, y etc. will have a larger value)
- In the editor, each glyph img gets `margin-bottom` proportional to its baselineDrop
  relative to the line. Glyphs with descenders get pushed up; glyphs without get
  pushed down — aligning their baselines.
- Concretely: compute baselineDrop as a fraction of bbox height, then convert to
  editor units (the img is 2em tall). Set `margin-bottom: -Xem` or use
  `vertical-align` / `transform: translateY()` to shift.

**Implementation:**
1. Add a "Snap to baseline" checkbox to editor controls
2. When toggled on, for each glyph-img already in the editor AND for new keystrokes,
   read the variant's baseline data and apply a `translateY` offset
3. When toggled off, remove the offsets
4. Store the baseline data on each img element as a data attribute when it's created
5. Export function needs to account for the offset too

**What this does NOT touch:** repertoire grid tiles — those stay as-is.

## Reverted / didn't help
- IoU-based dedup of overlapping symbol detections — didn't appreciably help
- Tighter horizontal clamping (symbol bbox + 1px instead of midpoint) — didn't help either
- The neighbor bleed problem persists; need a different approach (likely connected component isolation post-crop)
- Aspect ratio slider — not useful in practice
- Peakiness filter (sym.choices gap) — broken units, removed

## Completed
- [x] Delete COLLAGE-DETAILS.md (no longer relevant)
- [x] Switch color scheme from dark blue to off-white throughout
- [x] Word-bbox constrained extraction
- [x] Repertoire filter sliders (area, confidence, density)
- [x] CC-based neighbor cleanup
- [x] Density filter
- [x] Typography (Source Serif 4) + live title easter egg
- [x] IIIF random page source
