# 🏗️ The agent team guide

`tankview init` gives a repository a ready-made team of Claude Code
subagents, so each kind of work runs on a model that fits it:

| Agent | Model | What it does | Can edit files? |
|---|---|---|---|
| main session | Sonnet | understands your request, writes the code, makes the decisions | yes |
| `search` | Haiku | explores the repository and maps how it fits together | no |
| `grep` | Haiku | finds usages, call sites, configuration references and tests | no |
| `test` | Haiku | runs the relevant tests and explains failures | no (instructed) |
| `audit` | Haiku | reviews the diff for bugs and missing tests before work is done | no (instructed) |
| `architect` | Opus | reviews designs and risky changes, gives the final review | no |

Fast, cheap Haiku does the searching and checking, Sonnet does the actual
work, and Opus is called only when deeper reasoning pays off. Sonnet decides
when to delegate, following rules that `init` adds to your `CLAUDE.md`. Small
tasks are done directly, without any agents.

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
    ├── settings.json          "model": "sonnet" for the main session
    └── agents/
        ├── search.md
        ├── grep.md
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
| `--from <folder>` | Uses your own templates instead of the built-in ones. |

Without a path, the current folder is used.

## 🛡️ It never overwrites your setup

- **Your `CLAUDE.md`** stays as it is. One section is added between
  `tankview:orchestration` marker comments, and running `init` again updates
  only that section.
- **Your agents** are never replaced. If an agent with the same name already
  exists, the new version is saved to `.claude/tankview/proposed/` for you to
  merge by hand. (It can't go next to the original: two agents with the same
  name in one folder make Claude Code load one of them at random.)
- **Your `settings.json`** gets `"model": "sonnet"` only if it doesn't set a
  model yet. Everything else in it, formatting included, stays the same. If the
  file isn't valid JSON, it is left alone.
- It never runs git, commits, or touches your source code.
- Running it twice is safe: the second run reports everything as unchanged.

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
| Agent files | deleted if they still match tankview's template; an agent you edited is kept, and the preview says so |
| `CLAUDE.md` | the section between the `tankview:orchestration` markers is cut out, and the rest of your text stays exactly as it was; if nothing else is left, the file is deleted |
| `settings.json` | `"model": "sonnet"` is removed and the rest stays as it was; a different model is kept; if the file would be empty, it's deleted |
| Proposal files | `.claude/tankview/proposed/` is deleted |
| Folders | `.claude/agents/` and `.claude/` are removed only if they end up empty |

Your own agents, and any other files in `.claude/`, are never touched. If
you set up the agents with `init --from <folder>`, pass the same
`--from <folder>` to `remove`, so it can recognize them.

One thing to know: `init` only adds `"model": "sonnet"` when no model is set,
but `remove` can't tell whether you had set `"sonnet"` yourself before. If you
had, put it back after removing.

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

## ✅ Check that the right models are used

- The Claude Code startup header shows the main model and that it comes from
  `.claude/settings.json`; `/model` shows it too.
- Ask Claude: *"Which subagent types can you delegate to? List them with
  their models."* It should name the five agents.
- `/tasks` shows each subagent's model while it runs, and so does every card
  in tankview: Haiku in blue, Opus in purple.

## Why not worktree isolation for `audit`?

Claude Code can run a subagent in an isolated git worktree. But that worktree
starts from your default branch, not from your current changes, and git
commands that reach into your main checkout are blocked. An isolated `audit`
agent couldn't see the diff it's meant to review, so it runs in place, with
no editing tools.

[← Back to the README](../README.md)
