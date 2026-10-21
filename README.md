# tankview

**Operator console for Claude Code.** Watch your sessions and their subagents work in real time, see which model each one runs on and what it costs, and give any repository a ready-made Sonnet + Haiku + Opus agent team.

```
npx tankview
```

<!-- demo:start -->
```text
 TANKVIEW · operator console for Claude Code agents  ·  1 live session  ·  2 subagents working  ·  follow  ·  hooks …
 ■ opus   ■ sonnet   ■ haiku   ■ fable
╭────────────────────────────────────╮ ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
│ sessions (3)                       │ ╎ sonnet 5.5 · main session                                                   ╎
│ ● Add CSV export for orders        │ ╎ Add CSV export for orders   [ ● running ]   /home/dev/shop-api @ feature/c… ╎
│   shop-api · 4 sub · 1s            │ ╎ ▸ Agent Review export design                                                ╎
│ ○ Fix flaky checkout test          │ ╎ context ████░░░░░░░░░░░░░░░░ 42.3k/200.0k   wrote 5.8k · read 17.4k new + … ╎
│   shop-api · 1h                    │ ╎ calls 8  (Agent 4, Write 2, Read 1, Edit 1)   patch +120 -2 · 4 files   up… ╎
│ ○ Rewrite getting-started guide    │ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
│   docs-site · 1d                   │ » delegated to subagents · haiku 5.5, opus 5.5  [ 2/4 done ]  subagents read 2…
│                                    │ ╭─────────────────────────────────────╮╭─────────────────────────────────────╮
│                                    │ │ Map orders module                   ││ Find serializer usages              │
│                                    │ │ haiku 5.5  [ ✓ DONE ]               ││ haiku 5.5  [ ✓ DONE ]               │
│                                    │ │ ██████░░░░░░░░░░░░ wrote 1.6k       ││ ███░░░░░░░░░░░░░░░ wrote 870        │
│                                    │ │ search · depth 1                    ││ grep · depth 1                      │
│                                    │ │ ✓ 5 calls · 4 files                 ││ ✓ 2 calls · 0 files                 │
│                                    │ │ read 92.4k (89% cached) · 1m14s · … ││ read 25.0k (88% cached) · 53s · a2… │
│                                    │ ╰─────────────────────────────────────╯╰─────────────────────────────────────╯
│                                    │ ╭─────────────────────────────────────╮╭─────────────────────────────────────╮
│                                    │ │ Run order tests                     ││ Review export design                │
│                                    │ │ haiku 5.5  [ ● RUNNING ]            ││ opus 5.5  [ ◐ THINKING ]            │
│                                    │ │ ██░░░░░░░░░░░░░░░░ wrote 610        ││ ██████░░░░░░░░░░░░ wrote 1.5k       │
│                                    │ │ ▸ Bash npm test -- test/orders/exp… ││ ▸ Grep findAllOrders|stream\(       │
│                                    │ │ ✓ 4 calls · 1 file · 1 err          ││ ✓ 3 calls · 2 files                 │
│                                    │ │ read 40.3k (87% cached) · 4m01s · … ││ read 53.9k (80% cached) · 4m04s · … │
│                                    │ ╰─────────────────────────────────────╯╰─────────────────────────────────────╯
│                                    │
│                                    │ ╭─────────────────────────────────────────────────────────────────────────────╮
│                                    │ │ session log · live                                                          │
│                                    │ │ 16:03:29 Run order tests    prompt Run the order tests                      │
│                                    │ │ 16:03:30 Review export des… prompt Review the CSV export design             │
│                                    │ │ 16:03:38 Run order tests    tool   Glob  test/orders/**                     │
│                                    │ │ 16:03:42 Review export des… tool   Read  export.ts                          │
│                                    │ │ 16:03:58 Run order tests    tool   Bash  npm test -- test/orders            │
│                                    │ │ 16:04:13 Review export des… tool   Read  orders.repo.ts                     │
│                                    │ │ 16:04:58 Review export des… tool   Grep  findAllOrders|stream\(             │
│                                    │ │ 16:05:18 Run order tests    error  tool error  2 failed, 14 passed: export… │
│                                    │ │ 16:05:28 Run order tests    tool   Read  export.test.ts                     │
│                                    │ │ 16:07:30 Run order tests    tool   Bash  npm test -- test/orders/export.te… │
│                                    │ │ 16:07:35 main               spawn  Agent  Review export design              │
╰────────────────────────────────────╯ ╰─────────────────────────────────────────────────────────────────────────────╯
↑↓ session  f follow latest  a live only  c columns  $ cost  q quit
```
<!-- demo:end -->

*Named after Tank, the operator of the Nebuchadnezzar in The Matrix: the one at the screens, watching everyone inside, agents included.*

## Quick start

```
npx tankview
```

That's it. tankview reads the session transcripts Claude Code already writes to `~/.claude/projects`, so there is nothing to configure. Open it in a terminal next to your Claude Code session and it follows the most recently active session.

Requires Node 22 or later.

## What you see

- **Sessions**: every recent Claude Code session on this machine, live ones marked with a status icon.
- **Main session**: model, status, the tool it's running right now (or your last prompt), context usage, tokens, tool calls by type, lines changed.
- **Subagent cards**: one per subagent, with its model, status (running / thinking / waiting / done / stalled), current tool, calls, files, errors, duration and tokens.
- **Session log**: one timeline of the main session and all of its subagents: tool calls, messages, errors, spawns, finishes.
- **Cost** (press `$`): an estimate per agent and per session at API list prices.

## Give a repository its own agent team

`tankview init` adds a ready-made team of Claude Code subagents to any repository, so each kind of work runs on a model that fits it:

| Agent | Model | What it does | Can edit files? |
|---|---|---|---|
| main session | Sonnet | understands your request, writes the code, makes the decisions | yes |
| `search` | Haiku | explores the repository and maps how it fits together | no |
| `grep` | Haiku | finds usages, call sites, configuration references and tests | no |
| `test` | Haiku | runs the relevant tests and explains failures | no (instructed) |
| `audit` | Haiku | reviews the diff for bugs and missing tests before work is done | no (instructed) |
| `architect` | Opus | reviews designs and risky changes, gives the final review | no |

Fast, cheap Haiku does the searching and checking, Sonnet does the actual work, and Opus is called only when deeper reasoning pays off. Sonnet decides when to delegate, following rules that `init` adds to your `CLAUDE.md`.

### Step 1: preview

```
npx tankview init path/to/your-repo
```

This **changes nothing**. It inspects the repository and prints:

- what it found (an existing `CLAUDE.md`, agents and settings, and whether the project uses Spring);
- the files it would create or update;
- the exact content of every change, as a diff.

### Step 2: apply

```
npx tankview init path/to/your-repo --apply
```

This writes the files shown in the preview, and nothing else:

```
your-repo/
├── CLAUDE.md                  orchestration rules for the main session
└── .claude/
    ├── settings.json          "model": "sonnet" for the main session
    └── agents/
        ├── search.md
        ├── grep.md
        ├── test.md
        ├── audit.md
        └── architect.md
```

Then start Claude Code from the root of that repository with `claude`.

### Options

| Flag | What it does |
|---|---|
| *(none)* | Preview only: prints the plan and the diffs, writes nothing. |
| `--apply` | Writes the files from the preview. |
| `--from <folder>` | Uses your own templates instead of the built-in ones. The folder needs `agents/*.md` and `claude-section.md`; `java-spring.md` is optional. Copy the package's [`templates/`](templates/) folder to start. |

Without a path, the current folder is used.

### It never overwrites your setup

- **Your `CLAUDE.md`** stays as it is. One section is added between `tankview:orchestration` marker comments, and running `init` again updates only that section.
- **Your agents** are never replaced. If an agent with the same name already exists, the new version is saved to `.claude/tankview/proposed/` for you to merge by hand.
- **Your `settings.json`** gets `"model": "sonnet"` only if it doesn't set a model yet. Everything else in it, formatting included, stays the same. If the file isn't valid JSON, it is left alone.
- **Spring projects** (a `springframework` dependency or `@SpringBootApplication`) get an extra checklist in `architect` and `audit`: transactions, thread safety, N+1 queries and more.
- It never runs git, commits, or touches your source code. Running it twice is safe: the second run reports everything as unchanged.

### Check that the right models are used

- The Claude Code startup header shows the main model and that it comes from `.claude/settings.json`; `/model` shows it too.
- Ask Claude: "Which subagent types can you delegate to? List them with their models." It should name the five agents.
- `/tasks` shows each subagent's model while it runs, and so does every card in tankview.

## Instant updates with the plugin

Without setup, tankview infers what's happening from the transcript files. Install the plugin to make updates instant and statuses exact: tools that are still running, subagents starting and stopping, permission prompts waiting for you. In Claude Code, run:

```
/plugin marketplace add thesolwind/tankview
/plugin install tankview@tankview
```

The plugin registers background hooks that append each session, tool and subagent event to `~/.claude/tankview/events.jsonl`. They never slow Claude down. New and resumed sessions pick them up.

If you don't use plugins, the CLI can add the same hooks to your settings instead:

```
npx tankview install-hooks              # ~/.claude/settings.json
npx tankview install-hooks --project    # ./.claude/settings.local.json
npx tankview uninstall-hooks
```

Use one or the other, not both, or every event is recorded twice.

## Keys

| Key | Action |
|---|---|
| `↑` `↓` or `j` `k` | pick a session (pins it) |
| `f` | follow the most recently active session again |
| `a` | show only live sessions |
| `c` | change the number of card columns |
| `[` `]` | page through subagent cards |
| `$` | show or hide the estimated cost |
| `q` | quit |

## Reading the numbers

- **read** is how much text a model took in, added up over all its requests. Every tool call re-sends the conversation so far, so this grows fast.
  - **cached** is the part re-read from the prompt cache, at a fraction of the normal input price. It's usually most of it.
  - **new** is input seen for the first time.
- **wrote** is what the model generated: answers, tool calls and reasoning.
- **main context** is the size of the main session's conversation. Subagents read in their own separate context; only their final summaries come back to the main session, which is what keeps it small.
- The bar on a subagent card is its share of everything the subagents wrote. It is not a progress estimate; Claude Code doesn't report progress.
- **Cost** is an estimate at Anthropic API list prices for each model, including cache pricing. It doesn't apply to subscription plans, which aren't billed per token.
- Line counts come from the `Edit` and `Write` calls, not from git.

## Privacy

tankview only reads local files: the transcripts in `~/.claude/projects` and, with the plugin, `~/.claude/tankview/events.jsonl`. It makes no network requests and sends nothing anywhere. The hook recorder trims tool inputs to short previews and keeps no tool output.

## Development

```
npm install
npm test                          # build and run the test suite
node dist/cli.js                  # run the local build
npm run demo                      # render the demo frame above from a made-up session
node test/frame.mjs follow 170 48 # print one rendered frame of your real sessions
claude plugin validate .          # check the marketplace and plugin manifests
```

- `src/model.ts`: reads transcripts and hook events into session and agent state.
- `src/ui.tsx`: the terminal UI, built with [Ink](https://github.com/vadimdemedes/ink).
- `src/init.ts` and `templates/`: the `init` command and its agent templates.
- `src/install.ts`: `install-hooks` and `uninstall-hooks`.
- `plugin/`: the Claude Code plugin (`hooks/hooks.json` and the recorder `hooks/record.mjs`).

## License

[MIT](LICENSE)
