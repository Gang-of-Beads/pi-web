// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { render, type TemplateResult } from "lit";
import { renderActionActivityIndicator } from "../../../../pi-web-plugins/machines/browser/activityBadge.js";

function rendered(template: TemplateResult): HTMLElement {
  const host = document.createElement("div");
  render(template, host);
  const wrapper = host.querySelector(".action-activity");
  if (!(wrapper instanceof HTMLElement)) throw new Error("badge wrapper absent");
  return wrapper;
}

/**
 * Round 15 found two marks that were persistent wrappers toggled with
 * `[hidden]`, whose own author `display` rule beat the UA sheet's `[hidden]`
 * rule - CI asserted the attribute, the screen showed the mark anyway. These
 * tests assert the structure that decides honesty: the attribute on the
 * wrapper, and whether the unread class exists for the rail's :has() to see.
 */
describe("persistent marks that claim to be hidden", () => {
  it("an idle row hides its badge and carries no unread class for the rail to light", () => {
    const wrapper = rendered(renderActionActivityIndicator(undefined));
    expect(wrapper.hidden).toBe(true);
    expect(wrapper.querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("a genuinely unread row keeps its unread mark for the rail", () => {
    const wrapper = rendered(renderActionActivityIndicator(undefined, "Active", "Unread here"));
    expect(wrapper.hidden).toBe(false);
    expect(wrapper.querySelector(".activity-indicator.unread")).not.toBeNull();
  });

  it("an active row keeps its active mark", () => {
    const wrapper = rendered(renderActionActivityIndicator("session"));
    expect(wrapper.hidden).toBe(false);
    expect(wrapper.querySelector(".activity-indicator.session")).not.toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the companion rules that make [hidden] real", () => {
  const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");

  it("restates hidden for the persistent working mark", () => {
    expect(read("src/client/src/components/appShell/AppContextBar.ts")).toContain(".working[hidden] { display: none; }");
  });

  it("restates hidden for the persistent activity badge", () => {
    expect(read("src/client/src/components/shared.ts")).toContain(".action-activity[hidden] { display: none; }");
  });
});
