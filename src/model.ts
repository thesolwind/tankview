// Reads Claude Code transcripts and the hook event log into live session/agent state.
//
// Layout on disk:
//   <projects>/<project-slug>/<session-id>.jsonl                      main thread
//   <projects>/<project-slug>/<session-id>/subagents/agent-<id>.jsonl  each subagent
//   <projects>/<project-slug>/<session-id>/subagents/agent-<id>.meta.json
//   <config>/tankview/events.jsonl                                    hook events (plugin)
// All of these are append-only, so each file is tailed from its last read offset.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
export const PROJECTS_DIR = join(CONFIG_DIR, "projects");
export const EVENTS_FILE = join(CONFIG_DIR, "tankview", "events.jsonl");

// A transcript untouched for this long is no longer considered live.
export const STALE_AFTER_MS = 120_000;
// A tool the hooks saw start but not finish counts as stuck after this long.
const TOOL_STALE_AFTER_MS = 30 * 60_000;
// On startup, replay only this much of the hook event log.
const EVENTS_BACKLOG_BYTES = 2 * 1024 * 1024;
const LOG_LIMIT = 2000;

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SPAWN_TOOLS = new Set(["Agent", "Task"]);
// A subagent can finish by handing its report back through this tool instead of a final answer.
const HANDBACK_TOOL = "SubagentHandback";

export type Status = "running" | "thinking" | "done" | "stalled" | "waiting" | "idle";
export type LogKind = "tool" | "text" | "error" | "spawn" | "done" | "prompt" | "notify";
type HookState = "" | "thinking" | "done" | "waiting" | "ended" | "started";

export interface LogEvent {
  ts: number; // ms since epoch
  agent: string;
  model: string;
  kind: LogKind;
  text: string;
  detail: string;
  seq: number;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}

export interface TokenDetail {
  fresh: number; // uncached input, billed at the full input price
  cacheWrite: number; // input written to the prompt cache (first time seen)
  cacheRead: number; // input re-read from the cache, billed at a fraction
  output: number;
}

// API list prices in $ per million tokens (Claude API, cached 2026-10-06).
// Prefixes are matched longest first, so "claude-opus-5-5" wins over "claude-opus-5".
interface Price {
  input: number;
  output: number;
  cacheRead?: number; // defaults to 0.1 × input
  longPrompt?: { over: number; input: number; output: number }; // tiered pricing above a prompt size
}
const PRICES: [string, Price][] = [
  ["claude-fable-5-1", { input: 10, output: 50, cacheRead: 0.25 }],
  ["claude-fable-5", { input: 10, output: 50 }],
  ["claude-mythos-5", { input: 10, output: 50 }],
  ["claude-opus-5-5", { input: 4, output: 20, cacheRead: 0.2 }],
  ["claude-opus-5", { input: 5, output: 25 }],
  ["claude-opus-4", { input: 5, output: 25 }],
  ["claude-sonnet-5-5", { input: 2, output: 10, cacheRead: 0.2 }],
  ["claude-sonnet-5", { input: 2, output: 10 }],
  ["claude-sonnet-4-6", { input: 3, output: 15 }],
  ["claude-haiku-5-5", { input: 0.1, output: 0.5, longPrompt: { over: 100_000, input: 0.5, output: 2.5 } }],
  ["claude-haiku-4-5", { input: 1, output: 5 }],
].sort((a, b) => (b[0] as string).length - (a[0] as string).length) as [string, Price][];

function priceFor(model: string): Price | null {
  return PRICES.find(([prefix]) => model.startsWith(prefix))?.[1] ?? null;
}

/** Estimated API cost of one message's usage in dollars, or null for an unknown model. */
function messageCost(model: string, u: Usage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const fresh = u.input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const tier = p.longPrompt && fresh + write + read > p.longPrompt.over ? p.longPrompt : p;
  // Cache writes: 1.25× input for the 5-minute cache, 2× for the 1-hour cache.
  const write1h = Math.min(write, u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const writeCost = (write - write1h) * tier.input * 1.25 + write1h * tier.input * 2;
  const readPrice = tier === p ? p.cacheRead ?? p.input * 0.1 : tier.input * 0.1;
  return (fresh * tier.input + writeCost + read * readPrice + (u.output_tokens ?? 0) * tier.output) / 1_000_000;
}

// Loosely typed JSON records: transcripts and hook payloads are not a stable public schema.
type Rec = Record<string, any>;

export class Agent {
  name = "";
  agentType = "";
  description = "";
  parentId: string | null = null;
  depth = 0;
  model = "";
  started: number | null = null;
  lastTs: number | null = null;
  stopReason: string | null = null;
  lastKind: "" | "user" | "assistant" = "";
  currentTool = "";
  currentDetail = "";
  toolCounts = new Map<string, number>();
  errors = 0;
  files = new Set<string>();
  linesAdded = 0;
  linesRemoved = 0;
  lastText = "";
  // usage per API message id (records of one message repeat its usage), with the model that produced it
  usage = new Map<string, Usage>();
  usageModel = new Map<string, string>();
  lastContext = 0;
  handedBack = false;
  metaLoaded = false;
  // Live state from hooks, plus tools in flight: tool_use_id -> [name, detail, ts]
  hookState: HookState = "";
  hookTs = 0;
  inflight = new Map<string, [string, string, number]>();

  constructor(public id: string) {}

  get label(): string {
    return this.name || this.description || this.agentType || this.id.slice(0, 8);
  }

  get toolCalls(): number {
    let n = 0;
    for (const v of this.toolCounts.values()) n += v;
    return n;
  }

  /** [fresh input, cache read, output] summed over messages. */
  tokens(): [number, number, number] {
    let i = 0, c = 0, o = 0;
    for (const u of this.usage.values()) {
      i += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      c += u.cache_read_input_tokens ?? 0;
      o += u.output_tokens ?? 0;
    }
    return [i, c, o];
  }

  tokenDetail(): TokenDetail {
    const d: TokenDetail = { fresh: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    for (const u of this.usage.values()) {
      d.fresh += u.input_tokens ?? 0;
      d.cacheWrite += u.cache_creation_input_tokens ?? 0;
      d.cacheRead += u.cache_read_input_tokens ?? 0;
      d.output += u.output_tokens ?? 0;
    }
    return d;
  }

  /** Estimated cost at API list prices; null when no message used a known model. */
  cost(): number | null {
    let total: number | null = null;
    for (const [id, u] of this.usage) {
      const c = messageCost(this.usageModel.get(id) ?? this.model, u);
      if (c !== null) total = (total ?? 0) + c;
    }
    return total;
  }

  status(mtime: number, now = Date.now()): Status {
    if (this.hookTs && (this.lastTs === null || this.hookTs >= this.lastTs - 1000)) {
      // Hooks saw something at least as recent as the transcript: trust them.
      // A permission/input prompt blocks everything, even tools in flight.
      if (this.hookState === "waiting") return "waiting";
      if (this.inflight.size) {
        const oldest = Math.min(...[...this.inflight.values()].map((v) => v[2]));
        return now - oldest < TOOL_STALE_AFTER_MS ? "running" : "stalled";
      }
      if (this.hookState === "thinking") {
        return now - Math.max(this.hookTs, mtime) < STALE_AFTER_MS ? "thinking" : "stalled";
      }
      if (this.hookState === "done") return "done";
      if (this.hookState === "ended" || this.hookState === "started") return "idle";
    }
    const live = now - mtime < STALE_AFTER_MS;
    if (this.handedBack) return "done";
    if (this.lastKind === "assistant" && this.stopReason === "end_turn") return "done";
    if (this.lastKind === "assistant" && (this.stopReason === null || this.stopReason === "tool_use")) {
      return live ? "running" : "stalled";
    }
    if (this.lastKind === "user") return live ? "thinking" : "stalled";
    return "idle";
  }
}

export class Session {
  title = "";
  lastPrompt = "";
  cwd = "";
  branch = "";
  main = new Agent("main");
  subagents = new Map<string, Agent>();
  log: LogEvent[] = [];
  logSeq = 0;
  mtimes = new Map<string, number>(); // agent id -> file mtime ("hook" -> last hook event)
  private offsets = new Map<string, number>();
  private logged = new Set<string>(); // dedup keys shared by transcript and hook events

  constructor(public id: string, public project: string, public path: string) {
    this.main.name = "main";
  }

  get mtime(): number {
    let m = 0;
    for (const v of this.mtimes.values()) m = Math.max(m, v);
    return m;
  }

  get isLive(): boolean {
    return Date.now() - this.mtime < STALE_AFTER_MS;
  }

  agentStatus(agent: Agent): Status {
    return agent.status(this.mtimes.get(agent.id) ?? 0);
  }

  // ---- loading ---------------------------------------------------------

  /** Read whatever was appended since the last call. Returns true if anything changed. */
  refresh(): boolean {
    let changed = this.tail(this.path, this.main);
    const subDir = join(this.path.replace(/\.jsonl$/, ""), "subagents");
    let names: string[] = [];
    try {
      names = readdirSync(subDir);
    } catch {
      return changed;
    }
    for (const f of names.sort()) {
      const m = /^agent-(.+)\.jsonl$/.exec(f);
      if (!m) continue;
      const agent = this.subagent(m[1]);
      if (!agent.metaLoaded) changed = this.loadMeta(agent, join(subDir, `agent-${m[1]}.meta.json`)) || changed;
      changed = this.tail(join(subDir, f), agent) || changed;
    }
    return changed;
  }

  private subagent(id: string, agentType = ""): Agent {
    let agent = this.subagents.get(id);
    if (!agent) {
      agent = new Agent(id);
      agent.agentType = agentType;
      agent.depth = 1;
      this.subagents.set(id, agent);
    }
    return agent;
  }

  private loadMeta(agent: Agent, metaPath: string): boolean {
    let meta: Rec;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      return false;
    }
    agent.name = meta.name ?? agent.name;
    agent.agentType = meta.agentType ?? agent.agentType;
    agent.description = meta.description ?? agent.description;
    agent.parentId = meta.parentAgentId ?? null;
    agent.depth = meta.spawnDepth ?? agent.depth;
    agent.metaLoaded = true;
    return true;
  }

  private tail(path: string, agent: Agent): boolean {
    let size: number;
    try {
      const st = statSync(path);
      this.mtimes.set(agent.id, st.mtimeMs);
      size = st.size;
    } catch {
      return false;
    }
    const offset = this.offsets.get(path) ?? 0;
    if (size <= offset) return false;
    const lines = readNewLines(path, offset, size);
    if (!lines) return false;
    this.offsets.set(path, offset + lines.consumed);
    for (const raw of lines.lines) {
      const rec = parseJson(raw);
      if (rec) this.apply(rec, agent);
    }
    return true;
  }

  // ---- transcript records ------------------------------------------------

  private apply(rec: Rec, agent: Agent): void {
    const type = rec.type;
    if (type === "ai-title") {
      this.title = rec.aiTitle ?? this.title;
      return;
    }
    if (type === "last-prompt") {
      this.lastPrompt = rec.lastPrompt ?? this.lastPrompt;
      return;
    }
    if (type !== "user" && type !== "assistant") return;

    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      agent.started ??= ts;
      agent.lastTs = ts;
    }
    this.cwd = rec.cwd ?? this.cwd;
    this.branch = rec.gitBranch ?? this.branch;
    const msg: Rec = rec.message ?? {};
    const when = Number.isNaN(ts) ? Date.now() : ts;
    if (type === "assistant") this.applyAssistant(agent, msg, when);
    else if (!rec.isMeta) this.applyUser(agent, msg.content, when);
  }

  private applyAssistant(agent: Agent, msg: Rec, ts: number): void {
    agent.lastKind = "assistant";
    agent.stopReason = msg.stop_reason ?? null;
    if (msg.model && !String(msg.model).startsWith("<")) agent.model = msg.model;
    const usage: Usage | undefined = msg.usage;
    if (usage && msg.id) {
      agent.usage.set(msg.id, usage);
      if (agent.model) agent.usageModel.set(msg.id, agent.model);
      agent.lastContext =
        (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content as Rec[]) {
        if (block.type === "tool_use") {
          const name: string = block.name ?? "?";
          const input: Rec = block.input ?? {};
          agent.toolCounts.set(name, (agent.toolCounts.get(name) ?? 0) + 1);
          agent.currentTool = name;
          agent.currentDetail = summarizeInput(input);
          this.trackFiles(agent, name, input);
          if (name === HANDBACK_TOOL && agent !== this.main) {
            agent.handedBack = true;
            agent.currentTool = "";
            agent.currentDetail = "";
            if (typeof input.message === "string") agent.lastText = input.message;
            this.push(ts, agent, "done", "finished", `${agent.toolCalls} tool calls`, `done:${agent.id}`);
            continue;
          }
          this.push(ts, agent, SPAWN_TOOLS.has(name) ? "spawn" : "tool", name, agent.currentDetail, `tool:${block.id ?? ""}`);
        } else if (block.type === "text" && String(block.text ?? "").trim()) {
          agent.lastText = String(block.text).trim();
          this.push(ts, agent, "text", firstLine(agent.lastText, 160));
        }
      }
    }
    if (agent.stopReason === "end_turn") {
      agent.currentTool = "";
      agent.currentDetail = "";
      if (agent !== this.main) {
        this.push(ts, agent, "done", "finished", `${agent.toolCalls} tool calls`, `done:${agent.id}`);
      }
    }
  }

  private applyUser(agent: Agent, content: unknown, ts: number): void {
    agent.lastKind = "user";
    if (typeof content === "string") {
      this.pushPrompt(ts, agent, content);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content as Rec[]) {
      if (block.type === "tool_result" && block.is_error) {
        agent.errors += 1;
        this.push(ts, agent, "error", "tool error", firstLine(resultText(block), 140), `err:${block.tool_use_id ?? ""}`);
      } else if (block.type === "text" && agent === this.main) {
        this.pushPrompt(ts, agent, String(block.text ?? ""));
      }
    }
  }

  private pushPrompt(ts: number, agent: Agent, text: string): void {
    text = text.trim();
    if (text && !text.startsWith("<")) this.push(ts, agent, "prompt", firstLine(text, 160), "", `prompt:${text.slice(0, 200)}`);
  }

  private trackFiles(agent: Agent, name: string, input: Rec): void {
    const path = input.file_path ?? input.notebook_path;
    if (FILE_TOOLS.has(name) && path) agent.files.add(path);
    if (name === "Edit") {
      agent.linesRemoved += countLines(input.old_string);
      agent.linesAdded += countLines(input.new_string);
    } else if (name === "Write") {
      agent.linesAdded += countLines(input.content);
    }
  }

  // ---- hook events ---------------------------------------------------------

  applyHook(ev: Rec): void {
    const name: string = ev.hook_event_name ?? "";
    const ts = typeof ev.ts === "number" ? ev.ts * 1000 : Date.now();
    this.mtimes.set("hook", Math.max(this.mtimes.get("hook") ?? 0, ts));
    this.cwd = ev.cwd ?? this.cwd;
    if (ev.session_title) this.title = ev.session_title;

    const agent = ev.agent_id ? this.subagent(ev.agent_id, ev.agent_type ?? "") : this.main;
    agent.hookTs = Math.max(agent.hookTs, ts);
    const toolId: string = ev.tool_use_id ?? "";

    switch (name) {
      case "PreToolUse": {
        const tool: string = ev.tool_name ?? "?";
        const detail = summarizeInput(ev.tool_input ?? {});
        agent.inflight.set(toolId, [tool, detail, ts]);
        agent.currentTool = tool;
        agent.currentDetail = detail;
        agent.hookState = "thinking";
        this.push(ts, agent, SPAWN_TOOLS.has(tool) ? "spawn" : "tool", tool, detail, `tool:${toolId}`);
        break;
      }
      case "PostToolUse":
      case "PostToolUseFailure": {
        agent.inflight.delete(toolId);
        agent.hookState = "thinking";
        const last = [...agent.inflight.values()].at(-1);
        if (last) [agent.currentTool, agent.currentDetail] = last;
        if (name === "PostToolUseFailure") {
          const err = String(ev.error ?? ev.tool_name ?? "");
          this.push(ts, agent, "error", "tool error", firstLine(err, 140), `err:${toolId}`);
        }
        break;
      }
      case "SubagentStart":
        agent.hookState = "thinking";
        this.push(ts, agent, "spawn", "subagent started", agent.agentType, `start:${agent.id}`);
        break;
      case "SubagentStop":
        agent.hookState = "done";
        agent.inflight.clear();
        if (ev.last_assistant_message) agent.lastText = ev.last_assistant_message;
        this.push(ts, agent, "done", "finished", `${agent.toolCalls} tool calls`, `done:${agent.id}`);
        break;
      case "UserPromptSubmit":
        agent.hookState = "thinking";
        this.pushPrompt(ts, agent, String(ev.prompt ?? ""));
        break;
      case "Stop":
        agent.hookState = "done";
        agent.inflight.clear();
        break;
      case "StopFailure":
        agent.hookState = "done";
        agent.inflight.clear();
        this.push(ts, agent, "error", "turn failed", firstLine(String(ev.error ?? ""), 140));
        break;
      case "Notification":
        agent.hookState = "waiting";
        this.push(ts, agent, "notify", firstLine(String(ev.message ?? "notification"), 160));
        break;
      case "SessionStart":
        agent.hookState = "started";
        if (ev.model && !agent.model) agent.model = ev.model;
        this.push(ts, agent, "notify", `session ${ev.source ?? "start"}`);
        break;
      case "SessionEnd":
        agent.hookState = "ended";
        agent.inflight.clear();
        this.push(ts, agent, "notify", `session ended (${ev.reason ?? ""})`);
        break;
      case "PreCompact":
        this.push(ts, agent, "notify", "compacting context");
        break;
    }
  }

  private push(ts: number, agent: Agent, kind: LogKind, text: string, detail = "", key?: string): void {
    // Keys ending in ":" carry no id and are not deduplicated.
    if (key && !key.endsWith(":")) {
      if (this.logged.has(key)) return;
      this.logged.add(key);
    }
    this.logSeq += 1;
    this.log.push({ ts, agent: agent.label, model: agent.model, kind, text, detail, seq: this.logSeq });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }
}

/** All sessions under PROJECTS_DIR plus the hook event log, refreshed incrementally. */
export class Store {
  sessions = new Map<string, Session>();
  lastHookTs = 0;
  private eventsOffset: number | null = null;

  constructor(
    private root = PROJECTS_DIR,
    private maxSessions = 40,
    private eventsPath = EVENTS_FILE,
  ) {}

  get hooksSeen(): boolean {
    return this.lastHookTs > 0;
  }

  /** Rescan and tail; returns ids of sessions that changed. */
  refresh(): Set<string> {
    const files: [number, string][] = [];
    let projects: string[] = [];
    try {
      projects = readdirSync(this.root);
    } catch {}
    for (const project of projects) {
      let entries: string[];
      try {
        entries = readdirSync(join(this.root, project));
      } catch {
        continue;
      }
      for (const f of entries) {
        if (!f.endsWith(".jsonl")) continue;
        const path = join(this.root, project, f);
        try {
          files.push([statSync(path).mtimeMs, path]);
        } catch {}
      }
    }
    files.sort((a, b) => b[0] - a[0]);
    const changed = new Set<string>();
    for (const [, path] of files.slice(0, this.maxSessions)) {
      const sid = basename(path, ".jsonl");
      let session = this.sessions.get(sid);
      if (!session) {
        session = new Session(sid, basename(dirname(path)), path);
        this.sessions.set(sid, session);
      }
      if (session.refresh()) changed.add(sid);
    }
    this.tailEvents(changed);
    return changed;
  }

  ordered(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.mtime - a.mtime);
  }

  private tailEvents(changed: Set<string>): void {
    let size: number;
    try {
      size = statSync(this.eventsPath).size;
    } catch {
      return;
    }
    let skipPartial = false;
    if (this.eventsOffset === null) {
      this.eventsOffset = Math.max(0, size - EVENTS_BACKLOG_BYTES);
      skipPartial = this.eventsOffset > 0;
    }
    if (size < this.eventsOffset) this.eventsOffset = 0; // rotated by the recorder
    if (size === this.eventsOffset) return;
    const read = readNewLines(this.eventsPath, this.eventsOffset, size);
    if (!read) return;
    this.eventsOffset += read.consumed;
    const lines = skipPartial ? read.lines.slice(1) : read.lines;
    for (const raw of lines) {
      const ev = parseJson(raw);
      const sid: string | undefined = ev?.session_id;
      if (!ev || !sid) continue;
      let session = this.sessions.get(sid);
      if (!session) {
        const tpath: string = ev.transcript_path || join(this.root, "unknown", `${sid}.jsonl`);
        session = new Session(sid, basename(dirname(tpath)), tpath);
        this.sessions.set(sid, session);
      }
      session.applyHook(ev);
      if (typeof ev.ts === "number") this.lastHookTs = Math.max(this.lastHookTs, ev.ts * 1000);
      changed.add(sid);
    }
  }
}

// ---- helpers -----------------------------------------------------------------

/** Complete lines appended between offset and size; a half-written last line waits for next time. */
function readNewLines(path: string, offset: number, size: number): { lines: string[]; consumed: number } | null {
  const buf = Buffer.alloc(size - offset);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, buf.length, offset);
  } finally {
    closeSync(fd);
  }
  const end = buf.lastIndexOf(0x0a) + 1;
  if (end === 0) return null;
  const lines = buf.subarray(0, end).toString("utf8").split("\n").filter((l) => l.trim());
  return { lines, consumed: end };
}

function parseJson(raw: string): Rec | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function firstLine(text: string, limit: number): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length <= limit ? line : line.slice(0, limit - 1) + "…";
}

function countLines(text: unknown): number {
  return typeof text === "string" && text ? text.split("\n").length : 0;
}

function resultText(block: Rec): string {
  const c = block.content;
  if (Array.isArray(c)) return c.map((p: Rec) => p?.text ?? "").join(" ");
  return String(c ?? "");
}

function summarizeInput(input: Rec): string {
  for (const key of ["file_path", "notebook_path", "pattern", "command", "url", "query", "description", "skill", "prompt"]) {
    const val = input[key];
    if (typeof val === "string" && val) {
      return firstLine(key.endsWith("_path") ? basename(val.replaceAll("\\", "/")) : val, 90);
    }
  }
  return "";
}

/** claude-sonnet-5-5 -> "sonnet 5.5" */
export function shortModel(model: string): string {
  if (!model) return "?";
  const [family, ...rest] = model.replace(/^claude-/, "").split("-");
  const nums = rest.filter((p) => /^\d{1,3}$/.test(p));
  return `${family} ${nums.join(".")}`.trim();
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Share of input served from the cache, 0..1. */
export function cachedShare(d: TokenDetail): number {
  const total = d.fresh + d.cacheWrite + d.cacheRead;
  return total ? d.cacheRead / total : 0;
}

export function fmtCost(dollars: number | null): string {
  if (dollars === null) return "≈ $?";
  if (dollars < 0.01) return "< $0.01";
  return `≈ $${dollars < 10 ? dollars.toFixed(2) : dollars.toFixed(1)}`;
}

export function fmtDuration(start: number | null, end: number | null): string {
  if (start === null || end === null) return "-";
  const s = Math.floor((end - start) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

export function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function eventsFileExists(): boolean {
  return existsSync(EVENTS_FILE);
}
