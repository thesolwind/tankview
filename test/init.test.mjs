// `tankview init`: dry run, apply, idempotence and the never-overwrite rules.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "am-cfg-")); // no user-level agents
const { planInit, applyInit, renderReport, BUILTIN_TEMPLATES } = await import("../dist/init.js");
const CLI = new URL("../dist/cli.js", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

const repo = (files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "am-repo-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
};
const kinds = (report) => Object.fromEntries(report.actions.map((a) => [a.rel, a.kind]));
const read = (dir, p) => readFileSync(join(dir, p), "utf8");

test("fresh repo: dry run writes nothing, apply creates everything, re-run is a no-op", () => {
  const dir = repo();
  const report = planInit(dir);
  assert.deepEqual(kinds(report), {
    ".claude/agents/architect.md": "create",
    ".claude/agents/audit.md": "create",
    ".claude/agents/grep.md": "create",
    ".claude/agents/search.md": "create",
    ".claude/agents/test.md": "create",
    "CLAUDE.md": "create",
    ".claude/settings.json": "create",
  });
  assert.equal(existsSync(join(dir, ".claude")), false, "dry run must not write");
  assert.match(renderReport(report, { color: false, applied: false }), /Dry run: nothing was written/);

  applyInit(report);
  assert.match(read(dir, ".claude/agents/architect.md"), /^model: opus$/m);
  for (const a of ["search", "grep", "test", "audit"]) assert.match(read(dir, `.claude/agents/${a}.md`), /^model: haiku$/m);
  assert.deepEqual(JSON.parse(read(dir, ".claude/settings.json")), { model: "sonnet" });
  assert.match(read(dir, "CLAUDE.md"), /tankview:orchestration:start[\s\S]*## Agent orchestration[\s\S]*orchestration:end/);

  const again = planInit(dir);
  assert.ok(again.actions.every((a) => a.kind === "unchanged"), JSON.stringify(kinds(again)));
});

test("existing CLAUDE.md is kept verbatim; only the marked section is added or updated", () => {
  const original = "# My project\n\nBuild with `pio run`.\n";
  const dir = repo({ "CLAUDE.md": original });
  applyInit(planInit(dir));
  const after = read(dir, "CLAUDE.md");
  assert.ok(after.startsWith(original.trimEnd()), "original text untouched");
  assert.equal(after.split("orchestration:start").length, 2, "section added once");

  // Edit inside the section and append after it: re-run restores only the section.
  const edited = after.replace("## Agent orchestration", "## Agent orchestration (edited)") + "\n## Notes\nkeep me\n";
  writeFileSync(join(dir, "CLAUDE.md"), edited);
  applyInit(planInit(dir));
  const final = read(dir, "CLAUDE.md");
  assert.ok(!final.includes("(edited)"));
  assert.ok(final.startsWith(original.trimEnd()) && final.endsWith("## Notes\nkeep me\n"));
});

test("a section written under the old agents-monitor markers is replaced, not duplicated", () => {
  const old = "# Lamp\n\n<!-- agents-monitor:orchestration:start -->\nold rules\n<!-- agents-monitor:orchestration:end -->\n\n## Build\npio run\n";
  const dir = repo({ "CLAUDE.md": old });
  applyInit(planInit(dir));
  const after = read(dir, "CLAUDE.md");
  assert.ok(!after.includes("agents-monitor:orchestration") && !after.includes("old rules"));
  assert.equal(after.split("tankview:orchestration:start").length, 2);
  assert.ok(after.startsWith("# Lamp\n") && after.endsWith("## Build\npio run\n"));
});

test("an agent name that is already taken is never overwritten; a proposal is written outside .claude/agents", () => {
  const mine = "---\nname: search\ndescription: my own finder\nmodel: sonnet\n---\nmine\n";
  const dir = repo({ ".claude/agents/finder.md": mine });
  const report = planInit(dir);
  assert.equal(kinds(report)[".claude/tankview/proposed/search.md"], "conflict");
  assert.equal(kinds(report)[".claude/agents/search.md"], undefined);
  applyInit(report);
  assert.equal(read(dir, ".claude/agents/finder.md"), mine);
  assert.ok(!existsSync(join(dir, ".claude/agents/search.md")));
  assert.match(read(dir, ".claude/tankview/proposed/search.md"), /^model: haiku$/m);
  assert.deepEqual(readdirSync(join(dir, ".claude/agents")).sort(), ["architect.md", "audit.md", "finder.md", "grep.md", "test.md"]);
});

test("settings.json: existing model kept, missing model inserted without reformatting, invalid JSON untouched", () => {
  const withModel = repo({ ".claude/settings.json": '{ "model": "opus" }\n' });
  assert.equal(kinds(planInit(withModel))[".claude/settings.json"], "skipped");

  const custom = '{\n    "permissions": { "allow": ["Bash(pio run)"] },\n    "env": { "A": "1" }\n}\n';
  const noModel = repo({ ".claude/settings.json": custom });
  applyInit(planInit(noModel));
  const after = read(noModel, ".claude/settings.json");
  assert.deepEqual(JSON.parse(after), { model: "sonnet", permissions: { allow: ["Bash(pio run)"] }, env: { A: "1" } });
  assert.ok(after.includes('    "permissions": { "allow": ["Bash(pio run)"] },'), "original lines keep their formatting");

  const broken = '{\n  // comment\n  "env": {}\n}\n';
  const invalid = repo({ ".claude/settings.json": broken });
  applyInit(planInit(invalid));
  assert.equal(read(invalid, ".claude/settings.json"), broken);
});

test("Spring checklist only for Spring projects, only in architect and audit", () => {
  const spring = repo({ "pom.xml": "<dependency><groupId>org.springframework.boot</groupId></dependency>" });
  applyInit(planInit(spring));
  assert.match(read(spring, ".claude/agents/architect.md"), /Java \/ Spring Boot checklist/);
  assert.match(read(spring, ".claude/agents/audit.md"), /Java \/ Spring Boot checklist/);
  assert.doesNotMatch(read(spring, ".claude/agents/search.md"), /Spring/);

  const android = repo({ "android/app/build.gradle.kts": 'plugins { id("com.android.application") }', "android/Main.java": "class Main {}" });
  applyInit(planInit(android));
  assert.doesNotMatch(read(android, ".claude/agents/architect.md"), /Spring/);
});

test("CLI: --from may come before the repo; custom templates are used", () => {
  const tpl = mkdtempSync(join(tmpdir(), "am-tpl-"));
  cpSync(BUILTIN_TEMPLATES, tpl, { recursive: true });
  writeFileSync(join(tpl, "agents", "docs.md"), "---\nname: docs\ndescription: docs writer\nmodel: haiku\n---\nx\n");
  const dir = repo();
  const out = execFileSync(process.execPath, [CLI, "init", "--from", tpl, dir, "--apply"], { encoding: "utf8" });
  assert.match(out, /Done: wrote 8 file\(s\)/);
  assert.ok(existsSync(join(dir, ".claude/agents/docs.md")));
});
