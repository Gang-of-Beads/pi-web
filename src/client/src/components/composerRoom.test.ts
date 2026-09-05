import { describe, expect, it } from "vitest";
import { listStyles } from "./shared";
import { appStyles } from "./PiWebApp";
import { chatStyles } from "./ChatView";
import { promptEditorStyles } from "./PromptEditor";

const sheets = `${String(appStyles)}\n${String(listStyles)}\n${String(promptEditorStyles)}\n${String(chatStyles)}`;

describe("what floats over the composer", () => {
  /**
   * Attach floats over the bottom right corner of the box it attaches to, so
   * the text is paid room for it. An earlier version reserved room for two
   * buttons and then moved both away, leaving a strip of empty space the text
   * was not allowed to use.
   *
   * Dictation is not one of them: a microphone is not a property of the text,
   * so it is a control in the row below.
   */
  it("makes room for the one control that floats over it", () => {
    const rule = /(?:^|\})\s*textarea\s*\{([^}]*)\}/mu.exec(sheets)?.[1] ?? "";
    const attach = /\.editor-attach\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";
    const dictate = /\.editor-dictate\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";

    expect(attach).toMatch(/position:\s*absolute/u);
    expect(dictate).not.toMatch(/position:\s*absolute/u);
    // Room for one button, not two.
    expect(rule).toMatch(/padding-right:\s*calc\(var\(--pi-space-4\) \+ 36px\)/u);
  });
});

describe("the step footer of a question card", () => {
  /**
   * The footer used to stick to the bottom of the viewport, so options earlier
   * in the list scrolled underneath it: the reader could see an option's top
   * edge above the footer and its bottom edge below, with no scroll position
   * that showed the whole thing.
   *
   * Scroll margin was tried and only moves programmatic scrolling, not the
   * reader's own. A footer that does not overlap cannot hide anything.
   */
  it("does not float over the options", async () => {
    const { AskUserCard } = await import("./AskUserCard");
    const rule = /\.form-footer\s*\{([^}]*)\}/u.exec(String(AskUserCard.styles))?.[1] ?? "";

    expect(rule).not.toMatch(/position:\s*sticky/u);
  });
});



describe("the button that returns you to the newest message", () => {
  /**
   * It belongs in the corner a reader scrolling down is already watching. It
   * was moved to the top once because the bottom edge carried the composer
   * controls and a full-width activity dock; the dock is its own row now and
   * its quiet states hug their words, so that corner is free again.
   */
  it("sits at the bottom right, where the reader is heading", () => {
    const rule = /\.jump-to-bottom\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";

    expect(rule).toMatch(/bottom:/u);
    expect(rule).not.toMatch(/(^|;)\s*top:/u);
  });

  /**
   * The dock shares that corner and is not one height: a hugging pill when the
   * turn is quiet, a full row while the assistant works, taller again on a
   * touch screen. A fixed offset is wrong in most of those states, so the row
   * is measured and spent as a length - the same treatment the scrollbar gets
   * two properties above.
   */
  it("clears the activity dock by measuring it rather than guessing", () => {
    const rule = /\.jump-to-bottom\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";
    const bottom = /bottom:\s*calc\(([^;]*)\)/u.exec(rule)?.[1] ?? "";

    expect(bottom).toMatch(/--pi-chat-dock-room/u);
    expect(bottom).toMatch(/\+\s*var\(--pi-space-\d\)/u);
  });

  it("is square rather than a pill", () => {
    const rule = /\.jump-to-bottom\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";

    expect(rule).toMatch(/border-radius:\s*var\(--pi-radius-(xs|sm|md)\)/u);
  });

  /**
   * The reading column takes the whole width it is given, so the gutter that
   * positions the button is also where the message's right border is drawn.
   * Offsetting the button by the gutter alone therefore landed its edge on
   * that border, and the two lines read as one welded control.
   */
  it("is inset from the message's own border rather than sitting on it", () => {
    const rule = /\.jump-to-bottom\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";
    const right = /right:\s*calc\(([^;]*)\)/u.exec(rule)?.[1] ?? "";

    expect(right).toMatch(/--pi-chat-gutter/u);
    expect(right).toMatch(/--pi-chat-scrollbar/u);
    expect(right).toMatch(/\+\s*var\(--pi-space-\d\)/u);
  });
});

describe("controls that were moved into the row", () => {
  /**
   * Dictate was moved into the control row but its absolute positioning was
   * left behind. Absolute positioning takes an element out of the row's queue,
   * so it flew back to the bottom right and landed on top of the send button,
   * hiding it behind a microphone.
   *
   * A control in a row is positioned by the row.
   */
  it("is positioned by the row rather than by coordinates", () => {
    const rule = /\.editor-dictate\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";

    expect(rule).not.toMatch(/position:\s*absolute/u);
  });
});

describe("the size of a drawer section button", () => {
  /**
   * They are a strip of section names above the conversation, not primary
   * actions, and at full size they took a band of a phone screen that the
   * conversation needed.
   */
  it("is smaller than a control you press to act", () => {
    const rule = /\.drawer-tab\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";
    const height = /min-height:\s*(\d+)px/u.exec(rule)?.[1] ?? "";

    expect(Number(height)).toBeLessThanOrEqual(24);
  });
});

describe("the buttons in the control row", () => {
  /**
   * Dictate kept overrides from when it floated over the corner of the text:
   * 40px on a touch screen while every other control in the row is 36px, and
   * an offset for a position it no longer has. Attach still floats inside the
   * composer, so its own size is its own business.
   */
  it("leaves dictation the size of the row it sits in", () => {
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n {2}\}/u.exec(sheets)?.[1] ?? "";

    expect(coarse).not.toMatch(/\.editor-dictate/u);
  });
});

describe("the unread dot on a project tile", () => {
  /**
   * Measured on the running app: a 7px dot overlapping the actions button by
   * 5x7px, so most of it sat on a control it has nothing to do with. Both are
   * pinned to the same corner, and the dot was offset by a guess at the
   * button's width rather than by the width itself.
   */
  it("is offset by the button beside it rather than by a guess", () => {
    const rule = /\.list-body\.tiles \.action-activity\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";

    expect(rule).toMatch(/right:\s*calc\(/u);
    expect(rule).toMatch(/--pi-tile-menu-size/u);
  });
});

describe("the mobile navigation panel", () => {
  /**
   * A phone shows one place at a time: the list, or the conversation. The panel
   * had a rule that laid it out inside the navigation view and no rule that
   * took it away anywhere else, and a div defaults to being shown - so the
   * session list sat above the conversation, leaving the conversation a strip
   * at the bottom of the screen and neither surface making sense.
   */
  it("is shown only in the view that is about navigating", () => {
    const app = /main\.navigation-view \.mobile-navigation-panel[^}]*\}/u.exec(sheets)?.[0] ?? "";
    const hidden = /main:not\(\.navigation-view\) \.mobile-navigation-panel\s*\{[^}]*display:\s*none/u.exec(sheets)?.[0] ?? "";

    expect(app).not.toBe("");
    expect(hidden).not.toBe("");
  });
});

describe("the shape of the drawer's section buttons", () => {
  /**
   * They were the one pill left among square-cornered controls - message
   * cards, icon buttons and rows all round to the radius scale - so the strip
   * read as belonging to a different interface than the conversation under it.
   */
  it("rounds to the scale rather than to a pill", () => {
    const rule = /\.drawer-tab\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";

    expect(rule).toMatch(/border-radius:\s*var\(--pi-radius-(xs|sm|md)\)/u);
    expect(rule).not.toMatch(/--pi-radius-pill/u);
  });
});

function allRulesFor(selector: string): string[] {
  const pattern = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, "gu");
  return [...sheets.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("where the activity marker lives", () => {
  /**
   * Anchored to the bottom of the viewport, it passed over the conversation at
   * every scroll position but the very bottom: measured live at 1440x900 it
   * covered three lines including an assistant header, and reserving room at
   * the end of the transcript could not help text in the middle.
   *
   * A row of its own cannot cover anything.
   */
  it("occupies a row instead of floating over the words", () => {
    const rules = allRulesFor(".activity-dock");

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => /position:\s*absolute/u.test(rule))).toBe(false);
  });

  it("lets the conversation and the marker share the column", () => {
    const rules = allRulesFor(".chat-wrap");

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => /flex-direction:\s*column/u.test(rule))).toBe(true);
  });

  /**
   * The quiet states hugged their words while the dock was placed by
   * coordinates, because an absolute box with one edge left free shrinks to
   * fit. Moving the dock into the column made it a row, and a row stretches:
   * "idle" became a 240px stub with one word in its left corner, which is the
   * empty card the max-width was added to remove.
   *
   * A row that should hug has to say so.
   */
  it("lets the quiet states hug their words instead of drawing an empty stub", () => {
    for (const state of [".activity-dock.idle", ".activity-dock.background"]) {
      const rules = allRulesFor(state);

      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((rule) => /width:\s*fit-content/u.test(rule))).toBe(true);
      // `right` places nothing in a row; leaving it behind hides the bug again.
      expect(rules.some((rule) => /(^|;)\s*right:/u.test(rule))).toBe(false);
    }
  });
});

describe("the size of a target on a touch screen", () => {
  /**
   * Copy and resend measured 24x24 on a phone. A fingertip covers far more
   * than that, so the tap either misses or lands on the message underneath.
   * The drawn button stays small; only what a finger can hit grows.
   */
  it("gives message actions a finger-sized reach without redrawing them", () => {
    const rules = allRulesFor(".msg-action");

    expect(rules.some((rule) => /width:\s*24px/u.test(rule))).toBe(true);
    expect(sheets).toMatch(/\.msg-action::after\s*\{[^}]*inset:\s*-10px/u);
  });
});
