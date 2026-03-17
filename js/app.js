/**
 * app.js — Main coordinator.
 *
 * Handles image upload, Tesseract OCR, background-removal fragment
 * extraction, and repertoire population.
 */

import { addGlyph, onChange, totalCount, totalCountUnfiltered, getAllKeys, getVariants, getRandomVariant, setFilters, getAreaRange, getConfidenceRange, getDensityRange, getAllValues, clear as clearRepertoire } from "./repertoire.js";
import { extractFragment, analysePageStats } from "./fragment.js";
import { initEditor, resetEditor } from "./type-editor.js";

// DOM refs
const fileInput = document.getElementById("file-input");
const uploadArea = document.getElementById("upload-area");
const previewCanvas = document.getElementById("preview-canvas");
const progressBar = document.getElementById("progress-bar");
const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");
const repertoireGrid = document.getElementById("repertoire-grid");
const glyphCountEl = document.getElementById("glyph-count");

let sourceImage = null;
let processing = false;

const MAX_PROCESS_DIM = 1024;
const MIN_CONFIDENCE = 80; // Tesseract confidence threshold (0–100)

// ── Progress helpers ──

function showProgress(text, pct) {
  progressBar.hidden = false;
  progressFill.style.width = Math.min(100, pct) + "%";
  progressText.textContent = text;
}

function hideProgress() {
  progressBar.hidden = true;
}

// ── Image scaling ──

function downscaleImage(img, maxDim) {
  let w = img.width;
  let h = img.height;
  let scale = 1;

  if (w > maxDim || h > maxDim) {
    scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, scale, width: w, height: h };
}

// ── Image upload ──

function handleFile(file) {
  if (!file || !file.type.startsWith("image/") || processing) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      uploadArea.querySelector(".upload-prompt").textContent = file.name;
      showPreview(img);
      processImage(img);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function showPreview(img) {
  previewCanvas.hidden = false;
  uploadArea.querySelector(".upload-prompt").hidden = true;
  const maxW = 900;
  const scale = Math.min(1, maxW / img.width);
  previewCanvas.width = Math.round(img.width * scale);
  previewCanvas.height = Math.round(img.height * scale);
  const ctx = previewCanvas.getContext("2d");
  ctx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
}

// ── IIIF random page ──

const MANIFEST_URL = "https://iiif.archive.org/iiif/convenientbookof00allirich/manifest.json";
const randomPageBtn = document.getElementById("random-page");

// Prefetch manifest on page load so the button feels instant
let manifestPromise = fetch(MANIFEST_URL).then((r) => r.json()).catch(() => null);

randomPageBtn.addEventListener("click", loadRandomPage);

async function loadRandomPage() {
  if (processing) return;

  try {
    let manifest = await manifestPromise;
    if (!manifest) {
      // Retry if prefetch failed
      showProgress("Fetching manifest…", 2);
      manifest = await fetch(MANIFEST_URL).then((r) => r.json());
      manifestPromise = Promise.resolve(manifest);
    }

    const canvases = manifest.items || [];
    if (canvases.length === 0) throw new Error("No canvases in manifest");

    const lo = Math.min(100, canvases.length - 1);
    const hi = Math.min(300, canvases.length - 1);
    const canvas = canvases[lo + Math.floor(Math.random() * (hi - lo + 1))];
    const body = canvas.items?.[0]?.items?.[0]?.body;
    const serviceId = body?.service?.[0]?.id;
    if (!serviceId) throw new Error("No image service found on canvas");

    const label = canvas.label?.none?.[0] || "";
    const imageUrl = `${serviceId}/full/pct:50/0/default.jpg`;
    showProgress("Loading page…", 10);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      sourceImage = img;
      uploadArea.querySelector(".upload-prompt").textContent = `Page ${label} — A Convenient Book of Alphabets`;
      showPreview(img);
      processImage(img);
    };
    img.onerror = () => {
      showProgress("Failed to load image", 100);
      setTimeout(hideProgress, 2000);
    };
    img.src = imageUrl;
  } catch (err) {
    console.warn("IIIF load failed:", err);
    showProgress("Failed to load manifest", 100);
    setTimeout(hideProgress, 2000);
  }
}

// ── Processing pipeline ──

async function processImage(img) {
  processing = true;
  showProgress("Running OCR…", 5);

  // 1. Downscale for processing
  const { canvas: procCanvas } = downscaleImage(img, MAX_PROCESS_DIM);

  // 2. Tesseract OCR
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") {
        showProgress(`OCR… ${Math.round(m.progress * 100)}%`, 5 + m.progress * 40);
      }
    },
  });

  const { data } = await worker.recognize(procCanvas);
  await worker.terminate();

  // 3. Walk hierarchy to collect symbols with word context
  const VPAD = 4; // vertical padding above/below word bbox
  const HPAD = 4; // horizontal padding for first/last char in word
  const entries = [];

  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {

        for (const word of line.words || []) {
          const syms = (word.symbols || []).filter((sym) => {
            if (!sym.text || !sym.text.match(/[A-Za-z0-9]/)) return false;
            if (sym.confidence < MIN_CONFIDENCE) return false;
            const bw = sym.bbox.x1 - sym.bbox.x0;
            const bh = sym.bbox.y1 - sym.bbox.y0;
            return bw >= 5 && bh >= 5;
          });

          // Compute average symbol height in this word for outlier rejection
          const wordSyms = word.symbols || [];
          const avgH = wordSyms.length > 0
            ? wordSyms.reduce((s, sym) => s + (sym.bbox.y1 - sym.bbox.y0), 0) / wordSyms.length
            : 0;

          for (let i = 0; i < syms.length; i++) {
            const sym = syms[i];
            const symH = sym.bbox.y1 - sym.bbox.y0;

            // Reject symbols whose height is >1.8x the word average (likely multi-line)
            if (avgH > 0 && symH > avgH * 1.8) continue;

            // Safe crop rect: vertical from word bbox, horizontal from neighbor midpoints
            const left = i > 0
              ? Math.round((syms[i - 1].bbox.x1 + sym.bbox.x0) / 2)
              : sym.bbox.x0 - HPAD;
            const right = i < syms.length - 1
              ? Math.round((sym.bbox.x1 + syms[i + 1].bbox.x0) / 2)
              : sym.bbox.x1 + HPAD;

            entries.push({
              text: sym.text,
              confidence: sym.confidence,
              cropBox: {
                x0: left,
                y0: word.bbox.y0 - VPAD,
                x1: right,
                y1: word.bbox.y1 + VPAD,
              },
              symBox: sym.bbox,
            });
          }
        }
      }
    }
  }

  // Filter out extreme aspect ratio detections (horizontal lines, ornaments)
  // using 3-sigma: reject anything outside mean ± 3 * stddev
  if (entries.length > 0) {
    const ratios = entries.map((e) => {
      const w = e.symBox.x1 - e.symBox.x0;
      const h = e.symBox.y1 - e.symBox.y0;
      return w / h;
    });
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const variance = ratios.reduce((a, r) => a + (r - mean) ** 2, 0) / ratios.length;
    const stddev = Math.sqrt(variance);
    const lo = mean - 3 * stddev;
    const hi = mean + 3 * stddev;

    const before = entries.length;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (ratios[i] < lo || ratios[i] > hi) entries.splice(i, 1);
    }
    if (entries.length < before) {
      console.log(`Aspect ratio filter: removed ${before - entries.length} outliers (3σ range: ${lo.toFixed(2)}–${hi.toFixed(2)})`);
    }
  }

  if (entries.length === 0) {
    showProgress("No characters found in image", 100);
    setTimeout(hideProgress, 2000);
    processing = false;
    return;
  }

  showProgress(`Extracting ${entries.length} characters…`, 50);

  // 4. Analyse global page ink/background statistics
  const pageStats = analysePageStats(procCanvas);

  // 5. Extract each character with background removal
  let processed = 0;
  const total = entries.length;

  for (const entry of entries) {
    try {
      const result = extractFragment(procCanvas, entry.cropBox, pageStats, 0, entry.text);
      if (result) {
        addGlyph(entry.text, result.dataUrl, entry.symBox, "upload", entry.confidence, result.density);
      }
    } catch (err) {
      console.warn(`Failed to extract "${entry.text}":`, err);
    }

    processed++;
    if (processed % 20 === 0) {
      const pct = 50 + (processed / total) * 45;
      showProgress(`Extracting… ${processed}/${total}`, pct);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  showProgress(`Done! ${totalCountUnfiltered()} glyphs extracted.`, 100);
  setTimeout(hideProgress, 2000);
  processing = false;

  // Initialize filter sliders with actual data ranges
  initFilters();
}

// ── Filter UI ──

const filtersEl = document.getElementById("repertoire-filters");
const areaMin = document.getElementById("filter-area-min");
const areaMax = document.getElementById("filter-area-max");
const confMin = document.getElementById("filter-confidence-min");
const confMax = document.getElementById("filter-confidence-max");
const densMin = document.getElementById("filter-density-min");
const densMax = document.getElementById("filter-density-max");
const areaValueEl = document.getElementById("area-value");
const confidenceValueEl = document.getElementById("confidence-value");
const densityValueEl = document.getElementById("density-value");

let filtersInitialized = false;

function clampDual(lo, hi) {
  if (Number(lo.value) > Number(hi.value)) lo.value = hi.value;
}

function updateFilterLabels() {
  areaValueEl.textContent = `${areaMin.value}–${areaMax.value}`;
  confidenceValueEl.textContent = `${confMin.value}–${confMax.value}`;
  densityValueEl.textContent = `${densMin.value}–${densMax.value}`;
}

function initFilters() {
  if (filtersInitialized) return;
  filtersInitialized = true;
  filtersEl.hidden = false;

  const areaRange = getAreaRange();
  const confRange = getConfidenceRange();

  areaMin.min = areaMax.min = Math.floor(areaRange.min);
  areaMin.max = areaMax.max = Math.ceil(areaRange.max);
  areaMin.value = areaMin.min;
  areaMax.value = areaMax.max;

  confMin.min = confMax.min = Math.floor(confRange.min);
  confMin.max = confMax.max = Math.ceil(confRange.max);
  confMin.value = confMin.min;
  confMax.value = confMax.max;

  densMin.min = densMax.min = 0;
  densMin.max = densMax.max = 100;
  densMin.value = 0;
  densMax.value = 100;

  updateFilterLabels();

  function onAreaChange() {
    clampDual(areaMin, areaMax);
    updateFilterLabels();
    setFilters({ minArea: Number(areaMin.value), maxArea: Number(areaMax.value) });
    updateHistograms();
  }
  function onConfChange() {
    clampDual(confMin, confMax);
    updateFilterLabels();
    setFilters({ minConfidence: Number(confMin.value), maxConfidence: Number(confMax.value) });
    updateHistograms();
  }
  function onDensChange() {
    clampDual(densMin, densMax);
    updateFilterLabels();
    setFilters({ minDensity: Number(densMin.value) / 100, maxDensity: Number(densMax.value) / 100 });
    updateHistograms();
  }

  areaMin.addEventListener("input", onAreaChange);
  areaMax.addEventListener("input", onAreaChange);
  confMin.addEventListener("input", onConfChange);
  confMax.addEventListener("input", onConfChange);
  densMin.addEventListener("input", onDensChange);
  densMax.addEventListener("input", onDensChange);

  updateHistograms();
}

// ── Histograms ──

const histArea = document.getElementById("hist-area");
const histConfidence = document.getElementById("hist-confidence");
const histDensity = document.getElementById("hist-density");

function drawHistogram(canvas, values, sliderMin, sliderMax) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (values.length === 0) return;

  const bins = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const counts = new Array(bins).fill(0);

  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / range * bins));
    counts[idx]++;
  }

  const maxCount = Math.max(...counts);
  if (maxCount === 0) return;

  const barW = w / bins;
  const sliderMinNorm = (sliderMin - min) / range;
  const sliderMaxNorm = (sliderMax - min) / range;

  for (let i = 0; i < bins; i++) {
    const barH = (counts[i] / maxCount) * h;
    const binNorm = i / bins;
    const active = binNorm >= sliderMinNorm && binNorm <= sliderMaxNorm;
    ctx.fillStyle = active ? "#c0392b" : "#ddd";
    ctx.fillRect(i * barW, h - barH, barW - 1, barH);
  }
}

function updateHistograms() {
  const areas = getAllValues("area");
  const confs = getAllValues("confidence");
  const densities = getAllValues("density").map(d => d * 100);

  drawHistogram(histArea, areas, Number(areaMin.value), Number(areaMax.value));
  drawHistogram(histConfidence, confs, Number(confMin.value), Number(confMax.value));
  drawHistogram(histDensity, densities, Number(densMin.value), Number(densMax.value));
}

// ── Repertoire UI ──

let uiUpdatePending = false;

function updateRepertoireUI() {
  if (uiUpdatePending) return;
  uiUpdatePending = true;
  requestAnimationFrame(() => {
    uiUpdatePending = false;
    const filtered = totalCount();
    const total = totalCountUnfiltered();
    glyphCountEl.textContent = filtered < total
      ? `(${filtered}/${total} glyphs)`
      : `(${total} glyphs)`;

    repertoireGrid.innerHTML = "";
    for (const key of getAllKeys()) {
      const variants = getVariants(key);
      for (const v of variants) {
        const cell = document.createElement("div");
        cell.className = "glyph-cell";

        const img = document.createElement("img");
        img.src = v.dataUrl;
        img.alt = key;
        img.loading = "lazy";
        cell.appendChild(img);

        const label = document.createElement("span");
        label.className = "glyph-label";
        label.textContent = key;
        cell.appendChild(label);

        repertoireGrid.appendChild(cell);
      }
    }
  });
}

// ── Drag & drop ──

uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});

uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("dragover");
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// ── Live title: spell "TypeRaider" from repertoire as glyphs stream in ──

const TITLE_WORD = "TYPERAIDER";
const TITLE_MIN_CONFIDENCE = 90;
const titleEl = document.querySelector("header h1");

// Build initial title with placeholder spans for each character
function initTitle() {
  titleEl.innerHTML = "";
  for (const ch of TITLE_WORD) {
    const span = document.createElement("span");
    span.className = "title-char";
    span.dataset.char = ch;
    span.textContent = ch;
    titleEl.appendChild(span);
  }
}

function updateTitle() {
  for (const el of titleEl.querySelectorAll(".title-char")) {
    const ch = el.dataset.char;
    const variants = getVariants(ch).filter(v => v.confidence >= TITLE_MIN_CONFIDENCE);
    if (variants.length === 0) continue;

    const variant = variants[Math.floor(Math.random() * variants.length)];

    if (el.tagName === "IMG") {
      // Already a glyph — swap to a new random variant if still processing
      if (processing) el.src = variant.dataUrl;
    } else {
      const img = document.createElement("img");
      img.className = "title-glyph title-char";
      img.dataset.char = ch;
      img.src = variant.dataUrl;
      img.alt = ch;
      el.replaceWith(img);
    }
  }
}

initTitle();

// ── Clear repertoire ──

document.getElementById("clear-repertoire").addEventListener("click", () => {
  clearRepertoire();
  initTitle();
  previewCanvas.hidden = true;
  const prompt = uploadArea.querySelector(".upload-prompt");
  prompt.textContent = "Drop an image here or click to upload";
  prompt.hidden = false;
  document.getElementById("editor-controls").hidden = true;
  resetEditor();
  const editorEl = document.getElementById("type-editor");
  const hiddenInput = document.getElementById("hidden-input");
  // Remove all children except the hidden textarea, then add placeholder
  while (editorEl.firstChild) {
    if (editorEl.firstChild === hiddenInput) break;
    editorEl.firstChild.remove();
  }
  const placeholder = document.createElement("span");
  placeholder.className = "placeholder";
  placeholder.textContent = "Upload an image to start raiding glyphs\u2026";
  editorEl.insertBefore(placeholder, editorEl.firstChild);
  filtersInitialized = false;
  document.getElementById("repertoire-filters").hidden = true;
});

// ── Share target pickup ──

async function checkSharedImage() {
  const params = new URL(location.href).searchParams;
  if (!params.has("shared")) return;

  try {
    const cache = await caches.open("typeraider-share");
    const base = new URL(".", location.href).pathname;
    const resp = await cache.match(base + "shared-image");
    if (resp) {
      const blob = await resp.blob();
      await cache.delete(base + "shared-image");
      history.replaceState(null, "", base);

      // Feed into image processing pipeline
      const img = new Image();
      img.onload = () => {
        sourceImage = img;
        uploadArea.querySelector(".upload-prompt").textContent = "Shared image";
        showPreview(img);
        processImage(img);
      };
      img.src = URL.createObjectURL(blob);
    }
  } catch (err) {
    console.warn("Share target pickup failed:", err);
  }
}

// ── Init ──

onChange(() => {
  updateRepertoireUI();
  updateTitle();
  if (filtersInitialized) updateHistograms();
});
initEditor();
checkSharedImage();
