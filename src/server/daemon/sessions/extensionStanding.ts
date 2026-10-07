import type { ExtensionUiStanding } from "../../../shared/apiTypes.js";

/**
 * What a session's extensions leave standing on its screen through `ctx.ui`: footer statuses,
 * the working row's words, mark and visibility, the hidden-thinking label and the tab title
 * (extension-ui-counterpart.md, owner 2026-10-04).
 *
 * Statuses are drawn in the status bar between the context and the cost, where there is room
 * (owner, 2026-10-07: PI WEB favours no plugin; what fits is shown, what does not is left out,
 * as in pi's terminal). `setWidget` is not kept: PI WEB draws no extension box around the
 * composer (owner, 2026-10-06), so it stays pi's headless no-op.
 *
 * pi's terminal keeps these in its one process and draws them in its one screen; PI WEB keeps
 * them here, per session runtime, and every browser showing the session draws the snapshot that
 * rides on its status. A status holds one value per key and statuses sort by key, as pi's footer
 * sorts them; a single slot is last-writer-wins, and a reset restores PI WEB's own
 * default even if another extension set the value. A reload of the session's extensions clears
 * everything, as pi's does. Only the payload is bounded, never refused: a text is cut at
 * STATUS_MAX_LENGTH.
 */
export const STATUS_MAX_LENGTH = 1_000;

export class ExtensionStanding {
  private readonly statuses = new Map<string, string>();
  private workingMessage: string | undefined;
  private workingHidden = false;
  private workingFrames: readonly string[] | undefined;
  private hiddenThinkingLabel: string | undefined;
  private title: string | undefined;

  /** `changed` is told after every write. */
  constructor(private readonly changed: () => void) {}

  /** pi's `setStatus`: a text under its key, or none; a text that is blank once flattened is none. */
  setStatus(key: string, text: unknown): void {
    const flat = text === undefined ? "" : statusText(text);
    if (flat === "") this.statuses.delete(key);
    else this.statuses.set(key, flat);
    this.changed();
  }

  setWorkingMessage(message?: string): void {
    this.workingMessage = message === undefined || message === "" ? undefined : statusText(message);
    this.changed();
  }

  setWorkingVisible(visible: boolean): void {
    this.workingHidden = !visible;
    this.changed();
  }

  setWorkingIndicator(options?: { frames?: string[] }): void {
    this.workingFrames = options?.frames === undefined ? undefined : options.frames.map(statusText);
    this.changed();
  }

  setHiddenThinkingLabel(label?: string): void {
    this.hiddenThinkingLabel = label === undefined || label === "" ? undefined : statusText(label);
    this.changed();
  }

  setTitle(title: string): void {
    this.title = title === "" ? undefined : statusText(title);
    this.changed();
  }

  /** Everything back to PI WEB's defaults: the session's extensions reloaded or its runtime ended. */
  clear(): void {
    this.statuses.clear();
    this.workingMessage = undefined;
    this.workingHidden = false;
    this.workingFrames = undefined;
    this.hiddenThinkingLabel = undefined;
    this.title = undefined;
    this.changed();
  }

  /** The wire snapshot, or undefined when nothing stands. */
  snapshot(): ExtensionUiStanding | undefined {
    const standing: ExtensionUiStanding = {
      ...(this.statuses.size === 0 ? {} : { statuses: [...this.statuses].sort(([left], [right]) => left.localeCompare(right)).map(([key, text]) => ({ key, text })) }),
      ...(this.workingMessage === undefined ? {} : { workingMessage: this.workingMessage }),
      ...(this.workingHidden ? { workingHidden: true as const } : {}),
      ...(this.workingFrames === undefined ? {} : { workingFrames: [...this.workingFrames] }),
      ...(this.hiddenThinkingLabel === undefined ? {} : { hiddenThinkingLabel: this.hiddenThinkingLabel }),
      ...(this.title === undefined ? {} : { title: this.title }),
    };
    return Object.keys(standing).length === 0 ? undefined : standing;
  }
}

/** pi's footer sanitising (newlines and tabs to spaces, runs of spaces collapsed), then the payload bound. */
function statusText(text: unknown): string {
  const raw = typeof text === "string" ? text : typeof text === "number" || typeof text === "boolean" ? String(text) : "";
  const flat = raw.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
  if (flat.length <= STATUS_MAX_LENGTH) return flat;
  return `${flat.slice(0, STATUS_MAX_LENGTH - 1)}…`;
}
