#!/usr/bin/env node
import { render } from "ink";
import { applyInit, BUILTIN_TEMPLATES, planInit, renderReport } from "./init.js";
import { EVENTS, install, uninstall } from "./install.js";
import { EVENTS_FILE, Store } from "./model.js";
import { App } from "./ui.js";

const HELP = `tankview: operator console for Claude Code sessions and their subagents

Usage:
  tankview                     open the monitor
  tankview init [repo]         set up Sonnet/Haiku/Opus subagents in a repository
                               (preview: prints the plan and diffs, writes nothing)
    --apply                    write the files
    --from <folder>            use your own templates (agents/*.md, claude-section.md,
                               optional java-spring.md) instead of the built-in ones
  tankview install-hooks       add the live-feed hooks to ~/.claude/settings.json
  tankview uninstall-hooks     remove them
    --project                  use ./.claude/settings.local.json instead

The hooks make status updates instant. The easiest way to get them is the plugin,
from inside Claude Code:
  /plugin marketplace add thesolwind/tankview
  /plugin install tankview@tankview
`;

const [cmd, ...rest] = process.argv.slice(2);
const project = rest.includes("--project");

if (cmd === "init") {
  const fromIdx = rest.indexOf("--from");
  const from = fromIdx >= 0 ? rest[fromIdx + 1] : undefined;
  if (fromIdx >= 0 && !from) {
    console.error("--from needs a folder");
    process.exit(1);
  }
  // The repo is the first argument that is neither a flag nor the value of --from.
  const target = rest.find((a, i) => !a.startsWith("--") && !(fromIdx >= 0 && i === fromIdx + 1)) ?? ".";
  try {
    const report = planInit(target, from ?? BUILTIN_TEMPLATES);
    const apply = rest.includes("--apply");
    if (apply) applyInit(report);
    console.log(renderReport(report, { color: Boolean(process.stdout.isTTY), applied: apply }));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  }
} else if (cmd === "install-hooks") {
  const path = install(project);
  console.log(`Hooks added to ${path} (${EVENTS.length} events, async).`);
  console.log(`Events go to ${EVENTS_FILE}. New and resumed Claude Code sessions pick them up.`);
} else if (cmd === "uninstall-hooks") {
  console.log(`Hooks removed from ${uninstall(project)}.`);
} else if (cmd === "-h" || cmd === "--help" || cmd === "help") {
  console.log(HELP);
} else if (cmd) {
  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  process.exitCode = 1;
} else {
  render(<App store={new Store()} />, { exitOnCtrlC: true });
}
