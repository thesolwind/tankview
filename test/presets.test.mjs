// Model presets, switching between them, and upgrading repos set up by tankview 0.1.x.

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "tv-cfg-")); // no user-level agents
const { planInit, applyInit, planRemove, applyRemove, PRESETS, checkModel } = await import("../dist/init.js");

const FIXTURE_V01 = new URL("./fixtures/v0.1/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const repo = () => mkdtempSync(join(tmpdir(), "tv-pre-"));
const read = (dir, p) => readFileSync(join(dir, p), "utf8");
const model = (dir, agent) => /^model: (.+)$/m.exec(read(dir, `.claude/agents/${agent}.md`))[1];
const kinds = (report) => Object.fromEntries(report.actions.map((a) => [a.rel, a.kind]));

/** A repo exactly as `tankview init --apply` 0.1.x left it. */
function v01Repo() {
  const dir = repo();
  cpSync(join(FIXTURE_V01, "agents"), join(dir, ".claude", "agents"), { recursive: true });
  const section = readFileSync(join(FIXTURE_V01, "claude-section.md"), "utf8").trim();
  writeFileSync(join(dir, "CLAUDE.md"), `<!-- tankview:orchestration:start -->\n${section}\n<!-- tankview:orchestration:end -->\n`);
  writeFileSync(join(dir, ".claude", "settings.json"), '{\n  "model": "sonnet"\n}\n');
  return dir;
}

test("quality preset: Opus main session, Haiku subagents, Fable architect", () => {
  const dir = repo();
  const report = planInit(dir, undefined, PRESETS.quality);
  assert.ok(report.findings.some((f) => /Fable isn't available on every plan/.test(f)));
  applyInit(report);
  assert.deepEqual(JSON.parse(read(dir, ".claude/settings.json")), { model: "opus" });
  assert.equal(model(dir, "architect"), "fable");
  for (const a of ["search", "grep", "logs", "docs", "history", "test", "audit"]) assert.equal(model(dir, a), "haiku");
  const md = read(dir, "CLAUDE.md");
  assert.match(md, /The main session \(Opus\)/);
  assert.match(md, /\| `architect` \| Fable \|/);
  assert.match(md, /<!-- tankview:main-model=opus -->/);
});

test("each model can be chosen, including full model ids; bad names are rejected", () => {
  const dir = repo();
  applyInit(planInit(dir, undefined, { main: "claude-opus-5-5", scouts: "sonnet", architect: "opus" }));
  assert.deepEqual(JSON.parse(read(dir, ".claude/settings.json")), { model: "claude-opus-5-5" });
  assert.equal(model(dir, "logs"), "sonnet");
  assert.match(read(dir, "CLAUDE.md"), /The main session \(claude-opus-5-5\)/);
  assert.throws(() => checkModel("gpt-4", "--main"), /--main must be one of/);
  assert.equal(checkModel("fable", "--architect"), "fable");
});

test("switching presets updates unedited agents and the model tankview set, never your edits", () => {
  const dir = repo();
  applyInit(planInit(dir)); // balanced
  writeFileSync(join(dir, ".claude/agents/audit.md"), read(dir, ".claude/agents/audit.md") + "\nAlso check ISR safety.\n");

  const report = planInit(dir, undefined, PRESETS.quality);
  const k = kinds(report);
  assert.equal(k[".claude/agents/architect.md"], "update");
  assert.equal(k[".claude/agents/search.md"], "unchanged"); // haiku in both presets
  assert.equal(k[".claude/tankview/proposed/audit.md"], "conflict");
  assert.equal(k[".claude/settings.json"], "update");
  applyInit(report);
  assert.equal(model(dir, "architect"), "fable");
  assert.match(read(dir, ".claude/agents/audit.md"), /Also check ISR safety/);
  assert.deepEqual(JSON.parse(read(dir, ".claude/settings.json")), { model: "opus" });

  // A model you set yourself afterwards is yours: init leaves it alone.
  writeFileSync(join(dir, ".claude/settings.json"), '{ "model": "fable" }\n');
  assert.equal(kinds(planInit(dir))[".claude/settings.json"], "skipped");
});

test("upgrading a 0.1.x setup: old agents are updated, new ones added, nothing proposed", () => {
  const dir = v01Repo();
  const report = planInit(dir);
  const k = kinds(report);
  // architect and test changed their text in this version; the others only got a model placeholder,
  // so once it's filled in they are identical to 0.1.x.
  for (const a of ["architect", "test"]) assert.equal(k[`.claude/agents/${a}.md`], "update", a);
  for (const a of ["audit", "grep", "search"]) assert.equal(k[`.claude/agents/${a}.md`], "unchanged", a);
  for (const a of ["docs", "history", "logs"]) assert.equal(k[`.claude/agents/${a}.md`], "create", a);
  assert.equal(k["CLAUDE.md"], "update");
  assert.equal(k[".claude/settings.json"], "unchanged");
  assert.ok(!Object.keys(k).some((p) => p.includes("proposed")));
  applyInit(report);
  assert.match(read(dir, ".claude/agents/test.md"), /Build and test runner/);
  assert.match(read(dir, "CLAUDE.md"), /\| `logs` \| Haiku \|/);
  assert.ok(planInit(dir).actions.every((a) => a.kind === "unchanged"));
});

test("upgrading 0.1.x straight to the quality preset switches the main model it set", () => {
  const dir = v01Repo();
  applyInit(planInit(dir, undefined, PRESETS.quality));
  assert.deepEqual(JSON.parse(read(dir, ".claude/settings.json")), { model: "opus" });
  assert.equal(model(dir, "architect"), "fable");
});

test("remove works for any preset and for 0.1.x setups", () => {
  const quality = repo();
  applyInit(planInit(quality, undefined, PRESETS.quality));
  applyRemove(planRemove(quality));
  assert.deepEqual(readdirSync(quality), []);

  const old = v01Repo();
  applyRemove(planRemove(old));
  assert.deepEqual(readdirSync(old), []);
});

test("remove keeps a main model you changed after init", () => {
  const dir = repo();
  applyInit(planInit(dir, undefined, PRESETS.quality)); // sets opus
  writeFileSync(join(dir, ".claude/settings.json"), '{\n  "model": "sonnet",\n  "env": { "A": "1" }\n}\n');
  const report = planRemove(dir);
  assert.equal(kinds(report)[".claude/settings.json"], undefined);
  applyRemove(report);
  assert.ok(existsSync(join(dir, ".claude/settings.json")));
  assert.equal(JSON.parse(read(dir, ".claude/settings.json")).model, "sonnet");
});
