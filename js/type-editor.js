/**
 * type-editor.js — Typing UI that renders random glyph variants per keystroke.
 *
 * Uses a hidden textarea to capture input via beforeinput events, which works
 * reliably on both desktop and mobile virtual keyboards (the standard pattern
 * used by VS Code, CodeMirror, Monaco, etc.).
 */

import { getRandomVariant, hasGlyph, onChange } from "./repertoire.js";

let editorEl = null;
let hiddenInput = null;
let hasContent = false;
let enabled = false;

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

export function resetEditor() {
  enabled = false;
  hasContent = false;
}

export function initEditor() {
  editorEl = document.getElementById("type-editor");
  const clearBtn = document.getElementById("clear-editor");
  const exportBtn = document.getElementById("export-editor");
  const loremBtn = document.getElementById("lorem-btn");

  // Create the hidden textarea for capturing keyboard input
  hiddenInput = document.createElement("textarea");
  hiddenInput.id = "hidden-input";
  hiddenInput.setAttribute("autocapitalize", "off");
  hiddenInput.setAttribute("autocomplete", "off");
  hiddenInput.setAttribute("autocorrect", "off");
  hiddenInput.setAttribute("spellcheck", "false");
  hiddenInput.setAttribute("aria-label", "Type editor input");
  editorEl.appendChild(hiddenInput);

  // Tapping the editor focuses the hidden input (opens virtual keyboard)
  editorEl.addEventListener("click", () => {
    if (enabled) hiddenInput.focus();
  });

  // Reflect focus state on the editor for visual cursor
  hiddenInput.addEventListener("focus", () => {
    editorEl.classList.add("focused");
  });
  hiddenInput.addEventListener("blur", () => {
    editorEl.classList.remove("focused");
  });

  // Unified input handling via beforeinput — works on mobile and desktop
  hiddenInput.addEventListener("beforeinput", handleBeforeInput);

  clearBtn.addEventListener("click", clearEditor);
  exportBtn.addEventListener("click", exportEditor);
  loremBtn.addEventListener("click", insertLorem);

  // Enable editor when first glyph arrives
  onChange(() => {
    if (!enabled) {
      enableEditor();
    }
  });
}

function enableEditor() {
  enabled = true;
  // Remove contenteditable since we use the hidden textarea now
  editorEl.removeAttribute("contenteditable");
  editorEl.innerHTML = "";
  editorEl.appendChild(hiddenInput);
  hasContent = false;
  document.getElementById("editor-controls").hidden = false;
  hiddenInput.focus();
}

function handleBeforeInput(e) {
  e.preventDefault();

  const inputType = e.inputType;

  if (inputType === "deleteContentBackward" || inputType === "deleteContentForward") {
    const last = editorEl.lastElementChild;
    if (last && last !== hiddenInput) last.remove();
    if (editorEl.children.length <= 1) hasContent = false; // only hiddenInput remains
    return;
  }

  if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
    const br = document.createElement("div");
    br.className = "newline";
    editorEl.insertBefore(br, hiddenInput);
    hasContent = true;
    scrollToBottom();
    return;
  }

  if (inputType === "insertText" && e.data) {
    for (const char of e.data) {
      insertChar(char);
    }
    scrollToBottom();
    return;
  }

  // insertCompositionText, insertFromPaste, etc. — extract characters
  if (e.data) {
    for (const char of e.data) {
      insertChar(char);
    }
    scrollToBottom();
  }
}

function insertChar(char) {
  if (char === " ") {
    const sp = document.createElement("span");
    sp.className = "space-char";
    sp.textContent = "\u00A0";
    editorEl.insertBefore(sp, hiddenInput);
    hasContent = true;
    return;
  }

  const variant = getRandomVariant(char);
  if (variant) {
    const img = document.createElement("img");
    img.className = "glyph-img";
    img.src = variant.dataUrl;
    img.alt = char;
    img.draggable = false;
    editorEl.insertBefore(img, hiddenInput);
  } else {
    const span = document.createElement("span");
    span.className = "fallback-char";
    span.textContent = char;
    editorEl.insertBefore(span, hiddenInput);
  }
  hasContent = true;
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
      editorEl.insertBefore(br, hiddenInput);
    }
    for (let i = 0; i < lines[li].length; i++) {
      const ch = lines[li][i];
      insertChar(ch);
    }
  }
  hasContent = true;
  scrollToBottom();
}

function clearEditor() {
  // Remove all children except the hidden input
  while (editorEl.firstChild) {
    if (editorEl.firstChild === hiddenInput) break;
    editorEl.firstChild.remove();
  }
  // If hiddenInput got removed somehow, re-add it
  if (!editorEl.contains(hiddenInput)) {
    editorEl.innerHTML = "";
    editorEl.appendChild(hiddenInput);
  }
  hasContent = false;
  hiddenInput.focus();
}

function exportEditor() {
  const width = editorEl.scrollWidth;
  const height = editorEl.scrollHeight;

  const clone = editorEl.cloneNode(true);
  // Remove the hidden input from the clone
  const cloneInput = clone.querySelector("#hidden-input");
  if (cloneInput) cloneInput.remove();
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
    if (child === hiddenInput) continue;
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
