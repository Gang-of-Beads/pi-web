import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const chatView = readFileSync(join(here, "ChatView.ts"), "utf8");

describe("row margin groups", () => {
  it("has a rule per group, driven by one token each", () => {
    expect(chatView).toContain(".msg.event-group > summary");
    expect(chatView).toContain("var(--pi-row-inset)");
    expect(chatView).toContain("var(--pi-row-gutter)");
  });

  it("never pads a holder, so a held card keeps the column's full width", () => {
    const holderRule = /\.waiting-slot, \.group-msg \{ padding-inline: 0; \}/u;
    expect(chatView).toMatch(holderRule);
    const bareRule = /\.msg\.event-group > summary, \.session-activity, \.msg-notice \{ padding-inline: var\(--pi-row-inset\); \}/u;
    expect(chatView).toMatch(bareRule);
    const card = readFileSync(join(here, "InteractiveCard.ts"), "utf8");
    expect(card).not.toContain("--pi-row-inset");
  });
});
