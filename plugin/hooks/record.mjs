#!/usr/bin/env node
// Claude Code hook recorder: appends each hook event to the monitor's event log.
// Runs as an async hook, so it never delays Claude. Plain JS, no dependencies,
// so it starts fast and needs no build step inside the plugin.

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EVENTS_DIR = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "tankview");
const EVENTS_FILE = join(EVENTS_DIR, "events.jsonl");
const ROTATE_BYTES = 50 * 1024 * 1024;
const MAX_STR = 300;

// Fields worth keeping; tool_response and other bulky payloads are reduced below.
const KEEP = [
  "session_id", "transcript_path", "cwd", "hook_event_name", "agent_id", "agent_type",
  "tool_name", "tool_use_id", "source", "model", "reason", "error", "prompt",
  "last_assistant_message", "agent_transcript_path", "notification_type", "message",
  "permission_mode", "effort", "session_title", "trigger",
];

function clip(value, limit = MAX_STR) {
  if (typeof value === "string") return value.length <= limit ? value : value.slice(0, limit - 1) + "…";
  if (Array.isArray(value)) return value.slice(0, 8).map((v) => clip(v, limit));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 12).map(([k, v]) => [k, clip(v, limit)]));
  }
  return value;
}

export function reduce(event) {
  const out = {};
  for (const key of KEEP) if (key in event) out[key] = clip(event[key]);
  if (event.tool_input && typeof event.tool_input === "object") out.tool_input = clip(event.tool_input);
  const resp = event.tool_response;
  if (resp && typeof resp === "object") {
    const flags = {};
    for (const k of ["is_error", "interrupted", "success", "exitCode"]) if (k in resp) flags[k] = resp[k];
    if (Object.keys(flags).length) out.tool_response = flags;
  }
  out.ts = Date.now() / 1000;
  return out;
}

function main(raw) {
  let event;
  try {
    event = JSON.parse(raw || "{}");
  } catch {
    return;
  }
  mkdirSync(EVENTS_DIR, { recursive: true });
  try {
    if (statSync(EVENTS_FILE).size > ROTATE_BYTES) renameSync(EVENTS_FILE, EVENTS_FILE.replace(/\.jsonl$/, ".1.jsonl"));
  } catch {}
  // One append per event, so concurrent hooks don't interleave lines.
  appendFileSync(EVENTS_FILE, JSON.stringify(reduce(event)) + "\n");
}

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  try {
    main(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // a monitoring hook must never surface errors into the session
  }
});
