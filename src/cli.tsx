#!/usr/bin/env node
import { render } from "ink";
import {
  applyInit, applyRemove, BUILTIN_TEMPLATES, checkModel, DEFAULT_PRESET, planInit, planRemove, PRESETS, renderReport,
} from "./init.js";
import { EVENTS, install, uninstall } from "./install.js";
import { EVENTS_FILE, Store } from "./model.js";
import { App } from "./ui.js";

const HELP = `tankview: operator console for Claude Code sessions and their subagents

Usage:
  tankview                     open the monitor
  tankview init [repo]         set up a team of subagents in a repository
                               (preview: prints the plan and diffs, writes nothing)
    --apply                    write the files
    --preset <name>            balanced (default): main sonnet, subagents haiku, architect opus
                               quality:            main opus,   subagents haiku, architect fable
    --main <model>             model for the main session      } haiku, sonnet, opus, fable,
    --scouts <model>           model for every other subagent  } or a full id such as
    --architect <model>        model for the architect         } claude-opus-5-5
    --from <folder>            use your own templates (agents/*.md, claude-section.md,
                               optional java-spring.md) instead of the built-in ones
  tankview remove [repo]       undo init: delete the agents it added (unless you edited
                               them), its CLAUDE.md section and the main model it set
                               (preview: prints the plan and diffs, changes nothing)
    --apply                    make the changes
    --from <folder>            the templates you used with init --from
  tankview install-hooks      add the live-feed hooks to ~/.claude/settings.json
  tankview uninstall-hooks     remove them
    --project                  use ./.claude/settings.local.json instead

The hooks make status updates instant. The easiest way to get them is the plugin,
from inside Claude Code:
  /plugin marketplace add thesolwind/tankview
  /plugin install tankview@tankview
`;

const [cmd, ...rest] = process.argv.slice(2);
const project = rest.includes("--project");

if (cmd === "init" || cmd === "remove") {
  try {
    // Flags that take a value; the repo is the first argument that is neither a flag nor a value.
    const valueFlags = cmd === "init" ? ["--from", "--preset", "--main", "--scouts", "--architect"] : ["--from"];
    const values: Record<string, string> = {};
    const used = new Set<number>();
    rest.forEach((a, i) => {
      if (!valueFlags.includes(a)) return;
      const v = rest[i + 1];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
      values[a] = v;
      used.add(i + 1);
    });
    const unknown = rest.find((a) => a.startsWith("--") && a !== "--apply" && !valueFlags.includes(a));
    if (unknown) throw new Error(`Unknown option for ${cmd}: ${unknown}`);
    const target = rest.find((a, i) => !a.startsWith("--") && !used.has(i)) ?? ".";
    const templates = values["--from"] ?? BUILTIN_TEMPLATES;

    let models = PRESETS[DEFAULT_PRESET];
    if (values["--preset"]) {
      models = PRESETS[values["--preset"]];
      if (!models) throw new Error(`--preset must be one of: ${Object.keys(PRESETS).join(", ")}`);
    }
    models = {
      main: checkModel(values["--main"] ?? models.main, "--main"),
      scouts: checkModel(values["--scouts"] ?? models.scouts, "--scouts"),
      architect: checkModel(values["--architect"] ?? models.architect, "--architect"),
    };
    const report = cmd === "init" ? planInit(target, templates, models) : planRemove(target, templates);
    const apply = rest.includes("--apply");
    if (apply) (cmd === "init" ? applyInit : applyRemove)(report);
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
