import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keyboardInset } from "./keyboardInset";

/**
 * The composer sits at the bottom of a fixed, 100dvh shell. A soft keyboard
 * shrinks only the visual viewport, so without this the send button ends up
 * underneath the keyboard — measured at y=799 with 519px visible.
 */
describe("keyboardInset", () => {
  it("reports the height a keyboard covers", () => {
    expect(keyboardInset(839, { height: 519, offsetTop: 0 })).toBe(320);
  });

  it("reports nothing when the viewports agree", () => {
    expect(keyboardInset(839, { height: 839, offsetTop: 0 })).toBe(0);
  });

  it("ignores a viewport scrolled down rather than shrunk", () => {
    // Scrolling under a collapsing URL bar offsets the visual viewport without
    // covering the bottom; treating that as a keyboard would shorten the shell
    // while the user is just scrolling.
    expect(keyboardInset(839, { height: 839, offsetTop: 60 })).toBe(0);
  });

  it("accounts for offset and shrink together", () => {
    // Keyboard up *and* the page scrolled: only the genuinely hidden part counts.
    expect(keyboardInset(839, { height: 500, offsetTop: 39 })).toBe(300);
  });

  it("ignores sub-pixel and few-pixel drift", () => {
    // Browsers report small differences during scroll momentum; reacting would
    // make the layout twitch.
    expect(keyboardInset(839, { height: 830, offsetTop: 0 })).toBe(0);
  });

  it("reports nothing when there is no visual viewport at all", () => {
    expect(keyboardInset(839, undefined)).toBe(0);
  });

  it("refuses implausible measurements instead of collapsing the shell", () => {
    expect(keyboardInset(0, { height: 519, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(839, { height: 0, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(839, { height: Number.NaN, offsetTop: 0 })).toBe(0);
  });

  it("never shortens the shell past its own height", () => {
    expect(keyboardInset(839, { height: 10, offsetTop: -5000 })).toBeLessThanOrEqual(839);
  });
});

describe("what has to be watched for the shell to keep the right height", () => {
  /**
   * A phone hides its address bar while you scroll, which changes the layout
   * viewport without touching the visual one. Only the visual viewport was
   * watched, so the shell kept a height the screen no longer had and its
   * bottom - the composer - sat off screen until a keyboard was opened and
   * closed by hand, which finally forced a recalculation.
   */
  it("recomputes on a window resize, not only a visual viewport one", () => {
    const source = readFileSync(join(process.cwd(), "src/client/src/components/PiWebApp.ts"), "utf8");
    const connect = /connectedCallback\(\)[\s\S]*?\n {2}\}/u.exec(source)?.[0] ?? "";

    expect(connect).toMatch(/window\.addEventListener\("resize", this\.onVisualViewportChange\)/u);
    expect(connect).toMatch(/window\.addEventListener\("orientationchange", this\.onVisualViewportChange\)/u);
  });

  /**
   * Browser chrome is still settling on the first frames, so the height read at
   * connect can be one nobody ever sees.
   */
  it("reads the height again once the first frames have settled", () => {
    const source = readFileSync(join(process.cwd(), "src/client/src/components/PiWebApp.ts"), "utf8");
    const connect = /connectedCallback\(\)[\s\S]*?\n {2}\}/u.exec(source)?.[0] ?? "";

    expect(connect).toMatch(/requestAnimationFrame\(\(\) => \{ this\.onVisualViewportChange\(\); \}\)/u);
  });

  it("stops watching when the shell goes away", () => {
    const source = readFileSync(join(process.cwd(), "src/client/src/components/PiWebApp.ts"), "utf8");
    const disconnect = /disconnectedCallback\(\)[\s\S]*?\n {2}\}/u.exec(source)?.[0] ?? "";

    expect(disconnect).toMatch(/window\.removeEventListener\("resize", this\.onVisualViewportChange\)/u);
    expect(disconnect).toMatch(/window\.removeEventListener\("orientationchange", this\.onVisualViewportChange\)/u);
  });
});

describe("the height the shell is given", () => {
  /**
   * The shell was sized with `100dvh`, on the assumption that a mobile browser
   * subtracts its own toolbar from it. Where that does not hold, the shell is
   * taller than the screen and its bottom - the composer - is cut off, which no
   * amount of recalculating fixes because the number itself is wrong.
   *
   * The visual viewport is what is actually visible, so it is used when it can
   * be read, and `100dvh` remains for engines that cannot report it.
   */
  it("prefers a measured visible height over the assumption", () => {
    const sheet = readFileSync(join(process.cwd(), "src/client/src/components/shared.ts"), "utf8");
    const host = /:host \{ --pi-app-safe-area-bottom[^}]*\}/u.exec(sheet)?.[0] ?? "";

    expect(host).toMatch(/height:\s*var\(--pi-app-visible-height,/u);
    expect(host).toMatch(/100dvh/u);
  });

  it("publishes what the visual viewport reports", () => {
    const source = readFileSync(join(process.cwd(), "src/client/src/components/PiWebApp.ts"), "utf8");
    const handler = /onVisualViewportChange = \(\): void => \{[\s\S]*?\n {2}\};/u.exec(source)?.[0] ?? "";

    expect(handler).toMatch(/--pi-app-visible-height/u);
  });
});
