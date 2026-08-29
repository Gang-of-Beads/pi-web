/**
 * The browser owns confirm/select/input; every other UI surface an extension
 * asks for is delegated to Pi's headless defaults, which cancel safely. The
 * cancel was silent: the pi updater asked through ui.custom every session,
 * every answer evaporated, and the prompt returned each time with nothing
 * anywhere saying why. The cancel stays - the browser truly cannot draw the
 * screen - but it is said out loud where the reader can find it.
 */
export function announceUnsupportedSurface(surface: string): string {
  return `An extension asked for a screen this browser cannot show (ui.${surface}); it was cancelled.`;
}

export function withUnsupportedSurfaceAnnouncement<Args extends unknown[], Result>(
  base: (...args: Args) => Result,
  announce: () => void,
): (...args: Args) => Result {
  return (...args: Args): Result => {
    announce();
    return base(...args);
  };
}
