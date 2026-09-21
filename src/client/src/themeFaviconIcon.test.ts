import { describe, expect, it } from "vitest";
import { applyThemeFavicon, themeFaviconSvg } from "./themeFavicon";

/**
 * The icon follows the theme: the pi glyph is typeset in the product's mono
 * stack and coloured by the active palette, and a theme may bring its own
 * mark instead.
 */
function fakeDocument() {
  const link = { href: "", setAttribute: (_name: string, value: string) => { link.href = value; } };
  return { link, querySelector: () => link };
}

describe("the theme icon", () => {
  it("typesets the pi glyph in the mono stack, coloured by the theme", () => {
    const svg = themeFaviconSvg("#d9a24a", "#131519");
    expect(svg).toContain("ui-monospace");
    expect(svg).toContain("&#960;");
    expect(svg).toContain('fill="#d9a24a"');
    expect(svg).toContain('fill="#131519"');
  });

  it("changes with the palette", () => {
    const dark = themeFaviconSvg("#d9a24a", "#131519");
    const light = themeFaviconSvg("#8a6510", "#f6f5f2");
    expect(dark).not.toBe(light);
  });

  it("uses a theme's own icon when it declares one", () => {
    const doc = fakeDocument();
    applyThemeFavicon({ "--pi-accent": "#fff", "--pi-bg": "#000" }, doc, "<svg xmlns='http://www.w3.org/2000/svg'><circle r='1'/></svg>");
    expect(doc.link.href.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(doc.link.href)).toContain("circle");
  });

  it("accepts an image URL as a theme icon", () => {
    const doc = fakeDocument();
    applyThemeFavicon({}, doc, "https://example.test/icon.png");
    expect(doc.link.href).toBe("https://example.test/icon.png");
  });

  it("falls back to the generated glyph when the theme declares no icon", () => {
    const doc = fakeDocument();
    applyThemeFavicon({ "--pi-accent": "#8a6510", "--pi-bg": "#f6f5f2" }, doc);
    expect(decodeURIComponent(doc.link.href)).toContain("#8a6510");
  });
});
