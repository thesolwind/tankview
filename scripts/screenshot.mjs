// Renders the demo session (scripts/demo.mjs) with its terminal colors into an HTML page styled
// like a terminal window, then screenshots it with headless Chrome or Edge into docs/screenshot.png.
// Usage: npm run screenshot   (set BROWSER=/path/to/chrome to pick the browser)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COLS = 136;
const ROWS = 42;
const FONT_PX = 15;
const LINE = 1.2; // terminal-like cell height, so box-drawing lines join up
const CHAR_EM = 0.586; // advance width of Cascadia Mono / Consolas
const PAD = 40; // space around the window
const BG = "#0d1117";
const FG = "#c9d1d9";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "screenshot.png");

const ansi = execFileSync(process.execPath, [join(root, "scripts", "demo.mjs"), String(COLS), String(ROWS), "--ansi"], {
  encoding: "utf8",
});

// ---- ANSI (SGR only: bold, dim, 24-bit fg/bg) to HTML spans ------------------------------

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toHtml(text) {
  const state = { fg: null, bg: null, bold: false, dim: false };
  let html = "";
  const style = () => {
    const css = [];
    if (state.fg) css.push(`color:${state.fg}`);
    if (state.bg) css.push(`background:${state.bg}`);
    if (state.bold) css.push("font-weight:700");
    if (state.dim) css.push("opacity:.6");
    return css.join(";");
  };
  const lines = text.replace(/\r/g, "").split("\n").slice(0, ROWS);
  for (const line of lines) {
    for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
      const m = /^\x1b\[([0-9;]*)m$/.exec(part);
      if (!m) {
        if (part) {
          const css = style();
          html += css ? `<span style="${css}">${esc(part)}</span>` : esc(part);
        }
        continue;
      }
      const codes = (m[1] || "0").split(";").map(Number);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) Object.assign(state, { fg: null, bg: null, bold: false, dim: false });
        else if (c === 1) state.bold = true;
        else if (c === 2) state.dim = true;
        else if (c === 22) state.bold = state.dim = false;
        else if (c === 39) state.fg = null;
        else if (c === 49) state.bg = null;
        else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
          const rgb = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
          if (c === 38) state.fg = rgb;
          else state.bg = rgb;
          i += 4;
        }
      }
    }
    html += "\n";
  }
  return html;
}

// ---- page ---------------------------------------------------------------------------------

const termW = Math.ceil(COLS * CHAR_EM * FONT_PX) + 2; // + slack for font rounding
const termH = Math.ceil(ROWS * LINE * FONT_PX);
const winW = termW + 32;
const winH = termH + 32 + 36;
const pageW = winW + PAD * 2;
const pageH = winH + PAD * 2;

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #010409; }
  body { width: ${pageW}px; height: ${pageH}px; display: flex; align-items: center; justify-content: center; }
  .window { width: ${winW}px; background: ${BG}; border: 1px solid #30363d; border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0,0,0,.6); overflow: hidden; }
  .bar { height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 14px;
    background: #161b22; border-bottom: 1px solid #30363d; font: 13px "Segoe UI", system-ui, sans-serif; color: #8b949e; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .title { flex: 1; text-align: center; margin-right: 52px; }
  pre { margin: 0; padding: 16px; color: ${FG}; font: ${FONT_PX}px/${LINE} "Cascadia Mono", Consolas, "DejaVu Sans Mono", Menlo, monospace;
    white-space: pre; overflow: hidden; }
</style></head><body>
<div class="window">
  <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="title">tankview · ~/shop-api</span></div>
  <pre>${toHtml(ansi)}</pre>
</div>
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), "tankview-shot-"));
const htmlPath = join(tmp, "screenshot.html");
writeFileSync(htmlPath, page);

// ---- screenshot ---------------------------------------------------------------------------

const candidates = [
  process.env.BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) {
  console.error(`No Chrome/Edge found. Set BROWSER=/path/to/chrome. The page is at ${htmlPath}`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
execFileSync(browser, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
  `--user-data-dir=${join(tmp, "profile")}`,
  `--window-size=${pageW},${pageH}`, `--screenshot=${out}`, pathToFileURL(htmlPath).href,
], { stdio: "ignore" });
console.log(`Wrote ${out} (${pageW}x${pageH} at 2x). HTML: ${htmlPath}`);
