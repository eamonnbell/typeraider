/**
 * type-editor.js — Typing UI that renders random glyph variants per keystroke.
 */

import { getRandomVariant, hasGlyph, onChange } from "./repertoire.js";

let editorEl = null;
let hasContent = false;

const FRUITY_LOREM = [
  "MANGO PAPAYA GUAVA LYCHEE DRAGONFRUIT PASSIONFRUIT KUMQUAT PERSIMMON POMELO STARFRUIT",
  "RIPE FIGS DRIP HONEY WHILE TANGERINES ROLL ACROSS THE SUN WARMED COBBLESTONES",
  "THE BANANA REPUBLIC FELL TO A COALITION OF ANGRY POMEGRANATES AND ROGUE KIWIS",
  "WATERMELON SLICES GLISTENED LIKE STAINED GLASS IN THE AFTERNOON LIGHT",
  "SOMEWHERE BETWEEN THE PINEAPPLE AND THE JACKFRUIT LIES THE MEANING OF LIFE",
  "A DURIAN WALKED INTO A BAR AND EVERYONE LEFT",
  "BLOOD ORANGES SOUND MENACING BUT TASTE LIKE SUNSET",
  "QUINCE COMPOTE ON TOAST IS THE BREAKFAST OF CHAMPIONS",
  "THE LAST KNOWN CLOUDBERRY WAS SPOTTED NEAR A FJORD EATING LINGONBERRIES",
  "GOOSEBERRY FOOL REQUIRES NEITHER GEESE NOR FOOLS JUST CREAM AND COURAGE",
];

export function initEditor() {
  editorEl = document.getElementById("type-editor");
  const controls = document.getElementById("editor-controls");
  const clearBtn = document.getElementById("clear-editor");
  const exportBtn = document.getElementById("export-editor");
  const loremBtn = document.getElementById("lorem-btn");

  editorEl.addEventListener("keydown", handleKey);
  clearBtn.addEventListener("click", clearEditor);
  exportBtn.addEventListener("click", exportEditor);
  loremBtn.addEventListener("click", insertLorem);

  // Enable editor when first glyph arrives
  onChange(() => {
    if (!editorEl.isContentEditable) {
      enableEditor();
    }
  });
}

function enableEditor() {
  editorEl.contentEditable = "true";
  editorEl.innerHTML = "";
  hasContent = false;
  document.getElementById("editor-controls").hidden = false;
  editorEl.focus();
}

function handleKey(e) {
  e.preventDefault();

  if (e.key === "Backspace") {
    const last = editorEl.lastElementChild;
    if (last) last.remove();
    if (!editorEl.children.length) hasContent = false;
    return;
  }

  if (e.key === "Enter") {
    const br = document.createElement("div");
    br.className = "newline";
    editorEl.appendChild(br);
    hasContent = true;
    scrollToBottom();
    return;
  }

  if (e.key === " ") {
    const sp = document.createElement("span");
    sp.className = "space-char";
    sp.textContent = "\u00A0";
    editorEl.appendChild(sp);
    hasContent = true;
    scrollToBottom();
    return;
  }

  // Only handle printable single characters
  if (e.key.length !== 1) return;

  const char = e.key;
  const variant = getRandomVariant(char);

  if (variant) {
    const img = document.createElement("img");
    img.className = "glyph-img";
    img.src = variant.dataUrl;
    img.alt = char;
    img.draggable = false;
    editorEl.appendChild(img);
  } else {
    // Fallback: render as text
    const span = document.createElement("span");
    span.className = "fallback-char";
    span.textContent = char;
    editorEl.appendChild(span);
  }

  hasContent = true;
  scrollToBottom();
}

function scrollToBottom() {
  editorEl.scrollTop = editorEl.scrollHeight;
}

function insertLorem() {
  // Pick 3 random lines
  const lines = [...FRUITY_LOREM].sort(() => Math.random() - 0.5).slice(0, 3);
  for (let li = 0; li < lines.length; li++) {
    if (li > 0 || hasContent) {
      const br = document.createElement("div");
      br.className = "newline";
      editorEl.appendChild(br);
    }
    for (let i = 0; i < lines[li].length; i++) {
      const ch = lines[li][i];
      if (ch === " ") {
        const sp = document.createElement("span");
        sp.className = "space-char";
        sp.textContent = "\u00A0";
        editorEl.appendChild(sp);
      } else {
        const variant = getRandomVariant(ch);
        if (variant) {
          const img = document.createElement("img");
          img.className = "glyph-img";
          img.src = variant.dataUrl;
          img.alt = ch;
          img.draggable = false;
          editorEl.appendChild(img);
        } else {
          const span = document.createElement("span");
          span.className = "fallback-char";
          span.textContent = ch;
          editorEl.appendChild(span);
        }
      }
    }
  }
  hasContent = true;
  scrollToBottom();
}

function clearEditor() {
  editorEl.innerHTML = "";
  hasContent = false;
  editorEl.focus();
}

function exportEditor() {
  const width = editorEl.scrollWidth;
  const height = editorEl.scrollHeight;

  const clone = editorEl.cloneNode(true);
  clone.style.width = width + "px";
  clone.style.position = "absolute";
  clone.style.left = "-9999px";
  document.body.appendChild(clone);

  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#faf7f2";
  ctx.fillRect(0, 0, width, height);

  let x = 16;
  let y = 16;
  const lineHeight = 40;
  const glyphHeight = 32;

  for (const child of editorEl.children) {
    if (child.classList.contains("newline")) {
      x = 16;
      y += lineHeight;
      continue;
    }
    if (child.classList.contains("space-char")) {
      x += 12;
      continue;
    }
    if (child.tagName === "IMG") {
      const img = new Image();
      img.src = child.src;
      const aspect = img.naturalWidth / img.naturalHeight || 1;
      const drawW = glyphHeight * aspect;
      ctx.drawImage(img, x, y, drawW, glyphHeight);
      x += drawW + 2;
    } else {
      ctx.fillStyle = "#666";
      ctx.font = "28px monospace";
      ctx.fillText(child.textContent, x, y + glyphHeight - 4);
      x += ctx.measureText(child.textContent).width + 2;
    }
  }

  document.body.removeChild(clone);

  const link = document.createElement("a");
  link.download = "typeraider-export.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}
