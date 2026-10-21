// Builds a made-up Claude Code session with four subagents in a temp folder and prints one
// rendered frame of the monitor, for the README. Usage: npm run demo [-- cols rows] [--ansi]
// --ansi keeps the terminal colors; scripts/screenshot.mjs turns that into a PNG.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ansi = process.argv.includes("--ansi");
const [cols = "118", rows = "42"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const root = mkdtempSync(join(tmpdir(), "tankview-demo-"));
const projects = join(root, "projects");
const events = join(root, "tankview", "events.jsonl");
const now = Date.now();
const at = (secondsAgo) => new Date(now - secondsAgo * 1000).toISOString();
let msg = 0;

function assistant(secondsAgo, model, content, stop, usage) {
  return {
    type: "assistant", timestamp: at(secondsAgo), cwd: "/home/dev/shop-api", gitBranch: "feature/csv-export",
    message: { id: `msg_${++msg}`, model, stop_reason: stop, content, usage },
  };
}
const tool = (name, input) => ({ type: "tool_use", id: `toolu_${++msg}`, name, input });
const text = (t) => ({ type: "text", text: t });
const result = (secondsAgo, error = "") => ({
  type: "user", timestamp: at(secondsAgo),
  message: { content: [{ type: "tool_result", tool_use_id: `toolu_${msg}`, content: error || "ok", is_error: Boolean(error) }] },
});
const usage = (read, write, out) => ({ input_tokens: 3, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: out });

function writeJsonl(path, records, mtimeSecondsAgo = 0) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const t = (now - mtimeSecondsAgo * 1000) / 1000;
  utimesSync(path, t, t);
}

// ---- main session (Sonnet) ------------------------------------------------------------
const sid = "5f1c2a90-demo-4b8e-9d1a-shopapi00001";
const project = join(projects, "-home-dev-shop-api");
const S = "claude-sonnet-5-5";
writeJsonl(join(project, `${sid}.jsonl`), [
  { type: "ai-title", aiTitle: "Add CSV export for orders" },
  { type: "last-prompt", lastPrompt: "add CSV export to the orders page, with tests" },
  { type: "user", timestamp: at(420), message: { content: "add CSV export to the orders page, with tests" } },
  assistant(415, S, [text("I'll map the orders module and find every caller of the order serializer first."), tool("Agent", { description: "Map orders module" })], "tool_use", usage(18_000, 9_000, 420)),
  assistant(414, S, [tool("Agent", { description: "Find serializer usages" })], "tool_use", usage(27_000, 600, 180)),
  result(330),
  assistant(325, S, [tool("Read", { file_path: "src/orders/serializer.ts" })], "tool_use", usage(31_000, 2_400, 260)),
  result(322),
  assistant(300, S, [tool("Write", { file_path: "src/orders/export.ts", content: "x\n".repeat(64) })], "tool_use", usage(34_000, 1_900, 2_100)),
  result(296),
  assistant(280, S, [tool("Edit", { file_path: "src/orders/routes.ts", old_string: "a\nb", new_string: "a\nb\nc\nd\ne\nf" })], "tool_use", usage(37_000, 900, 640)),
  result(277),
  assistant(260, S, [tool("Write", { file_path: "test/orders/export.test.ts", content: "t\n".repeat(48) })], "tool_use", usage(39_000, 1_500, 1_700)),
  result(256),
  assistant(250, S, [text("Export written. Running the order tests and asking the architect to review the streaming design."), tool("Agent", { description: "Run order tests" })], "tool_use", usage(41_000, 800, 300)),
  assistant(249, S, [tool("Agent", { description: "Review export design" })], "tool_use", usage(42_000, 300, 160)),
]);

// ---- subagents -------------------------------------------------------------------------
const H = "claude-haiku-5-5";
const O = "claude-opus-5-5";
function subagent(id, meta, records, mtimeSecondsAgo) {
  const dir = join(project, sid, "subagents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify({ spawnDepth: 1, ...meta }));
  writeJsonl(join(dir, `agent-${id}.jsonl`), records, mtimeSecondsAgo);
}
subagent("a1c9e2f04b7d", { agentType: "search", description: "Map orders module" }, [
  { type: "user", timestamp: at(414), message: { content: "Map the orders module" } },
  ...["src/orders", "src/orders/serializer.ts", "src/orders/routes.ts", "src/db/orders.repo.ts", "src/http/csv.ts"].flatMap((p, i) => [
    assistant(410 - i * 12, H, [tool(i === 0 ? "Glob" : "Read", i === 0 ? { pattern: `${p}/**` } : { file_path: p })], "tool_use", usage(6_000 + i * 3_000, 2_000, 140)),
    result(405 - i * 12),
  ]),
  assistant(340, H, [text("## Findings\nOrders are served by routes.ts ...")], "end_turn", usage(22_000, 400, 900)),
], 340);
subagent("a2f7b31c9e05", { agentType: "grep", description: "Find serializer usages" }, [
  { type: "user", timestamp: at(413), message: { content: "Find every caller of serializeOrder" } },
  assistant(408, H, [tool("Grep", { pattern: "serializeOrder\\(" })], "tool_use", usage(5_000, 1_800, 120)),
  result(404),
  assistant(398, H, [tool("Grep", { pattern: "OrderDTO" })], "tool_use", usage(7_500, 900, 110)),
  result(395),
  assistant(360, H, [text("## Matches\n6 call sites ...")], "end_turn", usage(9_500, 300, 640)),
], 360);
subagent("a3d04e8b2c61", { agentType: "test", description: "Run order tests" }, [
  { type: "user", timestamp: at(249), message: { content: "Run the order tests" } },
  assistant(240, H, [tool("Glob", { pattern: "test/orders/**" })], "tool_use", usage(5_200, 1_700, 90)),
  result(236),
  assistant(220, H, [tool("Bash", { command: "npm test -- test/orders" })], "tool_use", usage(7_000, 600, 110)),
  result(140, "2 failed, 14 passed: export.test.ts > escapes quotes in customer names"),
  assistant(130, H, [tool("Read", { file_path: "test/orders/export.test.ts" })], "tool_use", usage(9_800, 2_300, 260)),
  result(126),
  assistant(8, H, [tool("Bash", { command: "npm test -- test/orders/export.test.ts" })], "tool_use", usage(13_000, 700, 150)),
], 8);
subagent("a4b8c5d9e0f2", { agentType: "architect", description: "Review export design" }, [
  { type: "user", timestamp: at(248), message: { content: "Review the CSV export design" } },
  assistant(236, O, [tool("Read", { file_path: "src/orders/export.ts" })], "tool_use", usage(9_000, 6_500, 380)),
  result(233),
  assistant(205, O, [tool("Read", { file_path: "src/db/orders.repo.ts" })], "tool_use", usage(15_500, 3_100, 520)),
  result(201),
  assistant(160, O, [tool("Grep", { pattern: "findAllOrders|stream\\(" })], "tool_use", usage(18_600, 1_200, 610)),
  result(4),
], 4);

// ---- two older sessions for the sidebar ------------------------------------------------
writeJsonl(join(projects, "-home-dev-shop-api", "0b7e1d22-demo-4c11-8f00-shopapi00002.jsonl"), [
  { type: "ai-title", aiTitle: "Fix flaky checkout test" },
  { type: "user", timestamp: at(7200), message: { content: "the checkout test fails randomly" } },
  assistant(7100, S, [text("Fixed the race in the payment mock.")], "end_turn", usage(30_000, 4_000, 900)),
], 7100);
writeJsonl(join(projects, "-home-dev-docs-site", "7c3a9f10-demo-4d22-9a00-docssite0001.jsonl"), [
  { type: "ai-title", aiTitle: "Rewrite getting-started guide" },
  { type: "user", timestamp: at(90_000), message: { content: "rewrite the getting started page" } },
  { ...assistant(89_000, S, [text("Done.")], "end_turn", usage(20_000, 3_000, 2_500)), cwd: "/home/dev/docs-site" },
], 89_000);

// Hook events: makes the banner show the live feed, as with the plugin installed.
mkdirSync(join(events, ".."), { recursive: true });
writeFileSync(events, JSON.stringify({ session_id: sid, hook_event_name: "PreToolUse", tool_name: "Agent", tool_use_id: `toolu_${msg}`, tool_input: { description: "Review export design" }, ts: (now - 3000) / 1000 }) + "\n");

const frame = execFileSync(process.execPath, [new URL("../test/frame.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), "follow", cols, rows, projects, events], {
  encoding: "utf8",
  env: ansi ? { ...process.env, RAW: "1", FORCE_COLOR: "3" } : process.env,
});
process.stdout.write(ansi ? frame : frame.replace(/\d{1,2}:\d{2}:\d{2}( [AP]M)?(?= *$)/m, "").replace(/\s+$/gm, ""));
