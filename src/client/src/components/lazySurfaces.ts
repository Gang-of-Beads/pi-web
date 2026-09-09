/**
 * Surfaces that are only defined when they are first opened.
 *
 * The entry bundle carried every dialog the app can show, including ones a
 * session never opens: settings, the quick switcher and the session tree are
 * about 110KB of source that first paint does not need. They are imported when
 * the app has finished booting, and again - awaited this time - at the moment
 * something asks to open them, so a cold open waits for its own module instead
 * of every open paying for it up front.
 *
 * Opening awaits the load rather than rendering an empty frame: a dialog that
 * appears blank is a lie about its contents, while a dialog that appears a
 * moment later is only slow.
 */
export type LazySurface = "settings" | "quick-switcher" | "session-tree";

const loaders: Readonly<Record<LazySurface, () => Promise<unknown>>> = {
  settings: () => import("./SettingsDialog"),
  "quick-switcher": () => import("./QuickSwitcher"),
  "session-tree": () => import("./SessionTreeNavigator"),
};

const started = new Map<LazySurface, Promise<void>>();

/**
 * Remember a load while it is unsettled, and keep it only if it succeeded.
 *
 * A failed load must not be remembered as an answer. The usual cause is a
 * deploy while the tab was open, so the module this bundle names is gone:
 * keeping the rejection would leave the surface permanently unopenable, even
 * once a reload would fix it. Forgetting means the next open tries again.
 */
export function trackLoad<K>(loads: Map<K, Promise<void>>, key: K, pending: Promise<void>): Promise<void> {
  loads.set(key, pending);
  void pending.catch(() => { if (loads.get(key) === pending) loads.delete(key); });
  return pending;
}

export function loadSurface(surface: LazySurface): Promise<void> | undefined {
  const existing = started.get(surface);
  if (existing !== undefined) return existing;
  return trackLoad(started, surface, loaders[surface]().then(() => undefined));
}

/**
 * Warm every lazy surface once the app is past its first paint. A failure here
 * is deliberately silent: the open path awaits the same load and is where a
 * real failure has to be reported.
 */
export function warmLazySurfaces(schedule: (task: () => void) => void = defaultSchedule): void {
  schedule(() => {
    for (const surface of Object.keys(loaders)) {
      if (isLazySurface(surface)) loadSurface(surface)?.catch(() => undefined);
    }
  });
}

function isLazySurface(value: string): value is LazySurface {
  return value === "settings" || value === "quick-switcher" || value === "session-tree";
}

function defaultSchedule(task: () => void): void {
  const idle = globalThis.requestIdleCallback;
  if (typeof idle === "function") { idle(() => { task(); }, { timeout: 2000 }); return; }
  globalThis.setTimeout(task, 1200);
}

export function lazySurfacesStarted(): readonly LazySurface[] {
  return [...started.keys()];
}

export function resetLazySurfaces(): void {
  started.clear();
}
