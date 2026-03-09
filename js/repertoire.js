/**
 * repertoire.js — Glyph storage with filtering.
 *
 * Each entry: { dataUrl, bbox, source, confidence, area, density }
 */

/** @type {Map<string, Array>} */
const glyphs = new Map();

/** Event target for change notifications */
const events = new EventTarget();

/** Filter state */
let minArea = 0;
let maxArea = Infinity;
let minConfidence = 0;
let maxConfidence = Infinity;
let minDensity = 0;
let maxDensity = Infinity;

function passesFilter(v) {
  if (v.area < minArea || v.area > maxArea) return false;
  if (v.confidence < minConfidence || v.confidence > maxConfidence) return false;
  if (v.density < minDensity || v.density > maxDensity) return false;
  return true;
}

export function setFilters(f = {}) {
  let changed = false;
  if (f.minArea !== undefined && f.minArea !== minArea) { minArea = f.minArea; changed = true; }
  if (f.maxArea !== undefined && f.maxArea !== maxArea) { maxArea = f.maxArea; changed = true; }
  if (f.minConfidence !== undefined && f.minConfidence !== minConfidence) { minConfidence = f.minConfidence; changed = true; }
  if (f.maxConfidence !== undefined && f.maxConfidence !== maxConfidence) { maxConfidence = f.maxConfidence; changed = true; }
  if (f.minDensity !== undefined && f.minDensity !== minDensity) { minDensity = f.minDensity; changed = true; }
  if (f.maxDensity !== undefined && f.maxDensity !== maxDensity) { maxDensity = f.maxDensity; changed = true; }
  if (changed) events.dispatchEvent(new CustomEvent("change"));
}

export function getFilters() {
  return { minArea, maxArea, minConfidence, maxConfidence, minDensity, maxDensity };
}

export function addGlyph(char, dataUrl, bbox, source = "", confidence = 0, density = 0) {
  const key = char.toUpperCase();
  if (!key.match(/[A-Z0-9]/)) return;
  if (!glyphs.has(key)) glyphs.set(key, []);
  const area = (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0);
  glyphs.get(key).push({ dataUrl, bbox, source, confidence, area, density });
  events.dispatchEvent(new CustomEvent("change", { detail: { key } }));
}

export function getVariants(char) {
  return (glyphs.get(char.toUpperCase()) || []).filter(passesFilter);
}

export function getRandomVariant(char) {
  const variants = getVariants(char);
  if (variants.length === 0) return null;
  return variants[Math.floor(Math.random() * variants.length)];
}

export function hasGlyph(char) {
  return getVariants(char).length > 0;
}

export function getAllKeys() {
  return [...glyphs.keys()].filter(k => getVariants(k).length > 0).sort();
}

export function totalCount() {
  let n = 0;
  for (const key of glyphs.keys()) n += getVariants(key).length;
  return n;
}

export function totalCountUnfiltered() {
  let n = 0;
  for (const arr of glyphs.values()) n += arr.length;
  return n;
}

export function getAreaRange() {
  let min = Infinity, max = 0;
  for (const arr of glyphs.values()) {
    for (const v of arr) {
      if (v.area < min) min = v.area;
      if (v.area > max) max = v.area;
    }
  }
  return min === Infinity ? { min: 0, max: 0 } : { min, max };
}

export function getConfidenceRange() {
  let min = Infinity, max = 0;
  for (const arr of glyphs.values()) {
    for (const v of arr) {
      if (v.confidence < min) min = v.confidence;
      if (v.confidence > max) max = v.confidence;
    }
  }
  return min === Infinity ? { min: 0, max: 0 } : { min, max };
}

export function getDensityRange() {
  let min = Infinity, max = 0;
  for (const arr of glyphs.values()) {
    for (const v of arr) {
      if (v.density < min) min = v.density;
      if (v.density > max) max = v.density;
    }
  }
  return min === Infinity ? { min: 0, max: 0 } : { min, max };
}

/** Return all raw values for a given field (unfiltered). */
export function getAllValues(field) {
  const vals = [];
  for (const arr of glyphs.values()) {
    for (const v of arr) {
      if (v[field] !== undefined) vals.push(v[field]);
    }
  }
  return vals;
}

export function onChange(fn) {
  events.addEventListener("change", fn);
}

export function clear() {
  glyphs.clear();
  events.dispatchEvent(new CustomEvent("change"));
}
