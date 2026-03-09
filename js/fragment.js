/**
 * fragment.js — Extract glyph crops with intelligent background removal.
 *
 * Strategy:
 * 1. Otsu's method on the full page → global bg/fg colors + threshold
 * 2. Per crop: blend local edge bg with global bg for reference color
 * 3. Flood fill from all border pixels — anything reachable and close
 *    to bg color is marked transparent (preserves counters in O, B, etc.)
 * 4. Remove small orphan speckles (connected components below a size)
 * 5. Smooth alpha on the boundary for anti-aliased edges
 */

// Reusable canvases
let _workCanvas, _workCtx;
let _outCanvas, _outCtx;

function getWork(w, h) {
  if (!_workCanvas) {
    _workCanvas = document.createElement("canvas");
    _workCtx = _workCanvas.getContext("2d");
  }
  _workCanvas.width = w;
  _workCanvas.height = h;
  return _workCtx;
}

function getOut(w, h) {
  if (!_outCanvas) {
    _outCanvas = document.createElement("canvas");
    _outCtx = _outCanvas.getContext("2d");
  }
  _outCanvas.width = w;
  _outCanvas.height = h;
  return { canvas: _outCanvas, ctx: _outCtx };
}

/**
 * Analyse the full page image to get global ink/background statistics.
 * Call once per uploaded image, pass result into extractFragment.
 */
export function analysePageStats(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const sampleMax = 512;
  let sw = w, sh = h;
  if (w > sampleMax || h > sampleMax) {
    const s = sampleMax / Math.max(w, h);
    sw = Math.round(w * s);
    sh = Math.round(h * s);
  }

  const ctx = getWork(sw, sh);
  ctx.drawImage(sourceCanvas, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  const n = sw * sh;

  // Luminance histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    hist[Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2])]++;
  }

  // Otsu's method
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumBg = 0, wBg = 0, bestVar = 0, bestT = 128;
  for (let t = 0; t < 256; t++) {
    wBg += hist[t];
    if (wBg === 0) continue;
    const wFg = n - wBg;
    if (wFg === 0) break;
    sumBg += t * hist[t];
    const meanBg = sumBg / wBg;
    const meanFg = (sumAll - sumBg) / wFg;
    const v = wBg * wFg * (meanBg - meanFg) ** 2;
    if (v > bestVar) { bestVar = v; bestT = t; }
  }

  // Mean colors per class
  let bgR = 0, bgG = 0, bgB = 0, bgN = 0;
  let fgR = 0, fgG = 0, fgB = 0, fgN = 0;
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    if (lum > bestT) {
      bgR += data[idx]; bgG += data[idx + 1]; bgB += data[idx + 2]; bgN++;
    } else {
      fgR += data[idx]; fgG += data[idx + 1]; fgB += data[idx + 2]; fgN++;
    }
  }
  if (bgN === 0) bgN = 1;
  if (fgN === 0) fgN = 1;

  return {
    bgR: bgR / bgN, bgG: bgG / bgN, bgB: bgB / bgN,
    fgR: fgR / fgN, fgG: fgG / fgN, fgB: fgB / fgN,
    threshold: bestT,
  };
}

/**
 * Extract a glyph with transparent background using flood-fill from edges.
 */
// Characters expected to have 2 connected components (tittle, dot, etc.)
const EXPECT_2_CC = new Set(["I", "J"]);

export function extractFragment(sourceImage, bbox, pageStats, padding = 4, char = null) {
  const imgW = sourceImage.width;
  const imgH = sourceImage.height;

  const x0 = Math.max(0, bbox.x0 - padding);
  const y0 = Math.max(0, bbox.y0 - padding);
  const x1 = Math.min(imgW, bbox.x1 + padding);
  const y1 = Math.min(imgH, bbox.y1 + padding);
  const W = x1 - x0;
  const H = y1 - y0;

  if (W <= 0 || H <= 0) return null;

  // 1. Crop
  const ctx = getWork(W, H);
  ctx.drawImage(sourceImage, x0, y0, W, H, 0, 0, W, H);
  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;
  const total = W * H;

  // 2. Local bg from edge pixels
  let lR = 0, lG = 0, lB = 0, lN = 0;
  for (let x = 0; x < W; x++) {
    let i = x * 4;
    lR += d[i]; lG += d[i + 1]; lB += d[i + 2]; lN++;
    i = ((H - 1) * W + x) * 4;
    lR += d[i]; lG += d[i + 1]; lB += d[i + 2]; lN++;
  }
  for (let y = 1; y < H - 1; y++) {
    let i = (y * W) * 4;
    lR += d[i]; lG += d[i + 1]; lB += d[i + 2]; lN++;
    i = (y * W + W - 1) * 4;
    lR += d[i]; lG += d[i + 1]; lB += d[i + 2]; lN++;
  }
  lR /= lN; lG /= lN; lB /= lN;

  // 3. Blended reference bg (70% local, 30% global)
  const refR = lR * 0.7 + pageStats.bgR * 0.3;
  const refG = lG * 0.7 + pageStats.bgG * 0.3;
  const refB = lB * 0.7 + pageStats.bgB * 0.3;

  // Adaptive tolerance from global bg↔fg distance
  const bgFgDist = Math.sqrt(
    (pageStats.bgR - pageStats.fgR) ** 2 +
    (pageStats.bgG - pageStats.fgG) ** 2 +
    (pageStats.bgB - pageStats.fgB) ** 2
  );
  const tolerance = bgFgDist * 0.35;

  // 4. Flood fill from border pixels
  //    Mark pixels as bg (0) or undecided (1)
  //    Flood can spread to any neighbour within tolerance of the ref bg color
  const mask = new Uint8Array(total); // 0 = bg, 1 = fg (default fg)
  mask.fill(1);

  const stack = [];

  // Seed all border pixels that are close enough to bg
  for (let x = 0; x < W; x++) {
    seedIfBg(x, 0);
    seedIfBg(x, H - 1);
  }
  for (let y = 1; y < H - 1; y++) {
    seedIfBg(0, y);
    seedIfBg(W - 1, y);
  }

  function seedIfBg(x, y) {
    const idx = (y * W + x) * 4;
    const dist = colorDist(d[idx], d[idx + 1], d[idx + 2], refR, refG, refB);
    if (dist < tolerance) {
      const pos = y * W + x;
      if (mask[pos] === 1) {
        mask[pos] = 0;
        stack.push(pos);
      }
    }
  }

  // Flood fill (4-connected)
  while (stack.length > 0) {
    const pos = stack.pop();
    const px = pos % W;
    const py = (pos - px) / W;

    const neighbors = [];
    if (px > 0) neighbors.push(pos - 1);
    if (px < W - 1) neighbors.push(pos + 1);
    if (py > 0) neighbors.push(pos - W);
    if (py < H - 1) neighbors.push(pos + W);

    for (const npos of neighbors) {
      if (mask[npos] !== 1) continue;
      const idx = npos * 4;
      const dist = colorDist(d[idx], d[idx + 1], d[idx + 2], refR, refG, refB);
      if (dist < tolerance) {
        mask[npos] = 0;
        stack.push(npos);
      }
    }
  }

  // 5. Remove small foreground speckles (connected components < minSize)
  const minSpeckle = Math.max(4, Math.round(total * 0.005));
  removeSmallComponents(mask, W, H, minSpeckle);

  // 5b. CC-based neighbor cleanup: if there are more connected components
  //     than expected for this character, keep only the N largest.
  if (char) {
    const expectedCCs = EXPECT_2_CC.has(char.toUpperCase()) ? 2 : 1;
    keepLargestComponents(mask, W, H, expectedCCs);
  }

  // 6. Apply alpha with soft edges
  //    For fg pixels near the bg boundary, ramp alpha based on
  //    color distance to give anti-aliased edges
  const softRange = bgFgDist * 0.2;

  for (let i = 0; i < total; i++) {
    if (mask[i] === 0) {
      d[i * 4 + 3] = 0; // bg → transparent
    } else {
      // Soft edge: if this fg pixel is close to bg color, partial alpha
      const idx = i * 4;
      const dist = colorDist(d[idx], d[idx + 1], d[idx + 2], refR, refG, refB);
      if (dist < tolerance + softRange) {
        // Ramp from 0 at tolerance to 255 at tolerance+softRange
        const t = (dist - tolerance) / softRange;
        d[idx + 3] = Math.round(255 * Math.max(0, Math.min(1, t)));
      }
      // else: fully opaque (default 255)
    }
  }

  // 7. Compute density (fraction of pixels with alpha > 0)
  let opaqueCount = 0;
  for (let i = 0; i < total; i++) {
    if (d[i * 4 + 3] > 0) opaqueCount++;
  }
  const density = total > 0 ? opaqueCount / total : 0;

  // 8. Export
  const { canvas: out, ctx: outCtx } = getOut(W, H);
  outCtx.putImageData(imgData, 0, 0);
  return { dataUrl: out.toDataURL("image/png"), density };
}

// ── Helpers ──

function colorDist(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Find all connected components of fg pixels. Returns array of { pixels: number[], size: number }.
 */
function findComponents(mask, w, h) {
  const total = w * h;
  const visited = new Uint8Array(total);
  const components = [];

  for (let i = 0; i < total; i++) {
    if (mask[i] !== 1 || visited[i]) continue;

    const pixels = [];
    const queue = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const pos = queue.pop();
      pixels.push(pos);
      const px = pos % w;
      const py = (pos - px) / w;

      if (px > 0 && mask[pos - 1] === 1 && !visited[pos - 1]) { visited[pos - 1] = 1; queue.push(pos - 1); }
      if (px < w - 1 && mask[pos + 1] === 1 && !visited[pos + 1]) { visited[pos + 1] = 1; queue.push(pos + 1); }
      if (py > 0 && mask[pos - w] === 1 && !visited[pos - w]) { visited[pos - w] = 1; queue.push(pos - w); }
      if (py < h - 1 && mask[pos + w] === 1 && !visited[pos + w]) { visited[pos + w] = 1; queue.push(pos + w); }
    }

    components.push({ pixels, size: pixels.length });
  }

  return components;
}

/**
 * Keep only the N largest connected components, zero out the rest.
 */
function keepLargestComponents(mask, w, h, keepCount) {
  const components = findComponents(mask, w, h);
  if (components.length <= keepCount) return;

  // Sort descending by size, keep the top N
  components.sort((a, b) => b.size - a.size);
  const discard = components.slice(keepCount);
  for (const comp of discard) {
    for (const pos of comp.pixels) {
      mask[pos] = 0;
    }
  }
}

/**
 * Find connected components of fg pixels (mask===1) and zero out
 * any component smaller than minSize.
 */
function removeSmallComponents(mask, w, h, minSize) {
  const total = w * h;
  const visited = new Uint8Array(total);
  const componentBuf = [];

  for (let i = 0; i < total; i++) {
    if (mask[i] !== 1 || visited[i]) continue;

    // BFS to find this component
    componentBuf.length = 0;
    const queue = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const pos = queue.pop();
      componentBuf.push(pos);
      const px = pos % w;
      const py = (pos - px) / w;

      const neighbors = [];
      if (px > 0) neighbors.push(pos - 1);
      if (px < w - 1) neighbors.push(pos + 1);
      if (py > 0) neighbors.push(pos - w);
      if (py < h - 1) neighbors.push(pos + w);

      for (const n of neighbors) {
        if (mask[n] === 1 && !visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }

    // If too small, mark as bg
    if (componentBuf.length < minSize) {
      for (const pos of componentBuf) {
        mask[pos] = 0;
      }
    }
  }
}
