// Live editor → in-browser compiler → Shortcuts-style blocks, with source-line linking.
const $ = selector => document.querySelector(selector);
const source = $("#source");
const gutter = $(".gutter");
const marks = $(".line-marks");
const blocksPanel = $("#blocks");
const status = $("#status");
const errorBox = $("#error");
const download = $("#download");
const nameInput = $("#name");
const lineHeight = 20;
const padding = 12;
const icons = { scripting: "⚙", variables: "x", text: "T", web: "⇣", output: "▶", other: "◇" };
const storageKey = "ts-shortcuts-visualizer-source";
const starter = `import { askText, showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const name = await askText("What's your name?");
  for (const greeting of ["Hello", "Welcome"]) {
    if (name === "Ada") {
      await showResult(\`\${greeting}, Countess!\`);
    } else {
      await showResult(\`\${greeting}, \${name}\`);
    }
  }
}
`;

let latest;
let compileSource;
let errorLine;
let linkedLines = new Set();
let timer;

// Editor plumbing
source.addEventListener("input", () => {
  localStorage.setItem(storageKey, source.value);
  refreshGutter();
  compileSoon();
});
source.addEventListener("scroll", () => {
  gutter.scrollTop = source.scrollTop;
  drawMarks();
});
for (const event of ["click", "keyup"]) source.addEventListener(event, () => linkFromCursor());
source.addEventListener("keydown", event => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  document.execCommand("insertText", false, "  ");
});
nameInput.addEventListener("input", () => compileSoon());

function refreshGutter() {
  const count = source.value.split("\n").length;
  gutter.innerHTML = Array.from({ length: count }, (_, i) => {
    const line = i + 1;
    const cls = line === errorLine ? "error" : linkedLines.has(line) ? "mark" : "";
    return `<span class="${cls}">${line}</span>`;
  }).join("\n");
  gutter.scrollTop = source.scrollTop;
  drawMarks();
}
function drawMarks() {
  marks.innerHTML = "";
  const add = (line, cls = "") => {
    const div = document.createElement("div");
    div.className = cls;
    div.style.top = `${padding + (line - 1) * lineHeight - source.scrollTop}px`;
    marks.append(div);
  };
  for (const line of linkedLines) add(line);
  if (errorLine) add(errorLine, "error");
}
function setLinkedLines(lines) {
  linkedLines = new Set(lines.filter(Boolean));
  refreshGutter();
}
function revealLine(line) {
  const top = padding + (line - 1) * lineHeight;
  if (top < source.scrollTop || top > source.scrollTop + source.clientHeight - lineHeight * 2) {
    source.scrollTop = Math.max(0, top - source.clientHeight / 3);
  }
}

// Compilation
function compileSoon(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(compileNow, delay);
}
function compileNow() {
  if (!compileSource) return;
  let response;
  try {
    response = compileSource(source.value, nameInput.value || "TS Shortcut");
  } catch (error) {
    response = { ok: false, error: String(error) };
  }
  status.className = "";
  if (response.ok) {
    latest = response;
    errorLine = undefined;
    errorBox.hidden = true;
    status.textContent = `${response.blocks.length} actions`;
    blocksPanel.classList.remove("stale");
    download.disabled = false;
    renderBlocks(response.blocks);
    $("#workflow").textContent = JSON.stringify(response.workflow, null, 2);
    $("#ir").textContent = JSON.stringify(response.ir, null, 2);
    linkFromCursor();
  } else {
    // Keep the last good output visible but dimmed while the source is broken.
    errorLine = response.position?.line;
    errorBox.hidden = false;
    errorBox.textContent = response.error;
    status.className = "error";
    status.textContent = "Error";
    blocksPanel.classList.add("stale");
    download.disabled = !latest;
    refreshGutter();
  }
}

// Rendering
function partNode(part) {
  const span = document.createElement("span");
  span.textContent = part.text;
  if (part.kind === "literal") span.className = part.text ? "literal" : "literal empty";
  if (part.kind === "token") {
    span.className = `token ${part.variant}`;
    if (part.source !== undefined) {
      span.dataset.source = part.source;
      span.title = `Output of action ${part.source + 1}`;
    }
  }
  return span;
}
function renderBlocks(blocks) {
  blocksPanel.replaceChildren(...blocks.map(block => {
    const card = document.createElement("article");
    card.className = `block ${block.role}`;
    card.dataset.index = block.index;
    if (block.line) card.dataset.line = block.line;
    card.style.marginLeft = `${block.depth * 22}px`;
    for (let level = 0; level < block.depth; level++) {
      const guide = document.createElement("span");
      guide.className = "depth-guide";
      guide.style.left = `${-22 * (block.depth - level) + 8}px`;
      card.append(guide);
    }

    const head = document.createElement("div");
    head.className = "head";
    if (block.role === "action" || block.role === "start") {
      const icon = document.createElement("span");
      icon.className = `icon cat-${block.category}`;
      icon.textContent = icons[block.category];
      head.append(icon);
    }
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = block.title;
    const summary = document.createElement("span");
    summary.className = "summary";
    summary.append(...block.summary.map(partNode));
    const index = document.createElement("span");
    index.className = "index";
    index.textContent = `#${block.index + 1}${block.line ? ` · L${block.line}` : ""}`;
    index.title = block.identifier;
    head.append(title, summary, index);
    card.append(head);

    if (block.details.length) {
      const details = document.createElement("dl");
      details.className = "details";
      for (const { label, value } of block.details) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.append(...value.map(partNode));
        details.append(dt, dd);
      }
      card.append(details);
    }
    if (block.output && block.role !== "middle") {
      const produces = document.createElement("div");
      produces.className = "produces";
      produces.append("→ ", partNode({ kind: "token", text: block.output, variant: "output" }));
      card.append(produces);
    }
    return card;
  }));
}

// Linking between source lines and blocks
function linkFromCursor() {
  const line = source.value.slice(0, source.selectionStart).split("\n").length;
  highlightBlocks(card => Number(card.dataset.line) === line, false);
  setLinkedLines(document.querySelector(".block.linked") ? [line] : []);
}
function highlightBlocks(predicate, scroll) {
  let first;
  for (const card of blocksPanel.children) {
    const match = predicate(card);
    card.classList.toggle("linked", match);
    first ??= match ? card : undefined;
  }
  first?.scrollIntoView({ block: "nearest", behavior: scroll ? "smooth" : "auto" });
}
blocksPanel.addEventListener("mouseover", event => {
  const card = event.target.closest(".block");
  if (card?.dataset.line) setLinkedLines([Number(card.dataset.line)]);
});
blocksPanel.addEventListener("click", event => {
  const token = event.target.closest(".token[data-source]");
  if (token) {
    // Jump to the action that produced this value.
    const target = blocksPanel.querySelector(`.block[data-index="${token.dataset.source}"]`);
    for (const card of blocksPanel.querySelectorAll(".target")) card.classList.remove("target");
    target?.classList.add("target");
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  const card = event.target.closest(".block");
  if (!card?.dataset.line) return;
  const line = Number(card.dataset.line);
  highlightBlocks(other => other.dataset.line === card.dataset.line, false);
  setLinkedLines([line]);
  revealLine(line);
});

// Tabs, examples and download
for (const tab of document.querySelectorAll("[role=tab]")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[role=tab]")) {
      other.setAttribute("aria-selected", String(other === tab));
      $(`#${other.dataset.tab}`).hidden = other !== tab;
    }
  });
}
const examples = $("#examples");
let exampleSources = {};
examples.addEventListener("change", () => {
  if (!examples.value) return;
  source.value = exampleSources[examples.value];
  nameInput.value = examples.value.replace(/^.*\//, "").replace(/\.ts$/, "");
  examples.value = "";
  source.scrollTop = 0;
  localStorage.setItem(storageKey, source.value);
  refreshGutter();
  compileSoon(0);
});
download.addEventListener("click", () => {
  if (!latest) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([latest.plist], { type: "application/x-plist" }));
  link.download = `${latest.name}.unsigned.plist`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

source.value = localStorage.getItem(storageKey) ?? starter;
refreshGutter();
status.textContent = "Loading compiler…";
try {
  // Relative URLs so the page also works from a GitHub Pages project path.
  const [{ createVisualizer }, assets] = await Promise.all([
    import("./compiler.js"),
    fetch("assets.json").then(r => r.json()),
  ]);
  compileSource = createVisualizer(assets);
  exampleSources = assets.examples;
  for (const file of Object.keys(exampleSources)) examples.append(new Option(file, file));
  compileNow();
} catch (error) {
  status.className = "error";
  status.textContent = "Failed to load";
  errorBox.hidden = false;
  errorBox.textContent = `Could not load the compiler: ${error}`;
}
