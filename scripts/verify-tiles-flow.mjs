/**
 * Tile grids collapse a list into invisible stacked strips when the row
 * tracks resolve below the tiles' height: each tile's top border peeks out
 * under the next tile's opaque body, and every label disappears. Measured on
 * the botim-eclipse project, whose 291 workspaces filled the whole page with
 * headless card tops.
 *
 * The invariant: successive tiles in one column sit at least a tile-height
 * apart, at phone and desktop widths.
 *
 * Usage: node scripts/verify-tiles-flow.mjs [port] [projectName]
 */
import { deepClick, openApp } from "./lib/liveApp.mjs";

const port = process.argv[2] ?? "8505";
const project = process.argv[3] ?? "botim-eclipse";

let failed = false;
for (const phone of [true, false]) {
  const app = await openApp({ port, phone });
  await deepClick(app.page, project);
  await app.page.waitForTimeout(5000);

  const geometry = await app.page.evaluate(() => {
    let list;
    const find = (root) => {
      const l = root?.querySelector?.("workspace-list");
      if (l) { list = l; return true; }
      for (const el of root?.querySelectorAll("*") ?? []) if (el.shadowRoot && find(el.shadowRoot)) return true;
      return false;
    };
    find(document.querySelector("pi-web-app")?.shadowRoot);
    if (!list) return undefined;
    const rows = [...list.shadowRoot.querySelectorAll(".workspace-row")].slice(0, 8).map((row) => {
      const r = row.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) };
    });
    return { rows, tracks: getComputedStyle(list.shadowRoot.querySelector(".list-body")).gridTemplateRows.slice(0, 30) };
  });

  if (geometry === undefined || geometry.rows.length < 4) {
    console.error(`FAIL(${phone ? "phone" : "desktop"}): fewer than four tiles laid out, so flow was never demonstrated`);
    await app.close();
    process.exit(1);
  }

  // Same-column neighbours: two tiles whose x aligns within 4px must be at
  // least one tile-height apart, or the lower one paints over the upper one.
  const column = geometry.rows.filter((r) => Math.abs(r.x - geometry.rows[0].x) < 4);
  let step = Number.POSITIVE_INFINITY;
  for (let i = 1; i < column.length; i += 1) step = Math.min(step, column[i].y - column[i - 1].y);
  const tileH = geometry.rows[0].h;
  const label = phone ? "phone" : "desktop";
  console.log(`${label}: tile h=${String(tileH)}px min column step=${String(step)}px tracks=[${geometry.tracks}]`);

  if (step < tileH) {
    console.error(`FAIL(${label}): tiles overlap - a ${String(tileH)}px tile repeats every ${String(step)}px, so every label is painted over`);
    failed = true;
  }
  await app.close();
}

if (!failed) console.log("PASS: tiles flow at both widths, every label readable");
process.exitCode = failed ? 1 : 0;
