import { chromium } from "@playwright/test";

const luminance = (colour) => {
  const [r, g, b] = colour.match(/\d+(\.\d+)?/gu).slice(0, 3).map(Number).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://127.0.0.1:8505", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const resolved = await page.evaluate(`(function () {
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const read = (token) => {
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      return getComputedStyle(probe).color;
    };
    const values = {
      success: read("--pi-success"),
      warning: read("--pi-warning"),
      danger: read("--pi-danger"),
      accent: read("--pi-accent"),
      raised: read("--pi-surface-raised"),
      card: read("--pi-surface-card"),
    };
    probe.remove();
    return JSON.stringify(values);
  })()`);
  const tokens = JSON.parse(resolved);
  for (const hue of ["success", "warning", "danger", "accent"]) {
    console.log(`${hue} on raised: ${ratio(tokens[hue], tokens.raised).toFixed(2)}  on card: ${ratio(tokens[hue], tokens.card).toFixed(2)}`);
  }
  await browser.close();
})();
