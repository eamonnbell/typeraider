# TypeRaider

Raid letterforms from images. Type with found glyphs.

TypeRaider extracts individual character shapes from uploaded images using OCR,
builds a repertoire of glyph variants, and lets you compose new text from those
found letterforms — a kind of typographic ransom note generator, but for fun.

## How it works

1. **Upload an image** (or click "Try a random page" to pull from a digitised
   19th-century type specimen book via IIIF)
2. **Tesseract.js** runs OCR on the image, detecting individual characters with
   bounding boxes and confidence scores
3. Each detected character is **cropped and cleaned** — background removal via
   flood fill from edges, speckle removal, and connected-component analysis to
   strip ink from neighboring characters that bleeds into the crop
4. The cleaned glyphs populate a **filterable repertoire** — sliders let you
   filter by pixel area, OCR confidence, and ink density to keep only the
   good extractions
5. **Type in the editor** and each keystroke picks a random variant from the
   repertoire for that character, producing text with the visual texture of the
   source material
6. **Export** the result as a PNG

## Try it

TypeRaider is a static site — no build step, no dependencies beyond what's
loaded from CDNs. Open `index.html` in a browser, or visit the
[GitHub Pages deployment](https://eamonnbell.github.io/typeraider/).

## Technical details

- **OCR:** [Tesseract.js](https://github.com/naptha/tesseract.js) v5, running
  entirely in the browser via Web Workers
- **Glyph extraction pipeline:** Otsu's method for global threshold, flood-fill
  background removal seeded from border pixels, connected-component cleanup to
  isolate the target glyph from neighbor bleed
- **IIIF source:** Random pages from
  [*A Convenient Book of Alphabets*](https://archive.org/details/convenientbookof00allirich)
  via the IIIF Image API
- **No build tools:** Plain HTML, CSS, and ES modules — runs directly from the
  filesystem or any static host

## Development process

TypeRaider was built collaboratively with [Claude Code](https://claude.ai/claude-code)
(Anthropic's CLI coding agent, running Claude Opus 4.6). The project evolved
through an iterative cycle of planning, implementation, and visual testing:

- Early work focused on getting the basic OCR-to-glyph pipeline working, then
  progressively improving extraction quality — word-bbox constrained cropping
  to avoid neighbor bleed, connected-component analysis to discard stray ink,
  and interactive filter sliders so the user can curate the repertoire
- Several approaches were tried and abandoned along the way (IoU-based
  deduplication, aspect ratio filtering, peakiness scoring) when they didn't
  improve results in practice
- The AI handled implementation of the image processing algorithms, DOM
  manipulation, and CSS layout, while the human directed the design, evaluated
  visual output, and decided what to keep or revert

The `todo.md` file in this repo preserves the full trail of plans, completed
tasks, and dead ends.

## License

MIT
