# Sync that converges: compare heads, never trust the stream alone

Owner, 2026-09-30 01:02: "The page froze.
Use message sequence numbers, indices or versions to check which messages weren't updated.
Guarantee sync, consistency, and recovery after the network drops, instead of a lost message
staying lost and a dead page never refreshing."

## What happened (2026-09-30, 00:58–01:02, production 8504)

| Surface | What the phone showed | What the daemon had |
|---|---|---|
| pi web session (`01a04701`) | Last row: "CI passed on da9cb17e", hours old. Status "turn in progress · 1h 20m". | Hundreds of later entries. A fresh page load showed them all and followed live frames. |
| playria session (`01a059ee`) | "Is it running?" (00:51:01), then only "agent running 7m 36s". | Reply text at 00:54:44 and tool calls every ~30 s from 00:52 onwards, all on disk and in `/messages`. |
| All projects list | Only the pinned session. | Not yet investigated. |

Evidence:
- The daemon's status and transcript were correct in both sessions (disk tail, `/status`, `/messages?limit=100`).
- A fresh browser page on the same build showed the correct rows, and its gap repair applied live frames (frontier 304067 → 304084 in 20 s; a new row appeared).
- The phone re-read `/messages?limit=100` and `/stream-snapshot` at 20:58:56 (web log) and still showed rows from hours earlier.
- Production ran web `2.202609.28` against a sessiond still on `2.202609.27`. The `.27` daemon sends frames with `seq` but no `epoch`, no join frame, and no `streamPosition` or `revision` in status. Phases 1–5 depend on all of these. The daemon was not restarted because the restart-when-idle watcher waits for all sessions to go idle, and six were busy the whole time. That contradicts the owner's ruling "updates restart everything".
- The daemon itself has no single head. Status `messageCount` counts readable messages (16372 for playria) and `/messages` `total` counts branch messages (16392). The two disagree by definition, so no client can compare "what I have" with "what the daemon has".
- The same phone re-read playria's git status and file tree about twice a second while its agent wrote files. That is a refresh storm and a candidate for the "frozen page".

The exact line that kept the phone's stale rows is **not reproduced**: that needs the phone's cache. The candidate, from the code, is `refreshByDeltaReplay`:
1. The page cites a persisted watermark `seq`.
2. A `.27` daemon has no epoch, so after a daemon restart its seq starts again from zero.
3. "Frames after seq N" then returns nothing.
4. The cached rows are kept and marked current.

## Why phases 1–5 did not save it

Phases 1–5 made the incremental path correct: an ordered inbox, seq and epoch, gap repair, deadlines. But every recovery still trusts that path. Nothing ever compares the page's content with the daemon's content. Any hole in the incremental path leaves the page wrong until a manual reload, and says nothing: version skew, a frame the ring evicted, a cache from another daemon instance, a merge bug, or a socket that died without closing. This is the fifth report of the same symptom. Per the owner's rule, the fix is the invariant, not another producer patch.

## The invariant

> Every surface the browser shows is either **equal to the daemon's version** of it, or **visibly marked** as behind or unknown. A surface that is behind converges **without a reload** within *T* seconds of the daemon being reachable.

Incremental frames stay as the fast path for latency. Correctness comes from comparing versions.

## Design

### 1. Every synced resource has a head

A head is a small value that changes exactly when the resource changes:

| Resource | Scope key | Head |
|---|---|---|
| Transcript | machine + session | `{ epoch, length, leafId }`: the branch length and the id of the last entry. pi entries already carry `id` and `parentId`. |
| Session status | machine + session | `{ epoch, revision }` (exists since phase 1) |
| Session list | machine + project (or all) | `{ epoch, revision }` of the catalog |
| Open asks and dialogs | machine + session | `{ epoch, revision }` (`pendingDialogsRevision` exists) |
| Plugin panels | plugin + scope | the plugin's own revision; the host only compares |

`epoch` is the daemon instance. A different epoch means "everything you hold may be from another numbering".

### 2. Heads travel everywhere, cheaply

- Every status frame, every keepalive (20 s), and every HTTP read carries the heads of what it concerns.
- One read, `GET /api/heads?keys=…`, returns the heads for every surface on screen in one small response. It works even when the socket is dead.
- The transcript head is the only value anything compares. Status `messageCount` stays a display figure: it leaves out compaction summaries, which the transcript shows (16372 against 16392 on playria). Whether the sidebar should count them is the owner's call, not part of this change.

### 3. The browser reconciles: compare, then fetch by index

One pure classifier per resource, `syncVerdict(local, remote, inFlight)`, with its states named and tested:

| Verdict | When | Action |
|---|---|---|
| `current` | heads equal | nothing |
| `ahead-in-flight` | a streaming partial the daemon has not persisted yet | nothing (bounded by *T*) |
| `behind(afterId, afterLength)` | same epoch, and the daemon's branch extends ours | `GET /messages?after=<leafId>`. The reply must start at `length+1` and its first `parentId` must be our leaf. Otherwise the verdict becomes `diverged`. |
| `diverged` | other epoch, our leaf is not on the daemon's branch (compaction, tree navigation, restart), or the reply did not connect | reload the tail window and replace rows by entry id; unsettled local sends are carried over |
| `unknown(since)` | no head for longer than the liveness window | show it; keep asking |

- Rows are keyed by pi's entry id, so applying the same entry twice or out of order is harmless.
- The transcript cache becomes only a display seed marked "cached" until the first head comparison confirms it. Delta replay from a persisted watermark is retired, since that is the candidate producer above.
- **When the compare runs:** on every head that arrives, on `visibilitychange`, `online`, `pageshow` and focus, and at least every *T* seconds while visible (one `/api/heads` read). A page cannot sit wrong for longer than *T* without the next compare finding it.

### 4. A page cannot fail silently

- **Socket watchdog.** No frame, keepalive included, for 2 × 20 s means the socket is closed and reopened. The first thing after a reconnect is a head comparison.
- **Honest labels.**
  - After 2 s behind, a surface shows a thin "Catching up…" line.
  - When unknown, it shows "Offline · updated 00:51" instead of stale rows as if they were current.
  - The status line never claims a live state that the transcript head contradicts.
- **No refresh storms.** A burst of `workspace.changed` coalesces into at most one git status and one tree read per 2 s per workspace. The web log showed about two a second.

### 5. Version skew is a state, not an accident

- The daemon advertises `protocolVersion`. On a mismatch, the web process and the page show "The session service is on an older build. Restart it to finish the update". The page then falls back to polling heads and re-reading the tail. Only the fields both builds have are needed for that.
- **The update restarts the daemon too, as the owner ruled.** The restart-when-idle watcher goes away. A daemon restart settles in-flight tool calls as interrupted (owed work, now required), so an interruption leaves an honest record.

## Owner decisions (2026-09-30 01:20)

1. **Direction approved** as written above.
2. **The quiet window *T* is a setting**, shown on the Settings page, default 15 s. Owner: "pull only when nothing at all has arrived for 15 s". So there is **no periodic poll while visible**, which replaces the "at least every *T* seconds" line in section 3:
   - Any frame resets the page's quiet timer. A page pulls `/api/heads` only when *T* passes with nothing received, and on `visibilitychange`, `online` and `pageshow`.
   - **The heartbeat is that frame, and it stays tiny.** The daemon sends it only on a socket that has been quiet, at an interval below *T* (the page names its *T* when it subscribes), so a healthy idle session never triggers a pull. It carries only the compact heads, a few tens of bytes. Measured today: an idle socket carries one 20-byte keepalive per 20 s. The status frames sent while streaming (284 in 45 s on playria) are the real traffic; phase A measures them and sends deltas.
   - *T* is per device (phone and desktop may want different values), stored with the browser's other preferences.
3. **Behind label: only when stuck.** Nothing is shown while a page catches up within *T*. After *T*, still behind shows "Catching up…", and no head shows "Offline · updated HH:MM".
4. **Order: sync first**, before `ask_user`. Two user-reported bugs go ahead of phase A: Enter picking a Chinese IME candidate sends the message, and sessions missing Archive and Delete.
5. **Restart the daemon now**, and remove the restart-when-idle watcher.

   Done at 10:26 in two attempts. The first used `launchctl kickstart -k`, which restarts the definition launchd already holds. A plist names its build by store path, so the daemon came back on `.27`. The second ran `pi-web restart` from a one-shot job outside the daemon. That boots each service out and back in, and the daemon now runs `.28`. nix-config's update path already does it the second way: `pi-web restart` in the activation, or from `com.pi-web.update-restart` when hosted. Only an ad-hoc `kickstart` was wrong.

## Phase A protocol (daemon)

1. **Message identity.** Every transcript message carries `entryId`, the id of the pi entry it was projected from. Ids are written into the session file, so they survive daemon restarts; the transcript head needs no epoch.
2. **Transcript head** `{ n, leaf }`: `n` is the number of messages the branch projects to (the same `total` that `/messages` pages by), and `leaf` is the `entryId` of the last one (`null` when empty).
   - The projection is not append-only: a later `context_edit` removes a retried attempt, and the Stop mark annotates an earlier reply. So `n` can shrink and `leaf` can change without growing.
   - The page never assumes; it verifies. A catch-up reads from index `n0 - 1` of its old head, and the message there must still be `leaf0`. If it isn't, the verdict is `diverged` and the tail window is reloaded.
   - The head is cached per session and keyed by pi's leaf id, since only an appended entry changes it. A 69k-entry branch is walked once per append, not once per heartbeat.
3. **`/messages` returns `head`**, computed in the same tick as the page it answers with.
4. **Heartbeat.** It keeps the `keepalive` frame type, so older pages still read it as liveness.
   - It is sent per socket, and only after that socket has been quiet for its interval: `0.6 × T`, from the `quiet=<seconds>` the page names when it subscribes, clamped to 3–20 s. A page that names nothing gets the 20 s it gets today.
   - A session socket's heartbeat carries `head: { seq, epoch, n, leaf }`, about 90 bytes.
   - The stream position is nested under `head` on purpose. A top-level `seq` would enter the page's gap repair as if it were the missed frame itself, and with exactly one frame missing it would be marked applied and lost.
5. **Heads read.** `POST /sessions/heads` with `{ sessions: [{ id, cwd }] }` returns each session's `{ seq, epoch, n, leaf }`, or `unknown` when the daemon does not hold it open. A page uses it when *T* passes with nothing received.
6. **The head is what gets compared.** Status carries the head too. `messageCount` stays a display figure and is never compared, since it counts a different set (it leaves out compaction summaries).

## Every surface is live (B28, owner 2026-09-30)

Owner: "every screen should take event-based updates at all times … when no message arrives within 15 s (per the setting), actively probe liveness, check the versions and pull the latest updates", and "guarantee maximal message efficiency and low latency". Every surface should take event-based updates at all times, and when nothing arrives within T (default 15 s) the page should probe the heads and pull the latest changes.

**What is wrong today** (traced, `PiWebApp.ts:2833-2880`):
- The machine-wide session list costs 1 + P + W requests: projects, then workspaces per project, then sessions per workspace.
- It is cached for 30 s (`QUICK_SWITCHER_REFRESH_MS`) and sorted by `modified` at fetch time.
- No event touches it. Row badges (state, waiting) do follow `status.update` and `activity.update` on the global socket, but a row's place and its "latest activity" do not, so a session that just spoke stays where it was.
- A failed workspace read becomes `[]`.

**Design:**
1. **One daemon fact for order.** `SessionStatus.lastActivityAt` (ISO) is the time of the latest transcript append, turn start or turn end. It rides every `status.update` frame on the global socket that already exists. The list orders rows by `lastActivityAt`, falling back to `modified` when unknown, and re-sorts on the frame. There is no refetch, and a frame costs a few dozen bytes.
2. **One read for the list.** `GET /api/sessions/board` returns every session on the machine, each with `lastActivityAt`, plus the list head `{epoch, revision}`. It replaces the 1 + P + W fan-out. A workspace the daemon cannot read is listed as `unknown`, never dropped (B8).
3. **The quiet window.** The global socket carries the list head in its keepalive, as the session socket does for the transcript (A2). After T with no frame, the page compares heads and pulls `/sessions/board` only when the head moved.
4. **Latency and efficiency budgets**, measured by the phase C probe:
   - an event reaches the row within one animation frame;
   - a keepalive is under 120 bytes;
   - a quiet page makes one head comparison per T and no list read;
   - the list read is one request.

## What this keeps and what it retires

- **Keeps:** the phase 1 inbox and ledger, the phase 2 deadlines and dispositions, and the phase 3 gap repair as the low-latency path.
- **Retires:** delta replay from a persisted watermark, and "fresh because nothing arrived".

## Phases and proof

| Phase | Scope |
|---|---|
| A | Daemon: transcript head `{epoch, length, leafId}` on status, keepalive and every read; `GET /messages?after=`; `GET /api/heads`; one message counter; `protocolVersion`. |
| B | Browser: `syncVerdict` and its effect layer, rows keyed by entry id, cache as a seed, the watchdog, honest labels. |
| C | Session list, asks and dialogs, and plugin panels on the same heads. Refresh coalescing. |
| D | Skew banner and fallback. The update restarts the daemon. In-flight tool calls are settled on restart. |

Each phase is accepted only when **fault-injection probes on 8505** show convergence within *T* without a reload, and show the old build failing:
1. drop frames at the proxy;
2. freeze the socket without closing it;
3. restart the daemon mid-turn;
4. seed the page with a cache from another daemon instance;
5. background the page for 5 minutes;
6. serve the page from a newer web build than the daemon.
