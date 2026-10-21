## Agent orchestration

The main session (Sonnet) understands the request, implements every code change, integrates subagent results and makes the final decisions. The subagents in `.claude/agents/` assist it:

| Agent | Model | Use for |
|---|---|---|
| `search` | Haiku | substantial repository exploration and architecture mapping |
| `grep` | Haiku | broad usage searches: call sites, implementations, configuration references, tests |
| `test` | Haiku | running targeted tests and analyzing failures |
| `audit` | Haiku | independent review of a diff before calling work done |
| `architect` | Opus | design review and final review of high-risk work |

Rules:
- Delegate only when the work is substantial. Do trivial lookups and edits directly; don't send several agents at a small task.
- Run independent read-only agents in parallel when that helps. Only the main session edits files, so no two agents ever modify the same files.
- Call `architect` (1) before complex architectural changes, (2) after the same problem survives two failed attempts, (3) before finishing significant refactors or high-risk changes. Skip it for small tasks.
- Ask subagents for concise summaries (findings, file paths, risks, next actions), never raw logs or whole files.
- Reuse what a subagent reported instead of re-reading the same files or repeating its investigation.
- Parallel agents don't automatically save tokens. Delegate for focus and independent work, not to shave a few tokens.
