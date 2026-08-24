import { beforeEach } from "vitest";
import { Storage } from "happy-dom";

/**
 * Give every test its own `localStorage` and `sessionStorage`.
 *
 * Node 24 added experimental Web Storage globals, and on a Node that ships them
 * both halves of this repository's storage assumptions break:
 *
 * - `localStorage` exists only as a getter that warns and returns `undefined`
 *   unless the process was started with `--localstorage-file`, and it outranks
 *   the one happy-dom installs. Every DOM test file follows the testing guide's
 *   `localStorage.clear()` cleanup, so the first `afterEach` throws, the rest of
 *   that hook (mock and global-stub restoration) never runs, and the failure
 *   cascades through the file.
 * - `sessionStorage` does work, but it is one store for the whole process, so
 *   module-level caches that persist through it (the chat history cache) leak
 *   state from one test into the next.
 *
 * Installing a fresh store before each test fixes both, and matches what the
 * browser gives a page: storage that starts empty and belongs to nobody else.
 * Files that install their own storage fake still win, because their own
 * `beforeEach` runs after this one.
 */
beforeEach(() => {
  installStorage("localStorage");
  installStorage("sessionStorage");
});

function installStorage(name: "localStorage" | "sessionStorage"): void {
  Object.defineProperty(globalThis, name, { value: new Storage(), configurable: true, writable: true });
}
