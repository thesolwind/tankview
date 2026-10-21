// Ink TUI: live view of Claude Code sessions and their subagents.

import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useState } from "react";
import {
  type Agent,
  type LogEvent,
  type Session,
  type Status,
  type Store,
  ago,
  cachedShare,
  fmtCost,
  fmtDuration,
  fmtTokens,
  shortModel,
} from "./model.js";

const C = {
  fg: "#e6edf3",
  text: "#c9d1d9",
  muted: "#8b949e",
  dim: "#6e7681",
  faint: "#484f58",
  line: "#30363d",
  green: "#7ee787",
  greenBorder: "#2ea043",
  blue: "#4fc3f7",
  orange: "#f0883e",
  red: "#ff7b72",
  yellow: "#e3b341",
  purple: "#b392f0",
};

const STATUS: Record<Status, { icon: string; color: string; border: string }> = {
  running: { icon: "●", color: C.blue, border: C.blue },
  thinking: { icon: "◐", color: C.blue, border: C.blue },
  done: { icon: "✓", color: C.green, border: C.greenBorder },
  stalled: { icon: "!", color: C.orange, border: C.orange },
  waiting: { icon: "?", color: C.yellow, border: C.yellow },
  idle: { icon: "○", color: C.dim, border: C.line },
};

const KIND_COLOR: Record<LogEvent["kind"], string> = {
  tool: C.text,
  text: C.muted,
  error: C.red,
  spawn: "#d2a8ff",
  done: C.green,
  prompt: C.orange,
  notify: C.yellow,
};

const MODEL_COLOR: [string, string][] = [
  ["opus", C.purple],
  ["sonnet", C.orange],
  ["haiku", C.blue],
  ["fable", C.green],
];

const DASHED = {
  topLeft: "┌", top: "╌", topRight: "┐", left: "╎", right: "╎", bottomLeft: "└", bottom: "╌", bottomRight: "┘",
};

const LOG_HEIGHT = 14;
const LEAD_HEIGHT = 7;
const CARD_HEIGHT = 8;
const MIN_CARD_WIDTH = 34;

function modelColor(model: string): string {
  return MODEL_COLOR.find(([family]) => model.includes(family))?.[1] ?? C.text;
}

/** Folder name of the session's working directory; the encoded project slug can't be split reliably. */
function projectName(s: Session): string {
  if (s.cwd) return s.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? s.cwd;
  return s.project.split("-").at(-1) ?? s.project;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function isActive(status: Status): boolean {
  return status === "running" || status === "thinking";
}

function clip(text: string, width: number): string {
  if (width <= 1) return "";
  return text.length <= width ? text : text.slice(0, width - 1) + "…";
}

function Bar({ frac, width, color }: { frac: number; width: number; color: string }) {
  const filled = Math.round(Math.max(0, Math.min(1, frac)) * width);
  return (
    <>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={C.line}>{"░".repeat(width - filled)}</Text>
    </>
  );
}

function Sep() {
  return <Text color={C.line}>{"  ·  "}</Text>;
}

// ---- pieces -------------------------------------------------------------------

function Banner({ store, follow }: { store: Store; follow: boolean }) {
  const all = store.ordered();
  const live = all.filter((s) => s.isLive);
  let working = 0;
  for (const s of live) for (const a of s.subagents.values()) if (isActive(s.agentStatus(a))) working++;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text wrap="truncate">
        <Text bold color={C.green}>TANKVIEW</Text>
        <Text color={C.muted}> · operator console for Claude Code agents</Text>
        <Sep />
        <Text bold color={C.orange}>{plural(live.length, "live session")}</Text>
        <Sep />
        <Text bold color={C.blue}>{plural(working, "subagent")} working</Text>
        <Sep />
        <Text color={follow ? C.green : C.purple}>{follow ? "follow" : "pinned"}</Text>
        <Sep />
        {store.hooksSeen && Date.now() - store.lastHookTs < 10 * 60_000 ? (
          <Text color={C.green}>hooks ● live, last event {ago(store.lastHookTs)} ago</Text>
        ) : store.hooksSeen ? (
          <Text color={C.dim}>hooks ○ quiet, last event {ago(store.lastHookTs)} ago</Text>
        ) : (
          <Text color={C.dim}>hooks ○ off, transcripts only (install the tankview plugin)</Text>
        )}
      </Text>
      <Text wrap="truncate">
        {MODEL_COLOR.map(([family, color]) => (
          <Text key={family}>
            <Text color={color}>■ </Text>
            <Text color={C.muted}>{family}   </Text>
          </Text>
        ))}
        <Text color={C.dim}>{new Date().toLocaleTimeString()}</Text>
      </Text>
    </Box>
  );
}

function SessionList({ sessions, selected, height, width: sidebarWidth }: { sessions: Session[]; selected: string | null; height: number; width: number }) {
  const per = 2;
  const visible = Math.max(1, Math.floor((height - 3) / per));
  const idx = Math.max(0, sessions.findIndex((s) => s.id === selected));
  const start = Math.max(0, Math.min(idx - Math.floor(visible / 2), sessions.length - visible));
  const width = sidebarWidth - 4;
  return (
    <Box flexDirection="column" width={sidebarWidth} flexShrink={0} borderStyle="round" borderColor={C.purple} paddingX={1}>
      <Text color={C.purple}>sessions ({sessions.length})</Text>
      {sessions.slice(start, start + visible).map((s) => {
        const st = STATUS[s.agentStatus(s.main)];
        const icon = s.isLive ? st.icon : "○";
        const title = s.title || s.lastPrompt || s.id.slice(0, 8);
        const project = projectName(s);
        const isSel = s.id === selected;
        return (
          <Box key={s.id} flexDirection="column">
            <Text wrap="truncate" backgroundColor={isSel ? "#1f2937" : undefined}>
              <Text color={s.isLive ? st.color : C.faint}>{icon} </Text>
              <Text bold={isSel} color={s.isLive || isSel ? C.fg : C.muted}>{clip(title, width - 2).padEnd(width - 2)}</Text>
            </Text>
            <Text wrap="truncate">
              <Text color={C.dim}>{"  " + project}</Text>
              {s.subagents.size > 0 && <Text color={C.blue}> · {s.subagents.size} sub</Text>}
              <Text color={C.dim}> · {ago(s.mtime)}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function Lead({ session: s, width, showCost, sessionCost }: { session: Session; width: number; showCost: boolean; sessionCost: number | null }) {
  const m = s.main;
  const status = s.agentStatus(m);
  const st = STATUS[status];
  const d = m.tokenDetail();
  // Past 200k the session must be on a 1M-context model.
  const window = m.lastContext <= 200_000 ? 200_000 : 1_000_000;
  const color = modelColor(m.model);
  const top = [...m.toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const inner = width - 4;
  return (
    <Box flexDirection="column" height={LEAD_HEIGHT} flexShrink={0} borderStyle={DASHED} borderColor={color} paddingX={1}>
      <Text color={color}>{shortModel(m.model)} · main session</Text>
      <Text wrap="truncate">
        <Text bold color={C.fg}>{s.title || "(untitled)"}</Text>
        <Text color={st.color}>   [ {st.icon} {status} ]</Text>
        <Text color={C.dim}>   {s.cwd || s.project}{s.branch ? ` @ ${s.branch}` : ""}</Text>
      </Text>
      {m.currentTool && isActive(status) ? (
        <Text wrap="truncate">
          <Text bold color={C.fg}>▸ {m.currentTool} </Text>
          <Text color={C.muted}>{m.currentDetail}</Text>
        </Text>
      ) : (
        <Text wrap="truncate">
          <Text color={C.orange}>» </Text>
          <Text color={C.muted}>{clip(s.lastPrompt.split("\n")[0] ?? "", inner - 2)}</Text>
        </Text>
      )}
      <Text wrap="truncate">
        <Text color={C.dim}>context </Text>
        <Bar frac={m.lastContext / window} width={20} color={m.lastContext < window * 0.75 ? C.green : C.orange} />
        <Text bold color={C.green}> {fmtTokens(m.lastContext)}</Text>
        <Text color={C.dim}>/{fmtTokens(window)}   wrote </Text>
        <Text bold color={C.fg}>{fmtTokens(d.output)}</Text>
        <Text color={C.dim}> · read </Text>
        <Text color={C.text}>{fmtTokens(d.fresh + d.cacheWrite)} new</Text>
        <Text color={C.dim}> + </Text>
        <Text color={C.text}>{fmtTokens(d.cacheRead)} cached</Text>
        {showCost && (
          <Text color={C.yellow}>   {fmtCost(m.cost())} main · {fmtCost(sessionCost)} session</Text>
        )}
      </Text>
      <Text wrap="truncate">
        <Text color={C.dim}>calls </Text>
        <Text bold color={C.fg}>{m.toolCalls}</Text>
        {top.length > 0 && <Text color={C.muted}>  ({top.map(([k, v]) => `${k} ${v}`).join(", ")})</Text>}
        <Text color={C.dim}>   patch </Text>
        <Text color={C.green}>+{m.linesAdded}</Text>
        <Text color={C.red}> -{m.linesRemoved}</Text>
        <Text color={C.muted}> · {plural(m.files.size, "file")}</Text>
        {m.errors > 0 && <Text color={C.red}>   {m.errors} tool errors</Text>}
        <Text color={C.dim}>   up {fmtDuration(m.started, m.lastTs)}</Text>
      </Text>
    </Box>
  );
}

function SwarmLine({ session: s, agents, showCost }: { session: Session; agents: Agent[]; showCost: boolean }) {
  if (!agents.length) return <Text color={C.dim}>  no subagents in this session yet</Text>;
  let read = 0, cached = 0, wrote = 0;
  let cost: number | null = null;
  for (const a of agents) {
    const d = a.tokenDetail();
    read += d.fresh + d.cacheWrite + d.cacheRead;
    cached += d.cacheRead;
    wrote += d.output;
    const c = a.cost();
    if (c !== null) cost = (cost ?? 0) + c;
  }
  const done = agents.filter((a) => s.agentStatus(a) === "done").length;
  const models = [...new Set(agents.filter((a) => a.model).map((a) => shortModel(a.model)))].sort();
  return (
    <Text wrap="truncate">
      <Text color={C.muted}>» delegated to subagents · </Text>
      <Text bold color={C.blue}>{models.join(", ") || "?"}</Text>
      <Text color={C.green}>  [ {done}/{agents.length} done ]</Text>
      <Text color={C.blue}>  subagents read {fmtTokens(read)} ({fmtTokens(cached)} cached) · wrote {fmtTokens(wrote)}</Text>
      {showCost && <Text color={C.yellow}> · {fmtCost(cost)}</Text>}
      <Text color={C.green}>  · main context {fmtTokens(s.main.lastContext)}</Text>
    </Text>
  );
}

function Card({ session: s, agent: a, swarmOut, width, showCost }: { session: Session; agent: Agent; swarmOut: number; width: number; showCost: boolean }) {
  const status = s.agentStatus(a);
  const st = STATUS[status];
  const color = modelColor(a.model);
  const d = a.tokenDetail();
  const out = d.output;
  const barWidth = Math.max(4, Math.min(18, width - 16));
  return (
    <Box
      flexDirection="column"
      width={width}
      height={CARD_HEIGHT}
      borderStyle="round"
      borderColor={st.border}
      paddingX={1}
    >
      <Text bold color={C.fg} wrap="truncate">{a.label}</Text>
      <Text wrap="truncate">
        <Text color={color}>{shortModel(a.model)}</Text>
        <Text color={st.color} bold={isActive(status)}>  [ {st.icon} {status.toUpperCase()} ]</Text>
      </Text>
      <Text wrap="truncate">
        <Bar frac={swarmOut ? out / swarmOut : 0} width={barWidth} color={color} />
        <Text color={C.muted}> wrote {fmtTokens(out)}</Text>
      </Text>
      {a.currentTool && isActive(status) ? (
        <Text wrap="truncate">
          <Text bold color={C.fg}>▸ {a.currentTool} </Text>
          <Text color={C.muted}>{a.currentDetail}</Text>
        </Text>
      ) : (
        <Text color={C.dim} wrap="truncate">{a.agentType || "agent"} · depth {a.depth}</Text>
      )}
      <Text wrap="truncate">
        <Text color={C.green}>✓ {a.toolCalls} calls</Text>
        <Text color={C.muted}> · {plural(a.files.size, "file")}</Text>
        {a.errors > 0 && <Text color={C.red}> · {a.errors} err</Text>}
        {showCost && <Text color={C.yellow}> · {fmtCost(a.cost())}</Text>}
      </Text>
      <Text color={C.dim} wrap="truncate">
        read {fmtTokens(d.fresh + d.cacheWrite + d.cacheRead)} ({Math.round(cachedShare(d) * 100)}% cached) · {fmtDuration(a.started, a.lastTs)}
        {` · ${a.id.slice(0, 7)}`}
      </Text>
    </Box>
  );
}

function Log({ session: s, height }: { session: Session; height: number }) {
  const events = [...s.log].sort((a, b) => a.ts - b.ts || a.seq - b.seq).slice(-(height - 3));
  return (
    <Box flexDirection="column" height={height} flexShrink={0} borderStyle="round" borderColor={C.line} paddingX={1}>
      <Text color={C.muted}>session log · live</Text>
      {events.map((e) => (
        <Text key={e.seq} wrap="truncate">
          <Text color={C.dim}>{new Date(e.ts).toLocaleTimeString([], { hour12: false })} </Text>
          <Text color={modelColor(e.model)}>{clip(e.agent, 18).padEnd(18)} </Text>
          <Text color={KIND_COLOR[e.kind]}>{e.kind.padEnd(6)} </Text>
          <Text color={KIND_COLOR[e.kind]} bold={e.kind === "error" || e.kind === "prompt"}>{e.text}</Text>
          {e.detail && <Text color={C.muted}>  {e.detail}</Text>}
        </Text>
      ))}
    </Box>
  );
}

// ---- app -----------------------------------------------------------------------

export function App({ store, intervalMs = 500 }: { store: Store; intervalMs?: number }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const size = { cols: columns || 120, rows: rows || 40 };
  const [, setTick] = useState(0);
  const [follow, setFollow] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [liveOnly, setLiveOnly] = useState(false);
  const [cols, setCols] = useState(3);
  const [cardPage, setCardPage] = useState(0);
  const [showCost, setShowCost] = useState(false);

  useEffect(() => {
    store.refresh();
    setTick((t) => t + 1);
    const timer = setInterval(() => {
      store.refresh();
      setTick((t) => t + 1);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [store, intervalMs]);

  let sessions = store.ordered();
  if (liveOnly) sessions = sessions.filter((s) => s.isLive);
  const current = follow ? sessions[0]?.id ?? null : selected;
  const session = current ? store.sessions.get(current) : undefined;

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) exit();
    else if (input === "f") setFollow(true);
    else if (input === "a") setLiveOnly((v) => !v);
    else if (input === "c") setCols((n) => (n === 1 ? 3 : n - 1));
    else if (input === "$") setShowCost((v) => !v);
    else if (input === "]") setCardPage((p) => p + 1);
    else if (input === "[") setCardPage((p) => Math.max(0, p - 1));
    else if (key.upArrow || key.downArrow || input === "j" || input === "k") {
      const idx = sessions.findIndex((s) => s.id === current);
      const next = key.upArrow || input === "k" ? idx - 1 : idx + 1;
      const target = sessions[Math.max(0, Math.min(sessions.length - 1, next))];
      if (target) {
        setFollow(false);
        setSelected(target.id);
        setCardPage(0);
      }
    }
  });

  const bodyHeight = Math.max(16, size.rows - 3); // banner (2) + footer (1)
  const sidebarWidth = size.cols < 110 ? 26 : 38;
  const rightWidth = Math.max(30, size.cols - sidebarWidth - 1);
  // The log gives up rows first so at least one row of cards stays visible.
  const logHeight = Math.max(5, Math.min(LOG_HEIGHT, bodyHeight - LEAD_HEIGHT - 1 - CARD_HEIGHT));
  const effCols = Math.max(1, Math.min(cols, Math.floor(rightWidth / MIN_CARD_WIDTH)));
  const agents = session
    ? [...session.subagents.values()].sort((a, b) => (a.started ?? 0) - (b.started ?? 0))
    : [];
  let swarmOut = 0;
  let sessionCost = session?.main.cost() ?? null;
  for (const a of agents) {
    swarmOut += a.tokenDetail().output;
    const c = a.cost();
    if (c !== null) sessionCost = (sessionCost ?? 0) + c;
  }
  const cardsHeight = Math.max(CARD_HEIGHT, bodyHeight - LEAD_HEIGHT - 1 - logHeight);
  const perPage = Math.max(1, Math.floor(cardsHeight / CARD_HEIGHT)) * effCols;
  const pages = Math.max(1, Math.ceil(agents.length / perPage));
  const page = Math.min(cardPage, pages - 1);
  const cardWidth = Math.floor(rightWidth / effCols);

  return (
    <Box flexDirection="column" width={size.cols} height={size.rows}>
      <Banner store={store} follow={follow} />
      <Box flexDirection="row" height={bodyHeight}>
        <SessionList sessions={sessions} selected={current} height={bodyHeight} width={sidebarWidth} />
        <Box flexDirection="column" width={rightWidth} marginLeft={1}>
          {session ? (
            <>
              <Lead session={session} width={rightWidth} showCost={showCost} sessionCost={sessionCost} />
              <SwarmLine session={session} agents={agents} showCost={showCost} />
              <Box flexDirection="row" flexWrap="wrap" height={cardsHeight} overflow="hidden">
                {agents.slice(page * perPage, (page + 1) * perPage).map((a) => (
                  <Card key={a.id} session={session} agent={a} swarmOut={swarmOut} width={cardWidth} showCost={showCost} />
                ))}
              </Box>
              <Log session={session} height={logHeight} />
            </>
          ) : (
            <Text color={C.dim}>no Claude Code sessions found in ~/.claude/projects</Text>
          )}
        </Box>
      </Box>
      <Text wrap="truncate">
        <Text color={C.purple}>↑↓</Text><Text color={C.muted}> session  </Text>
        <Text color={C.purple}>f</Text><Text color={C.muted}> follow latest  </Text>
        <Text color={C.purple}>a</Text><Text color={C.muted}> {liveOnly ? "show all" : "live only"}  </Text>
        <Text color={C.purple}>c</Text><Text color={C.muted}> columns  </Text>
        <Text color={C.purple}>$</Text><Text color={C.muted}> {showCost ? "hide cost" : "cost"}  </Text>
        {pages > 1 && (
          <>
            <Text color={C.purple}>[ ]</Text>
            <Text color={C.muted}> cards {page + 1}/{pages}  </Text>
          </>
        )}
        <Text color={C.purple}>q</Text><Text color={C.muted}> quit</Text>
      </Text>
    </Box>
  );
}
