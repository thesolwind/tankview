// Copies text to the system clipboard: the platform tool first, then the OSC 52 terminal escape.

import { spawnSync } from "node:child_process";

type Tool = [cmd: string, args: string[], input: Buffer];

function tools(text: string): Tool[] {
  const utf8 = Buffer.from(text, "utf8");
  if (process.platform === "win32") {
    // clip.exe detects UTF-16LE on its own (a BOM would be pasted as a character); UTF-8 would get mangled.
    return [["clip", [], Buffer.from(text, "utf16le")]];
  }
  if (process.platform === "darwin") return [["pbcopy", [], utf8]];
  return [
    ...(process.env.WAYLAND_DISPLAY ? [["wl-copy", [], utf8] as Tool] : []),
    ["xclip", ["-selection", "clipboard"], utf8],
    ["xsel", ["--clipboard", "--input"], utf8],
  ];
}

/** Returns how the text was copied: the tool's name, or "terminal" for OSC 52 (which may be ignored). */
export function copyToClipboard(text: string): string {
  for (const [cmd, args, input] of tools(text)) {
    const r = spawnSync(cmd, args, { input, timeout: 2000, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    if (!r.error && r.status === 0) return cmd;
  }
  process.stdout.write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
  return "terminal";
}
