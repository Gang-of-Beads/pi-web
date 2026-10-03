import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A region drawn in the transcript chains the wheel and a swipe to the transcript at its end
 * (state-diagram D2, B11). The owner reported a wheel over a card that scrolled nothing: the dialog
 * detail region declared `overscroll-behavior: contain`, which D2 keeps for overlays. Horizontal
 * containment stays: on a code block it keeps a sideways swipe from going Back.
 */
const componentsDir = dirname(fileURLToPath(import.meta.url));
const drawnInTheTranscript = ["AskUserCard.ts", "ChatView.ts", "ExtensionDialogCard.ts", "ToolExecutionView.ts"];
const verticalContainment = /overscroll-behavior(?:-y|-block)?\s*:\s*contain/gu;

describe("regions drawn in the transcript chain to it", () => {
  it.each(drawnInTheTranscript)("%s declares no vertical overscroll containment", (file) => {
    const source = readFileSync(join(componentsDir, file), "utf8");

    expect(source.match(verticalContainment) ?? []).toEqual([]);
  });
});
