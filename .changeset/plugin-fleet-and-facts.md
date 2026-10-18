---
"@gang-of-beads/pi-web": patch
---

Browser plugins can build fleet-wide pages. A global page declared with `scope: "fleet"` is listed once whichever machine is selected. Through the new `context.fleet` it reads every configured machine with its reachability, and each machine's session board with how much of it answered. It opens a session on any machine through PI WEB's own navigation, and it adds, renames, removes, opens or rechecks machines through PI WEB's own dialogs.

Plugins can also subscribe to read-only session and machine facts:

- `context.sessions`: `onDidCreate`, `onDidRename`, `onDidReplace`, `onDidStartRun` and `onDidEndRun`.
- `context.machines`: `onDidAdd`, `onDidRemove` and `onDidChangeReachability`.

While a plugin listens to `onDidChangeReachability`, PI WEB keeps checking every machine's reachability, one read per machine every 15 seconds. A run ends `stopped` when you stopped it, `interrupted` when it was cut otherwise, the same words as the transcript and the server facts, and `failed` only when it ended on an error pi did not retry. Snapshots and facts are frozen, and enumerated values may gain members in later releases.

PI WEB now also sends four lifecycle events that `context.on` documented but never delivered: `session-selected`, `session-left` and `connection-changed` (both of which now carry `machineId`) and `theme-applied`. A new session that is still starting is announced as selected once, with its real id.
