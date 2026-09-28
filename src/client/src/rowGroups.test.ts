import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROW_GROUPS, groupedSelectors } from "./rowGroups.js";

const here = dirname(fileURLToPath(import.meta.url));
const chatView = readFileSync(join(here, "components/ChatView.ts"), "utf8");

describe("row margin groups", () => {
  it("gives every group at least one selector", () => {
    for (const membership of Object.values(ROW_GROUPS)) {
      expect(membership.selectors.length).toBeGreaterThan(0);
    }
  });

  it("claims each selector once", () => {
    const all = groupedSelectors();
    expect(new Set(all).size).toBe(all.length);
  });

  it("has a rule per group, driven by one token each", () => {
    expect(chatView).toContain(".msg.event-group > summary");
    expect(chatView).toContain("var(--pi-row-inset)");
    expect(chatView).toContain("var(--pi-row-gutter)");
  });

  it("never pads a holder, so a held card keeps the column's full width", () => {
    const holderRule = /\.waiting-slot, \.group-msg \{ padding-inline: 0; \}/u;
    expect(chatView).toMatch(holderRule);
    const bareRule = /\.msg\.event-group > summary, \.session-activity \{ padding-inline: var\(--pi-row-inset\); \}/u;
    expect(chatView).toMatch(bareRule);
    const askCard = readFileSync(join(here, "components/AskUserCard.ts"), "utf8");
    expect(askCard).not.toContain("--pi-row-inset");
  });
});
