# 📊 Reading the numbers

## Tokens

- **read** is how much text a model took in, added up over all its requests.
  An agent works in a loop: every tool call is a new request that re-sends the
  conversation so far, so this number grows fast.
  - **cached** is the part re-read from the prompt cache, at a fraction of
    the normal input price. It's usually most of it.
  - **new** is input seen for the first time.
- **wrote** is what the model generated: answers, tool calls and reasoning.

## Context

**main context** is the size of the main session's conversation, shown as a
bar against its context window. Subagents read in their own separate context,
and only their final summaries come back to the main session. That's what
keeps the main context small, and it's the main reason to delegate.

## Subagent cards

- The **bar** is the agent's share of everything the subagents in this
  session wrote. It is not a progress estimate; Claude Code doesn't report
  progress.
- **Status**:

  | | |
  |---|---|
  | `● running` | a tool is running |
  | `◐ thinking` | the model is working on its next step |
  | `? waiting` | Claude is waiting for you, for example a permission prompt (needs the hooks) |
  | `✓ done` | the agent has finished and handed its result back |
  | `! stalled` | nothing has happened for a while; it may have been interrupted |

## 💸 Cost estimate

Press `$` to show an estimate per agent, per subagent group and per session.
It uses Anthropic API list prices for each model, per million tokens:

| Model | Input | Output | Cached read |
|---|---|---|---|
| Opus 5.5 | $4 | $20 | $0.20 |
| Sonnet 5.5 | $2 | $10 | $0.20 |
| Haiku 5.5 | $0.10 | $0.50 | $0.01 |

Writing to the prompt cache costs 1.25× the input price (2× for the
one-hour cache), and Haiku 5.5 costs more for prompts over 100k tokens. Each
API request is priced with the model that answered it.

It's an estimate: prices change, and subscription plans aren't billed per
token at all. It's most useful for comparing, for example how much of a
session went to the Opus architect versus the Haiku scouts.

## Lines changed

`patch +120 -2` counts the lines in the main session's `Edit` and `Write`
calls. It isn't read from git, so it can differ from your final diff.

[← Back to the README](../README.md)
