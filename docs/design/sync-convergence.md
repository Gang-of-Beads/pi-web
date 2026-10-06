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
  - When unknown, it says so instead of showing stale rows as if they were current. (Superseded 2026-10-06: the word is "Syncing…", never "Offline"; see phase B.)
  - The status line never claims a live state that the transcript head contradicts.
- **No refresh storms.** The watcher drops git's own churn, dependency folders and pi's runtime state, and coalesces a burst into one `workspace.changed` per window: 250 ms for git state, 2.5 s for the tree (object model §1.16). The web log showed about two a second before it.

### 5. Version skew is a state, not an accident

- The daemon advertises `protocolVersion`. On a mismatch, the web process and the page show "The session service is on an older build. Restart it to finish the update". The page then falls back to polling heads and re-reading the tail. Only the fields both builds have are needed for that.
- **The update restarts the daemon too, as the owner ruled.** The restart-when-idle watcher goes away. A daemon restart settles in-flight tool calls as interrupted (owed work, now required), so an interruption leaves an honest record.

## Owner decisions (2026-09-30 01:20)

1. **Direction approved** as written above.
2. **The quiet window *T* is a setting**, shown on the Settings page, default 15 s. Owner: "pull only when nothing at all has arrived for 15 s". So there is **no periodic poll while visible**, which replaces the "at least every *T* seconds" line in section 3:
   - Any frame resets the page's quiet timer. A page pulls `/api/heads` only when *T* passes with nothing received, and on `visibilitychange`, `online` and `pageshow`.
   - **The heartbeat is that frame, and it stays tiny.** The daemon sends it only on a socket that has been quiet, at an interval below *T* (the page names its *T* when it subscribes), so a healthy idle session never triggers a pull. It carries only the compact heads, a few tens of bytes. Measured today: an idle socket carries one 20-byte keepalive per 20 s. The status frames sent while streaming (284 in 45 s on playria) are the real traffic; phase A measures them and sends deltas.
   - *T* is per device (phone and desktop may want different values), stored with the browser's other preferences.
3. **Behind label: only when stuck.** Nothing is shown while a page catches up within *T*. After *T*, still behind shows "Catching up…", and no head shows "Offline · updated HH:MM". (Refined 2026-10-06, phase B: the word is "Syncing…" for both, shown when frames are known missing or a check failed, and never "Offline".)
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

## Phase B for the transcript: what the page knows (owner, 2026-10-06)

### The case

Owner, 2026-10-06 13:56 (phone, production 8504): the last row was his own message, nothing after
it, and the dock said "idle". On disk the agent had answered (playground session `01a10fd0`):
his message was steered in at 09:50:19, ten tool rounds followed, and the reply was written at
09:55:45. The daemon log for the session:

| UTC | The page |
|---|---|
| 09:50:51 | joined: tail read, stream snapshot, status, socket |
| 09:50:56 - 09:56:00 | nothing (backgrounded: the socket and its timers froze) |
| 09:56:00 | back in front: a delta replay from the watermark persisted at the join |
| 09:56:36 | a full re-join |

The screenshot fell between 09:56:00 and 09:56:36: a status already current next to a transcript
from before the page went to the background, shown as one final state. Owner: "show something like
sending until the page is in step with the server, then the real state; consider every
intermediate state."

Owner, later the same day, on when to say it (answers to ask `c4825c84`):

- "Syncing…" shows only when the page knows the browser and the server disagree, or a check could
  not confirm they agree. Never for every check: on a poor network every turn would flash it.
- Never "offline": the page is always trying to sync, and a warning the reader cannot act on is not
  shown (the standing rule for alerts). The reader is told the page is syncing, as a message is
  "sending".
- The sync state belongs to the transcript, not to the ask card: an open card does not hide it.

This matches the 2026-09-30 decision that the catching-up word shows only when the page is stuck,
not while it routinely checks.

### Four states, one owner

`SessionController` owns one value per selected machine + session, `transcriptSync`, and the dock
reads it before anything else it would say (`transcriptSync.ts`, lookup tables for the
transitions, the dock and the retry).

| State | Means | The dock says |
|---|---|---|
| `confirmed` | the page applied a full read and every frame after it, in seq order, without a gap | the session's real status (idle, working, waiting...) |
| `checking` | a routine reason to look; nothing is known to be missing, and the check is under way | the session's status, unchanged: checking is quiet |
| `behind` | the page knows frames are missing (a seq gap, a heartbeat ahead, a frame it could not read, another seq space) and is fetching them | "Syncing…", with the sending dots, over the status word, the ask card's notes dock and the sending line alike; plugin notes kept |
| `retrying` | a check failed (an error, or the 30 s request deadline) | "Syncing…"; the check is retried from 5 s, doubling to a minute, for as long as it takes |

### What starts a check

| Event | Why | The check | Marks |
|---|---|---|---|
| a session is opened or selected | nothing read yet | the join read | `checking` |
| the page becomes visible after being hidden, or is restored from the back-forward cache | a hidden page's socket and timers freeze; frames sent meanwhile may be gone | catch up from the frontier | `checking` |
| the browser reports `online` | the network came back | catch up from the frontier | `checking` |
| the socket loses an open connection, including the liveness check dropping one silent past 42 s (checked every 5 s while visible: the probe after silence) | frames published until it reopens reach nobody here | catch up from the frontier (a failed reconnect attempt is not news: a daemon that stays down would repeat it on every try) | `checking` |
| the socket reopens | the new connection carries nothing over | catch up from the frontier; the ledger ask waits for it | `checking` |
| the selected session goes idle | the status may come over the machine socket ahead of the session socket's own frames, and a trailing loss there has no later frame to reveal it | catch up from the frontier | `checking` |
| the seq monitor, the gap repair or a heartbeat head shows a gap, or a frame from another seq space arrives | frames are missing | the gap repair, or the full read | `behind` |
| a revisioned frame fails validation | a transition was lost | the full read | `behind` |
| any check fails | it could not confirm | the retry | `retrying` |

A window that only regains focus while visible is not doubt: its timers and socket kept running,
and the liveness check covers a socket that died quietly.

The seq monitor learns where the page stands from the read's snapshot and from each replay, not only
from frames on the wire. Before, the first heartbeat after a join became its baseline, so frames
published between the read and the subscription were never asked for on a session that then went
quiet.

"Catch up from the frontier" asks the daemon's ring for the frames after the highest seq this page
applied without a gap (the gap repair's own request). They were never applied here, so applying
them cannot double anything. A resync verdict, another epoch or a failed request falls back to the
full read, and so does a replayed frame that does not parse or a revisioned one that fails
validation: skipped, the frontier would pass it and the page would be called in step without it.
A composer write among replayed frames keeps its place in seq order and is not applied: it
missed its moment, and applied late it could land over the reader's newer typing.
The check is confirmed when its replay or read is in, and a read does not confirm while the gap
repair still holds frames: the repair's landing confirms. It fails when the read fails.

### Why the end of a turn is a check

The idle status reaches the page on two sockets: the session's own, in seq order after the reply,
and the machine socket that feeds every session's row. The second can arrive first, or alone when
the session socket lost its last frames, and a trailing loss has no later frame to reveal it. So the
moment the selected session goes idle is a quiet check: one small request for the frames after the
frontier. On a healthy stream it answers nothing within a round trip and nothing changes on screen;
when it finds the frames, they apply in that round trip; only a failure shows "Syncing…".
The join read's own idle status counts too: its status read is separate from its transcript read
and can be newer, and the frames between them are exactly the ones a quiet session never reveals.

The session socket's heartbeat head was not read (slice H1 wired it to the machine socket only),
so a trailing loss on the session socket was never noticed. It now is, and it starts the same
catch-up.

### Every transition

| From | Event | To |
|---|---|---|
| any | another session or machine selected | `checking` for the new key; the old key's repair and retry are dropped |
| `confirmed`, `checking` | a routine reason | `checking` (one check runs: a catch-up under way asks again once it lands, since its reply may predate the reason; full reads join in the refresh coordinator) |
| `confirmed`, `checking` | frames known missing | `behind` |
| `behind` | a routine reason, or more frames missing | `behind` |
| `retrying` | a routine reason, or frames missing | `retrying` (the retry stays armed) |
| any | a check landed for the same key, and the gap repair holds nothing | `confirmed` |
| any | a check failed | `retrying` |
| any | the session is deselected | none |

An archived session has no live stream and carries no sync state: its read shows it or fails as
before, and a selected session archived from another device drops its sync state when the listing
shows it archived. A closed session the daemon does not hold open joins like any other. A session still being
created has no transcript yet; its dock shows the startup progress as before.

### Retired

Delta replay from a watermark persisted at the join (`refreshByDeltaReplay`): it replays every frame
after the join, including the ones the page already applied live, which is the candidate producer
named on 2026-09-30 and was found again on 2026-10-06. Catching up from the frontier replaces it.
The persisted watermark keys an older build wrote are swept on the page's first cache write.

### Cost

Opening, reconnecting and returning to the front already read today. Catching up from the frontier
is one small request that answers only the frames the page missed; it replaces the delta replay on a
return, and adds one request per turn end.

### Not yet

The transcript head's `n` and `leaf` are not compared: rows applied from live frames carry no entry
id (pi persists a message after announcing it), so the page cannot state its own head. The seq
checks above prove the stream arrived whole; comparing `n`/`leaf` would also catch a merge bug, and
needs the daemon to tell the page the entry id of each committed message.

### Next (owner, 2026-10-06: yes)

Phase C puts the session list, docked cards and plugin panels on the same states (below). The owner
asked for the ablation batch first (2026-10-06); it is done.

## Phase C: the session list, docked cards and plugin panels (draft for the owner, 2026-10-06)

### The rules, carried from phase B

1. A routine check is quiet: coming back to the front, the network or a connection returning, a
   periodic re-read.
2. A surface says it is syncing only when it knows it is out of step (an announcement it missed, a
   source that did not answer) or a check failed, and it keeps trying until it is in step.
3. Never "offline", never a final "failed" for something the page retries. A warning stays only when
   the reader can act on it: a Retry button, a setting to change, a permission to grant.
4. The state belongs to the data, not to the card or panel that shows it.

### What each surface does today

| Surface | Kept current by | Knows it is out of step when | Says today |
|---|---|---|---|
| Session list (Navigate, Go to, quick switcher) | one board read per machine, `session.name`/`session.created` and status frames on the machine socket, a re-read after a missed announcement, a whole re-read after 30 s when browsed | the machine socket's seq monitor sees a gap (`missedAnnouncements`); a project or workspace listing did not answer (an unknown source, retried on the shared backoff) | nothing: the rows that did answer show, the rest are read again silently (owner Q4, 2026-09-30: the board is not an app-row cause) |
| Docked cards (ask, extension dialogs, waiting cards) | the session's status frames on both sockets; the dialog surface's revision (`RevisionScope`) resyncs on a revision gap or a malformed frame | a dialog revision gap; the transcript is `behind` or `retrying` (they ride the same session stream) | nothing on the card; since phase B the dock says "Syncing…" while the session stream is behind |
| Plugin panels (files, git, goals, tasks, relays, subagents, background runs) | each plugin's own reads, `workspace.changed` nudges, a few polls | a read failed; the plugin decides | the plugin's own words: "Couldn't read this workspace's files: …", "Status unavailable.", "Could not load workspace tasks.", "Could not scan workspace relays." (some with a Retry button) |
| Composer, a message that could not send | the outbox, retried when the network returns | the browser is offline | "You are offline - this message sends itself when the connection is back." |
| App row | the machine and session sockets, every read's outcome | a link is down, a machine does not answer, a server error | "Reconnecting…", "X is unavailable; reconnecting…", the server's own reason |

### Proposal

- **Session list:** one sync value per machine, the same four states. `checking` for the routine
  re-reads; `behind` when the machine socket missed an announcement or a source did not answer;
  `retrying` when the whole read failed. While `behind` or `retrying`, the list's header says
  "Syncing…" (quiet otherwise), and rows from a source that did not answer stay as they were rather
  than vanish. The app row stays out of it, as ruled.
- **Docked cards:** no state of their own. They ride the session's transcript sync (the same key),
  which already says "Syncing…" in the dock; a dialog revision gap marks that key `behind`. A card
  keeps working while syncing: an answer to a card closed elsewhere is refused by the daemon and the
  card says so (already shipped).
- **Plugin panels:** the host offers each panel the same four states through the plugin API (an
  additive field on the panel context: `sync` plus a `report(outcome)` a panel calls after a read).
  The host draws "Syncing…" in the panel's header while `behind` or `retrying`; a plugin keeps its
  own words only for an error the reader can act on (with its Retry button or setting). Plugins
  move one at a time; the API change comes first.
- **Composer:** "You are offline - …" becomes "Waiting for the connection - this message sends
  itself when it is back."
- **App row:** unchanged ("Reconnecting…" is already "we are trying").

### Open questions (owner)

See the ask that accompanies this draft; nothing here is built until it is answered.

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
