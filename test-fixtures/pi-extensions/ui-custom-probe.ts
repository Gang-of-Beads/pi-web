/**
 * A screen that proves `ctx.ui.custom` is rendered and drivable by this host.
 *
 * Draws a small menu with a cursor, moves it on the arrow keys, selects on Enter and
 * finishes on Escape, each read as the bytes pi's terminal sends. Nothing depends on it in production; it exists so
 * probe-custom-screen can tell "the factory ran, the browser drew it, and touch
 * can drive it" from "the call was cancelled" - and so the touch affordances
 * (tap a line, Confirm, Cancel) have something with a cursor to act on.
 */
export default function (pi: {
  on: (event: string, handler: (event: unknown, ctx: any) => unknown) => void;
  registerCommand: (name: string, command: { description: string; handler: (args: string, ctx: any) => Promise<void> }) => void;
  registerProvider: (name: string, config: unknown) => void;
}): void {
  if (process.env.PI_WEB_UI_CUSTOM_PROBE !== "1") return;
  // A provider the probes control (scripts/probe-retry-wording.mjs serves it): it fails
  // on purpose, so pi's retries and a cut reply can be driven end to end on 8505.
  pi.registerProvider("pi-web-probe", {
    name: "PI WEB probe",
    baseUrl: "http://127.0.0.1:18999/v1",
    apiKey: "probe",
    api: "openai-completions",
    models: [{ id: "flaky", name: "Flaky probe model", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 },
      { id: "small", name: "Small-window probe model", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8000, maxTokens: 1000 }],
  });
  const cardProbe = (name: string, description: string, web: unknown): void => {
    pi.registerCommand(name, {
      description,
      handler: async (_args, ctx) => {
        const answer: unknown = await ctx.ui.custom(() => {
          console.error(`[${name}] factory ran`);
          return { render: () => [`${name} terminal frame`], handleInput: () => undefined };
        }, { web });
        console.error(`[${name}] returned ${JSON.stringify(answer)}`);
        ctx.ui.notify(`${name} returned ${JSON.stringify(answer)}`, "info");
      },
    });
  };
  cardProbe("card-probe", "Open an interactive card of every field type (docs/design/interactive-card.md)", {
    kind: "card",
    title: "Card probe",
    submit: "Send it",
    fields: [
      { type: "text", id: "intro", text: "Every field type, one per step." },
      { type: "choice", id: "plan", label: "Which plan?", detail: "Plan B also moves the store.", options: [{ value: "a", label: "Plan A" }, { value: "b", label: "Plan B", detail: "Moves the store" }], other: "choice" },
      { type: "choice", id: "langs", label: "Which languages?", options: [{ value: "ts", label: "TypeScript" }, { value: "go", label: "Go" }, { value: "rs", label: "Rust" }], multiple: true, other: "field" },
      { type: "input", id: "note", label: "Why?", multiline: true, placeholder: "A sentence is enough", required: true },
      { type: "input", id: "name", label: "Branch name", placeholder: "feature/..." },
      { type: "confirm", id: "push", label: "Push when done?", confirm: "Push", decline: "Keep local" },
    ],
  });
  cardProbe("card-single-probe", "Open an interactive card with one choice", {
    kind: "card",
    fields: [{ type: "choice", id: "pick", label: "Pick one", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] }],
  });
  cardProbe("card-refused-probe", "Declare a card core refuses (a choice without options), so the terminal frame is drawn", {
    kind: "card",
    fields: [{ type: "choice", id: "pick", label: "No options", options: [] }],
  });
  const items = ["first", "second", "third"];
  const openScreen = (ctx: any): Promise<void> => {
    let cursor = 0;
    const done = (value: unknown): void => { console.error(`[ui-custom-probe] returned ${String(value)}`); ctx.ui.notify(`ui.custom probe returned ${String(value)}`, "info"); };
    return ctx.ui.custom((_tui: unknown, _theme: unknown, _keys: unknown, finish: (value: unknown) => void) => ({
      render: (width: number) => [
        "ui-custom probe · tap a line or press a key",
        ...items.map((item, index) => `${index === cursor ? "▸" : " "} ${item}`.padEnd(width, " ")),
        "enter to select · esc to close",
      ],
      handleInput: (data: string) => {
        const keys: Record<string, () => void> = {
          "\x1b": () => { finish("escaped"); },
          "\r": () => { finish(items[cursor]); },
          "\x1b[B": () => { cursor = Math.min(cursor + 1, items.length - 1); },
          "\x1b[A": () => { cursor = Math.max(cursor - 1, 0); },
        };
        keys[data]?.();
      },
    })).then(done).catch(() => undefined);
  };
  // Opened only when a probe asks: opened on every session_start it sat in every 8505
  // session the owner looked at (351 times in one log, 2026-10-02).
  // A confirm whose message overflows its card, for probe-card-wheel-chains (B11).
  pi.registerCommand("long-confirm-probe", {
    description: "Open a confirm with a long message (probe-card-wheel-chains)",
    handler: async (_args, ctx) => {
      const lines = Array.from({ length: 60 }, (_, index) => `Probe detail line ${String(index + 1)}: a long message the card has to scroll.`);
      await ctx.ui.confirm(`Long confirm probe\n${lines.join("\n")}`, "Proceed?");
    },
  });
  // Every standing ctx.ui value at once, for the extension UI counterpart (step 3), and a
  // command that clears them; a widget long enough to need "Show all" on both layouts.
  pi.registerCommand("standing-probe", {
    description: "Set every standing ctx.ui value (extension UI counterpart)",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("b-probe", "probe status B with a text long enough to be cut on the footer line");
      ctx.ui.setStatus("a-probe", "probe A");
      ctx.ui.setWidget("probe-widget", Array.from({ length: 14 }, (_, index) => `probe widget line ${String(index + 1)}`));
      ctx.ui.setWidget("probe-below", ["probe widget below the composer"], { placement: "belowEditor" });
      ctx.ui.setWorkingMessage("Probe is working on it");
      ctx.ui.setWorkingIndicator({ frames: ["◆"] });
      ctx.ui.setHiddenThinkingLabel("probe thinking");
      ctx.ui.setTitle("Probe title");
    },
  });
  // Review fixes for the standing values: a component that asks to redraw from inside render()
  // (it must not loop) and draws 150 lines (the cut must count 51), an unknown notify level, the
  // working row hidden, and statuses long enough to need the open list's scroll.
  pi.registerCommand("standing-component-probe", {
    description: "Set a component widget that redraws itself from render (review fixes)",
    handler: async (_args, ctx) => {
      let renders = 0;
      ctx.ui.setWidget("probe-component", (tui: { requestRender: () => void }) => ({
        render: () => {
          renders += 1;
          console.error(`[standing-probe] render ${String(renders)}`);
          tui.requestRender();
          return Array.from({ length: 150 }, (_, index) => `component line ${String(index + 1)}`);
        },
        invalidate: () => undefined,
        dispose: () => { console.error("[standing-probe] component disposed"); },
      }));
    },
  });
  pi.registerCommand("notify-success-probe", {
    description: "Notify with a level outside info/warning/error (review fixes)",
    handler: async (_args, ctx) => { ctx.ui.notify("probe success notice", "success"); },
  });
  pi.registerCommand("standing-hide-working", {
    description: "Hide the working row (review fixes)",
    handler: async (_args, ctx) => { ctx.ui.setWorkingVisible(false); },
  });
  pi.registerCommand("standing-long-probe", {
    description: "Set statuses long enough to need the open list's scroll (review fixes)",
    handler: async (_args, ctx) => {
      for (const key of ["c-long", "d-long", "e-long", "f-long"]) ctx.ui.setStatus(key, `${key} ${"long status text ".repeat(50)}`);
    },
  });
  pi.registerCommand("standing-clear", {
    description: "Clear every standing ctx.ui value the standing probe set",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("a-probe", undefined);
      ctx.ui.setStatus("b-probe", undefined);
      ctx.ui.setWidget("probe-widget", undefined);
      ctx.ui.setWidget("probe-below", undefined);
      ctx.ui.setWidget("probe-component", undefined);
      for (const key of ["c-long", "d-long", "e-long", "f-long"]) ctx.ui.setStatus(key, undefined);
      ctx.ui.setWorkingVisible(true);
      ctx.ui.setWorkingMessage();
      ctx.ui.setWorkingIndicator();
      ctx.ui.setHiddenThinkingLabel();
      ctx.ui.setTitle("");
    },
  });
  // A select with no options, which the host refuses to show (probe-refused-dialog, B10).
  pi.registerCommand("refused-dialog-probe", {
    description: "Ask for a dialog the host refuses (probe-refused-dialog)",
    handler: async (_args, ctx) => {
      try {
        await ctx.ui.select("Refused probe", []);
      } catch (error) {
        console.error(`[refused-dialog-probe] rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
  pi.registerCommand("editor-probe", {
    description: "Open ctx.ui.editor with a two-line prefill (extension UI step 4)",
    handler: async (_args, ctx) => {
      const text = await ctx.ui.editor("Edit the probe note", "first line\nsecond line");
      ctx.ui.notify(text === undefined ? "editor probe: cancelled" : `editor probe: ${JSON.stringify(text)}`, "info");
    },
  });
  pi.registerCommand("editor-long-probe", {
    description: "Open ctx.ui.editor with a prefill past the bound (extension UI step 4)",
    handler: async (_args, ctx) => {
      const text = await ctx.ui.editor("Long probe text", "x".repeat(32_010));
      ctx.ui.notify(text === undefined ? "editor long probe: cancelled" : `editor long probe: ${String(text.length)} characters`, "info");
    },
  });
  pi.registerCommand("editor-text-probe", {
    description: "setEditorText into the composer (extension UI step 4)",
    handler: async (_args, ctx) => { ctx.ui.setEditorText("probe set text"); },
  });
  pi.registerCommand("editor-paste-probe", {
    description: "pasteToEditor into the composer (extension UI step 4)",
    handler: async (_args, ctx) => { ctx.ui.pasteToEditor(" [probe paste] "); },
  });
  pi.registerCommand("editor-get-probe", {
    description: "Report getEditorText (extension UI step 4)",
    handler: async (_args, ctx) => { ctx.ui.notify(`getEditorText: ${JSON.stringify(ctx.ui.getEditorText())}`, "info"); },
  });
  pi.registerCommand("ui-custom-probe", {
    description: "Open the ui.custom probe screen (probe-custom-screen)",
    handler: async (_args, ctx) => { await openScreen(ctx); },
  });
}
