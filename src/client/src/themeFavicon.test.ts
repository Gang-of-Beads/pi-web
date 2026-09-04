import { describe, expect, it } from "vitest";
import { applyThemeFavicon, themeFaviconHref, themeFaviconSvg } from "./themeFavicon";

describe("the favicon follows the theme", () => {
  it("draws the pixel glyph in the theme accent on the theme background", () => {
    const svg = themeFaviconSvg("#e8643c", "#15110e");
    expect(svg).toContain('fill="#15110e"');
    expect(svg).toContain('fill="#e8643c"');
    expect(svg.match(/<rect /gu)?.length).toBeGreaterThan(10);
  });

  it("encodes an inline data href", () => {
    expect(themeFaviconHref("#fff", "#000").startsWith("data:image/svg+xml,")).toBe(true);
  });

  it("rewrites the icon link from the theme tokens", () => {
    const written: string[] = [];
    const doc = { querySelector: () => ({ setAttribute: (_name: string, value: string) => { written.push(value); } }) };
    applyThemeFavicon({ "--pi-accent": "#abc", "--pi-bg": "#123" }, doc);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain(encodeURIComponent("#abc"));
  });

  it("touches nothing when the theme lacks the tokens", () => {
    const written: string[] = [];
    const doc = { querySelector: () => ({ setAttribute: (_name: string, value: string) => { written.push(value); } }) };
    applyThemeFavicon({}, doc);
    expect(written).toEqual([]);
  });

  it("touches nothing when the document has no icon link", () => {
    expect(() => { applyThemeFavicon({ "--pi-accent": "#abc", "--pi-bg": "#123" }, { querySelector: () => null }); }).not.toThrow();
  });
});
