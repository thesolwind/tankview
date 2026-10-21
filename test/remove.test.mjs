// `tankview remove`: undoes init, touching only what init added.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "tv-cfg-")); // no user-level agents
const { planInit, applyInit, planRemove, applyRemove, renderReport } = await import("../dist/init.js");

const repo = (files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "tv-rm-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
};
const read = (dir, p) => readFileSync(join(dir, p), "utf8");
const kinds = (report) => Object.fromEntries(report.actions.map((a) => [a.rel, a.kind]));

test("init then remove on a fresh repo leaves nothing behind; the preview changes nothing", () => {
  const dir = repo({ "src/main.c": "int main() {}\n" });
  applyInit(planInit(dir));
  const report = planRemove(dir);
  assert.equal(Object.values(kinds(report)).filter((k) => k === "delete").length, 7);
  assert.match(renderReport(report, { color: false, applied: false }), /Dry run: nothing was changed\. Re-run with --apply to delete 7 file\(s\)/);
  assert.ok(existsSync(join(dir, ".claude/agents/search.md")), "preview must not delete");

  applyRemove(report);
  assert.deepEqual(readdirSync(dir).sort(), ["src"]);
  assert.equal(read(dir, "src/main.c"), "int main() {}\n");
  assert.match(renderReport(planRemove(dir), { color: false, applied: false }), /nothing from tankview init found[\s\S]*Nothing to change/);
});

test("your own CLAUDE.md text and settings come back exactly as they were", () => {
  const md = "# Lamp\n\nBuild with `pio run`.\n";
  const settings = '{\n    "permissions": { "allow": ["Bash(pio run)"] },\n    "env": { "A": "1" }\n}\n';
  const dir = repo({ "CLAUDE.md": md, ".claude/settings.json": settings });
  applyInit(planInit(dir));
  assert.notEqual(read(dir, "CLAUDE.md"), md);

  const report = planRemove(dir);
  assert.equal(kinds(report)["CLAUDE.md"], "update");
  assert.equal(kinds(report)[".claude/settings.json"], "update");
  applyRemove(report);
  assert.equal(read(dir, "CLAUDE.md"), md);
  assert.equal(read(dir, ".claude/settings.json"), settings);
  assert.ok(!existsSync(join(dir, ".claude/agents")), "empty agents folder is removed");
});

test("text after the section is kept too", () => {
  const dir = repo({ "CLAUDE.md": "# Lamp\n" });
  applyInit(planInit(dir));
  writeFileSync(join(dir, "CLAUDE.md"), read(dir, "CLAUDE.md") + "\n## Notes\nkeep me\n");
  applyRemove(planRemove(dir));
  assert.equal(read(dir, "CLAUDE.md"), "# Lamp\n\n## Notes\nkeep me\n");
});

test("an edited agent, your own agents and a different model are left alone", () => {
  const mine = "---\nname: docs\ndescription: my docs writer\n---\nmine\n";
  const dir = repo({ ".claude/agents/docs.md": mine });
  applyInit(planInit(dir));
  writeFileSync(join(dir, ".claude/agents/architect.md"), read(dir, ".claude/agents/architect.md") + "\nAlso check the ISR code.\n");
  writeFileSync(join(dir, ".claude/settings.json"), '{ "model": "opus" }\n');

  const report = planRemove(dir);
  assert.equal(kinds(report)[".claude/agents/architect.md"], "skipped");
  assert.equal(kinds(report)[".claude/agents/docs.md"], undefined);
  assert.equal(kinds(report)[".claude/settings.json"], undefined);
  applyRemove(report);
  assert.deepEqual(readdirSync(join(dir, ".claude/agents")).sort(), ["architect.md", "docs.md"]);
  assert.equal(read(dir, ".claude/agents/docs.md"), mine);
  assert.equal(read(dir, ".claude/settings.json"), '{ "model": "opus" }\n');
});

test("proposal files from a name clash are removed, the clashing agent stays", () => {
  const mine = "---\nname: search\ndescription: my finder\n---\nmine\n";
  const dir = repo({ ".claude/agents/finder.md": mine });
  applyInit(planInit(dir));
  assert.ok(existsSync(join(dir, ".claude/tankview/proposed/search.md")));
  applyRemove(planRemove(dir));
  assert.ok(!existsSync(join(dir, ".claude/tankview")));
  assert.deepEqual(readdirSync(join(dir, ".claude/agents")), ["finder.md"]);
});

test("files checked out with Windows line endings still count as unchanged", () => {
  const dir = repo();
  applyInit(planInit(dir));
  for (const f of readdirSync(join(dir, ".claude/agents"))) {
    const p = join(dir, ".claude/agents", f);
    writeFileSync(p, readFileSync(p, "utf8").replace(/\n/g, "\r\n"));
  }
  const report = planRemove(dir);
  assert.ok(report.actions.filter((a) => a.rel.startsWith(".claude/agents/")).every((a) => a.kind === "delete"));
});

test("a section under the old agents-monitor markers is removed as well", () => {
  const dir = repo({
    "CLAUDE.md": "# Lamp\n\n<!-- agents-monitor:orchestration:start -->\nold rules\n<!-- agents-monitor:orchestration:end -->\n",
  });
  applyRemove(planRemove(dir));
  assert.equal(read(dir, "CLAUDE.md"), "# Lamp\n");
});
