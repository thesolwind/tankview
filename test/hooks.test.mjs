// End-to-end: hook payloads -> plugin recorder -> events.jsonl -> Store state; plus the installer.
// Everything runs against a temporary CLAUDE_CONFIG_DIR.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const cfg = mkdtempSync(join(tmpdir(), "tankview-"));
process.env.CLAUDE_CONFIG_DIR = cfg; // must be set before the model module computes its paths
const { Store, EVENTS_FILE } = await import("../dist/model.js");
const { install, uninstall } = await import("../dist/install.js");

const RECORDER = new URL("../plugin/hooks/record.mjs", import.meta.url);
const transcript = join(cfg, "projects", "D--app", "demo.jsonl");

function hook(ev) {
  const payload = { session_id: "demo", transcript_path: transcript, cwd: "D:\\app", ...ev };
  execFileSync(process.execPath, [RECORDER.pathname.replace(/^\/(\w:)/, "$1")], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
  });
}

test("recorder clips payloads and keeps only flags of tool_response", () => {
  hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "x0", tool_input: { command: "y".repeat(1000) }, tool_response: { stdout: "big", is_error: false } });
  const line = JSON.parse(readFileSync(EVENTS_FILE, "utf8").trim().split("\n").at(-1));
  assert.equal(line.tool_input.command.length, 300);
  assert.deepEqual(line.tool_response, { is_error: false });
  assert.equal(typeof line.ts, "number");
});

test("hook events drive live subagent and session status", () => {
  hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "x0" });
  hook({ hook_event_name: "UserPromptSubmit", prompt: "fix the jwt clock skew bug" });
  for (const [i, id, type] of [[0, "a1", "search"], [1, "a2", "grep"], [2, "a3", "audit"]]) {
    hook({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_use_id: `m${i}`, tool_input: { description: type } });
    hook({ hook_event_name: "SubagentStart", agent_id: id, agent_type: type });
  }
  hook({ hook_event_name: "PreToolUse", agent_id: "a1", agent_type: "search", tool_name: "Glob", tool_use_id: "g1", tool_input: { pattern: "src/**/*.ts" } });
  hook({ hook_event_name: "PostToolUseFailure", agent_id: "a2", agent_type: "grep", tool_name: "Grep", tool_use_id: "g2", error: "regex parse error" });
  hook({ hook_event_name: "SubagentStop", agent_id: "a3", agent_type: "audit", last_assistant_message: "0 leaks" });

  const store = new Store(join(cfg, "projects"));
  store.refresh();
  const s = store.sessions.get("demo");
  assert.ok(s, "session created from hook events alone");
  assert.ok(store.hooksSeen);
  const status = (id) => s.agentStatus(s.subagents.get(id));
  assert.equal(status("a1"), "running");
  assert.equal(s.subagents.get("a1").currentTool, "Glob");
  assert.equal(status("a2"), "thinking");
  assert.equal(status("a3"), "done");
  assert.equal(s.agentStatus(s.main), "running"); // Agent tool calls still in flight

  hook({ hook_event_name: "Notification", message: "Claude needs your permission to use Bash" });
  store.refresh();
  assert.equal(s.agentStatus(s.main), "waiting");

  const kinds = s.log.map((e) => `${e.agent}:${e.kind}`);
  assert.ok(kinds.includes("grep:error"));
  assert.ok(kinds.includes("audit:done"));
  assert.ok(kinds.includes("main:prompt"));
  assert.equal(kinds.filter((k) => k === "search:spawn").length, 1);
});

test("transcript and hook report the same tool call once", () => {
  const store = new Store(join(cfg, "projects"));
  hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "dup1", tool_input: { file_path: "C:\\src\\jwt.ts" } });
  const rec = {
    type: "assistant", timestamp: new Date().toISOString(),
    message: { id: "msg1", model: "claude-sonnet-5-5", stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: "tool_use", id: "dup1", name: "Read", input: { file_path: "C:\\src\\jwt.ts" } }] },
  };
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, JSON.stringify(rec) + "\n");
  store.refresh();
  const s = store.sessions.get("demo");
  assert.equal(s.log.filter((e) => e.text === "Read").length, 1);
  assert.equal(s.main.toolCounts.get("Read"), 1);
  assert.equal(s.main.model, "claude-sonnet-5-5");
});

test("a subagent that finishes through SubagentHandback is done, not stalled", () => {
  const subDir = join(dirname(transcript), "demo", "subagents");
  mkdirSync(subDir, { recursive: true });
  const old = new Date(Date.now() - 10 * 60_000).toISOString(); // long past the stale threshold
  const lines = [
    { type: "assistant", timestamp: old, message: { id: "h1", model: "claude-opus-5-5", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "hb1", name: "SubagentHandback", input: { message: "## Verdict\napprove" } }] } },
    { type: "user", timestamp: old, message: { content: [{ type: "tool_result", tool_use_id: "hb1", content: "delivered" }] } },
  ];
  writeFileSync(join(subDir, "agent-hb.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const store = new Store(join(cfg, "projects"));
  store.refresh();
  const s = store.sessions.get("demo");
  const agent = s.subagents.get("hb");
  assert.equal(s.agentStatus(agent), "done");
  assert.equal(agent.lastText, "## Verdict\napprove");
  assert.ok(s.log.some((e) => e.kind === "done" && e.agent === agent.label));
});

test("install-hooks is idempotent, keeps user hooks, and uninstalls cleanly", () => {
  const settings = join(cfg, "settings.json");
  writeFileSync(settings, JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }));
  install();
  install();
  const after = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(after.hooks.Stop.length, 2);
  assert.equal(after.hooks.PreToolUse.length, 1);
  assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "node");
  assert.match(after.hooks.PreToolUse[0].hooks[0].args[0], /tankview\/record\.mjs$/);
  uninstall();
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), {
    theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] },
  });
});
