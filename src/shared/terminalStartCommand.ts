/**
 * When a new shell is ready for its start command. A line typed while the shell still starts is
 * thrown away (zsh did), so the line waits until the shell's output has gone quiet for
 * SHELL_SETTLED_MS, and at most SHELL_READY_CAP_MS: a shell that never goes quiet is typed into
 * anyway. The session daemon and the page that types for an older daemon wait alike.
 */
export const SHELL_SETTLED_MS = 300;
export const SHELL_READY_CAP_MS = 5_000;
