// Fallback for users without the plugin: add or remove the recorder hooks in settings.json.
// The recorder is copied to a stable path first, because npx runs from a temporary cache.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR } from "./model.js";

const PACKAGED_RECORDER = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "hooks", "record.mjs");
const INSTALLED_RECORDER = join(CONFIG_DIR, "tankview", "record.mjs");
// Identify our entries for uninstall, including ones installed before the rename to tankview.
const MARKERS = ["tankview/record.mjs", "agents-monitor/record.mjs"];

export const EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "Stop", "StopFailure",
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "SubagentStart", "SubagentStop", "Notification", "PreCompact",
];

type HookEntry = { type: string; command?: string; args?: string[]; [k: string]: unknown };
type HookGroup = { matcher?: string; hooks: HookEntry[] };
type Settings = { hooks?: Record<string, HookGroup[]>; [k: string]: unknown };

export function settingsPath(project: boolean): string {
  return project ? join(process.cwd(), ".claude", "settings.local.json") : join(CONFIG_DIR, "settings.json");
}

function load(path: string): Settings {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8").trim();
  return text ? JSON.parse(text) : {};
}

function save(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
}

function isOurs(h: HookEntry): boolean {
  return [h.command ?? "", ...(h.args ?? [])].some((part) => MARKERS.some((m) => part.replaceAll("\\", "/").includes(m)));
}

function stripOurs(hooks: Record<string, HookGroup[]>): void {
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event]
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length);
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
}

export function install(project = false): string {
  const path = settingsPath(project);
  const settings = load(path);
  if (existsSync(path)) copyFileSync(path, path + ".bak");
  mkdirSync(dirname(INSTALLED_RECORDER), { recursive: true });
  copyFileSync(PACKAGED_RECORDER, INSTALLED_RECORDER);

  const hooks = (settings.hooks ??= {});
  stripOurs(hooks);
  const recorder = INSTALLED_RECORDER.replaceAll("\\", "/");
  for (const event of EVENTS) {
    // Exec form: no shell, so paths with spaces need no quoting on any platform.
    (hooks[event] ??= []).push({ hooks: [{ type: "command", command: "node", args: [recorder], async: true }] });
  }
  save(path, settings);
  return path;
}

export function uninstall(project = false): string {
  const path = settingsPath(project);
  const settings = load(path);
  if (settings.hooks) {
    stripOurs(settings.hooks);
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
    save(path, settings);
  }
  return path;
}
