# ⚡ Live hooks

tankview works without any setup: it reads the transcripts Claude Code writes
to `~/.claude/projects`. Transcripts are only written when a message is
complete, though, so tankview has to infer some things:

| | Without hooks | With hooks |
|---|---|---|
| A tool that runs for minutes | can look stalled after 2 minutes | shown as running until it finishes |
| A subagent starting | appears when its first message is written | appears the moment it starts |
| Claude waiting for your permission | not visible | shown as `? waiting` |
| Tool failures | after the transcript catches up | immediately |

## Option 1: the plugin (recommended)

In Claude Code:

```
/plugin marketplace add thesolwind/tankview
/plugin install tankview@tankview
```

New and resumed sessions pick it up. The banner in tankview then shows
**hooks ● live**.

## Option 2: without plugins

The CLI can add the same hooks to a settings file:

```sh
npx tankview install-hooks              # ~/.claude/settings.json (all projects)
npx tankview install-hooks --project    # ./.claude/settings.local.json (this project)
npx tankview uninstall-hooks            # remove them again
```

It copies the recorder to `~/.claude/tankview/record.mjs` first, because
`npx` runs from a temporary cache. It saves a backup as `settings.json.bak`,
leaves your own hooks alone, and is safe to run twice.

Use one option or the other, not both, or every event is recorded twice.

## What gets recorded

The hooks run in the background (`"async": true`), so they never slow Claude
down. For each event they append one line to `~/.claude/tankview/events.jsonl`:

- **events**: session start and end, prompts, tool calls and their results,
  subagent start and stop, notifications, turn failures, compaction;
- **kept**: the session, agent and tool names and ids, and a short preview of
  each tool input (strings trimmed to 300 characters);
- **dropped**: tool output; only flags like "this failed" are kept.

The file is rotated at 50 MB. Nothing is sent anywhere.

[← Back to the README](../README.md)
