// `tankview init <repo>`: installs the multi-model subagent setup into another repository.
// Plans every change first (dry run by default) and never overwrites existing configuration:
//   - an agent whose name is already taken gets a proposal file to merge by hand
//   - CLAUDE.md gets one marked section; text outside the markers is never touched
//   - settings.json gains "model" only when no model is set

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BUILTIN_TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "templates");
const START = "<!-- tankview:orchestration:start -->";
const END = "<!-- tankview:orchestration:end -->";
// Sections written before the rename to tankview are recognized and replaced, never duplicated.
const MARKER_PAIRS = [
  [START, END],
  ["<!-- agents-monitor:orchestration:start -->", "<!-- agents-monitor:orchestration:end -->"],
];
const MAIN_MODEL = "sonnet";
// The Spring checklist is appended to these agents when the repo uses Spring.
const SPRING_AGENTS = ["architect.md", "audit.md"];
const SKIP_DIRS = new Set([".git", "node_modules", "build", "target", "dist", ".gradle", ".venv", ".pio", ".idea", "out"]);

export type Kind = "create" | "update" | "unchanged" | "conflict" | "skipped" | "delete";

export interface Action {
  rel: string; // path shown to the user, relative to the target
  abs: string; // path written on --apply
  kind: Kind;
  before: string;
  after: string;
  note?: string;
}

export interface Report {
  target: string;
  findings: string[];
  actions: Action[];
}

export function planInit(targetDir: string, templatesDir = BUILTIN_TEMPLATES): Report {
  const target = resolve(targetDir);
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`Not a directory: ${target}`);
  const agentsTpl = join(templatesDir, "agents");
  const sectionTpl = join(templatesDir, "claude-section.md");
  if (!existsSync(agentsTpl) || !existsSync(sectionTpl)) {
    throw new Error(`Templates folder must contain agents/*.md and claude-section.md: ${templatesDir}`);
  }

  const findings: string[] = [];
  const actions: Action[] = [];
  const rel = (p: string) => relative(target, p).replaceAll("\\", "/");

  // ---- inspect ----
  findings.push(existsSync(join(target, ".git")) ? "git repository" : "not a git repository");
  const spring = detectSpring(target);
  findings.push(spring ? `Spring detected (${spring}): adding the Java/Spring checklist` : "no Spring code: Java/Spring checklist not needed");

  const agentsDir = join(target, ".claude", "agents");
  const existing = readAgentNames(agentsDir);
  findings.push(
    existing.size ? `existing project agents: ${[...existing.keys()].join(", ")}` : "no existing project agents",
  );
  const userAgents = readAgentNames(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "agents"));

  // ---- agents ----
  for (const { file, plain, withSpring } of agentTemplates(templatesDir)) {
    const content = spring ? withSpring : plain;
    const name = frontmatterName(content) ?? file.replace(/\.md$/, "");
    const dest = join(agentsDir, file);
    const taken = existing.get(name);
    const userNote = userAgents.has(name) ? `overrides your user-level agent "${name}" in this project` : undefined;

    if (!taken && !existsSync(dest)) {
      actions.push({ rel: rel(dest), abs: dest, kind: "create", before: "", after: content, note: userNote });
      continue;
    }
    const current = readFileSync(taken ?? dest, "utf8");
    if (current === content) {
      actions.push({ rel: rel(taken ?? dest), abs: taken ?? dest, kind: "unchanged", before: current, after: current });
      continue;
    }
    // Never overwrite. The proposal lives outside .claude/agents/, where a second file with the
    // same name would make Claude Code load one of them at random.
    const proposal = join(target, ".claude", "tankview", "proposed", file);
    actions.push({
      rel: rel(proposal), abs: proposal, kind: "conflict", before: current, after: content,
      note: `agent "${name}" already exists in ${rel(taken ?? dest)}; merge this proposal by hand`,
    });
  }

  // ---- CLAUDE.md ----
  const section = `${START}\n${readFileSync(sectionTpl, "utf8").trim()}\n${END}\n`;
  const claudeMd = [join(target, "CLAUDE.md"), join(target, ".claude", "CLAUDE.md")].find((p) => existsSync(p))
    ?? join(target, "CLAUDE.md");
  if (!existsSync(claudeMd)) {
    findings.push("no CLAUDE.md");
    actions.push({ rel: rel(claudeMd), abs: claudeMd, kind: "create", before: "", after: section });
  } else {
    const before = readFileSync(claudeMd, "utf8");
    const pair = MARKER_PAIRS.find(([a, b]) => before.indexOf(a) >= 0 && before.indexOf(b) > before.indexOf(a));
    let after: string;
    if (pair) {
      const s = before.indexOf(pair[0]);
      const e = before.indexOf(pair[1]);
      findings.push(`${rel(claudeMd)} already has the orchestration section`);
      const tail = before.slice(e + pair[1].length).replace(/^\r?\n/, "");
      after = before.slice(0, s) + section + tail;
    } else {
      findings.push(`existing ${rel(claudeMd)} (${before.split("\n").length} lines) is kept; one section is appended`);
      after = before.replace(/\s*$/, "") + "\n\n" + section;
    }
    actions.push({ rel: rel(claudeMd), abs: claudeMd, kind: after === before ? "unchanged" : "update", before, after });
  }

  // ---- settings.json ----
  actions.push(planSettings(join(target, ".claude", "settings.json"), rel, findings));

  return { target, findings, actions };
}

function planSettings(path: string, rel: (p: string) => string, findings: string[]): Action {
  const base = { rel: rel(path), abs: path };
  if (!existsSync(path)) {
    findings.push("no .claude/settings.json");
    const after = JSON.stringify({ model: MAIN_MODEL }, null, 2) + "\n";
    return { ...base, kind: "create", before: "", after };
  }
  const before = readFileSync(path, "utf8");
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(before);
  } catch {
    return {
      ...base, kind: "skipped", before, after: before,
      note: `could not parse it, so it was left alone; add "model": "${MAIN_MODEL}" yourself`,
    };
  }
  if (obj.model !== undefined) {
    findings.push(`.claude/settings.json already sets model: ${JSON.stringify(obj.model)}`);
    return obj.model === MAIN_MODEL
      ? { ...base, kind: "unchanged", before, after: before }
      : { ...base, kind: "skipped", before, after: before, note: `keeps the existing model ${JSON.stringify(obj.model)}` };
  }
  // Insert the key as text so the rest of the file keeps its formatting.
  const indent = /\{\s*\n([ \t]+)"/.exec(before)?.[1] ?? "  ";
  let after = Object.keys(obj).length
    ? before.replace(/^(\s*\{)(\s*)/, `$1\n${indent}"model": "${MAIN_MODEL}",$2`)
    : JSON.stringify({ model: MAIN_MODEL }, null, 2) + "\n";
  try {
    JSON.parse(after);
  } catch {
    after = JSON.stringify({ model: MAIN_MODEL, ...obj }, null, 2) + "\n";
  }
  return { ...base, kind: "update", before, after };
}

export function applyInit(report: Report): Action[] {
  const written = report.actions.filter((a) => a.kind === "create" || a.kind === "update" || a.kind === "conflict");
  for (const a of written) {
    mkdirSync(dirname(a.abs), { recursive: true });
    writeFileSync(a.abs, a.after);
  }
  return written;
}

/** Each agent template, plain and with the Spring checklist appended where it applies. */
function agentTemplates(templatesDir: string): { file: string; plain: string; withSpring: string }[] {
  const springPath = join(templatesDir, "java-spring.md");
  const springText = existsSync(springPath) ? readFileSync(springPath, "utf8") : "";
  return readdirSync(join(templatesDir, "agents")).filter((f) => f.endsWith(".md")).sort().map((file) => {
    const plain = readFileSync(join(templatesDir, "agents", file), "utf8");
    const withSpring = springText && SPRING_AGENTS.includes(file) ? plain.trimEnd() + "\n" + springText : plain;
    return { file, plain, withSpring };
  });
}

// ---- remove ---------------------------------------------------------------------------
// `tankview remove <repo>` undoes init, touching only what init added: agents that still match
// a template, the marked CLAUDE.md section, "model": "sonnet", and init's proposal files.

const PROPOSAL_DIRS = [join(".claude", "tankview", "proposed"), join(".claude", "agents-monitor", "proposed")];
// Removed after --apply when they end up empty, deepest first.
const PRUNE_DIRS = [...PROPOSAL_DIRS, join(".claude", "tankview"), join(".claude", "agents-monitor"), join(".claude", "agents"), ".claude"];

const sameText = (a: string, b: string) => a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

export function planRemove(targetDir: string, templatesDir = BUILTIN_TEMPLATES): Report {
  const target = resolve(targetDir);
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`Not a directory: ${target}`);
  if (!existsSync(join(templatesDir, "agents"))) throw new Error(`Templates folder must contain agents/*.md: ${templatesDir}`);
  const findings: string[] = [];
  const actions: Action[] = [];
  const rel = (p: string) => relative(target, p).replaceAll("\\", "/");

  // ---- agents: only exact template copies ----
  const agentsDir = join(target, ".claude", "agents");
  for (const { file, plain, withSpring } of agentTemplates(templatesDir)) {
    const path = join(agentsDir, file);
    if (!existsSync(path)) continue;
    const current = readFileSync(path, "utf8");
    if (sameText(current, plain) || sameText(current, withSpring)) {
      actions.push({ rel: rel(path), abs: path, kind: "delete", before: current, after: "" });
    } else {
      actions.push({
        rel: rel(path), abs: path, kind: "skipped", before: current, after: current,
        note: "differs from tankview's template (edited, or from another version): kept; delete it yourself if you don't need it",
      });
    }
  }

  // ---- proposal files from init ----
  for (const dir of PROPOSAL_DIRS) {
    const abs = join(target, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).sort()) {
      const path = join(abs, f);
      if (statSync(path).isFile()) {
        actions.push({ rel: rel(path), abs: path, kind: "delete", before: readFileSync(path, "utf8"), after: "" });
      }
    }
  }

  // ---- CLAUDE.md: cut out the marked section ----
  for (const claudeMd of [join(target, "CLAUDE.md"), join(target, ".claude", "CLAUDE.md")]) {
    if (!existsSync(claudeMd)) continue;
    const before = readFileSync(claudeMd, "utf8");
    const pair = MARKER_PAIRS.find(([a, b]) => before.indexOf(a) >= 0 && before.indexOf(b) > before.indexOf(a));
    if (!pair) continue;
    const head = before.slice(0, before.indexOf(pair[0])).replace(/\s+$/, "");
    const tail = before.slice(before.indexOf(pair[1]) + pair[1].length).replace(/^\s+/, "");
    const rest = [head, tail].filter(Boolean).join("\n\n");
    if (rest.trim()) {
      actions.push({ rel: rel(claudeMd), abs: claudeMd, kind: "update", before, after: rest.replace(/\s*$/, "\n") });
    } else {
      actions.push({ rel: rel(claudeMd), abs: claudeMd, kind: "delete", before, after: "", note: "only had tankview's section" });
    }
  }

  // ---- settings.json: drop "model": "sonnet" ----
  const settings = join(target, ".claude", "settings.json");
  if (existsSync(settings)) {
    const before = readFileSync(settings, "utf8");
    let obj: Record<string, unknown> | null = null;
    try {
      obj = JSON.parse(before);
    } catch {
      findings.push(".claude/settings.json isn't valid JSON, so it was left alone");
    }
    if (obj && obj.model === MAIN_MODEL) {
      const { model: _, ...others } = obj;
      if (!Object.keys(others).length) {
        actions.push({ rel: rel(settings), abs: settings, kind: "delete", before, after: "", note: `only set "model": "${MAIN_MODEL}"` });
      } else {
        // Remove the line as text so the rest keeps its formatting; fall back to re-serializing.
        let after = before.replace(/^[ \t]*"model"\s*:\s*"sonnet"\s*,?[ \t]*\r?\n/m, "");
        try {
          JSON.parse(after);
        } catch {
          after = JSON.stringify(others, null, 2) + "\n";
        }
        actions.push({
          rel: rel(settings), abs: settings, kind: "update", before, after,
          note: `removes "model": "${MAIN_MODEL}", which init adds; the rest stays`,
        });
      }
    } else if (obj && obj.model !== undefined) {
      findings.push(`.claude/settings.json sets model ${JSON.stringify(obj.model)}, not tankview's "${MAIN_MODEL}": kept`);
    }
  }

  if (!actions.some((a) => a.kind === "delete" || a.kind === "update")) findings.push("nothing from tankview init found");
  else findings.push("folders that end up empty (.claude/agents, .claude) are removed too");
  return { target, findings, actions };
}

export function applyRemove(report: Report): Action[] {
  const changed = report.actions.filter((a) => a.kind === "delete" || a.kind === "update");
  for (const a of changed) {
    if (a.kind === "delete") rmSync(a.abs, { force: true });
    else writeFileSync(a.abs, a.after);
  }
  for (const dir of PRUNE_DIRS) {
    const abs = join(report.target, dir);
    try {
      if (statSync(abs).isDirectory() && readdirSync(abs).length === 0) rmdirSync(abs);
    } catch {
      // missing or not empty: leave it
    }
  }
  return changed;
}

// ---- inspection helpers -----------------------------------------------------------

function frontmatterName(text: string): string | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  return fm ? /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm)?.[1] : undefined;
}

/** Agent name -> file path for every .md in an agents directory (subfolders included). */
function readAgentNames(dir: string): Map<string, string> {
  const names = new Map<string, string>();
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".md")) {
        const name = frontmatterName(readFileSync(p, "utf8")) ?? e.replace(/\.md$/, "");
        if (!names.has(name)) names.set(name, p);
      }
    }
  };
  walk(dir);
  return names;
}

/** Returns where Spring was found, or null. Looks at build files first, then Java sources. */
function detectSpring(root: string): string | null {
  let budget = 5000; // files examined, so huge repos stay fast
  const javaFiles: string[] = [];
  const walk = (d: string, depth: number): string | null => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return null;
    }
    for (const e of entries) {
      if (budget-- <= 0) return null;
      const p = join(d, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e) && !e.startsWith(".") && depth < 6) {
          const hit = walk(p, depth + 1);
          if (hit) return hit;
        }
      } else if (/^(pom\.xml|build\.gradle(\.kts)?)$/.test(e)) {
        if (readFileSync(p, "utf8").includes("springframework")) return relative(root, p).replaceAll("\\", "/");
      } else if (e.endsWith(".java") && javaFiles.length < 300) {
        javaFiles.push(p);
      }
    }
    return null;
  };
  const build = walk(root, 0);
  if (build) return build;
  const app = javaFiles.find((p) => readFileSync(p, "utf8").includes("@SpringBootApplication"));
  return app ? relative(root, app).replaceAll("\\", "/") : null;
}

// ---- report rendering ---------------------------------------------------------------

const ANSI = { green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };
const LABEL: Record<Kind, string> = {
  create: "create", update: "update", unchanged: "unchanged", conflict: "proposal", skipped: "skipped", delete: "delete",
};

export function renderReport(report: Report, opts: { color: boolean; applied: boolean }): string {
  const c = (code: keyof typeof ANSI, s: string) => (opts.color ? ANSI[code] + s + ANSI.reset : s);
  const out: string[] = [];
  out.push(c("bold", `Target: ${report.target}`), "");
  out.push(c("bold", "Inspection"));
  for (const f of report.findings) out.push(`  - ${f}`);
  out.push("", c("bold", "Plan"));
  const width = Math.max(...report.actions.map((a) => a.rel.length));
  for (const a of report.actions) {
    const color = a.kind === "create" || a.kind === "update" ? "green"
      : a.kind === "delete" ? "red"
      : a.kind === "conflict" || a.kind === "skipped" ? "yellow" : "dim";
    const note = a.note ? a.rel.padEnd(width) + c("dim", `  (${a.note})`) : a.rel;
    out.push(`  ${c(color, LABEL[a.kind].padEnd(9))} ${note}`);
  }
  out.push("", c("bold", "File tree"), ...renderTree(report));
  for (const a of report.actions) {
    if (a.kind !== "create" && a.kind !== "update" && a.kind !== "conflict") continue;
    out.push("", c("cyan", `--- ${a.kind === "create" ? "/dev/null" : a.rel}`), c("cyan", `+++ ${a.rel}`));
    for (const line of unifiedDiff(a.kind === "conflict" ? "" : a.before, a.after)) {
      out.push(line.startsWith("+") ? c("green", line) : line.startsWith("-") ? c("red", line) : line.startsWith("@@") ? c("cyan", line) : line);
    }
  }
  out.push("");
  const writes = report.actions.filter((a) => a.kind === "create" || a.kind === "update" || a.kind === "conflict").length;
  const deletes = report.actions.filter((a) => a.kind === "delete").length;
  const parts = [writes && `${opts.applied ? "wrote" : "write"} ${writes} file(s)`, deletes && `${opts.applied ? "deleted" : "delete"} ${deletes} file(s)`]
    .filter(Boolean).join(" and ");
  if (opts.applied) out.push(c("green", parts ? `Done: ${parts}. Nothing else was changed.` : "Nothing to change."));
  else if (parts) out.push(c("yellow", `Dry run: nothing was changed. Re-run with --apply to ${parts}.`));
  else out.push(c("green", "Nothing to change."));
  return out.join("\n");
}

function renderTree(report: Report): string[] {
  const root = report.target.replaceAll("\\", "/").split("/").at(-1) + "/";
  const lines = [`  ${root}`];
  const paths = report.actions.map((a) => ({ parts: a.rel.split("/"), a })).sort((x, y) => x.a.rel.localeCompare(y.a.rel));
  const seen = new Set<string>();
  for (const { parts, a } of paths) {
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i + 1).join("/");
      if (seen.has(key)) continue;
      seen.add(key);
      const isFile = i === parts.length - 1;
      lines.push(`  ${"    ".repeat(i + 1)}${parts[i]}${isFile ? `   [${LABEL[a.kind]}]` : "/"}`);
    }
  }
  return lines;
}

/** Minimal unified diff (LCS over lines) with 2 lines of context. */
export function unifiedDiff(before: string, after: string): string[] {
  const a = before ? before.replace(/\n$/, "").split("\n") : [];
  const b = after ? after.replace(/\n$/, "").split("\n") : [];
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const ops: { t: " " | "-" | "+"; s: string; ai: number; bi: number }[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({ t: " ", s: a[i], ai: i++, bi: j++ });
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) ops.push({ t: "+", s: b[j], ai: i, bi: j++ });
    else ops.push({ t: "-", s: a[i], ai: i++, bi: j });
  }
  const CONTEXT = 2;
  const out: string[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === " ") {
      k++;
      continue;
    }
    const start = Math.max(0, k - CONTEXT);
    let end = k;
    while (end < ops.length) {
      if (ops[end].t !== " ") {
        end++;
        continue;
      }
      let run = 0;
      while (end + run < ops.length && ops[end + run].t === " ") run++;
      if (end + run >= ops.length || run > CONTEXT * 2) {
        end = Math.min(ops.length, end + CONTEXT);
        break;
      }
      end += run;
    }
    const hunk = ops.slice(start, end);
    const aLen = hunk.filter((o) => o.t !== "+").length;
    const bLen = hunk.filter((o) => o.t !== "-").length;
    out.push(`@@ -${aLen ? hunk[0].ai + 1 : hunk[0].ai},${aLen} +${bLen ? hunk[0].bi + 1 : hunk[0].bi},${bLen} @@`);
    for (const o of hunk) out.push(o.t + o.s);
    k = end;
  }
  return out;
}
