// Renders the app into a fake terminal and prints the frame as plain text.
// Usage: node test/frame.mjs [sessionId|follow] [cols] [rows] [projectsDir] [eventsFile]
import { EventEmitter } from "node:events";
import React from "react";
import { render } from "ink";
import { Store } from "../dist/model.js";
import { App } from "../dist/ui.js";

const [target = "follow", cols = "170", rows = "48", root, events] = process.argv.slice(2);
class FakeStdout extends EventEmitter {
  columns = Number(cols);
  rows = Number(rows);
  isTTY = true;
  frames = [];
  write(s) { this.frames.push(s); return true; }
}
const stdout = new FakeStdout();
// Ink 8 reads keys via 'readable' + read(), like a real TTY stream.
const queue = [];
const stdin = Object.assign(new EventEmitter(), {
  isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {}, ref() {}, unref() {},
  read() { return queue.shift() ?? null; },
});
const store = new Store(...(root ? [root, 40, events] : []));
const app = render(React.createElement(App, { store, intervalMs: 200 }), {
  stdout, stdin, debug: true, exitOnCtrlC: false, patchConsole: false,
});
const press = (k) => { queue.push(k); stdin.emit("readable"); };
await new Promise((r) => setTimeout(r, 400));
if (target !== "follow") {
  // walk down the session list until the target is selected
  for (let i = 0; i < 40; i++) {
    const sel = [...store.ordered()].findIndex((s) => s.id === target);
    if (sel < 0) break;
    if (i === sel) break;
    press("j");
    await new Promise((r) => setTimeout(r, 30));
  }
}
// KEYS presses extra keys before the frame is captured, e.g. KEYS=c for one fewer card column
for (const k of process.env.KEYS ?? "") press(k);
await new Promise((r) => setTimeout(r, 400));
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
console.log(strip(stdout.frames.at(-1)));
app.unmount();
process.exit(0);
