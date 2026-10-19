import type { PluginListRead } from "../../../../shared/pluginApiTypes";

/**
 * What an output view shows, decided in one place, with the list's own rule (pluginListView.ts):
 * text is shown whenever there is some, under the stale line when the latest read failed, so a
 * failed refresh never blanks what an earlier read found; no text draws the box with the words for
 * the read state, so "not read yet", "nothing" and "could not read" never collapse into one blank.
 */
export type OutputViewState = "text" | "text-stale" | "box";

const TEXT_STATE: Readonly<Record<PluginListRead, OutputViewState>> = {
  reading: "text",
  ready: "text",
  failed: "text-stale",
};

export function outputViewState(read: PluginListRead, text: string): OutputViewState {
  return text === "" ? "box" : TEXT_STATE[read];
}

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/**
 * Terminal escape sequences: CSI (colours, cursor moves), OSC (titles, links) and the two-byte
 * escapes. Shell output carries them; drawn as text they read as noise.
 */
const TERMINAL_ESCAPES = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`, "g");

export function withoutTerminalEscapes(text: string): string {
  return text.replace(TERMINAL_ESCAPES, "");
}
