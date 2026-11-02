# 🏗️ The agent team guide

`tankview init` gives a repository a ready-made team of Claude Code
subagents, so each kind of work runs on a model that fits it:

| Agent | Model (default) | What it does | Can edit files? |
|---|---|---|---|
| main session | Sonnet | understands your request, writes the code, makes the decisions | yes |
| `search` | Haiku | explores the repository and maps how it fits together | no |
| `grep` | Haiku | finds usages, call sites, configuration references and tests | no |
| `logs` | Haiku | digs through long logs (device and serial output, builds, CI, crash dumps) and returns the lines that matter | no (instructed) |
| `docs` | Haiku | looks things up in library docs, API references, datasheets and on the web | no |
| `history` | Haiku | finds out why and when code changed, from git log and blame | no (instructed) |
| `test` | Haiku | builds the project, runs the relevant tests and explains failures | no (instructed) |
| `audit` | Haiku | reviews the diff for bugs and missing tests before work is done | no (instructed) |
| `architect` | Opus | reviews designs and risky changes, gives the final review | no |

Fast, cheap Haiku does the reading and checking, the main session does the
actual work, and the architect is called only when deeper reasoning pays off.
The main session decides when to delegate, following rules that `init` adds
to your `CLAUDE.md`. Small tasks are done directly, without any agents.

The helpers all follow one pattern: they read a lot (files, logs, docs,
history) and report back a short summary. Everything they read stays in their
own context, so the main session's context stays small.

## 🎛️ Choosing the models

Pick a preset:

| Preset | Main session | Helpers | Architect | When |
|---|---|---|---|---|
| `balanced` (default) | Sonnet | Haiku | Opus | good quality at a moderate cost |
| `quality` | Opus | Haiku | Fable | the strongest models where they matter most |

```sh
npx tankview init path/to/your-repo --preset quality
```

Or set any of the three yourself. Each takes `haiku`, `sonnet`, `opus`,
`fable`, or a full model id such as `claude-opus-5-5`, and overrides the
preset:

```sh
npx tankview init path/to/your-repo --main opus --architect fable
```

| Flag | Sets |
|---|---|
| `--main <model>` | the main session, in `.claude/settings.json` |
| `--scouts <model>` | every helper: `search`, `grep`, `logs`, `docs`, `history`, `test`, `audit` |
| `--architect <model>` | the `architect` |

Some things to know:

- **Cost.** Opus costs twice Sonnet per new input and output token, but long
  sessions are mostly cached input, which costs the same for both. In
  practice an Opus main session costs roughly a quarter to a half more. On a
  subscription you pay in usage limits instead: Opus uses them up faster.
- **Fable** is the most capable model and the most expensive. As the
  architect it only runs a few times on hard problems, but a deep review can
  take several minutes, and it isn't available on every plan. If Claude Code
  can't use it, run `init` again with `--architect opus`.
- **Switching later** is safe. Run `init` again with another preset or
  model: unedited agents are updated, and the main session's model is
  switched only if it's still the one tankview set.

## Step 1: preview

```sh
npx tankview init path/to/your-repo
```

This **changes nothing**. It inspects the repository and prints:

- what it found: an existing `CLAUDE.md`, agents and settings, and whether the project uses Spring;
- the files it would create or update;
- the exact content of every change, as a diff.

## Step 2: apply

```sh
npx tankview init path/to/your-repo --apply
```

This writes the files shown in the preview, and nothing else:

```
your-repo/
├── CLAUDE.md                  orchestration rules for the main session
└── .claude/
    ├── settings.json          "model" for the main session
    └── agents/
        ├── search.md
        ├── grep.md
        ├── logs.md
        ├── docs.md
        ├── history.md
        ├── test.md
        ├── audit.md
        └── architect.md
```

Then start Claude Code from the root of that repository with `claude`.

## Options

| Flag | What it does |
|---|---|
| *(none)* | Preview only: prints the plan and the diffs, writes nothing. |
| `--apply` | Writes the files from the preview. |
| `--preset <name>` | `balanced` (default) or `quality`; see [Choosing the models](#️-choosing-the-models). |
| `--main`, `--scouts`, `--architect <model>` | Sets one model, overriding the preset. |
| `--from <folder>` | Uses your own templates instead of the built-in ones. |

Without a path, the current folder is used.

## 🛡️ It never overwrites your setup

- **Your `CLAUDE.md`** stays as it is. One section is added between
  `tankview:orchestration` marker comments, and running `init` again updates
  only that section.
- **Your agents** are never replaced. An agent file is updated only if it's
  an unedited copy that tankview wrote (from this version or an earlier one).
  If an agent with the same name exists and you've written or edited it, the
  new version is saved to `.claude/tankview/proposed/` for you to merge by
  hand. (It can't go next to the original: two agents with the same name in
  one folder make Claude Code load one of them at random.)
- **Your `settings.json`** gets the main model only if it doesn't set a model
  yet, or if the model there is still the one tankview set. Everything else
  in it, formatting included, stays the same. If the file isn't valid JSON, it
  is left alone.
- It never runs git, commits, or touches your source code.
- Running it twice is safe: the second run reports everything as unchanged.

## ⬆️ Upgrading

When a new tankview version brings new or improved agents, run `init` again
on the repository. The preview shows which agents are updated and which are
new. Agents you've edited are left alone, and their new version goes to
`.claude/tankview/proposed/` for you to compare.

## 🧹 Removing it

`tankview remove` undoes `init`. Like `init`, it only previews unless you
add `--apply`:

```sh
npx tankview remove path/to/your-repo           # preview: changes nothing
npx tankview remove path/to/your-repo --apply   # make the changes
```

It takes out only what `init` added:

| What | What happens |
|---|---|
| Agent files | deleted if they're unedited tankview copies (any version, any model); an agent you edited is kept, and the preview says so |
| `CLAUDE.md` | the section between the `tankview:orchestration` markers is cut out, and the rest of your text stays exactly as it was; if nothing else is left, the file is deleted |
| `settings.json` | the main model `init` set is removed and the rest stays as it was; a model you changed since is kept; if the file would be empty, it's deleted |
| Proposal files | `.claude/tankview/proposed/` is deleted |
| Folders | `.claude/agents/` and `.claude/` are removed only if they end up empty |

Your own agents, and any other files in `.claude/`, are never touched. If
you set up the agents with `init --from <folder>`, pass the same
`--from <folder>` to `remove`, so it can recognize them.

One thing to know: `init` only sets the main model when none is set, but
`remove` can't tell whether you had set that same model yourself before
`init`. If you had, put it back after removing.

## ☕ Spring projects

When the repository uses Spring (a `springframework` dependency or
`@SpringBootApplication`), `architect` and `audit` get an extra checklist:
transaction boundaries, thread safety, N+1 queries, resource leaks, exception
handling, API compatibility, integration tests, dependency injection and
security. Other Java or Kotlin code, such as an Android app, doesn't get it.

## 🎨 Your own templates

Copy the package's [`templates/`](../templates/) folder, change what you
like, and point `init` at it:

```sh
npx tankview init ./my-repo --from ./my-templates
```

The folder needs `agents/*.md` (one file per agent) and `claude-section.md`
(the rules added to `CLAUDE.md`). `java-spring.md` is optional; it's appended
to `architect.md` and `audit.md` in Spring projects.

In the templates, these placeholders are filled in from the preset and the
model flags: `{{main_model}}`, `{{scout_model}}`, `{{architect_model}}` (for
`model:` lines), and `{{main_name}}`, `{{scout_name}}`, `{{architect_name}}`
(display names such as "Opus", for text).

## ✅ Check that the right models are used

- The Claude Code startup header shows the main model and that it comes from
  `.claude/settings.json`; `/model` shows it too.
- Ask Claude: *"Which subagent types can you delegate to? List them with
  their models."* It should name the eight agents.
- `/tasks` shows each subagent's model while it runs, and so does every card
  in tankview: Haiku in blue, Sonnet in orange, Opus in purple, Fable in green.
- Start Claude Code from the folder that has `.claude/agents/`. A session
  started somewhere else (a parent folder, or a folder that was moved) won't
  find the agents or the rules.

## Why not worktree isolation for `audit`?

Claude Code can run a subagent in an isolated git worktree. But that worktree
starts from your default branch, not from your current changes, and git
commands that reach into your main checkout are blocked. An isolated `audit`
agent couldn't see the diff it's meant to review, so it runs in place, with
no editing tools.

[← Back to the README](../README.md)
