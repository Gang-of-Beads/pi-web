/**
 * The quick switcher re-fetched its whole world on every open: projects, then
 * every workspace, then every workspace's sessions - measured at roughly a
 * dozen requests per open. Freshness is worth keeping; a dozen requests per
 * keystroke-adjacent open is not. Within a short window a reopen must serve
 * from the cache it just filled.
 *
 * Usage: node scripts/verify-switcher-refetch.mjs [port]
 */
import { deepClick, openApp } from "./lib/liveApp.mjs";

const port = process.argv[2] ?? "8505";
const app = await openApp({ port, phone: true });

// 路由接管让缓存命中的请求也出现在事件流里,否则第二次打开会被 HTTP 缓存吞掉
await app.page.route("**/api/**", (route) => route.continue());

const counting = { on: false, hits: 0 };
app.page.on("request", (request) => {
  const url = request.url();
  const isListing = /\/api\//.test(url)
    && /(sessions\?|\/projects\/|workspaces)/.test(url)
    && !/interrupted|background-tasks|subsessions|unread|workspace-catalog/.test(url);
  if (counting.on && isListing) counting.hits += 1;
});

const hitsInWindow = async (ms) => {
  const before = counting.hits;
  await app.page.waitForTimeout(ms);
  return counting.hits - before;
};

// 基线:什么都不做的窗口里,后台轮询自己会发多少请求
const idle = await hitsInWindow(2500);

// 冷开:缓存为空,必须真正拉取清单
counting.on = true;
await deepClick(app.page, "open sessions");
const cold = (await hitsInWindow(2200)) - idle;
await app.page.keyboard.press("Escape");
const idle2 = await hitsInWindow(2500);

// 热开:窗口内的重开必须只有后台基线,没有切换器自己的重拉
await deepClick(app.page, "open sessions");
const warm = (await hitsInWindow(2200)) - idle2;

console.log(`switcher-attributable requests: cold open=${String(cold)} warm reopen=${String(warm)} (idle baseline ${String(idle)}/${String(idle2)})`);
if (cold <= 5) {
  console.error("FAIL: the cold open issued almost no listing requests, so the switcher loads nothing measurable");
  process.exitCode = 1;
} else if (warm > 2) {
  console.error(`FAIL: a reopen within the window issued ${String(warm)} extra listing request(s) beyond the background baseline`);
  process.exitCode = 1;
} else console.log("PASS: cold open fetches, quick reopen serves from cache");

await app.close();
