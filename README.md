# tankview

[![npm version](https://img.shields.io/npm/v/tankview)](https://www.npmjs.com/package/tankview)
![status: beta](https://img.shields.io/badge/status-beta-orange)

**An operator console for Claude Code.** See every session and subagent at
work in real time: which model each one runs on, what tool it's using right
now, how much it has read and written, and what it costs.

And when you want your own agent team, one command gives any repository a
Sonnet + Haiku + Opus setup: cheap, fast agents for searching and checking,
and a senior architect for the hard calls.

```sh
npx tankview
```

> ⚠️ **Early beta.** tankview is new, and things will change: commands, the
> agent templates and what the console shows. It reads Claude Code's transcript
> files, which aren't a stable public format, so a Claude Code update can break
> parts of it. The console only reads files, but `tankview init --apply`
> writes to your repository: run the preview first, and commit or back up
> before applying. Found a problem? Please
> [open an issue](https://github.com/thesolwind/tankview/issues).

![tankview watching a Claude Code session: the main Sonnet session, two Haiku agents done, a Haiku test run and an Opus design review in progress, and a live log of every tool call](https://raw.githubusercontent.com/thesolwind/tankview/main/docs/screenshot.png)

*Named after Tank, the operator in The Matrix: the one at the screens,
watching everyone inside, agents included.*

## ✨ Why tankview

- 👀 **See your subagents work**: a live card for each one, with its model, status, current tool and progress in tokens
- 🧠 **Know which model did what**: Haiku, Sonnet and Opus each in their own color, so you can see whether the cheap model really did the cheap work
- 💸 **Optional cost estimate**: press `$` for an estimate per agent and per session
- 📜 **One timeline**: every tool call, error and handoff from the main session and all its subagents in one log
- 🏗️ **Agent team in one command**: `tankview init` sets up Haiku scouts and an Opus architect in any repo, and never overwrites your setup
- ⚡ **Works with zero setup**: it reads the transcripts Claude Code already writes; add the plugin for instant updates
- 🔒 **Local only**: reads files on your machine, makes no network requests

## Install

```sh
npm install -g tankview
```

Or run it without installing: `npx tankview`.

Node 22+. Nothing else to install.

## Use

```sh
tankview                          # open the console; follows your most active session
tankview init ./my-repo           # preview an agent team for a repo (changes nothing)
tankview init ./my-repo --apply   # ...and set it up
```

Open tankview in a terminal next to your Claude Code session. It picks up
new sessions and subagents by itself.

## 🏗️ An agent team for your repo

`tankview init` adds five subagents and the rules for using them:

| Agent | Model | Job |
|---|---|---|
| main session | Sonnet | writes the code and makes the decisions |
| `search` | Haiku | explores the repo and maps how it fits together |
| `grep` | Haiku | finds usages, call sites, config references and tests |
| `test` | Haiku | runs the relevant tests and explains failures |
| `audit` | Haiku | reviews the diff before the work is called done |
| `architect` | Opus | reviews designs and risky changes |

Without `--apply` it only shows what it would do, as diffs. It never
overwrites your agents, your `CLAUDE.md` or your settings, and it adds a
Spring checklist when the project uses Spring.

📖 See **[the agent team guide](docs/init.md)** for what each file contains,
the safety rules, custom templates, and how to check the models in use.

## ⚡ Instant updates

Out of the box, tankview works out what's happening from the transcript
files. For instant, exact statuses (tools still running, subagents starting
and stopping, Claude waiting for your permission), add the plugin in Claude
Code:

```
/plugin marketplace add thesolwind/tankview
/plugin install tankview@tankview
```

📖 See [how the live hooks work](docs/hooks.md), including setup without plugins.

## Keys

| | |
|---|---|
| `↑` `↓` / `j` `k` | pick a session (pins it) |
| `f` | follow the most active session again |
| `a` | live sessions only |
| `c` | number of card columns |
| `[` `]` | page through subagent cards |
| `$` | show / hide the cost estimate |
| `q` | quit |

## Learn more

| | |
|---|---|
| 🏗️ [The agent team guide](docs/init.md) | `tankview init`: the agents, the safety rules, custom templates |
| ⚡ [Live hooks](docs/hooks.md) | the plugin, `install-hooks`, and what gets recorded |
| 📊 [Reading the numbers](docs/numbers.md) | read, wrote, cached, context, and the cost estimate |

## 🔒 Privacy

tankview only reads local files: the transcripts in `~/.claude/projects` and,
with the plugin, `~/.claude/tankview/events.jsonl`. It makes no network
requests. The hook recorder keeps short previews of tool inputs and no tool
output.

## Development

```sh
npm install
npm test                          # build, then run the test suite
node dist/cli.js                  # run your checkout
npm run demo                      # print a made-up demo session as text
npm run screenshot                # regenerate docs/screenshot.png (needs Chrome or Edge)
node test/frame.mjs follow 170 48 # print one frame of your real sessions
claude plugin validate .          # check the plugin and marketplace manifests
```

`test/frame.mjs` renders the real UI into a fake terminal and prints the
frame, which is how the layout gets checked without a terminal.

## Known limits

- It's a beta (see the note at the top). Claude Code's transcript format isn't
  a public API, so a new Claude Code version can change what tankview can read.
- Without the hooks, statuses are inferred from the transcript files, so a
  long-running tool can briefly look stalled.
- The bar on a subagent card is its share of what all the subagents wrote,
  not a progress estimate: Claude Code doesn't report progress.
- The cost estimate uses API list prices. It doesn't apply to subscription
  plans, which aren't billed per token.
- The `test` and `audit` agents need Bash to run tests and `git diff`, so
  they stay read-only by instruction, not by a hard block.
- Line counts come from `Edit` and `Write` calls, not from git.

## License

[MIT](LICENSE)
