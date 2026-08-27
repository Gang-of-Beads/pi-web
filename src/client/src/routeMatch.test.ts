import { describe, expect, it } from "vitest";
import { routeMatchesUrl } from "./routeMatch";

describe("whether the address bar still describes what is on screen", () => {
  /**
   * The back gesture asks the app to restore what the previous URL described.
   * The comparison that decides whether anything needs restoring looked at the
   * machine, project, workspace and session - and not at which view was open.
   *
   * So leaving the conversation for Files or Terminal wrote a new URL, but
   * pressing back found the four things it compares unchanged and concluded
   * there was nothing to do. Measured: four presses left the screen untouched
   * while the address bar said view=files. On Android that reads as a frozen
   * app, and the next press leaves it.
   */
  const base = { machine: "local", project: "p1", workspace: "w1", session: "s1" };

  it("says the URL no longer matches once the view has moved on", () => {
    expect(routeMatchesUrl({ ...base, view: "core:workspace.files" }, { ...base, view: "chat" }, "navigation")).toBe(false);
  });

  it("says it matches when the view agrees", () => {
    expect(routeMatchesUrl({ ...base, view: "chat" }, { ...base, view: "chat" }, "navigation")).toBe(true);
  });

  /**
   * The navigation view is the default and is not written to the URL, so an
   * absent view parameter has to match it rather than look like a difference.
   */
  it("treats an absent view parameter as the navigation view", () => {
    expect(routeMatchesUrl({ ...base, view: undefined }, { ...base, view: "navigation" }, "navigation")).toBe(true);
  });

  it("still notices the other four moving", () => {
    expect(routeMatchesUrl({ ...base, view: "chat" }, { ...base, session: "s2", view: "chat" }, "navigation")).toBe(false);
  });
});

describe("the view a URL leaves unwritten", () => {
  /**
   * The view is only written to the URL when it differs from what the layout
   * would show anyway. Reading an absent view as "navigation" was right for a
   * phone with no session, and wrong everywhere else: on a desktop an absent
   * view means the conversation, so a URL that matched perfectly compared
   * unequal, and the guard that keeps history from piling up never fired.
   */
  it("matches the conversation when that is what an absent view means", () => {
    const url = { project: "p", workspace: "w", session: "s", view: undefined };
    const state = { project: "p", workspace: "w", session: "s", view: "chat" };

    expect(routeMatchesUrl(url, state, "chat")).toBe(true);
  });

  it("still matches navigation when that is what an absent view means", () => {
    const url = { project: "p", workspace: "w", session: undefined, view: undefined };
    const state = { project: "p", workspace: "w", session: undefined, view: "navigation" };

    expect(routeMatchesUrl(url, state, "navigation")).toBe(true);
  });

  it("does not match a view the layout would not have chosen", () => {
    const url = { project: "p", workspace: "w", session: "s", view: undefined };
    const state = { project: "p", workspace: "w", session: "s", view: "navigation" };

    expect(routeMatchesUrl(url, state, "chat")).toBe(false);
  });
});
