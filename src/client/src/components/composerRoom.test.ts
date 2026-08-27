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
   * It sat in the bottom right, the same corner the composer controls and the
   * activity dock occupy, and it was round where every other floating control
   * on that edge is round too - so it read as one more of them.
   *
   * It belongs at the top right instead: away from the controls, on the edge
   * you are scrolling away from, shaped like a panel affordance rather than a
   * pill.
   */
  it("sits at the top right, out of the way of the controls", () => {
    const rule = /\.jump-to-bottom\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";

    expect(rule).toMatch(/top:/u);
    expect(rule).not.toMatch(/bottom:/u);
  });

  it("is square rather than a pill", () => {
    const rule = /\.jump-to-bottom\s*\{([^}]*)\}/u.exec(sheets)?.[1] ?? "";

    expect(rule).toMatch(/border-radius:\s*var\(--pi-radius-(xs|sm|md)\)/u);
  });
});

describe("the header's action cluster", () => {
  /**
   * Measured at 393px the bar was exactly full: 60px of location, 163px of
   * session name - both already cut short - 34px of rename, and 136px of
   * circular actions. The actions keep their size whatever the screen does, so
   * every pixel they take comes out of the words that say where you are.
   *
   * On a phone they give up a little of their own room instead.
   */
  it("takes less room on a narrow screen", async () => {
    const { AppContextBar } = await import("./appShell/AppContextBar");
    const sheet = String(AppContextBar.styles);
    const narrow = /@media \(max-width: (?:430|640)px\)[^{]*\{([\s\S]*?)\n {4}\}/u.exec(sheet)?.[1] ?? "";

    expect(narrow).toMatch(/context-action-button/u);
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
