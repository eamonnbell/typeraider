# TypeRaider TODO

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
