# @jmfederico/pi-web

## 1.202608.75

### Patch Changes

- Fixed the two-tap dialog bug at its measured root: a tap's pointerdown focused the dialog host, the composer collapsed mid-tap, and the dialog moved ~90px before the pointer came up, so the tap landed nowhere. The composer collapse now waits for the pointer to come up. Command receipts also persist in the transcript instead of disappearing after 8 seconds, the GOALS drawer tab shows its goal count like the other tabs, and receipt rows are colored by state (gold while waiting, green when done, red on failure).

## 1.202608.74

### Patch Changes

- 6f56c29: Fixed live dictation failing with "The dictation connection failed." on every attempt: the Azure Speech handshake was rejected with HTTP 400 for two stacked reasons — the Bearer scheme's space was serialized as `+` instead of `%20`, and the configured language never travelled on the streaming socket URL (Azure answers "Invalid CID or language" without it). The handshake now percent-encodes the token, carries the configured language, and joins query parameters correctly when the base URL already has one.

## 1.202608.73

### Patch Changes

- 15e8fd7: Fixes from the live verification pass: a failing activity read no longer renders as "Nothing running right now." — the panel says the read failed and retries automatically; an unreadable goals directory now fails the goals read (HTTP 400) instead of answering a successful empty list that claimed "No goals recorded" over goals it could not see; the composer no longer stays collapsed after the dialog it stepped aside for is answered and removed (the loan is called back when its host is gone); the zoom-dialog sync survives a null handle before the editor first renders; and a command accepted while a reply streams now says "accepted — waits for the running reply to finish" in the ledger instead of claiming completion.
- 12e6020: Lost push frames now repair themselves instead of surfacing as stale state. Every session frame is stamped with a monotonic sequence; the daemon keeps a bounded replay ring, and when the browser sees a gap it holds the live tail, replays exactly the missed range in front of it, and only falls back to a full refresh when the ring cannot serve. A frame that fails validation counts as a gap rather than vanishing. Ask and dialog cards carry the surface revision end to end (previously stamped but stripped by the client's own validators, which disarmed the stuck-card repair), a restarted daemon's fresh counters are detected through the instance identity instead of deafening the surface, and the notification count is pinned to the list it counts. Each remaining client timer names the surface it backs up.
- Sessions recorded in subdirectories of a workspace now appear in that workspace's session list: the list covers the workspace's directory tree, so a session whose working directory sits below the workspace root is visible and selectable where it was previously invisible. The goals panel's source-root qualifier disambiguates when goals come from more than one root. Operators also get a documented restart story: the installation guide now covers the session daemon's startup ownership claim, the safe restart order (web/API first, then the session daemon), and the environment a second instance needs.
- 156f2a2: Warnings now file in the session's notification drawer instead of stacking as cards above the transcript. Each warning occurrence becomes exactly one drawer record; dismissing the record of a warning with a server-side off-switch (the Anthropic billing notice) also silences the warning itself. The transcript-top cards, their collapse control and the status-bar warning counter are removed, so warnings can no longer fill the screen or move the layout. Slash and goal-panel commands now leave an immediate receipt row in the transcript (queued → running → ok/failed), and goal panel buttons disable the moment one is pressed.

## 1.202608.72

### Patch Changes

- 532773e: A tap on a phone now activates the thing it lands on. `:hover` was styling
  elements on every device, and on a coarse pointer the first touch dispatches
  hover, changes the appearance, and the browser withholds the click - so an
  option or a Dismiss button needed two taps, the first only tinting it. Hover is
  now a device capability everywhere in the client, guarded by `@media (hover:
hover)`, with an invariant test so the rule cannot grow back one file at a time.

  The drawer's tab strip keeps its membership when a count reaches zero, so the
  row no longer reflows and moves content out from under a finger mid-tap.

  Answering an extension dialog no longer costs a second tap to put the card
  away: the answer settles into one quiet row, and the outcome is filed in the
  session's notification drawer where it can be read back.

## 1.202608.71

### Patch Changes

- c420449: Dialog cards carry their own tap rules. The transcript sets `touch-action: manipulation` and suppresses the platform's tap highlight for its buttons, but extension-dialog and ask-user option buttons live in their own shadow roots that those rules never reach - so they stayed eligible for the browser's double-tap-zoom click delay and painted the rectangular tap highlight. Both card components now declare the same two properties for their own controls.
- 430a3cf: The goals panel no longer shows another project's goal. Keeping the previous list across a loading or failed read fixed the vanishing Goals chip, but the retention answered to nothing: after the switcher moved the selection to another project, the panel kept rendering the previous project's goal with live Resume and Abandon buttons, so acting on it would archive another project's goal from the wrong session. The retained list is now keyed to the machine+project+workspace it was fetched for - rendered only while that key matches the selection, with the action controls withheld otherwise - which keeps the chip through loading and failures for the same workspace while making the cross-workspace bleed impossible. A session switch that moves workspaces now also refreshes the goals and re-seeds the session list from the keyed cache instead of carrying the previous workspace's rows.
- 8cb3a7d: The composer's prompt history became a searchable, closable sheet. It shipped as a bare floating list: no search - and quick search was the original request - no close affordance a thumb could reach, and it covered the composer it fills. The sheet now anchors above the composer instead of over it, filters with the ranking the Ctrl/Cmd+R shortcut always used, fills the composer on tap, and closes by its close button, a backdrop tap, or Escape.
- fefbecb: A catch-up scroll scheduled by one touch press no longer fires into the next one. The timer could land up to 250ms into a new press, scrolling the transcript between the press and its click, so the tap registered on whatever moved into its place - the "first tap does nothing, second works" pattern on dialog cards. Starting a new press now cancels the previous press's pending catch-up, symmetric with how it already dropped a deferred card alignment.

## 1.202608.70

### Patch Changes

- 824aa64: Let a dialog the daemon genuinely opens again survive the dismissal it was shown under.

  A dialog this browser settled is remembered so a status snapshot taken before the close cannot re-open it and cost a second tap. But the memory had no expiry in the other direction: a live `dialog.opened` for the same id did put the card back on screen, and the very next status frame - stale or fresh - filtered the id out again and wiped it. A genuine re-ask therefore flashed for one frame and never came back.

  A live open is newer news than any snapshot, so it now also forgives the dismissal: the card shows, the memory drops, and the next status frame that carries the dialog agrees with what is on screen. A stale snapshot without the dialog still cannot resurrect a dismissed one - that contract is pinned alongside.

- 15ca72f: Goal commands are observable end to end. Clicking Resume with no session selected did nothing and said nothing - the dead button; the fix surfaces a message naming what is missing. A failed goals listing no longer reads as "no goals": the previous rows stay and the Goals tab keeps its entrance while the list loads. Running a goal command refreshes the panel, so the card shows the goal as it now is.
- a23fe93: A background task whose process was killed from outside the tracker no longer reports running forever. Measured live: a web-server task that died on August 24 still counted itself running on August 29 - five days - because the operating system had handed its pid to /usr/libexec/microstackshot. The pid's start time is its identity: a process born long after the task began is a stranger wearing the number, and the record reads lost.
- 57e2cb5: A slash command forwarded to the agent whose turn then shows nothing no longer vanishes. Measured live: /goal-resume with no goal appended only empty assistant messages, so the command looked like it never ran. The turn's end now says "/goal-resume finished without any output." in the transcript, and the record persists in the notification drawer across reloads.
- 2406e05: A tile wraps a long branch name to a second line instead of cutting it to one line. Nineteen of twenty-four visible tiles were cut short, and four worktree-agent tiles truncated to the same prefix were completely indistinguishable on a touch screen, where no hover title can rescue them. Measured after: zero tiles cut horizontally, every worktree tile tells itself apart.
- 13fb329: Answering a question or dialog now retracts the amber "asking" marker everywhere it is read, not just on the card in front of you: the session's row and the quick switcher stop asking once the daemon says it was answered, the answer still lands when you navigate away while it is being submitted, and indicators a reconnect's status catalog no longer stands behind are dropped instead of held until a reload. Opening the quick switcher also reconciles the indicators against the daemon's catalog, so a dropped frame can no longer leave a finished session marked as waiting.
- 2570aad: An extension asking for a screen the browser cannot draw is told no out loud. The pi updater asked through ui.custom every session; the silent cancel made every answer evaporate and the prompt return each time with nothing anywhere saying why. The cancel stays - the browser truly cannot draw it - and a warning now lands in the notification drawer naming the surface.
- c636d1d: The Add-project folder list now belongs to the text currently in the input. Rows for a query the reader already left disappear the moment the path changes; every keystroke aborts the previous server-side directory walk (the walk also gained a 2-second wall-clock budget beside its 4,000-directory count budget, each directory read is itself bounded so one unresponsive directory - measured live: a Photos library whose readdir never returns - cannot hold the request or wedge the server's filesystem threads, and a once-hung directory is never read again this process); the server stops scanning when the requesting connection closes; and a failed search reads as "Search failed - try again" instead of the misleading "No matching folders found". The trust read is debounced like the search instead of firing on every keystroke.
- c2b8adb: The composer's prompt history now includes the session's own user messages, most recent first, alongside what this browser typed. On a device that never typed here the entrance appeared for nothing while the session held fifteen thousand prompts; measured on a fresh browser, the button is present and the picker lists the session's prompts.
- 80ef7b8: The composer's prompt history gets a visible entrance. It answered only to Ctrl/Cmd+R, which a phone cannot type, so the sentences already typed in a session were unreachable exactly where typing them again costs the most. The button appears once the session has history, and opens the same picker the shortcut opens.
- 5fdbac9: The composer's history picker reaches the session's own prompts. The entrance read only this browser's localStorage, so a fresh device showed no door in front of a session holding fifteen thousand messages; the session's user messages are the same history arrived by another door. Measured on a clean profile: the button appears with zero local entries, and the picker lists what the server has.
- 7c6a29b: On a question card the advancing button keeps to the right, even on the first question where Back is absent - the left edge is Back's spot whether Back is there or not.

  A send whose confirmation frame was dropped no longer waits forever: while a card is still waiting, the disk is re-read on a slow cadence, and the refresh carries waiting cards across the rebuild instead of dropping them.

- 2a9b486: Hold the transcript and the notification drawer still under a finger when an ask or dialog opens, and never let live content move the control being aimed at.

  Opening an ask-user form or an extension dialog aligns the card to the top of the transcript, which pulls every line above it upward. Measured at 393x850 with a pointer held on the transcript: a dialog opening mid-press moved the block under the finger 330px, an ask 236px (at 1440x900: 282px and 241px). Both alignments now go through the same ScrollFollowGate the live-tail follow uses: refused while a pointer is down, replayed once the press ends and the settle grace has let the tap land, and dropped when the reader scrolled away or the card was answered before the release. A press that opens nothing still catches up to the bottom.

  The notifications drawer turned out to have no gate at all: it is its own scroller, and a notification arriving mid-press prepends a row above every settled card. Measured at 393x850: the settled card under a resting finger moved 60px (the same at 1440x900) and stayed moved - the owner's two-tap Dismiss. The drawer now holds live tray updates while a pointer rests on it and applies them once the press ends, through a second instance of the same gate, so there is one owner for "may this surface follow live content" and no third hand-rolled variant. A tray that was not on screen when the press started (a first tray, or another chat's after a switch) shows live, because there is nothing under the finger to keep still.

- 20a4bd1: Plugins in a manifest are fetched together instead of one round trip after another: five plugins used to cost five sequential fetches on the boot path; now they cost the slowest one. The manifest's order is preserved in the registrations.
- a51944f: A dropped push frame no longer leaves the conversation lying. A send still waiting for its confirmation now rides across a transcript rebuild instead of vanishing without a failure, and while any card waits, the disk is re-read on a slow cadence — with a healthy socket and a visible page, nothing else would ever have re-read it, so a card could wait forever for a confirmation that had already happened.
- cecf5b7: The first paint stops carrying the composer's editor. CodeMirror core and languages - 649KB of vendor chunks - were modulepreloaded from index.html, so every page waited on an editor nobody had focused yet. The editor module now loads when the composer mounts: measured after, the preload list carries 0KB of editor, and typing in a live session still lands.
- 43b177c: The Goals tab stays while its list loads, a failed listing keeps the goals it had instead of reading as "no goals", and the goal buttons say something when they cannot run: clicking Resume with no session selected now shows "Open a session in this workspace to run goal commands." instead of doing nothing. A command that does run refills the panel, so the card reflects the goal as it now is.
- 3828878: Reopening the quick switcher within half a minute serves the list the last open just fetched. Every open used to re-fetch projects, every workspace and every workspace's sessions — measured at 302 requests on this machine, where one project alone carries 291 worktrees — before the list appeared. Past the window the refresh still runs, so a rename or a new session shows up within half a minute.
- 5bf0f8f: Give the end of the transcript back the room the floating dock was reserving.

  The activity dock used to float over the scroller's bottom edge, and the transcript kept 64px of bottom padding so the last message would stay clear of it - both arrived together. The dock is an in-flow row below the scroller now, with its own margin, so the reservation was dead weight added on top: measured at 393x850, a reader scrolled to the end sat 80px above the dock - the message rhythm's own 16px margin plus 64px of reserved nothing, an empty band that read as a rendering fault.

  The transcript again ends with the room it had before the dock existed: one space-7 of padding on top of the message margin, 32px from the last message to the dock. The two pill variants of the dock measure equal height for the same content at 1440x900 (23px both, line-height normal on both the div and the button - the button's `font: inherit` is what makes that true); on a phone the background-run pill is 44px because the coarse-pointer rule gives the only interactive dock state the app's 44px touch floor, by design, not because of line-height.

- c3faa0e: Tile grids keep their rows as tall as the tiles. The first botim-eclipse visit showed why this matters: its 291 workspaces collapsed into stacked two-pixel tracks, each tile painted over by the next, and the page read as a deck of empty card tops with no label anywhere. Any list longer than one grid row was affected; shorter lists hid the bug.

## 1.202608.69

### Patch Changes

- 92c0aa0: Show a subagent run only in the session that started it. A run with no directory of its own was attributed to whichever session happened to be listing while its transcript was being written, so any session's live child appeared in every session at once - two sessions showing a running ring, and a session with no children of its own reporting a background run. Membership now comes from what is written on disk: the run's directory under its parent, or the spawn the parent recorded in its own transcript. Measured on a real project, three runs were previously claimed by all eight sessions and none is now claimed by more than one.
- a79ec1b: Stop an extension dialog's answer controls covering the choices above them on a phone. The footer stuck to the bottom of the screen while the card's end was below the fold, so it sat on top of the card's own option rows: a tap aimed at an option reached Cancel and answered the dialog. The footer and the matching sticky header now scroll with the card where pointers are coarse.

## 1.202608.68

### Patch Changes

- 3624fa7: Return a pinned reader to the bottom after a press that held the transcript still.

  Opening a phone keyboard grows the transcript's scrollable range. Following that
  growth while a finger is already down would move the control the reader is aiming
  at, so it is suppressed - but the suppressed scroll was dropped rather than
  deferred. Measured at 393x850, a reader pinned at 27612 of 27612 was left at
  27612 of 27948 once the press ended: still short of the bottom they were pinned
  to, with no later event to correct it.

  The follow refused during a press is now applied when the press ends, after the
  grace that lets the tap land. A reader who scrolled away during the press keeps
  their position instead of being pulled back down.

  The scroller also had no `pointercancel` binding, which is what a phone fires
  instead of `pointerup` once a press becomes a scroll gesture. Every way a press
  can end now releases the gate.

- 2a6a505: Stop losing the first tap on a notification after the daemon restarts.

  Dismissing a notification took two taps whenever the browser tab had been open
  across a daemon restart. The tab sends the daemon instance id it read when it
  loaded the inbox; the daemon mints a new one every time it starts; the store
  compared the two, refused, and answered 200 with the current inbox and nothing
  to say it had refused. The row was removed optimistically, the next poll put it
  back, and the reader tapped again. The second tap worked because the refusal had
  carried the current id, which the client installs — so the cost was exactly one
  silent wasted tap per restart, on a phone that keeps a tab open for hours while
  this daemon restarts on every update.

  For a single dismissal the guard was protecting nothing. A notification id is
  minted as `${daemonInstanceId}:${order}`, so it already names one notification
  of one instance and cannot reach a newer one; naming a notification the daemon
  never minted simply finds nothing. That dismissal is now accepted whatever
  instance the caller last saw.

  Dismiss-all is not the same and keeps its guard: it names an order range rather
  than an id, and order restarts at zero with the process, so a range read before
  a restart covers notifications the reader has never seen. Measured on the real
  store, an accepted stale range would have cleared an unseen notification. The
  refusal now names itself instead of being silent, and the client reissues once
  against the range the refusal reports, so the inbox still clears in one gesture.

  This is the same fault, and the same fix, as the unread acknowledgement one
  release earlier; both stores now report the outcome of a dismissal rather than
  declining in silence. These are the only two places in the server that refused a
  request on a stale identifier with an empty result.

- 2f6c683: Stop a finished dictation from reporting a failure afterwards.

  Stopping a live dictation closed its socket but left the handlers attached.
  Closing is not immediate, so a socket that failed on the way down still ran
  `onerror` and put "The dictation connection failed." above the composer — for a
  dictation the user had already finished, next to a composer they were no longer
  dictating into. A socket still connecting when the user stopped was left open
  entirely, because `close()` does nothing in that state.

  Stopping now drops the handlers before closing, and closes a still-connecting
  socket once it opens.

- 8e594a3: Keep a dismissed extension-dialog card from coming back.

  Dismissing a settled dialog card removed it from the list that was also the only
  record that the dialog had already been settled here. The daemon's status
  projection is unordered against socket frames, so a snapshot built before the
  close could arrive after the dismissal, put the dialog back on the open list, and
  let the following close record its outcome card a second time — a card the reader
  had to dismiss again.

  A dismissal is now remembered for as long as the settled cards themselves live,
  so a status that predates the close can no longer re-open the dialog. A live
  `dialog.opened` frame still shows a card, because an extension asking again is
  news the projection cannot be stale about.

## 1.202608.67

### Patch Changes

- f67344b: Let a running subagent vouch for itself.

  A child that runs in a fork of the parent context never creates its own run
  directory, so it is listed only through the transcript it writes in the shared
  artifacts directory. That path admitted such a run only while the parent session
  was streaming — and the reader watches precisely when the parent is idle, having
  asked for something and waiting. So every running fork child disappeared at the
  moment someone looked for it, and the drawer answered "Nothing running right
  now" while children were working.

  The precedence was backwards. A transcript appended to seconds ago proves the
  child is alive whatever the parent is doing; the parent's activity is a fallback
  for a child that has produced no evidence of its own, which is what the code
  already said about a run that has written nothing at all. Measured on the live
  session directory: with the parent idle the list reported no running work, and
  now reports the child whose transcript had been touched moments earlier, while
  ten husks left by children that died before writing stay `unknown` and
  transcripts silent for twelve hours are still left alone.

- d1bd7f1: Open a subagent run as the conversation it is, and say where its limits are.

  A subsession row opened the session it named while an agent-run row only ever
  offered a block of text — the same work told two different ways. The row now
  opens the child's own conversation: its turns, its tool calls, and its thinking,
  drawn by the same renderers the transcript uses. Both kinds of child arrive the
  same way, whether the run kept a session file or the subagent tool's event log.

  The view names the run it belongs to and offers a way back, because it sits over
  a different conversation and must not be mistaken for the one underneath.

  It reads and does not steer. Steering, resuming and interrupting a live child
  travel over the subagent extension's RPC on the in-process Pi event bus
  (`pi.events`), which the web server does not hold, so the view says so rather
  than offering a control that would do nothing. The bridge is not impossible —
  the session daemon hosts the agent process that loaded the extension — but it
  belongs on the daemon's socket rather than in the browser.

  The log viewer stays where a log is genuinely a file: background task output,
  and runs that ended without writing a transcript at all.

- d76c6e0: Open a subagent run as the conversation it is.

  The two kinds of activity row told the same work two different ways: a
  subsession row opened the session it named, while an agent-run row opened a
  block of text. A run does have a conversation, so clicking one now shows it,
  labelled as a child run of the session it belongs to. A run that never opened a
  transcript still falls back to whatever it returned.

  Two kinds of child write two different files under names that look alike. A
  fresh-context child gets a run directory holding an ordinary session `jsonl`. A
  fork-context child — which is what the builtin `worker` and `oracle` agents are,
  so the common case — never creates that directory; the subagent tool keeps its
  own event log in the shared artifacts directory instead. The two were assumed to
  be the same file because of the name: projected as a session branch, a real fork
  transcript of 254 entries yielded zero messages. The event log is adapted rather
  than the session walk being widened, because the difference is in the data.

  Reading only, and the view says so. Steering, resuming or interrupting a live
  child travels over the subagent extension's RPC — `SUBAGENT_RPC_METHODS` at
  `src/extension/rpc.ts:34` — which rides the in-process Pi event bus:
  `SUBAGENT_RPC_REQUEST_EVENT` at `rpc.ts:30`, subscribed at `rpc.ts:776`, wired
  through `pi.events` at `src/extension/index.ts:668-778`. A caller must hold that
  bus inside the agent process that loaded the extension, and the web/API process
  never does. The session daemon is a different matter: it hosts the Pi agent
  process that loaded the extension in the first place, so the way to offer
  intervention is to expose that RPC over the socket the daemon already serves —
  not to give the web server `pi.events`. An unexplained missing control reads as
  an unfinished feature, so the conversation states the boundary instead.

- 62fca71: Say when a dismissal was refused, and keep a row under the finger that is
  reaching for it.

  Dismissing took several taps, for two independent reasons.

  The daemon is right to refuse an acknowledgement that would clear work the
  reader never saw, and a session that completes background work constantly
  advances the completion order between the moment the browser reads the catalog
  and the moment the reader taps. It refused silently, though: the answer to a
  refusal and the answer to an acceptance were both the current catalog, so the
  browser removed the row optimistically, the next poll put it back, and nothing
  said why. The acknowledgement now reports what became of it, and a browser told
  its request was superseded acknowledges the newer order instead of leaving the
  row on screen. The chase is bounded, so a session that never stops completing
  cannot turn one tap into an unbounded loop.

  The activity list also re-sorts on live status every few seconds while rendering
  rows by position, so a run finishing moved every row below it and Lit rewrote
  the text of whatever element already sat at each index. The control a finger was
  travelling towards became a different control mid-tap. Activity rows and
  notification rows are now keyed by what they are - the child session, the run,
  the task, the notification - so a row that moves takes its element with it.

## 1.202608.66

### Patch Changes

- 2ea813e: Stop offering long-dead runs as working agents.

  A run directory holds no evidence about whether its child lives until the child
  writes something, so the parent conversation was asked instead. But the parent
  streaming is a fact about the parent: it says a conversation is busy now, not
  that a particular child spawned hours ago is what is keeping it busy. Six
  directories left by children that died before writing anything - empty for 158
  to 274 minutes - were reported as running agents under the generic name, with no
  output and nothing to open, and the drawer went on offering them for hours.

  The parent may now vouch only for a child young enough that "it has not written
  yet" is still the explanation. Measured across 198 real runs, a child's first
  transcript line lands a median of 7s and at most 55s after its directory
  appears, so a run still silent five minutes in did not start slowly. Past that
  the run is reported as `lost`, which is what this module already calls a child
  that stopped without reporting. It keeps its row: hiding these again would
  restore the older defect where a working fork child was absent from the list for
  as long as it was working.

## 1.202608.64

### Patch Changes

- 757130b: Say what an empty session is, and call it something a person can read.

  A session nobody had spoken to yet showed a blank screen — roughly 1160px of
  nothing between the header and the composer, which reads the same as a session
  that failed to load. It now says it is empty and offers a control that puts the
  cursor in the composer.

  That same session was named after the tail of its id, so the header announced
  "Session: 7c4dc82f" and offered to rename it by that number. Sessions waiting
  for their first message are called "New session", and the id moves to the row's
  detail line, where it still tells two of them apart. The header and the session
  list now take that name from one place, so they cannot disagree again.

  On a touch screen the action palette drew a keyboard shortcut badge on every
  row — a label for a key that cannot be pressed, holding open 101px the titles
  were being truncated to give up. The badges are for pointers that come with a
  keyboard, and the title takes the width back.

  The palette also listed itself, offering to open the surface already on screen;
  that entry is gone while the shortcut that opens it from elsewhere stays. Action
  names are sentence case throughout, and the search box uses a real ellipsis.

- 07ea02d: Say what failed, and let a reply withdraw the saying of it.

  A red banner reading the single word "HttpError" could sit above a session that
  went on replying normally, with the dismiss button as the only way out. Nobody
  wrote that text. Over HTTP/2 `response.statusText` is always the empty string,
  so a response whose body carried no error field built an error with an empty
  message, and an Error with a name and no message stringifies to just its name.
  The banner was showing a class name.

  It stayed because the field that marks a complaint as one a successful reply
  disproves was never set. It was introduced with the notice module, defaulted to
  "only the reader can clear this", and no call site ever set it, so the code that
  withdraws such a complaint returned early every time.

  Both halves were decided independently at every call site: 60 of them, built by
  hand out of `String(error)`. They now go through one function that returns the
  words and the lifetime together, so neither half can be set without the other
  and a call site added later cannot reintroduce either fault. A failure that
  describes itself is quoted as it is; one that does not is described by its
  status instead of by its class.

  Reported failures lose their `Error: ` prefix, which was the same class name
  leaking through in a smaller way.

- f44a4d6: Show a subagent run that has started but not written anything yet.

  A child agent that runs in a fork of the parent context writes its transcript to
  a shared `forks/` directory and leaves its own run directory empty until it
  finishes. The activity list treated an empty directory as "not a run" and
  dropped it, so those children were missing from the list for exactly as long as
  they were working, and appeared only once they were over. Measured on a live
  session: two children were working while the drawer said "Nothing running right
  now", and the endpoint reported 12 runs where there were 16.

  An empty run directory is now reported, and the existing rule decides what it
  means — running while the parent is streaming, unknown when it is not. The
  neighbouring `forks` directory is still excluded: a run directory is named after
  the child session, and that name is what tells the two apart.

- 52a7115: Show a subagent that is working but has no run directory.

  A child running in a fork of the parent context may never get a run directory:
  its transcript goes to the shared `forks/` folder, and the only trace under its
  own id is what it writes into the project's artifacts directory. Enumeration
  walked directories only, so such a run was missing from the activity list for
  its whole life and after it - measured on a live child, the directory was absent
  for the 90 seconds it ran and stayed absent once it had finished.

  Runs are now found from a live transcript artifact as well as from a directory.
  A run writes its prompt and opens its transcript when it starts and only writes
  `meta.json` when it ends, so those two facts are kept apart: a run with a
  transcript and no report is shown as running rather than done, and its agent
  name is read from the artifact instead of falling back to the generic label.

  Nothing in an artifact names the session that started the run, and the artifacts
  directory is shared by the whole project - measured on one project, two sessions
  with overlapping lifetimes shared 35 artifacts of which 19 belonged to the other
  session. A run without a directory is therefore only claimed while its transcript
  is still being written and the parent is streaming, so a neighbouring session's
  history is never adopted.

## 1.202608.63

### Patch Changes

- d644631: Keep the activity list current, and give the quiet states their shape back.

  The subagent activity list read every transcript and every result in full to
  take a few kilobytes from each — 170MB per four-second poll on a session with
  129 finished runs — and the poll did not wait for the read before starting
  another. The list fell far enough behind that only reloading the page appeared
  to update it. Both readers now read the window they always claimed to read, and
  a request arriving during a read is served once that read finishes.

  The jump-to-bottom button was offset by the same gutter that draws the message's
  right border, so the two edges landed on one line; it is inset from the reading
  column now. The quiet activity markers hugged their words while the dock was
  positioned by coordinates, and stretched into empty bars once it became a row in
  the column; they hug again.

  A run held up by an extension dialog was marked as waiting for an answer and
  captioned "idle" in the same breath, so the one marker that could have said the
  session was stuck said nothing was happening. It says what it is waiting for.

  Adding a project is read-modify-write, and the web server and the session daemon
  each hold their own store over one file, so two overlapping changes could drop
  one of the two projects and a reader could meet a half-written list. Changes are
  serialized and the file is replaced in a single step.

## 1.202608.62

### Patch Changes

- b5795a4: A session is described by one number. The sidebar counted every line in the session file and the transcript counted what it could show, both calling the result "messages": the same session read as 14451 in the list and "of 14397" above the conversation.

  The bar that says where you are appears on a desktop once the panel carrying that identity is collapsed, and keeps its words clear of the buttons beside them by measuring how wide they actually are rather than assuming 58px.

  The activity marker sits below the conversation instead of floating over it, so it no longer covers the line you are reading.

  Copy and resend can be hit with a finger.

## 1.202608.61

### Patch Changes

- The activity marker takes a row of its own instead of floating over the conversation, where it covered lines of tool output and message headers at every scroll position but the very bottom.

  Collapsing the navigation panel on a desktop no longer hides where you are: the shell keeps a line naming the machine, project, workspace and session.

  The context bar keeps its words clear of the buttons beside them by measuring the buttons instead of guessing 58px for three that occupy 120px.

  Copy and resend keep their small drawing but can be hit with a finger.

## 1.202608.60

### Patch Changes

- 2592ffa: Dictation transcribes while you speak. Every part of the streaming path already existed — token, socket, sample capture, partial results — and nothing reached it, so the microphone button recorded a whole clip and uploaded it after you stopped. Pauses, restarts and switching language now appear in the composer as they happen, on deployments configured with a streaming socket.

## 1.202608.59

### Patch Changes

- 4234945: Dictation reaches the transcription service again. The browser refuses `fetch` called with anything but the window as its receiver, and it was being handed to the transcriber inside a dependency object, which made every call a method call on that object: "Could not reach the transcription service: Failed to execute 'fetch' on 'Window': Illegal invocation".

  The activity tab counts what is running rather than everything that ever ran, so a session with nothing in flight no longer shows a number that reads as work waiting for you.

  The conversation stops following the newest message while your finger is down, so a button does not move out from under a tap.

## 1.202608.58

### Patch Changes

- 192c8a9: Messages carry an identity, so a message delivered twice is drawn once. A message reaches the browser through several independent paths — an optimistic bubble, the server's echo, the agent's committed copy, streaming deltas, a history load, the server's queue — and without an identity each path had its own test for "have I seen this?", each with a different blind spot.
- ebfe4af: The button that returns you to the newest message appears when the transcript grows, not only when you scroll. A reply that grew the page produced no scroll event, so a reader who stopped following ended up four screens from the newest message with no way back.

  The drawer's section buttons round to the radius scale instead of being pills, matching the controls around them.

  Messages carry an identity, so a message delivered twice is drawn once.

## 1.202608.57

### Patch Changes

- fd5c2e5: A phone shows one place at a time. The navigation panel had a rule that laid it out inside the navigation view and no rule that removed it anywhere else, so the session list sat above the conversation and left it a strip at the bottom.

  A reply delivered twice is drawn once. Duplicate detection only ever looked at user messages.

  A notice says what retires it. Withdrawing it was decided afterwards by matching the words against a list of known phrasings, so anything the list had not met — "HttpError" among them — stayed on screen while the session replied normally.

## 1.202608.56

### Patch Changes

- 71d076b: Thinking text no longer drops a message that is waiting to be sent. One of the three branches that place streaming text kept the queued messages and the other did not.
- aba5e7b: The unread dot on a project tile no longer sits on the actions button. Both are pinned to the same corner and the dot was offset by a guess at the button's width; measured on the running app, a 7px dot overlapped the button by 5x7px.

## 1.202608.55

### Patch Changes

- 16af0c0: Pinch zoom is off. Pinching moves the visual viewport under the layout viewport, which is the same signal a soft keyboard gives, so the shell shortened itself for a keyboard that was not there. Scale belongs to the app's own control in settings.

## 1.202608.54

### Patch Changes

- 40287ab: The dictation button is the size of the row it sits in. It kept a larger size and an offset from when it floated over the corner of the text.

  The return-to-newest button is no longer painted over by the transcript it floats above.

  The rename control sits beside the name it renames rather than across a status indicator from it.

  Seven rules for elements that no longer exist are gone.

- 5c1bf6e: Component styles live with the component that renders them. A control and its rules were 1109 lines apart in a sheet shared by fifteen components, which is how moving one button left three rules behind it.

## 1.202608.53

### Patch Changes

- d2c23bd: Delivery stages are named rather than compared as string literals at each call site. Restating what "settled" means in twenty-two places is how one of them came to disagree with the rest and draw a queued message twice.

## 1.202608.52

### Patch Changes

- ab2b265: A queued message is drawn once. A bubble the browser had already marked delivered could not be claimed by the server's queue, so the same words appeared twice — once plain, once marked queued.

  Dictation and attachment stay usable while the agent is answering. Both put things into the composer and neither sends anything, so a turn in flight has nothing to do with them.

  The drawer drops its counts of failed, done, stopped and lost work, and the sentence explaining what the activity list is. The section buttons are smaller.

  Background work statuses are a named type rather than loose strings.

## 1.202608.51

### Patch Changes

- 38a675e: A reply is no longer split in two by a message sent while it is being written. Streaming text was appended to whatever line was last, so a message sent mid-reply became last and the rest of the reply started a second assistant message — the transcript showed half an answer, then the message, then the other half.

  Dictation says what it is doing. Every voice state, including a microphone that could not be opened and a permission that was refused, was written only into the button's tooltip, which a phone never shows: pressing the button and getting nothing back was indistinguishable from the feature not working.

  The shell uses the height the browser reports as visible rather than assuming what `100dvh` excludes.

## 1.202608.50

### Patch Changes

- 4305588: A message the agent has not started is drawn below whatever it is working on. It used to be appended to the transcript, which is drawn before the reply in progress, so a message the model had not been given yet appeared above the answer to an earlier one.

  Attach is back inside the composer, in the corner it has always been in. Dictation stays in the row below.

## 1.202608.49

### Patch Changes

- 0192eea: Dictation has no button of its own. Holding the composer starts it, and a control appears only while recording, so there is a way to stop.

  Nothing floats over the composer text any more, so the strip of padding reserved for the buttons that used to sit there is gone.

  The header's actions take less room on a phone. At 393px the bar was exactly full, and every pixel the fixed-size buttons took came out of the words saying which machine, project and session you are in.

  A reply that finishes after you have typed again lands above your new message rather than below it: the bubble the browser draws now carries the moment it was written, which is what placement needs.

  Drawer section names keep their counts. Letting them shrink cut them to "ACTIVITY (...", losing the number.

- 420fee2: The bottom of the page stops sliding off screen. A phone hides its address bar as you scroll, which changes the layout viewport without touching the visual one, and only the visual viewport was being watched — so the shell kept a height the screen no longer had until a keyboard was opened and closed by hand.

  Dictation is a button again. Starting it by holding the composer was tried and taken back: holding a text field is how a phone selects text, and the two gestures fought over the same press.

## 1.202608.48

### Patch Changes

- 2333cd9: Hold the composer to dictate. The dictate and attach buttons floated over the corner of the text area, where they covered what you were typing; attach moves down to the row of controls that already exists.

  On a phone the conversation and the composer are wider. Thirty-two pixels of a 393px screen went to margins; both now use the same, narrower gutter and stay exactly aligned.

  A question card's footer no longer floats over its own options. It used to hide whichever option sat behind it, with no scroll position that showed that option whole.

  The activity summary stops calling deliberate acts failures. A task you stopped reads as stopped, a run nobody can account for reads as lost, and only what actually failed is counted as failed.

- 2333cd9: A queued message is drawn once. Only bubbles already marked queued were matched against the server's queue, so a message still marked sending — the state it holds between leaving the browser and the next status frame — was drawn a second time beside itself.

  The drawer's sections stay reachable on a narrow screen. They refused to shrink, so the selected one scrolled into view and took the others out of sight, which read as the strip disappearing.

- 7e293d0: The button that returns you to the newest message moves to the top right and is square. It used to sit in the bottom right, the corner the composer controls and the activity dock already occupy, shaped like the round buttons beside it.

## 1.202608.47

### Patch Changes

- aebfeb2: The back gesture undoes one trip per press. Opening a tool left two history entries behind, so the first press of every pair appeared to do nothing.

  An error banner stays long enough to read. Retries set and cleared it in quick succession, which resized the column and shoved the conversation twenty-one times in six seconds.

  A custom answer clears the footer that sticks over it, and Back and Next are one size.

  Choosing a session from another workspace takes the project and workspace with it, so the lists beside the conversation describe the same place.

  The session breadcrumb returns to its conversation. Opening Goals, Files or a terminal used to leave no way back.

  Delivery marks report only what is unsettled, so a message the agent has taken looks the same before and after a reload.

  Layers come from one scale. The dialog asking you to sign in again used to open behind the panel you were reading.

## 1.202608.46

### Patch Changes

- fc01946: A session whose turn has finished but whose background work is still running
  now says so in the session list. The server had been sending the count all
  along; the client dropped it while parsing.

  A draft survives a page refresh. It was saved on every keystroke but only read
  back when the session changed, which a refresh is not.

  The activity drawer gets three fifths of a phone screen and keeps its close
  control in view, rather than covering the screen and taking the way out with it.

  Machines and workspaces can be searched, like projects and sessions already
  could. A project with dozens of worktrees no longer has to be scrolled.

  Dialog text longer than the room it was given now scrolls instead of painting
  over the answer buttons.

## 1.202608.45

### Patch Changes

- 659d855: Arriving in a conversation on a touch device no longer raises the keyboard over
  it. Switching session, closing a dialog and restoring a queued message each
  reached for the composer directly, past the rule that was supposed to withhold
  focus.

  The session name now gets the room in a phone header, instead of a few
  characters beside a machine-and-project trail that rarely changes.

  The expanded activity drawer keeps a way back out. It covered the screen, and
  the app header painted over the drawer's own header, taking the only control
  that closes it.

  A message queued while a reply was running stays below that reply. It carries
  the moment it was typed, not the moment it was sent, so ordering by timestamp
  lifted it above the answer it had been waiting for.

## 1.202608.44

### Patch Changes

- 4be2b0f: The terminal no longer shows two scrollbars on a phone. xterm draws its own,
  and the panel was reserving a second, native one that scrolled nothing.

  The session switcher's filter chips now list every project. They previously
  listed only those whose workspaces had finished loading, so the row changed
  under you as the responses arrived.

## 1.202608.43

### Patch Changes

- 0a2947a: Settings ▸ Appearance can now set how large the interface is drawn, from 80% to
  150%, remembered per device. A PI WEB installed as a PWA has no browser zoom
  control to reach for, and browser zoom is remembered per context, so the same
  install could look different depending on how it was opened.

  A session whose turn has finished but which still has background work running
  now says so in the session list, instead of showing the grey dot that means
  nothing is happening.

## 1.202608.42

### Patch Changes

- 280b7e5: On a phone the activity drawer opens as a page rather than a strip above the
  transcript, so a goal's title and tasks are readable instead of clipped.

  The drawer also folds itself again once the work it was opened for finishes,
  instead of staying open for the rest of the chat.

  Opening the session switcher on a touch screen no longer raises the keyboard
  over the list. On a desktop it still focuses the search box, so the shortcut
  and typing still work together.

  Session tiles are as wide as a name needs: the desktop panel showed three
  truncated columns because it used the width chosen for a phone.

## 1.202608.41

### Patch Changes

- d6453e0: A button returns you to the newest message, shown only while it is a screenful
  or more away.

  The "Session daemon unavailable" banner now withdraws itself once the daemon is
  back. It previously stayed until it was clicked, because the self-healing rule
  recognised only one of the wordings the server sends.

## 1.202608.40

### Patch Changes

- d5d7c1a: A self-update started from the pi-web UI no longer leaves pi-web down.

  Restarting a service tore it down and built it up again as separate steps,
  which needs the command doing the restart to survive the teardown. An update
  started from the UI runs inside the session daemon, so restarting the daemon
  killed the updater before it could start anything: both services were left
  unloaded, and KeepAlive does not restart a service that is not loaded.

  launchd now performs that restart itself, so the caller's death partway
  through no longer matters.

## 1.202608.39

### Patch Changes

- ea17c88: The file and git browsers give the list the whole panel until you choose a
  file, instead of splitting the height with an empty viewer. A phone showed a
  short list above two thirds of a screen reading "Select a changed file".

  Session tiles now fit two across on a small phone, and the name may take two
  lines so a half-width tile still shows as much of it as a full-width row did.

## 1.202608.38

### Patch Changes

- 878cb16: Give the session name the room to be read, and lay sessions out as tiles

  Three things a phone made worse. The context row gave every chip the same 42vw,
  so the session name - the one chip that answers "which of these am I looking
  at" - was truncated to "pi-...", while the machine and project names beside it
  were recognisable from a few characters anyway. The session chip now takes the
  width it needs; the row already scrolls, so this costs the others nothing.

  The session switcher listed one session per row, a column of wide, mostly empty
  cards, so choosing between a dozen sessions meant scrolling a list that wasted
  half its width on every row. Sessions are now tiles that take as many columns
  as fit, which is two on a phone and one when there is only room for one.

  Opening the switcher no longer leaves the on-screen keyboard covering the list
  it exists to show. Only text entry is blurred: taking focus off a button would
  cost someone on a physical keyboard their place for no benefit.

- 58ea615: The activity drawer now starts folded and opens when you tap it, instead of
  opening itself whenever work was running or a notification had arrived. The
  folded strip still reports what is happening.

  Session names get room to show in full on a phone, the session list lays out
  as tiles (two columns on a phone), and opening a session no longer leaves the
  keyboard up.

  The "ended without a reply" badge has been withdrawn. It inferred a stalled
  run from the newest record being tool output, but a turn that ends on purpose
  looks exactly the same, so it reported ordinary turns as failures. Runs that a
  restart or crash actually interrupted are still marked, from a record kept for
  that purpose rather than guessed from the transcript.

## 1.202608.37

### Patch Changes

- 75c321b: Hand the browser a short-lived token for live transcription

  Live transcription connects from the page straight to Azure, because putting
  this server in the audio path would add a hop to every syllable for nothing.
  That means the page needs a credential - but not the subscription key, which
  could be used for anything and would be readable by anyone who opened the
  developer tools.

  The key now stays on the server and is exchanged for a ten-minute token. The
  token endpoint is derived from the same config the socket url is, so the two
  cannot drift apart, and an upstream refusal is reported by status without
  forwarding the body of an authentication error to a browser.

- 4008570: Wire live dictation from the microphone to the service

  The last piece: token, socket, microphone and text, sequenced. Audio goes from
  the page straight to the service, because a relay would add a hop to every
  syllable for nothing; the page never holds the account key, only a ten-minute
  token.

  Azure's socket does not carry bare JSON - each message is a text frame of
  headers, a blank line, and a body - so a decoder that assumed JSON would report
  a broken socket for a service that was working. The order is asserted too:
  asking for the microphone before there is anywhere to send audio makes a
  browser request permission it may never use, and stopping keeps only settled
  text, because the half-formed guess on screen is not something the speaker
  said.

## 1.202608.36

### Patch Changes

- 9dd667c: Keep the transcript in the order the messages were made

  Messages were appended as they arrived, and a streaming reply arrives only once
  it has finished. Send something while one is in flight and your own message was
  appended first, so the reply that started before you typed sat underneath it:
  the transcript claimed you spoke first when the record said otherwise.

  Arriving messages are now placed by the timestamp they carry. Messages sharing
  a timestamp keep arrival order, and a message carrying none is appended rather
  than guessed at, so nothing is reordered on no evidence.

- 9dd667c: Support Azure Speech for live transcription

  Azure's socket speaks a third vocabulary: a hypothesis while a phrase is still
  forming, and a recognised phrase once it settles. Its hypotheses re-send the
  whole phrase, so they replace the current guess rather than extending it. A
  turn that recognised nothing is ignored rather than treated as an empty final,
  which would have wiped what had already been dictated.

- 2ddc8e7: Add live transcription using the browser's own recogniser

  The one streaming path that needs nothing configured, so an install can try
  dictation before choosing a service. The browser reports a growing list of
  results where settled entries stay put and the last keeps changing, which is
  neither socket protocol's shape; it is translated into the same delta and final
  events the rest of the code already understands. Interim results are requested
  explicitly, without which nothing arrives until the speaker stops - the batch
  behaviour this exists to replace.

- e3f23ec: Show the workspace's goals on a phone

  Goals lived in the navigation panel, which a phone never shows, so a running
  goal was invisible on the device most likely to be asking what the session is
  working towards. They now appear as a tab in the drawer above the transcript,
  beside activity and notifications, with the same Resume, Pause and Abandon
  controls.

  The tab is offered only when the workspace has a goal, and never takes the
  drawer from work in flight. The drawer itself used to render only when there
  was activity or a notification, which hid goals in exactly the case where
  nothing else was running.

- 60ea5f1: Add the protocol layer for live transcription

  Dictation transcribed only after the recording stopped, so a long thought
  arrived as a wall of text minutes after it was spoken. Live transcription needs
  a different protocol per service, so this adds the part worth getting right
  first: decoding each service's messages, accumulating the text they produce,
  and deciding what an install has actually configured.

  The two services disagree about what a delta means - one appends fragments, the
  other re-sends the whole phrase - so that difference is held in one place
  rather than in the composer. A socket protocol with no token endpoint is
  refused rather than downgraded, because the only other way to authenticate from
  a page is to ship an account key to it.

- 787bbc4: Convert microphone audio into what a transcription socket expects

  The browser hands out float samples at whatever rate the device runs at; the
  services want signed 16-bit integers at a rate they name. Getting this subtly
  wrong does not fail loudly - it produces audio that transcribes as plausible
  nonsense - so each hazard is pinned by a test: the ends of the float range are
  scaled separately, because the usual symmetric multiply overflows a full-scale
  positive sample to the most negative one and is heard as a click on the loudest
  part of a phrase; overshoot is clamped rather than wrapped; and upsampling is
  refused rather than approximated.

- 186f7c9: Say whether dictation will write as you speak

  Batch dictation says nothing until it is stopped; live dictation writes as it
  hears. The control looked identical either way, so there was no way to know
  which one you were speaking into until you had already spoken. It now reads
  "Dictate live" when streaming is configured, and keeps the plain label
  otherwise. Once capture is under way both read "Listening…", because by then
  the mode no longer matters.

- cb7bffe: Stop discarding speech-to-text config on the way in

  The config parser builds its result field by field, so a key it does not name
  is dropped in silence. `speechToText` was never named: an install could write
  the setting, restart, and find no microphone in the composer, with nothing
  anywhere to say the setting had been thrown away when it was read. Dictation
  could not be switched on at all.

  The setting is now parsed and written back, with the streaming protocol
  validated by name. An empty endpoint is rejected rather than stored: a config
  that half-enables dictation produces a control that cannot work, which is worse
  than no control at all.

## 1.202608.35

### Patch Changes

- b3f16c8: Keep attachments on a message that has to be retried

  The offline outbox stored a pending message as text alone, and the replay sent
  text alone, so a message that carried a screenshot came back as prose about a
  screenshot nobody could see. Nothing said so: the bubble replayed and the send
  succeeded. Pending messages now carry their attachments through storage and
  back out on retry, and entries written before this still load.

- 578e548: Stop one send with an attachment from becoming two messages

  Attaching a file is asynchronous: it is read to base64 before it joins the
  composer. Pressing send inside that window sent the text on its own, because
  the composer still held no attachments - and the image, landing a moment later
  in a composer whose text had just been cleared, went out as a second message
  with no body at all. In the transcript that reads as one text message followed
  by a bodiless image, which is why "I only sent it once" looked wrong.

  A send now waits for a file that is still being read, so one submission is one
  message.

- b3f16c8: Show which model and thinking level a subagent run is using

  A fleet of running agents gave no way to tell which was on which model, or at
  what thinking level - the two things that decide what a run costs and how long
  it takes. The run already recorded it as `provider/model:thinking`; the row
  just never showed it. Rows now read "claude-opus-5 · medium", keep the full
  identifier in the tooltip, and say it to assistive technology too.

## 1.202608.34

### Patch Changes

- 83ceb5d: Draw a list row as one surface instead of two boxes glued together

  A row was two separately outlined boxes butted against each other: the body
  carried `border: 1px 1px 1px 3px` and the overflow menu carried `1px 1px 1px 0`,
  so their shared edge stacked into a hard vertical rule and the row read as a
  table cell rather than as one thing to click. Selection painted both boxes,
  which is what made the seam visible in the first place.

  The border, the radius, the background, the hover state and the status rail now
  belong to the row; the parts inside it are transparent. An unselected row has no
  outlined children at all.

- 56d035e: Give the panel collapse handle a hit area you can actually hit

  The control that collapses a side panel is a sliver pinned to the panel edge.
  It declares 18px of width and renders at 14px - the flex host shrinks it to the
  divider column - against a 24px minimum target size, with no hit area beyond
  its own box. The handle stays as narrow as it looks, but now takes a 24px-wide
  target so a pointer does not have to be precise about it.

- a39dd21: Give every button the app's type instead of the user agent's

  None of the shared button rules set a font, so buttons fell back to Chrome's
  13.333px in the platform UI face - a size on no scale, in a face that is not
  the app's. It reads as almost-right, which is why it survived: 13.333px only
  looks wrong beside real 13px text.

  This is the same omission that made the navigation header 56px out of buttons
  nobody had sized, so it is fixed in the shared sheets and held there by a test
  rather than patched per component. No button in the rendered app now falls back
  to the user agent's type.

- 4547f38: Ask one question at a time so the answer field stays above the keyboard

  The question card laid every question out at once. On a phone that made it
  taller than the screen, and the field being typed into sat below the virtual
  keyboard: the only way to read your own answer was to dismiss the keyboard,
  scroll to find the field, and open the keyboard again to keep editing.

  Each question now gets its own step, with Back and Next between them and the
  submit control on the last one. A single question still shows no navigation.
  Measured on a 375x360 viewport - a phone whose height has been taken by the
  keyboard - the card went from 509px to 354px and now fits, with no scroll
  region of its own.

- 7cb8403: Rank the actions in the sessions heading

  Starting a session, deleting old ones and switching into multi-select were
  drawn identically: same border, same background, same text colour, same weight,
  differing only in width. Nothing said which one you normally came here to do,
  or which one destroys something. Starting a session now carries the accent;
  the other two are quiet until hovered, and cleanup warms to the danger colour
  when it is.

- 7cb8403: Clear a lost-connection banner as soon as anything reaches the server again

  The banner a dropped connection leaves behind was withdrawn only when the
  realtime socket reconnected. A failure raised by a request left the socket
  untouched - a phone that slept, a tunnel that blinked, a web process
  restarting - so nothing ever disproved the message and the only way to clear
  it was to reload the page by hand.

  Any successful request now reports that the server is reachable, and the banner
  is withdrawn on that. A real failure is left alone: it is not a transport
  problem and still waits to be read.

## 1.202608.33

### Patch Changes

- d0cc1ec: Make a subagent row read as subordinate to the session that started it

  A child row and its parent were drawn identically - same height, same type
  size, same weight, same colour - with 16px of indent as the only difference.
  Even that inverted: a parent reserves a gutter for its disclosure control, so
  the child's name began 12px further left than its parent's and read as the more
  important row.

  Depth is now marked on the row itself, and the child is drawn lighter rather
  than smaller: the type size stays on the scale while colour and indent carry
  the relationship.

- 6748654: Make the subagent disclosure control findable

  The control that expands a session's subagents painted the same background as
  the row it sat on and outlined itself in a border one shade off the row's own,
  so the only thing separating a control from its surroundings was a line that
  was almost the same colour. It was found by hunting rather than by looking.

  It now carries a tint of its own instead of borrowing the row's, and says
  "Show subagents" or "Hide subagents" on hover as well as to a screen reader.

- 4121924: Say what the goals count counts

  The goals heading carried a bare numeral adrift between the title and the
  refresh control, which stated nothing: a reader could not tell a count from an
  index. It also counted finished goals, so a workspace whose work was over still
  advertised a number. The heading now reads "1 open", sits beside the title, and
  counts only goals that are still open.

- 86c6d70: Shrink the message header to the size of a label

  Every message reserved 47px above its first word for one line of small text.
  The height came from a 32px icon button rather than from the text, so the row
  read as a title bar rather than as a label. The action button is now 24px, the
  WCAG 2.2 AA minimum target size, and the header is 29px. The sticky offset
  moved with it so the role label still shows while a long message scrolls.

- 1275471: Tell a finished run apart from one that stopped owing a reply

  A tool ran, returned successfully, and the run ended there: no assistant
  message, no error record, every request a 200. The dock showed "idle", which is
  exactly what it shows when a run finishes normally, so a turn that vanished and
  a turn that completed looked identical and the only clue was that no answer had
  arrived.

  A recorded tool result with no assistant message after it means the model still
  owes a response. That case now reads "ended without a reply" with its own
  badge, so it can be seen and acted on instead of being mistaken for a finished
  session.

- 5a7d5f4: Stop telling the user an archived child has lost its parent

  Archiving a subagent on its own moved its row into the archived section, which
  is built as a separate tree. The parent was not in that tree, so the row was
  marked an orphan and read "Parent session is not available in this workspace" -
  while the parent sat unarchived one row above.

  Whether a parent exists is now answered against every session in the workspace
  rather than against whichever section the row landed in. A child whose parent
  really is absent is still marked.

- c185945: Operate a goal from the goals panel

  The panel listed goals and their progress but offered no way to act on them, so
  resuming or pausing meant typing a slash command into the composer. Each open
  goal now carries Resume or Pause and Abandon controls that run the extension's
  own commands in the focused session, keeping its audit trail, token accounting
  and goal-focus rules intact. Controls are disabled, with the reason, when no
  session is open to run them in.

- 5f60aa1: Align the navigation and chat headers on one height

  The two headers sit either side of the main divider, so their bottom borders
  read as one horizontal rule - except they were 56px and 36px. The rail was
  taller because its buttons were never given a size and inherited the user
  agent's 31px. Both headers and the rail's controls now size from shared
  panel-header tokens, so the rule lines up and stays lined up.

- f3c7d53: Let the conversation use the width of the screen, and keep the status dock in it

  The transcript was capped at a 78ch reading measure and centred, so a wide
  monitor showed a narrow column between two large empty margins. The column now
  takes the width it is given and keeps a gutter at each edge. The status dock
  was positioned against the viewport rather than the column, so "idle" sat far
  to the left of every message it described; it now measures from the same
  gutter. Transcript, composer and dock share one token, so they line up at every
  window size instead of by coincidence.

- 8ea5d9c: Name the browser tab and the navigation header after the focused context

  Every tab and every panel header read "PI WEB", which is the one thing a reader
  already knows. With several sessions open in several tabs, nothing in the tab
  strip said which was which. Both surfaces now name the focused context - the
  session being read, else the workspace, project, or remote machine - and fall
  back to the product name only when nothing is selected.

## 1.202608.32

### Patch Changes

- e8309cf: Stop question and dialog cards from scrolling inside the transcript. Long asks and confirmations bounded their own body, so a card sitting in a scroller got a second scroller inside it: reading a plan crossed a scroll boundary mid-sentence and the content appeared to jump in and out of its own box. The cards now grow with their content and pin the answer controls to the bottom of the viewport instead, which is what kept the buttons reachable in the first place.
- e8309cf: Let the composer's trigger characters read as a hint. The empty field said "Message pi… / @ #", running the three affordance characters into the sentence where they looked like stray punctuation. The prompt now sits at the reading edge with the triggers grouped quietly at the trailing edge.

## 1.202608.31

### Patch Changes

- 27e7d71: Let a queued message sent by another client be recalled. A message queued over the API or by a different browser carries no clientMessageId, so its synthesized transcript row fell back to a `queued:kind:text` key that never matched the server's queue: the row was drawn as an ordinary user message - no gold waiting mark, no recall action - even though the server's recall accepts such entries by kind and text. The row is now matched against the queue the same way the server recalls it.

## 1.202608.30

### Patch Changes

- 0d8b330: Accept the home-directory shorthand everywhere a working directory is compared. A session created or recorded with `~/code` used to be invisible to a client asking for `/Users/<name>/code`: the request boundary rejected the tilde outright, stored headers kept it verbatim, and the equality check resolved the two forms differently. The request and stored-path boundaries now expand a leading `~` to the daemon user's home directory, so the shorthand and the absolute form address the same sessions.
- dcb2057: Stop the mode hint from covering the composer. While a session compacts (or a shell command is queued) a green pill floated over the editor's bottom-right corner, exactly where typed text sits, and hid whatever the user was typing. The hint is now an in-flow row above the text box that pushes the editor down instead of overlapping it.

## 1.202608.29

### Patch Changes

- 72beed6: Give the composer the transcript's reading column. On a wide screen the messages were supposed to sit in a centred 78ch column while the input box stretched edge to edge, but the centring `margin-inline: auto` was written with the same specificity as the message margin shorthand that followed it, so the shortcut always won: the transcript pinned to the left edge (it never centred at any width) and the composer spanned the whole window - two unrelated columns. The message margin now centres explicitly, the composer's footer joins the same 78ch measure, and a live check mounts a real chat-view and prompt-editor to hold the shared edge.

## 1.202608.28

### Patch Changes

- de2877a: Keep a failed send where it happened. When a message could not reach the server the bubble was withdrawn and only a bare error banner remained: the text vanished from the transcript, so the natural reaction was to retype it, and when the automatic outbox retry then landed, the message ended up sent twice. The bubble now stays in place marked "Not sent", and the outbox retry reuses the message's own correlation id, so the retry revives that same bubble - it reads "Not sent" while the network is down, then advances to sent once the retry lands. One message, one bubble, one place to look. A genuine server rejection still withdraws the bubble, because the composer restoring the text is the actionable home for it.
- dd08971: Follow a queue that grows into the transcript. A message sent from another device or an injected command reaches this browser through the session status, not through the message list, so its queued row appeared in the transcript below the fold while the view stayed where it was - the row was there but out of sight. The view now follows the queue down when it grows, and stays put when a status refresh just re-reports the same queue.
- de2877a: Keep long dialogs on the phone screen. A goal plan with its tasks and verification contracts could stretch a confirm dialog to thousands of pixels, pushing the Yes/No buttons and the whole choice list far below the fold - the card did not bend, so there was nothing left to reach. Long messages, choice lists, and long question sets now scroll inside the card, and the answer controls stay on screen.
- 139c232: Enlarge a pending image attachment. The thumbnails next to the composer were inert pictures: tapping one did nothing, and a keyboard user had no way to see the image at full size. Each thumbnail is now a real button that opens the image in its own dialog, with the close action reachable by keyboard and by Esc, and the backdrop clickable to dismiss.
- 520a60c: Show queued messages in one place only. The queued-message panel listed messages the transcript already draws, so a message waiting behind a busy turn read twice on the same screen — once in gold in the conversation, once again in the panel. The panel is gone; every queued message is drawn in the transcript, marked, in the order the queue will send it, and the only thing kept beside them is a slim strip with the count and the clear-queue action.

## 1.202608.27

### Patch Changes

- 09e974c: Stop reporting a normal message as a fault. A message just typed into this browser has no server metadata yet, and the header said so out loud — "No Pi message metadata available", in the place a timestamp normally sits, on every queued message and every message whose send had failed. Having no metadata yet is that message's ordinary state, not something worth announcing, so the header now says nothing at all until there is something to say.
- 81db086: Stop resurrecting subagent runs that already stopped. An active parent turn was treated as proof that every unfinished child was still working, so typing a message turned a graveyard of long-dead runs back into "12 running". Measured on a real session, children that were still alive had been quiet for under a minute and the dead ones for at least 139 minutes, so the quiet separates them and the parent's own state never did. A busy parent now widens that window instead of overriding it. A run that started, wrote, and then went silent without recording an outcome reads as "Stopped" rather than "Unknown", which said only that the outcome could not be read — as true of a run still in flight as of one that died.

## 1.202608.26

### Patch Changes

- 88c92ec: Read a background task's log without it becoming something the agent said. Opening a task or a subagent run from the activity list wrote its output into the transcript as a tool message: a turn that never happened, attributed to the agent, appended again on every click and gone on the next reload. A log is a file, so it now opens in a view of its own and the conversation is left alone. A task whose log file exists but is still empty used to look readable and then appear to do nothing at all when opened; the viewer now says the log has not been written to yet.
- 644ba9d: Keep the model's name readable on a phone. The button naming the current model declared an ellipsis it could never draw: as a flex box its text wrapped instead, and the fixed height cut the second line off mid-name. The provider prefix now gives way first, so "anthropic-merchant/claude-opus-5" narrows to "anthr… claude-opus-5" and the model id — the part that names the choice — survives down to the narrowest screen, with the whole name on hover. The drawer's tabs also scroll sideways with their scrollbar hidden: two tabs need more room than a phone gives them, so the second one was simply absent. They now fade at the edge like the workspace tool tabs and the context bar already did, from one shared implementation.
- 644ba9d: Stop listing runs that never happened. A subagent that died before writing anything left behind the empty directory the tool had made for it, and a neighbouring `forks` directory holds conversations rather than runs; both were reported as agent runs. They claimed to be "running" for as long as the parent session was, counted themselves into the drawer header — five phantom runs made it read "Activity · 5 running" while nothing was running — and answered "No output for this subagent run" in a red banner every time one was opened. A directory is now only a run when it has left an attempt to read or a result to show. A real run that still has nothing to show opens empty and says so instead of raising an error, and a run that genuinely could not be reached still reports that.
- 3827ecd: Keep a resting subagent in sight. A subagent has no "done" of its own: it rests at "idle" between turns and can still be resumed. The activity list treated everything that was not actively working as finished, so an idle child was folded away under "Show N finished" and, in the full history, sank below every completed run because it carries no start time to sort on. A live session you could still open read as work that had ended. "Finished" now means only the states that really are terminal — done, failed, error — while the strip's "N running" count still reports just the work happening at this moment.
- 3827ecd: Find a model by naming the model and its provider. Searching "opus-5 merchant" returned "No matching options" even though `anthropic-merchant/claude-opus-5` was right there under "opus-5", because the search asked for the words as one unbroken run of characters and "claude-opus-5 anthropic-merchant" never contains "opus-5 merchant". The same model is served by several providers, so naming both is exactly how you tell them apart. Each word is now looked for on its own, so word order and whatever sits between them stop mattering. The action palette and the auth provider list shared the same matcher and the same blind spot: "sessions clean" now finds "Clean Up Sessions". A one-word search behaves as before, and each further word can only narrow the list.

## 1.202608.25

### Patch Changes

- 6cd3181: Say what an aborted turn was doing when it stopped. "Model response failed: This operation was aborted" is equally true of a cancelled turn, a tool that hung, and a stop the reader pressed — so on its own it left the reader to reconstruct which. The failed message still carries the tool it was calling, so the line now names it: "(stopped while running bash)", or "(the turn was stopped before it finished)" when no tool was in flight.
- 6cd3181: Adapt the transcript to the screen it is on. On a wide display a message stretched the full width — about 150 characters a line at 2560px, where the eye loses its place returning to the next line — so the reading column is now bounded near 78 characters and centred. On a short one (a phone with the keyboard up, ~400px) the composer's input area is allowed to shrink so the transcript keeps more than a couple of visible lines.

## 1.202608.24

### Patch Changes

- 420c376: Say why terminals will not start when node-pty's helper cannot be repaired. The runtime repair for node-pty's missing execute bit can only work where the install is writable; on a read-only one — a nix store path, an image layer — it failed silently and left node-pty to report `posix_spawnp failed.`, which names neither the file nor the cause. The failure is now remembered and attached to the error the terminal reports, naming the helper and where the bit has to be set instead.

## 1.202608.23

### Patch Changes

- a43a26d: Keep the pictures with a prompt that is waiting to be sent. A session's queue carries the text of a pending message and nothing else, so a prompt that was mostly a screenshot waited as an empty-looking line. The images now travel with the message's own bubble, where they render as thumbnails and open full size like every other image in the transcript.
- 6544640: Let the activity surfaces change state visibly rather than instantly. A row going from running to done, the status dock moving between idle, working and asking, and the drawer's tabs and filters changing selection all switched colour between one frame and the next, which reads as a flicker rather than as something happening. They now ease over the project's own motion tokens — colour only, so nothing moves position — and collapse to no transition at all under `prefers-reduced-motion: reduce`.

## 1.202608.22

### Patch Changes

- 0ded077: Say why adding a project did not work, where it was attempted. A failure was reported through the global banner while the dialog stayed open in front of it, so submitting a path that does not exist looked like the button did nothing — and the message, when it could be seen at all, was a raw `ENOENT ... realpath` string. The dialog now shows the reason itself, in words that name the next move ("Tick 'Create the folder if it does not exist'"), and the button reports that it is working.
- 3aa8eac: Show pending messages in the order they will be sent. A message this browser sent appeared as a bubble in the transcript while one queued anywhere else appeared in a panel drawn below the whole transcript — so a message sent seconds ago sat above one queued minutes earlier. Every pending message is now drawn in the transcript, ordered by the queue itself; the panel keeps the count and the clear action instead of repeating their text.
- 3d1d3f2: Keep the Add project buttons on screen. The dialog never bounded itself to the viewport, so a long list of folder suggestions pushed its footer — the only way to finish adding a project — below the fold on a phone, and further still once the keyboard opened. It now uses the same viewport bound the other dialogs already set, and scrolls its body instead of growing past the screen.
- 63ad445: Stop declaring a thinking subagent dead. Liveness was inferred from how recently the child wrote its transcript, with a ten-minute window — but a child writes only when it calls a tool, so four reviewers reading a long document (silent for 15 minutes) were all reported as `unknown` and the drawer said "Nothing running right now" while they worked. Whether the parent turn is still running is a fact rather than an inference, and it now settles the question: a run with no result, spawned by a turn that has not returned, is running. The mtime window remains only as the fallback for a run whose parent has already gone idle.
- c609d53: Stop colouring every system line as a fault. A background task that finished with exit code 0 was reported in danger red, which reads as a failure at a glance; system lines now use the muted tone and red stays for actual errors.

## 1.202608.21

### Patch Changes

- 2bd7b9b: Accept long extension-dialog prose in the browser. The daemon already bounds a dialog's title and message by the prose limit, but the client parser still held them to the tighter label limit, so a dialog with a long title failed session-status parsing and replaced the chat with "String field exceeds limit: title".

## 1.202608.20

### Patch Changes

- 403eb3a: Give the drawer's "Show N finished" control its full touch height. The coarse-pointer rule that raises it to 44px was written earlier in the stylesheet than the 30px base height it overrides, and a media query adds no specificity, so the base height won — the control stayed 30px on every touch device. Measured in a real browser; a unit test cannot see a cascade order.
- 9be94f8: Let an extension dialog carry the decision it is asking about. Titles and messages were bounded like the labels a user clicks (1,000 characters), so a dialog whose body is genuinely long — a goal proposal, a migration plan — was rejected outright, even though the card is built to render exactly that shape by splitting the first line into the heading and scrolling the rest. Prose now has its own, larger bound; option labels and placeholders keep the tight one.
- 491d216: Stop expiring extension dialogs by default. `extensionDialogsTimeoutMs` now defaults to `0` (wait for an answer) rather than five minutes. An expired dialog is settled with its kind's cancel value, which the extension cannot tell apart from a deliberate dismissal — so reading a long proposal on a phone for five minutes silently discarded it and reported it as the reader's own choice. A positive value still restores the safety valve, and dialogs are still settled when the run they belong to ends or is stopped and when the session ends.
- da4ec10: Stop reporting a session that is waiting for you as idle. A run parked on an extension dialog — `ctx.ui.confirm`/`select`/`input`, including the update prompt that cancels itself after a few minutes — was shown as idle in the status dock, and was left out of the waiting set the session list and quick switcher read, because both surfaces looked only for an `ask_user` question set. Both now ask one question ("is this session waiting on the user?") that counts either kind.
- 4f9e0a7: Open the conversation a shared link names, on a phone too. A narrow layout opens on the session list because it cannot show the list and the chat at once — but a link that already names a session has made that choice, and ignoring it left the reader in the list with the named session one tap away, while the same link opened the conversation directly on a desktop.
- 19c9db4: Say which step is which on a first screen. With no project chosen, the context bar read "Local | Choose | Choose": three steps sharing the bar are 103px wide at 1440px, under the container query that hides their labels, so nothing distinguished the project from the workspace. An unset step now names what it would choose.
- 6b43206: Leave a failed send in exactly one place. A send that failed put the message in two: the optimistic bubble stayed in the transcript reading "Not sent" while the same text was handed back to the composer — and the outbox, the one mechanism that retries by itself when the connection returns, was never reached, because the controller reported the connectivity failure instead of throwing it. A dropped connection now goes to the outbox and the bubble is withdrawn (so a successful automatic retry cannot end up sitting under a stale "Not sent" copy of itself); any other failure hands the text back to the composer, and the transcript keeps nothing.
- 500cb3d: Let session rows see a pending dialog too. The shared classifier every row and the quick switcher read counted only an `ask_user` question set, so a session blocked on an extension dialog was listed as idle. The rule now lives in one place, next to the rest of the session-state classification.
- b56139c: Tell the reader a workspace has no sessions yet. The list rendered its heading and then blank space, so the only way forward was a control in the heading the eye had already passed.
- 09867f0: Let a running subagent say what it is doing, and open. The reader that summarises a child's transcript looked for `content` on the transcript line, but pi writes the model message wrapped: `{"type":"message","message":{"content":[…]}}`. Nothing matched in any real transcript, so a run that had not written its result yet reported no steps: its row showed only "working", and opening it answered "No output for this subagent run" — which is every run while it is still running. The existing fixtures used the flat shape the reader assumed, so they agreed with the bug.

## 1.202608.19

### Patch Changes

- Sharpen the session activity drawer: the elapsed-time counter no longer re-announces itself to screen readers every second, "Show N finished" counts within the active filter instead of promising rows the filter hides, opening the drawer from the status dock keeps the filter you chose, the turn clock resets when you switch sessions, running rows are distinguishable from finished ones, and a short viewport (a phone with the keyboard up) always keeps at least two rows visible instead of collapsing to a header. Every control the drawer added now meets the 44px touch height the design tokens declare, and its small print meets AA contrast.
- Make the session activity drawer answer "what is running now". The list is ordered by what is live rather than by which of the three lists a row came from, shows only running work until the history is asked for ("Show N finished"), labels each row with its kind, and offers kind filters (subagents, agent runs, tasks) once more than one kind is present. The tab reports live work — "Activity · 2 running" — instead of the size of the history, and the status dock's background-work pill is now a control that opens the drawer on exactly that work.
- Give the screen to the input being used. While a question form or an extension dialog field has focus, the message composer collapses to a single line that restores it (and shows the start of an unsent draft), the answer box grows with the answer instead of keeping a long reply behind a three-line slot, and the floating status pill no longer sits on top of the field being typed into.
- Stop leaving a question form open that nobody is waiting for. A message queued before `ask_user` ran was delivered by the agent the moment the ask ended the run — milliseconds after the form appeared — and nothing voided the ask, so the form stayed on screen while the model read the queued message and reported the questions unanswered. Any user message entering the transcript now closes an open ask the same way a message sent while the form is on screen already did, and the model is told without being woken.
- Show background task durations that actually advance. The row comparison ignored the duration, so a running task froze at the elapsed time it had when its row first rendered - a number that answered "is this stuck?" incorrectly rather than not at all.
- Fix the composer that yields space to a question form. Focus moving inside a shadow tree is not redispatched to the host, so the listener never fired for pointer or touch users; collapsing then removed the editor's host from the DOM and the editor was not rebuilt on expand, leaving an empty input strip with the draft out of sight. The listener now sits on the shadow root, the editor is torn down and reseeded from the draft across collapse, and focus leaving the form - or the form closing - restores the composer.
- Let the end-to-end suite run against a locally started dev stack: the web container it writes workspace fixtures into is now `PI_WEB_E2E_WEB_CONTAINER`, matching the existing override for the session-daemon container, instead of a name only the upstream CI stack uses.
- Repair node-pty's `spawn-helper` before the first terminal starts. node-pty publishes the macOS helper without its execute bit (microsoft/node-pty#850, still unfixed on the `latest` tag), so package managers that preserve tarball permissions install a helper that cannot run and every terminal fails with `posix_spawnp failed` while nothing explains why. The execute bit is now checked once per process at the moment a PTY is spawned, which works however the package was installed - an install hook would not, because npm 12 does not run a package's own lifecycle scripts unless the installing user allows them.
- Stop leaving a dropped-connection error on screen after the connection is back. `TypeError: Failed to fetch` (and Safari's and Firefox's wording for the same thing) is now recognised as a self-healing transport failure, shown as "Lost connection to PI WEB. Reconnecting…", and withdrawn as soon as the realtime socket reconnects rather than waiting to be dismissed by hand.
- Record deployment environment variables in the services `pi-web install` writes. A service manager does not inherit the installing shell's environment, so `PI_WEB_UPDATE_COMMAND` and `PI_WEB_UPDATE_REPO` were lost on launchd and the update surface reported "no checkout to update" on a machine that was configured correctly. Only those two deployment-scoped variables are captured, so a one-off port or scratch data directory in the installing shell is not baked into long-lived service files.
- Notice a dead connection while the tab is still open. A socket dropped by a proxy, a NAT table or a tunnel stays OPEN in the browser and fires no close event, so the page silently stopped updating until it was reloaded; the staleness check that catches this only ran when a hidden tab came back. It now runs every 15 seconds while the tab is visible, the browser's `online` event retries at once instead of sitting out a backoff window measured against a network that no longer exists, and reconnect delays carry jitter so a daemon restart does not aim every tab at it in the same millisecond.
- Say how long the current turn has been running. A turn that has been going for hours looked exactly like one that started a second ago, which is how a session held open by a background process reads as "still thinking" all night while every message typed into it queues behind it. The status dock now carries the elapsed time and marks a turn that has passed ten minutes.

## 1.202608.18

### Patch Changes

- Repair node-pty's `spawn-helper` before the first terminal starts, not only on install. Install hooks are not dependable — npm 12 refuses to run a package's own lifecycle scripts unless the installing user allows them — so a globally installed PI WEB still failed every terminal with `posix_spawnp failed`. The execute bit is now checked once per process at the moment a PTY is spawned, which works however the package was installed.
- 62f704a: Add a search box to the provider selection list in the authentication dialog, so long subscription/credential provider lists can be narrowed by name or id. The search also applies to the stored-credential removal step.
- 2d60542: Make `pi-web doctor` exit nonzero when an installed Web/UI or session daemon component is unavailable or stale (restart needed), instead of only reporting it in the version section. Machines with no PI WEB services installed keep the previous informational behavior.
- Keep the test suite green on Node versions that ship experimental Web Storage. Node's flag-gated `localStorage` outranks the one the DOM test environment installs and throws on use, and its `sessionStorage` is shared by the whole process, so DOM cleanup crashed and module-level caches leaked between tests. Each test now gets its own storage. Several tests also assumed a temp directory that is not a symlink and a Linux-only detach path, which made them fail on macOS.
- 53006c1: Trim surrounding whitespace from the path when adding a project, so the stored project matches the path the trust preview showed and no whitespace-padded folder is created.
- e31d283: Fix the Add Project dialog showing "Loading folders…" forever without folder suggestions once a path was typed.
- 7344b31: Fix the prompt editor caret height before any text is entered, and keep the caret and selection highlight colors readable in every theme.
- 321de5d: Honor pi's global and project `enabledModels` settings in session model selection and cycling.
- 3369cc9: PI WEB now always honors pi's project-trust model; the `respectProjectTrust` opt-in (env var and config key) is removed. At session start a workspace's project-local `.pi/` resources load only when the workspace is trusted, resolved the way `pi` resolves it with no browser prompt: a saved decision in the agent directory's `trust.json` wins, a user/global extension may decide through the `project_trust` event (and request that the choice be remembered), and otherwise `defaultProjectTrust` applies — with `ask` or no decision a workspace is untrusted, matching headless `pi`.

  You can trust a workspace from the new workspace-menu toggle or when adding a project; both link to the project-trust documentation instead of spelling out the details in the UI. The trust routes are federated, so the toggle reads and stores the decision on the machine where the workspace runs.

  This is a breaking change for existing projects without a saved trust decision: after this release they become untrusted by default, so their project-local `.pi/` resources — settings, extensions, skills, prompts, themes, SYSTEM.md, APPEND_SYSTEM.md — do not load until you trust the workspace (workspace-menu toggle) or set `defaultProjectTrust` to `always`.

- 6db7a72: Report the Pi coding agent version in use: the Info panel and its diagnostics action now show the Pi version loaded by each PI WEB component (flagging when the session daemon runs a different one), the status/version API exposes it per component, and the `pi-web` CLI version report prints it.
- Make the create controls findable on a phone. The project and session controls were a bare "+" glyph and now carry their label again ("Add project", "New session"), and the machines list gained the "Add machine" control it never had. On narrow screens a section heading with no controls is hidden, so the machines section previously had no heading and no way to add a machine at all outside Settings. The machines section, the machine step of the context switcher and the mobile machine crumb now appear whenever a machine exists rather than only when there are two, so a single-machine install can still rename this device or add another.
- 679a956: Add an Enabled / All models toggle to the session model picker. All-models mode lists the machine's full model catalog — enabled models first — with a per-model checkbox that adds or removes the model from Pi's enabled-models list (the same setting the Pi TUI edits), and search keeps filtering in both modes. Picking a model keeps its current behavior.
- Repair node-pty's `spawn-helper` on install. node-pty publishes the macOS helper without its execute bit (microsoft/node-pty#850, still unfixed on the `latest` tag), and package managers that preserve tarball permissions install a helper that cannot run — every terminal then fails with `posix_spawnp failed` and nothing explains why. PI WEB now restores the execute bit after install. The step is idempotent, silent when there is nothing to fix, and never fails an install.
- 1e52e0b: Recognize Relay handoff session names whose leg identifiers contain letters or dashes.
- b4f68fb: Fix `pi-web restart` on macOS reporting success while LaunchAgents could disappear: the CLI now waits for each `launchctl bootout` to finish unloading before re-bootstrapping the service instead of racing launchd's asynchronous teardown, and the install path settles the same way. `pi-web start` and `pi-web restart` now also verify on macOS and Linux that each service is actually running and responsive (web/API endpoint, session daemon health), exiting nonzero and naming the unready service instead of succeeding silently. These readiness checks and `pi-web doctor` automatically use the custom config path persisted by `pi-web install --config` unless the command is invoked with a nonempty `PI_WEB_CONFIG` override, and fail safely when the service manager has a conflicting loaded definition; malformed systemd environment entries are rejected without stalling lifecycle commands.
- Show subagents and background tasks as they start. The activity list was read only when a session was selected, so a subagent requested in the conversation already on screen stayed invisible until the reader switched sessions and came back. The open session now refreshes its activity while its tab is in front, and stops when the tab is hidden. The status dock no longer reports "idle" while this chat's own background work is still running.
- Replace the stacked activity strip and notification tray above the transcript with one foldable, tabbed session drawer. Activity and Notifications are now separate tabs sharing the space instead of competing for it, the drawer explains what "Activity" means, and it stays folded to a single summary line ("Activity (2) · 2 done") unless something is running, something failed, or a notification arrived. Rows no longer look like assistant messages, a long subagent task no longer inflates a row to half the screen, and the list scrolls within a bounded height on short phone viewports.

  Fix machine renaming: the Settings → Machines rename form never appeared because its state was not reactive, and the local machine had no row menu at all. Every machine now offers Rename from its row menu in the machine list, including the local one, where the new name is stored as a display alias.

- Show subagent tool runs as what they are. A run's directory is named after the child session while its results are filed under the subagent tool's own run id, and PI WEB assumed the two matched: every finished run showed as "Unknown" with the generic name "subagent", lost its task and model, and could not be opened because its result looked absent. The two are now joined through the name the child session records for itself, so a finished run shows its agent, its verdict, its task and its output. Runs with no result file yet — including ones still going — open their own transcript instead of nothing.

## 1.202608.1

### Upgrade warnings

- **Browser plugin API v1 → v2:** browser plugin entries must now declare `apiVersion: 2`; v1 entries are rejected without a compatibility shim. The deprecated browser-v1 aliases were removed: use `refreshWorkspacePanels()` with `onInvalidate()`, the provider-authored `workspace.label`, and `workspace.provider.metadata` instead of `isGitRepo`, `isGitWorktree`, or top-level `workspace.branch`. The `plugin-api/unstable` package export is gone, and browser packages must declare a safe `browserRoot` with canonical relative module paths. The server plugin API stays on v1. Update any installed browser plugins when you update PI WEB.
- **Federated deployments must upgrade together:** machine federation breaks across versions in both upgrade orders. The workspace listing route now answers with a provider resolution object, so an older gateway cannot open any project on an updated machine and an updated gateway cannot open any project on an older machine (the machine still reports online and its settings, files, terminals, and sessions still load). Older gateways also lose Git status/diff on updated machines, and workspace deletion requires a host-issued confirmation from the same release. Upgrade gateways and remote machines together, then manually restart `pi-web-sessiond.service` on each target and reload the browser — a web/API restart alone is insufficient.
- **Requires Pi Coding Agent `>=0.84.0`:** update Pi before updating PI WEB.
- **Breaking configuration change:** the `agent.command` config key and `PI_WEB_AGENT_COMMAND` no longer do anything, and `PI_WEB_AGENT_DIR`, `PI_WEB_AGENT_SESSION_DIR`, and `agent.dir` are deprecated aliases of `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR`. Deprecated inputs still work in this release but show a non-dismissable UI warning and will be removed in a future release — rename the environment variables and delete `agent.*` from your PI WEB config now.
- **Restart the session daemon after upgrading** on every machine: the machine status indicators, the new subsessions default, and the Pi runtime changes only take effect with a session-daemon restart.
- **Tracked subsessions are now enabled by default:** agents receive the `spawn_subsession` / `list_subsessions` / `check_subsession` / `read_subsession` / `yield_to_subsessions` tools out of the box. Set `subsessions: false` or `PI_WEB_SUBSESSIONS=0` to opt out.

### Patch Changes

- 676815f: Keep `PI_CODING_AGENT_SESSION_DIR` visible to agent processes: when a deployment overrides the session storage directory, `pi` CLIs started from sessions, terminals, and subsessions now use the same session store as the session daemon instead of silently falling back to the default store.
- 180d71a: Send a provider login prompt or selection only once: pressing Enter again, or choosing another option, while the previous response is still being sent no longer submits a duplicate response that could lose the race and report an expired login request. Cancelling the login stays available while a response is in flight.
- 4471e80: Add semantic colors to session-tree kind badges so conversation entry types are easier to distinguish.
- d388375: Keep the session selection toolbar compact by showing the selected count in the clear action and right-aligning bulk session actions.
- 71f0eab: Allow subscription (OAuth) login and logout for federated remote machines from the gateway web UI. Provider discovery, login flows, and credential removal stay bound to the machine where the operation began, even if the selected machine changes while a request is pending. Older pending provider lookups cannot replace or close a newer login/logout dialog or flow. The dialog explains that the provider's redirect page will not load in your browser so you can paste the full redirect URL back to complete the login.
- 42ee6ed: Fix workspace (worktree) removal failing immediately with "Failed to start workspace removal: HTTP request cancelled". A request carrying a body is no longer mistaken for a disconnected client after its body has been read.
- 2dc27b7: Keep error messages readable. The error banner now stays until you dismiss it with its new dismiss button, another message replaces it, or the action that raised it clears it, instead of being wiped by an unrelated background refresh.
- 109ea72: Make the working, terminal, and unread indicators in the machine, project, and workspace lists reliable. Each machine's session daemon now decides which projects and workspaces a running session or terminal belongs to and publishes one status snapshot for the whole machine, so the browser shows the same state everywhere instead of matching directories on its own. Indicators for a machine appear once that machine runs a PI WEB version with this change and its session daemon has been restarted.
- 327df80: Give the web UI's custom overlay dialogs (authentication, settings, session cleanup, command picker, action palette, project/machine dialogs, and the session tree navigator) a shared modal surface: dialogs now take focus when opened, Escape and backdrop presses close them consistently, Tab focus stays trapped inside the dialog, and focus returns to the element that was focused before the dialog opened—even when stacked dialogs close out of order. Global application shortcuts pause while a dialog is open. The authentication dialog also supports ArrowUp/ArrowDown/Enter navigation through its option lists, matching the action palette. In the session tree navigator's second step (continuing or forking from a selected entry), a backdrop press now steps back to the tree — matching Escape — instead of closing the dialog outright.
- d8253a0: Upgrade the bundled Pi coding agent to 0.84.1 and require Pi Coding Agent `>=0.84.0`, so update Pi before updating PI WEB. Pi 0.84 makes provider logins, logouts, and catalog refreshes local-only and cancellable by default, so PI WEB no longer forces offline mode while creating its shared model runtime; bounded network catalog refreshes remain confined to the background refresher.
- 0085967: Always run sessions on the bundled Pi runtime and resolve Pi's agent state directory from Pi's own environment variables. **Breaking configuration change:** the `agent.command` config key and the `PI_WEB_AGENT_COMMAND` environment variable no longer do anything (they never replaced the embedded runtime), and `PI_WEB_AGENT_DIR`, `PI_WEB_AGENT_SESSION_DIR`, and the `agent.dir` config key are now deprecated aliases for `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`. Deprecated inputs are still honored for this release and surface a non-dismissable warning in the UI that names each input and its replacement and clears once you remove them; support will be removed in a future release. Migrate by renaming the environment variables to their `PI_CODING_AGENT_*` equivalents and deleting `agent.*` from your PI WEB config. `pi-web doctor` and the status/update flow now probe the `pi` command on `PATH` directly, and the session daemon exports the resolved state directory to everything it starts, so terminals, the bash tool, and agent-started `pi` processes all use the same directory as your sessions.

  Starting a second PI WEB instance against state owned by a live instance now fails loudly at startup with an actionable error naming the owner and the distinct `PI_WEB_DATA_DIR` / `PI_WEB_SESSIOND_SOCKET` / ports to set, instead of silently sharing state. Sessions carry `PI_WEB_SESSION=1` and receive environment facts explaining they run nested inside PI WEB, including the precautions for running another instance and for restarting services (web before sessiond); agent-spawned processes now inherit the daemon's `PI_WEB_*` environment, and the startup environment scrub removes only `NODE_ENV` and `PORT`.

  Restart the session daemon after upgrading.

- a625a43: Add safe inline workspace file previews for images, HTML, PDF, and rendered Markdown, plus attachment downloads for other files. Text-based formats (HTML, Markdown, and SVG) open as raw source and offer a Raw/Preview control; the chosen mode is remembered on this device, carries across files, and travels in the URL so shared links and browser Back/Forward restore the recorded view.
- fbe6cf9: Add a two-step session tree flow that first selects a history entry, then either continues from it in the same session or forks it into a separate session while leaving the original unchanged. Forking works for local and connected machines; user messages fork from before the entry and restore their text, when present, as the new session draft.
- 568c205: Keep cached session-list rows consistent with the transcript files they describe. When a session file has changed, its row is now rebuilt from a complete pass over that file instead of folding only the newly appended lines onto state kept from an earlier pass, so a row can no longer keep showing details that were overwritten earlier in the file. Unchanged files are still not re-read at all, and message bodies that cannot affect a row are still skipped without being decoded or parsed. This has a cost worth stating plainly: since 1.202608.0 a changed file was re-read only from its previous end, so refreshing a workspace while one of its sessions is actively being written now re-reads that whole transcript rather than just its new tail.
- c9aee67: Tracked subsessions now always run in the working directory of the session that spawned them, so a tracked child always appears in its parent's session tree instead of possibly landing in a workspace where you would not see it. `spawn_subsession` no longer takes a `cwd` parameter, and a request to start a tracked child in a different directory is refused with an explanatory error rather than quietly started somewhere else. To get work done in another workspace, either tell the child to work there, or use `spawn_session`, which can still start an independent session in any project workspace.
- bc4cad9: Enable tracked subsessions by default. Agents now receive the `spawn_subsession`, `list_subsessions`, `check_subsession`, `read_subsession`, and `yield_to_subsessions` tools out of the box; set the `subsessions` config key or the `PI_WEB_SUBSESSIONS` environment variable to `false` to opt out. Tracked subsessions still require `spawnSessions` (also on by default). Restart the session daemon after upgrading for the new default to apply.
- 989439a: Add trusted server-backed workspace provider plugins. Bundled Git now uses the same public lifecycle, claim, JSON backend, removal, federation, and diagnostics contracts available to installed third-party providers; PI WEB ships no replacement integration. Manage desired state per selected machine, and recover offline with `pi-web plugins disable` or `pi-web plugins safe-start ...` (`serverPlugins.safeStart`, including `bundled-only` and `none`).

  Machine federation breaks across versions in both upgrade orders, so upgrade gateways and remote machines together. The workspace listing route now answers with a provider resolution object instead of a workspace array, so workspaces do not load at all across a version mismatch: an older gateway cannot open any project on an updated machine, and an updated gateway cannot open any project on an older machine. The machine still reports online and its settings, files, terminals, and sessions still load, so the failure appears only once a project is selected. Workspace deletion also requires a host-issued confirmation from the same release, older gateways can no longer read Git status/diff from updated machines because the legacy core Git routes are gone, and newer gateways withhold all remote plugin contributions from older targets that lack the versioned lifecycle contract. After upgrading each target, manually restart `pi-web-sessiond.service`, then reload the browser; a web/API restart alone is insufficient. Restarting sessiond may interrupt active sessions/runtime ownership.

  Adopt browser plugin API v2 while keeping the server plugin API on v1. Browser entries must set `apiVersion: 2`; v1 entries are rejected without a compatibility shim. Activation now exposes stable source `pluginId` separately from host-unique `runtimePluginId`. Remove the deprecated browser-v1 aliases: use `refreshWorkspacePanels()` with `onInvalidate()`, use the provider-authored `workspace.label` for generic presentation, and read provider details from `workspace.provider.metadata` instead of `isGitRepo`, `isGitWorktree`, or top-level `workspace.branch`.

  Make the two supported type-only package exports self-contained for strict external TypeScript consumers and remove the former `plugin-api/unstable` path. Browser packages must declare a safe `browserRoot` and canonical relative module paths; only files inside the root are served, with both `.js` and `.mjs` receiving executable JavaScript MIME types. Ship a standalone dual-entry workspace-provider example and updated migration, identity, metadata, signal, removal, asset-boundary, and packaging guidance.

- f24b9a8: Session trees now cover only the workspace you are viewing. Opening a workspace's session list no longer reads session files from your other worktrees, so listing stays fast no matter how many sibling worktrees exist or how busy they are. Three things go away with it: a session's row no longer counts child sessions started in other workspaces, a session whose parent lives in another workspace no longer names that workspace, and it no longer offers "Go to parent session". Such a session now appears as an ordinary top-level row with a dimmed `↳` marker (hover text: "Parent session is not available in this workspace"). Parents and children in the same workspace are untouched — they still nest, indent, and detach exactly as before.

## 1.202608.0

> [!WARNING] > **Breaking change:** Compatibility with older PI WEB runtimes has been removed. Upgrade every remote machine first, then the gateway, so every machine and the gateway run `1.202608.0` together. This release also requires Pi Coding Agent 0.83.0 or newer.

### Patch Changes

- f716f65: Keep the session daemon's own runtime environment out of agent processes: agent shells, terminals, and spawned sessions no longer inherit keys such as `NODE_ENV=production` or `PI_WEB_DATA_DIR`, so commands like `npm install` behave normally inside sessions and a second PI WEB instance started from a session no longer picks up the live daemon's data directory or socket.
- c09b67d: Show the thinking level in assistant chat bubble metadata next to the model and timestamp, for both history and live messages. Bubbles from turns with thinking off stay unchanged.
- 8163d08: Drop all backwards-compatibility gates for older PI WEB runtimes. This release is incompatible with older components: upgrade every remote machine first, then the gateway, so all machines and the gateway run the new version together.

  Also fixes the session daemon staleness check: a session daemon running an older version than the installed package is now correctly reported as stale, so the restart reminder fires as intended.

- b9d3634: Speed up session listings and opening persisted sessions in projects with large session histories. The session daemon no longer parses every session transcript on each request: listings use a lightweight summary scan with an incremental cache that only re-reads newly appended transcript data, and opening a session no longer triggers redundant full-workspace scans.
- 233fd90: Navigation panel sections now share the panel height equally: collapsing a section (such as Projects) distributes its space to all remaining expanded sections instead of only the session list growing.
- ff7a06e: Show nested relay documents in the Relays workspace panel. Folders in a relay packet now appear as chips in the document strip and expand inline (expanding one collapses its siblings); collapsing the folder that holds the open document keeps the selection and highlights the folder. Very deep or large relay trees are listed partially, with a notice.
- Update HTTP server dependencies to patched releases that prevent static-route authorization and path-traversal guard bypasses, request-validation host confusion, and denial-of-service vectors.
- 4bf2be9: Respect the Pi agent profile's `httpIdleTimeoutMs` in the session daemon so long model responses (e.g. slow local vLLM backends) no longer fail with "Model response failed: terminated" at the built-in 5-minute HTTP idle timeout; `0` disables the timeout. Restart pi-web-sessiond after changing the setting.
- c2b7cce: Sessions started via `spawn_session` and `spawn_subsession` now inherit the spawning session's thinking level instead of falling back to the pi default, clamped to the child model's capabilities.
- 5f4d813: Let agents pick a model when delegating work: `spawn_session` and `spawn_subsession` accept an optional `model` parameter as an exact `provider/model-id` (an unknown value is rejected; omitting it keeps the inherited model). In the chat composer, typing `#` opens a model completion menu that inserts a `#provider/model-id` reference into the draft, which agents forward as that parameter.
- 7103bfc: Streamline the session list bulk-selection toolbar: the Select visible / Clear visible / Clear buttons are now a single toggle that offers "Select visible" when nothing is selected and "Clear selected" otherwise, and the redundant Done button is gone — selection mode closes from the same ☑ heading button that opened it. "Archive selected" and "Delete selected" are shortened to "Archive" and "Delete". The slimmer toolbar no longer wraps to two lines on narrow sidebars.
- 9ef2649: Upgrade the bundled Pi coding agent to 0.83.0, bringing credential export commands, headless OpenRouter sign-in, Claude Opus 5 on GitHub Copilot, and upstream session and provider fixes. The supported Pi version range is now open-ended (`>=0.83.0`, no upper bound), so you can run newer Pi releases as they come out without waiting for a PI WEB update.
- f927f5d: Run a repo-provided `.pi-web/hooks/worktree-pre-remove` hook before deleting a workspace worktree. When the hook exists and is executable, it runs with the target worktree path before `git worktree remove`; a non-zero exit blocks the removal. See the config reference for the hook contract.

## 1.202607.3

### Patch Changes

- 9191f59: Add an `ask_user` session tool that lets agents post structured question sets as one chat-native browser form. The form uses the transcript's single scroll area, keeps its header visible, and always gives every question a Custom free-text answer with mobile-safe text sizing. Agents end their run while the form waits; users can submit full or partial answers, unanswered questions are reported explicitly, sending an ordinary chat message voids the open form, pending forms survive browser and web/API reconnects, and closed forms remain readable in the transcript. Disable the tool from **Settings → Session daemon**, with `askUser: false`, or with `PI_WEB_ASK_USER=false`.
- 111db63: Let chat markdown tables keep their natural width and scroll horizontally instead of being squeezed into the chat column, making them readable on mobile.
- 5759201: Support Pi extension dialogs in the browser: `ctx.ui.confirm()`, `ctx.ui.select()`, and `ctx.ui.input()` now render as cards inline in the session transcript and resolve with the user's actual answer — including dialogs opened from `session_start` hooks while the session is still starting and from in-flight `tool_call` hooks, which previously resolved `false` immediately despite `hasUI === true`. Answers travel over a dedicated session-daemon channel rather than the prompt queue, so a dialog parked inside a `tool_call` hook cannot deadlock the run. Open dialogs survive browser reloads, the first answer wins across browser tabs, and unanswered dialogs settle safely on run abort, runtime replacement, or timeout. Adds the `extensionDialogsTimeoutMs` config key (default 5 minutes, `0` waits forever) as the unattended-dialog safety valve; dialog support is always on. Other `ExtensionUIContext` surfaces (widgets, status, editor, `custom`) remain unimplemented.
- 8517800: Turn the bundled Info plugin panel into an always-available PI WEB status view: it now shows the running and installed versions, installation kind and path, release state, per-service health, and machine and workspace details from host-provided status, plus a "Copy PI WEB Diagnostics" action that copies a plain-text summary for bug reports.
- 531ccf7: Let an already-known provider extension refresh its own model list after daemon startup. Previously every provider registration made after the global bootstrap was ignored, so a provider that fetched an updated model catalog on session start never had those models appear. A registration is now applied when it matches the provider's recorded startup configuration in every respect except the model list; anything else — a new provider, a changed provider base URL, API key, API type, headers, or auth surface, a native provider registration, or an unregistration — is still ignored to keep project-level provider configuration from leaking between workspaces. Documented the refreshed policy under Pi extension provider baseline in the configuration reference.
- ce4b469: Add action-palette commands for selecting a session's model and thinking level, with support for assigning custom shortcuts in Settings.
- 69b125b: Show cross-workspace session relationships in the session list. A session whose parent lives in another worktree now names that parent's workspace or branch instead of only reporting an unavailable parent, and offers a "Go to parent session" action that switches to the owning workspace and selects the parent. A session with children in other workspaces of the same project now shows how many, so a parent no longer looks childless when its children are not nested beneath it.
- d19fca4: Add `files.listFiles(path)` to the stable plugin API so workspace panel and label plugins can list workspace directory entries on local and federated machines.
- 8517800: Add `state.selectedMachine` to the stable plugin runtime state so plugin actions and other runtime callbacks can read the selected machine's identity, not just workspace panel contexts.
- 87c0998: Add a built-in Relays plugin: a read-only workspace tab (and **Open Workspace Relays** action) that browses `.pi-web/relays/` packets, with a most-recent relay picker, ordered document tabs, sanitized markdown rendering, and truncation notices.
- c3aeef2: Keep the relays panel document tab strip's horizontal scroll position when switching documents, instead of jumping back to the left edge on every tab click.
- 5c3461d: Remove the legacy session archive migration from session daemon startup. Each `PI_WEB_DATA_DIR` data directory is independent: pointing PI WEB at a new data directory starts there with empty registries and no session archives.

  You are only affected if you have session archives created before July 2026 in the default `~/.pi-web` data directory and you newly set a custom `PI_WEB_DATA_DIR`. To carry those archives over, stop PI WEB, then copy `archived-sessions.json` and the `archived-sessions/` directory from the old data directory into the new one.

- 76f292c: Stop the session and workspace lists from re-scrolling to the selected row on live data refreshes, such as message-count updates while a session streams or workspace topology refreshes. The lists now scroll the selection into view only when the selection moves to a different row, an archived session is revealed, a restored session moves back to the current section, or a collapsed section expands.
- 49e7c39: Say what a slow session start is waiting on. While a session is being created or opened, the activity line now names the current startup step — starting the Pi session, or loading session extensions — and adds a note when provider model lists happen to be refreshing at the same time. When nothing can be attributed, the previous generic wording is kept rather than guessing a cause.
- 8af637b: Give every navigation row a single activity indicator that also carries unread state. When sessions beneath a workspace, project, or machine row have unread completions, the row's indicator becomes a static accent ring around the activity dot — or a filled accent dot while idle — instead of a separate dot next to the name. Session rows now surface unread state even while busy or sending, and the "N unread" header and mobile Sessions badge count busy unread sessions too.
- 8af637b: Add "Mark as read" actions for unread sessions: a per-session item in the session row ⋯ menu (shown only for unread sessions) and a bulk "Mark read" button in the multi-select bar that marks every unread selected session as read.
- 4a51503: Add copy buttons to the workspace menu details so the workspace path and branch can be copied to the clipboard with one click, matching the copy affordances already available in chats.
- 8a24a7c: Pick up git worktrees created or removed outside PI WEB without any user action. The selected project's workspace list is re-read whenever the browser tab regains focus or becomes visible, on local and remote machines, keeping the current workspace, session, and scroll position untouched. Worktrees whose checkout directory no longer exists are hidden instead of being offered as selectable workspaces.

## 1.202607.2

### Patch Changes

- b48b147: Allow npm 12 global installs and updates to run node-pty's required native-module installation scripts, and diagnose blocked native modules before installing services.
- ed9c2f6: Fix multi-minute stalls when opening the model selector, starting sessions, or using the auth dialogs. Provider model catalogs are no longer fetched on request paths: the session daemon now refreshes them in the background on a bounded schedule — shortly after startup and hourly, plus immediately after a provider login or logout — with a per-run timeout and a single retry, keeping the stored catalogs when a provider fails. Setting `PI_WEB_OFFLINE` or `PI_OFFLINE` disables these background refreshes entirely. See the configuration reference for details.
- 4ca4a1d: Add a hierarchical `/tree` navigator for switching conversation branches in place while retaining abandoned branches, with optional branch summaries. Compact branch indentation keeps the tree usable across mobile and desktop, and the preselected no-summary choice navigates immediately.
- b85e1b9: Show project activity indicators for active sessions and terminals in external Git worktrees before the project is opened.
- a77c83b: Clarify agent instructions so independent sessions are created only when explicitly requested and tracked subsessions remain part of the current task.
- 115d74e: Keep session unread indicators and counts synchronized across browser clients and daemon restarts, and clear them when the completed chat is viewed. Tracked sub-sessions remain excluded from unread counts.
- 8a5aaf9: Add a List/Tree toggle to the Git panel's changed-file list. Tree view groups changes by directory and opens fully collapsed, with a one-click expand-all/collapse-all control, and the chosen view is remembered across sessions.
- dd435cb: Expand a changed submodule in the Git panel to see the work inside it. Tree view nests the submodule's own modified and untracked files (keeping their folder structure) and list view flattens them into one group, with a moved commit pointer shown as `<old> → <new>` when it changed. Selecting any inner file shows its real diff instead of the bare `Subproject commit` line.
- 2429113: Build an immutable provider baseline at session-daemon startup. Globally installed Pi extensions can register both config-form and native providers during startup bootstrap; every later Pi extension registration or unregistration—including global replay, project same-ID replacement, lifecycle callbacks, and `/reload`—is ignored. PI WEB browser plugins are a separate browser-only system and are unaffected. Non-provider Pi extension features still work, and ignored calls are de-duplicated in session-daemon logs by operation/provider ID without logging provider configuration or credentials or creating session warnings/notifications.

  After updating PI WEB, or after installing, removing, or updating a globally installed Pi extension that registers providers, manually restart `pi-web-sessiond.service` (`systemctl --user restart pi-web-sessiond`). Restarting only the web/API service and running `/reload` do not rebuild the provider baseline.

- a884773: Keep PI WEB-managed sessions running when extensions use `ctx.ui.theme`, preserving formatted output as readable plain text.
- 503c2c7: Show extension notifications in a compact, dismissible tray for the selected chat, with reconnect recovery and per-chat collapse state.
- 2c777b4: Let users minimise session warnings with an accessible status-bar count that remains available as an expand/collapse toggle, an in-pane minimise chevron on the expanded warnings pane, per-session remembered state, and SVG warning icons.
- 9285448: Require Pi Coding Agent `>=0.82.1 <0.83`. PI WEB no longer supports Pi 0.81 and earlier, so update Pi before updating PI WEB. On Pi 0.82 provider model catalogs revalidate with the server instead of downloading in full when nothing changed, and newly published catalog updates are no longer suppressed for a while after a fresh install.

## 1.202607.1

### Patch Changes

- 73ac24c: Set `PI_WEB_TERMINAL=1` in PI WEB terminal shells.
- 67f673b: Keep auth interactions bound to their originating machine and cancel flows created after their browser start operation becomes stale, preventing secrets from reaching the wrong remote or abandoned provider resources from surviving a closed dialog.
- a1f749c: Add a capability-aware Clear queue action that removes queued session messages, including prompts held during compaction, without stopping active work.
- dde48b3: Validate install and doctor service requirements in the real systemd or launchd manager context before changing native services, with plan-specific PATH guidance and safe probe cleanup. Thanks to @blain3white for the original report, reproduction, and root-cause analysis.
- f539193: Restore session-daemon startup and authentication on supported Pi `>=0.80.8 <0.81` releases by migrating model and credential handling to `ModelRuntime`. Provider discovery now reloads model configuration and reports only complete usable credentials. Login options follow each provider's executable API-key and OAuth capabilities: multi-step API-key setup is supported, legacy one-secret clients fail safely before storing malformed credentials, and OAuth prompts retain their input, selection, and device-code semantics. A committed login remains successful through late cancellation or notification failures. Failed realtime delivery now closes only the affected socket so its browser can reconnect while healthy peers keep receiving events. PI WEB now requires Node.js `>=22.19.0`.
- d72b14f: Add a **Check for PI WEB Updates** action that bypasses cached release data and refreshes update status for the selected local or federated machine.
- 75e2377: Add selectable Pi-compatible agent profiles and companion CLIs for isolated auth, models, settings, sessions, Pi packages, plugins, diagnostics, and safe update commands. Settings shows when a session-daemon restart is required, and mixed-version remote saves fail instead of reporting false success. The embedded runtime remains the bundled Pi SDK.
- ec0ca13: Store session archive metadata and archived session files under `PI_WEB_DATA_DIR` when configured, and automatically migrate a legacy archive on the first eligible session-daemon startup after upgrading.

  Migration runs only when `PI_WEB_DATA_DIR` explicitly selects a different root, the legacy index and every referenced file form a complete valid archive, and the destination archive is pristine. PI WEB copies and verifies files across filesystem boundaries, rewrites their `archivePath` values, atomically commits the destination index, and only then removes legacy archive state. Ambiguous, invalid, partial, or coexisting layouts are left untouched instead of being merged or overwritten; active Pi session files are never moved.

- 2b1507b: Load login shell profiles in new and continued interactive terminals so PATH-managed commands are available.
- 15d25d8: Omit oversized tracked-subsession output from parent completion notices, directing the parent to retrieve the full result with `check_subsession` instead of duplicating a truncated preview in context.
- a493949: Support root and nested reverse-proxy deployments with one published client, including scoped PWA assets, WebSockets, and local or federated plugins.
- 21c58fe: Serve PI WEB plugin SVG assets with a browser-compatible content type and clarify module-relative asset packaging.
- d72a001: Show notifications emitted by Pi extension slash commands in the web chat.
- f181c47: Keep tool-result images visible in clearly labeled standard chat cards outside collapsed event groups while retaining technical execution details and final message metadata.
- 2b17145: Stream in-flight assistant replies immediately when opening or reconnecting to a session mid-turn. The chat now seeds the partial message (text, thinking, and in-progress tool calls) and continues streaming live updates on top of it, replacing the blocking "Catching up…" placeholder and the end-of-turn transcript reload. Sessions still open normally against remote machines or session daemons that predate this feature: the snapshot is fetched as a progressive enhancement and its absence no longer blocks the transcript.
- aedcbf8: Surface live session startup warnings in the web UI. A pinned banner at the top of the session view now shows resource and runtime diagnostics (skills, prompts, themes, and extension load errors) plus the Anthropic subscription-auth billing notice, recomputed from the current runtime so they stay accurate across browser reloads. The Anthropic billing notice can be dismissed, which durably suppresses it through the underlying agent's own warning setting.
- d5154df: Add explicit tracked-subsession yielding with no-poll wake-up guidance, remaining-child status, and clear boundaries around child output.
- 6cd666f: Let chat images open in a full-size modal viewer on click or keyboard activation, with backdrop and Escape to dismiss, a touch-friendly close button, and safe-area handling so the viewer clears device notches.

## 1.202607.0

### Patch Changes

- d165d69: Make archive and delete actions reliable for large multi-session selections.
- d6cfffd: Allow chat copy buttons to work from HTTP private-network addresses by falling back when the browser Clipboard API is unavailable.
- a660ba8: Keep delegation tools available in human-created and independently spawned sessions, remove them from tracked child sessions, and guide parents to wait for required children at join points without polling.
- 256db33: Keep npm release builds working across platforms and exclude internal test-support modules from published packages.
- 338faf4: Speed up chat loading, session resume, and long-conversation rendering while reducing browser response sizes.
- ad62853: Show complete file paths and commands in tool headers and expanded details, with horizontal scrolling for long tool targets and results.
- a874798: Make spawned and tracked subsessions inherit the dispatching session's current model instead of falling back to the last globally selected model.
- eb17276: Preserve archive and archived-session delete actions for older federated PI WEB machines that do not yet advertise session persistence or delete capabilities.
- 8ade238: Manage Pi packages from Settings on the selected local or federated PI WEB machine, with install, update, and removal flows that respect each machine's advertised capabilities.
- 2009e6a: Keep the chat prompt stable during streaming so mobile touch gestures, including iOS paste and edit callouts, are not interrupted.
- 7063c2c: Prevent iOS Safari from zooming into small text inputs across the web UI.
- 386c67e: Require Pi 0.80 or newer and use its stable streaming API for session-name generation.
- 32907bb: Support Pi's `max` thinking level and refresh shipped runtime dependencies.
- 10efb7f: Name Relay handoff sessions consistently from their relay name and leg number.
- 256db33: Improve file suggestions by waiting for all Git probes before deciding whether to scan the wider workspace.
- 0b17b9d: Promote the Updates tab to stable by removing its beta label while keeping update message counts visible.
- 64b2b32: Edit machine-scoped PI WEB settings on the selected machine—including session daemon tools, plugin enablement, path access, and upload defaults—while keeping gateway/browser-only settings local and disabling unsupported remote forms.
- d2e10cd: Show generated suffixes for unnamed sessions so multiple new empty chats are easier to distinguish.
- 889672f: Add `/reload` for PI WEB sessions so newly installed Pi package resources can be loaded without restarting the session daemon, with separate guidance for browser plugin reloads.
- 2665d1e: Open new chats immediately—including on mobile—queue sends until their backend sessions are ready, and keep concurrent starts and archive/delete/reload actions aligned with server persistence.
- b61a9c0: Standardize Settings panels so descriptions, notices, and controls render in a consistent order.
- abcf44b: Show complete message dates and model identifiers in a consistent label, wrapping expanded metadata without changing message-header height.
- 02f34c4: Add a terminal copy mode with a touch-selectable, color-preserving output snapshot and a Copy all action for mobile browsers.

## 1.202606.7

### Patch Changes

- b17faeb: Improve chat, prompt, and session text rendering for RTL and mixed-direction content.
- 7e812aa: Allow chat composer attachments to save and mention general files while preserving native inline image delivery for supported image-only batches.
- 47c9b66: Fix `pi-web doctor` "can find npm/pi" checks on fish. The `--version` check
  wrapped the version command in a POSIX subshell `(cmd --version 2>&1 || true)`,
  which fish parses as a command substitution in command position and rejects
  (`command substitutions not allowed in command position`), producing a false
  negative. Emit fish's `begin; ...; end` grouping when the service shell is fish.
- b14205e: Highlight within-line changes in the Git diff viewer.
- cb13af4: Add a manual sessions cleanup flow that previews and confirms archiving idle sessions and deleting old archived sessions, with per-project selection and capability guidance for unsupported machines. Actions can now expose disabled reasons so unavailable remote-machine actions stay visible with an explanation.
- e46d9ec: Add manual Files panel uploads with direct drag/drop, an options flow from the Upload button, safe non-overwrite defaults, visible per-file progress/error reporting with clear failed/cancelled terminal states, and project-local default destinations.
- 32ea809: Add a Keyboard shortcuts setting for choosing whether Enter sends chat messages or inserts new lines in this browser, with Shift+Enter performing the opposite action when supported, while preserving the desktop-vs-mobile default (desktop Enter sends; mobile/coarse/narrow Enter inserts a new line).
- a99696b: Persist tracked subsession links in session history so parents can list, check, and read child sessions after the session daemon restarts, and reopened children can resume parent notifications.
- 27a3b2b: Add workspace file mutation (`files.writeFile`, `files.deleteFile`, `files.moveFile`) and prompt editor (`prompt.insertText`, `prompt.getText`, `prompt.getSelection`) APIs to the plugin system. File mutations work for local and federated machines, enforce workspace path safety, and auto-refresh the File Explorer.
- 9980027: Expose the plugin prompt editor helper in workspace panel contexts so panel interactions can insert text into the current prompt.

## 1.202606.6

### Patch Changes

- c479a0d: Fix the session daemon startup when PI WEB runs with compatible Pi packages that moved legacy provider registry exports to the Pi AI compatibility entrypoint.

## 1.202606.5

### Patch Changes

- c2e2a29: Add a dedicated PI WEB configuration reference covering config-file precedence, project-local config, external path access allowlists, session daemon tools, plugins, shortcuts, upload limits, and environment variables. Custom `pi-web install --config` paths are now passed to the session daemon service as well as the web service, and the session daemon now honors config-file `maxUploadBytes` values.
- 4f4c6fa: Fix remote session reloads so they proxy through the web/API instead of returning the app shell as JSON.
- 62c2234: Prevent live skill-loading cards from duplicating when the finalized transcript groups multiple skill reads.
- 27bc924: Persist the Settings → Session daemon tracked subsessions toggle so it remains enabled after restart.
- d931101: Fix dead-key/IME input in the terminal (e.g. typing `~` on a Swedish keyboard). The character previously stuck in the top-left corner and was never sent to the shell. The terminal panel now includes the xterm composition-view styles and no longer forces the helper textarea's position with `!important`, so dead-key composition is placed at the cursor and committed correctly.
- 6933d3a: Keep mobile navigation on the selected session when remote workspace loading finishes out of order.
- 2bb6e48: Normalize allowed external path suggestions on Windows so configured absolute paths use platform separators consistently.
- 9cc20d6: Allow configured external filesystem roots to be listed, read, configured from the global settings UI, and completed from absolute `@` path suggestions while keeping absolute paths denied by default, advertise workspace-scoped file suggestion support as a remote-machine capability, and use `fzf` when available to improve file/path completion filtering.
- 355ebe8: Add tracked subsessions (beta, off by default): agents can spawn child sessions they stay attached to. The new `spawn_subsession` tool starts a child session linked to its parent (recorded in the session tree), notifies the parent when the child stops working, and lets the parent inspect children via `list_subsessions`, `check_subsession` (a quick glance at a child's status and latest output), and `read_subsession` (read through a child's transcript with role/content filters, full-content substring search, optional per-value `maxChars` truncation that flags clipped parts, and pagination). The completion notice is delivered as a system-authored message (not attributed to the human), and still wakes an idle parent while queueing behind any in-flight work. Unlike the fire-and-forget `spawn_session`, subsessions are observable by their spawner.

  The capability is gated behind a beta flag so it can ship without being exposed in releases: enable it with the `PI_WEB_SUBSESSIONS` env var, the `subsessions` config key, or the "Allow agents to start tracked subsessions" toggle in Settings → Session daemon. It also requires `spawnSessions` to be enabled. Requires a manual session daemon restart to take effect.

## 1.202606.4

### Patch Changes

- 53b00c4: Show a per-session sending indicator while messages with image attachments are uploading. Previously the composer cleared instantly while the upload, server-side image resizing, and first-session open happened in the background, so it looked like nothing was happening. The chat activity dock now shows "Sending your message…" for the originating session (including the folder-mode upload step), and that session shows the activity dot in the session list so progress is visible even after switching away. The indicator is scoped per session, so it no longer leaks onto other sessions or machines, and the upload itself continues in the background regardless of navigation.
- cfb7493: Improve user/assistant message distinction in the dark theme. Previously the user and assistant message backgrounds were nearly identical (contrast ratio ~1.06), making it hard to tell speakers apart. The dark theme's user-message background was lightened and decoupled from the generic hover color, and the user border brightened, so user turns stand out clearly.
- dd23b3e: Fix a duplicate session appearing in the list when starting a new session. The `session.created` broadcast (added with the spawn_session tool) could race ahead of the start request's HTTP response in the same tab, leaving two badges with the same id — one with archive/reload actions and one with delete. The optimistic insert now replaces any entry the broadcast added, so the locally cached session (with its delete action and draft support) always wins.
- 3930505: Fix the "Catching up…" badge sometimes staying visible after a session goes idle. The stream catch-up mode was tracked by two fields that could drift — a private guard and the public badge flag — and the socket reconnect path updated one without the other, so the terminating idle status no longer cleared the badge. Both facets now route through a single source of truth, and any idle status for the selected session reliably dismisses the badge.
- 411e61a: Declutter the chat composer bar with icon-based actions. The Send, Queue, Steer, and Stop buttons are now compact icons, the Attach button moved into the message box, and the thinking level is shown as a small gauge whose bars reflect the levels available for the current model. This leaves more room on narrow/mobile layouts while keeping the model selector readable. All controls retain accessible labels and tooltips. Thinking levels are now sourced from pi directly, so an unfamiliar level from a newer pi version is still selectable and displayed gracefully instead of causing an error.
- d17050e: Add image attachments to the chat composer. You can now paste (Ctrl/Cmd+V), drag-and-drop, or use the new Attach button to add PNG, JPEG, GIF, and WebP images to a message, with thumbnail previews and multi-image support. Attachments are delivered to the session using pi's native image format (images are auto-resized to pi's inline limits for full compatibility), and image content now renders inline in the transcript. A per-message delivery toggle also lets you instead save attachments into the workspace `.pi-web/attachments` folder and reference them so the agent reads them with its own tools. The accepted HTTP upload size is now configurable via `PI_WEB_MAX_UPLOAD_BYTES` or the `maxUploadBytes` config value.
- 3c6b4a4: Run the suggested Linux restart commands inside a detached transient systemd user service (`systemd-run --user`) instead of directly. The restart now completes even when the launching PI WEB terminal is killed by restarting the session daemon, and its output can be inspected with `journalctl --user -u pi-web-restart`.
- 61f0b79: Move reload to the end of the session action menu.
- 82db15f: Add a **Reload** action to the session three-dot menu that re-reads the session from disk. The session daemon keeps an in-memory `SessionManager` per session and never re-reads the session file, so when the same session is also driven by another process (for example the `pi` CLI), new on-disk entries were invisible to the web UI and the tail of the conversation appeared truncated. Reloading closes the active session, re-opens it from disk, discards the cached transcript, and re-fetches the history.

  Reload is also available from the command palette as **Reload Session**, so it can be triggered from the keyboard and assigned a custom shortcut. Reload refuses to run while the session has work in progress and on archived (read-only) sessions, and is gated behind a new `sessions.reload` runtime capability so it only appears for machines whose Pi-Web runtime supports it (both the menu item and the palette action are disabled otherwise).

  Note: this changes a session daemon code path, so `pi-web-sessiond.service` must be restarted manually for the server side of this change to take effect.

- 95c1512: Let agents start new sessions with a `spawn_session` tool. An agent can dispatch a fresh, independent session with an initial prompt — useful for ralph-style loops (an agent kicks off the next iteration when done) and for chaining long plans across sessions. Spawned sessions are normal sessions a human can open and interact with, and they now appear in the session list the moment they are created (in the matching workspace) without a manual reload.

  To keep every spawned session visible and controllable, an agent may only spawn into a workspace — any worktree, including one it just created — of the same registered project as the spawning session. The capability is on by default and can be toggled under Settings → Session daemon (or via the `spawnSessions` config key / `PI_WEB_SPAWN_SESSIONS` environment variable); changes take effect after the session daemon restarts.

  Note: this adds a session daemon code path, so `pi-web-sessiond.service` must be restarted manually for the server side of this change to take effect.

- 3c6b4a4: Make the Updates panel actionable: every suggested command now has both a Copy and a Run button (Run executes it in a workspace terminal), a single recommended all-in-one command is shown at the top so users do not have to choose, and the remaining commands are grouped as clearly optional additional commands.

## 1.202606.3

### Patch Changes

- c0d1222: Fix sessions outside the server's launch directory being invisible: listing returned no sessions and opening them failed with 404 "Session not found", leaving the model picker empty. Working directories are now normalized at the API boundary and when reading stored session data, so path differences (trailing slashes, redundant segments, and Windows backslash vs forward-slash forms) no longer hide live or archived sessions. Requests with a relative `cwd` are now rejected with a 400 error instead of being resolved against the server's own working directory. Requires Pi coding agent SDK 0.78.0 or newer.
- 38cf334: Restart the web/UI services before the session daemon in the suggested "Restart all" command and `pi-web restart`, so running the command from a PI WEB terminal still restarts the UI even though restarting the session daemon kills the terminal.

## 1.202606.2

### Patch Changes

- 824b7a0: Initialize Pi extensions for web-managed sessions so `session_start` handlers, extension resources, and startup-dependent tools run correctly.
- a73bceb: Reduce desktop navigation crowding by moving machine switching into a compact header control and removing automatic desktop section collapse.
- 9a3f2ce: Make navigation sections collapsible on desktop and auto-collapse completed context sections after selections.
- 271c990: Document machine federation across the website and add a Fleet guide for setup, trust model, remote plugins, and troubleshooting.
- 351ed03: Add a keyboard shortcuts settings editor with manual entry, recording, disabling, reset-to-default controls, and conflict/shadowing indicators.
- 65b4c76: Let Firefox copy only the selected chat text instead of replacing selections with the full message.
- d66eccc: Keep all-file prompt suggestions active while typing file names with spaces, and include git-tracked/untracked matches when broad all-file scans miss them.
- f7eff88: Make the app refresh control perform a full page reload directly instead of opening refresh-data options.
- ad963a2: Simplify the mobile location breadcrumb by hiding the machine crumb when there is only one configured machine and removing activity indicators from breadcrumb items.
- f3e19d1: Add keyboard-first navigation for focusing Machines, Projects, Workspaces, Sessions, and the chat composer.
- b35ce1d: Reduce repeated machine and workspace details in the chat status bar and workspace tool header, keeping compact session metrics right-aligned.
- c57f24d: Allow PI WEB plugins to mark themselves as machine-specific so the gateway copy stays local-only and remote machines can provide their own status/plugin UI.
- 25d8188: Keep the documentation site's GitHub and theme controls visible in mobile portrait layouts.
- ef22247: Keep the selected remote machine during transient reconnects instead of switching the web UI back to Local.
- 0118e6e: Keep archived parent sessions visible in the current session tree while they still have unarchived children.
- 058fdee: Clarify plugin docs and website copy around private PI WEB APIs and the supported helper surface.
- b616684: Add draggable, persistent side panel resizing for the web UI navigation and workspace panels, including reset actions.
- 06052ea: Respect Pi session directory settings in pi-web sessions, including project-local Pi settings, while allowing cwd-scoped session operations without breaking legacy id-only routes.
- b2a7975: Align the desktop machine badge status to the right edge of the badge.
- a3b5b72: Add safe bulk session actions for archiving current sessions and permanently deleting archived sessions, with runtime capability checks for remote compatibility.
- 9dd59c0: Show model response errors in the chat transcript instead of leaving the conversation blank.
- 4bc390a: Keep machine/session navigation snappy by deferring expensive Pi-Web status refreshes and caching status checks.
- 577594a: Allow sidebar action/detail menus to expand beyond their list section when only a few rows are shown.
- f501f9d: Pin navigation activity indicators to the top-right of list chips so active projects, workspaces, and sessions no longer shift their labels.

## 1.202606.1

### Patch Changes

- 93b50e6: Replace add-machine browser prompts with a PI WEB form that asks for the remote URL first, suggests a machine name, and supports an optional bearer token.
- 08f69d0: Document built-in PI WEB plugins, including configuration guidance for Workspace Tasks.
- 9c3dafc: Delete workspaces through a server-side operation that closes target workspace terminals before running the worktree removal command, preventing stale machine activity indicators.
- 159f533: Fix workspace selection in the web UI so local machine project and session loading no longer fails with `api is not defined`.
- 82ba2e0: Prevent malformed session prompt API calls from crashing the session daemon.
- f2d211d: Harden remote machine plugin asset proxying so plugin asset URLs cannot escape the remote plugin directory.
- ccd4a76: Hide the Machines navigation section when only one machine is configured, align Machines list spacing with the other navigation sections, and add a remove action to remote machine rows.
- 193c9d0: Show machine activity indicators when sessions or terminals are active on any workspace for that machine.
- b5f8810: Add machine-scoped local project, workspace, file, and git API aliases as the next step toward machine federation.
- 4495a26: Make the mobile Actions entry available from the top context controls and remove the redundant PI WEB navigation header on mobile.
- 4548e5c: Use compact icons, initials, and inline badges for the mobile main tab bar so tabs are easier to fit without losing horizontal scrolling; let workspace panel plugins provide custom SVG tab icons; and add icons for bundled Info, Updates, and Tasks plugin panels.
- e352dce: Fall back to the local machine when a bookmarked or restored remote machine is offline, and clear stale remote workspace route state.
- bd8d1f1: Keep workspace tool tab icons visible in the desktop workspace panel and collapse tab names only in compact panel widths.
- 30fb960: Preserve machine, workspace, session, and terminal navigation memory across reloads within each browser tab.
- 08f69d0: Add plugin enablement settings so discovered PI WEB plugins can be disabled before the browser imports them.
- e3533eb: Add documented plugin context helpers for machine-scoped workspace files and terminal commands, generate plugin API declarations from source, and move bundled plugins away from direct PI WEB API calls.
- 8cd2bba: Keep the PWA refresh control menu visible above mobile tab navigation and workspace tab content.
- b3bb732: Remember each machine's last selected project, workspace, session, and workspace tool when switching machines in the web UI.
- a142f5e: Add remote machine federation so PI WEB can register trusted remote runtimes and proxy their projects, workspaces, sessions, files, git state, activity, and terminals through the current web server.
- b9be7de: Load trusted PI WEB plugins from selected federated machines with machine-scoped actions, workspace panels, labels, proxied plugin assets, and gateway-preferred duplicate handling.
- f1c8f1f: Clean up the workspace panel plugin context by moving render invalidation to `context.host.requestRender()` and deprecating the legacy runtime-only `openTerminal` alias in favor of `context.terminal.open()`.
- 4495a26: Add a deep-linked Settings UI for editing the active PI WEB config file and viewing registered keyboard shortcuts.
- a58c211: Add shortcut preferences to the PI WEB config schema so keyboard shortcuts can be overridden or disabled by action id.
- 0405b38: Add the first machine registry API and show the synthesized Local machine in the web UI as the foundation for machine federation.
- 4bc0010: Add workspace file and render helpers to plugin workspace label callbacks so labels can load workspace-scoped metadata without hidden panels.
- 08f69d0: Prevent redundant Workspace Tasks panel re-renders from resetting mobile scroll position or replacing task buttons mid-click, and show feedback for stale, cancelled, or already-starting tasks.
- 08f69d0: Bundle Workspace Tasks with PI WEB as a built-in plugin for running `.pi-web/tasks.json` commands in workspace terminals.

## 1.202606.0

### Patch Changes

- 6c094af: Keep slash command autocomplete visible above the chat status indicator.
- bad3a18: Add an action-palette command for deleting browser-cached new sessions, while keeping archive and delete session actions context-specific.
- fdd2cf2: Keep chat file mention suggestions working on installations that do not have ripgrep available, add an all-file `@` mention mode, stop hiding directories in the file explorer, and report optional ripgrep availability in `pi-web doctor`.
- a038da6: Fix mobile browser layout so the app no longer leaves an extra bottom gap above browser controls while preserving standalone PWA safe-area spacing.
- 9c80eb0: Avoid suggesting unavailable `pi-web` restart commands for local checkout installs, and show native service commands only when PI WEB can detect matching service files.
- 5090661: Add `pi-web version` and include installed and running PI WEB version details in doctor output.
- 9c80eb0: Rename the PI WEB status workspace tab to Updates so version and restart guidance is easier to find.

## 1.202605.14

### Patch Changes

- 3bd4773: Correct the chat history range label when normalized display messages are fewer than the raw session transcript entries.
- 1c1740a: Keep left navigation section titles visible while project, workspace, and session lists scroll.
- 5737b22: Add a collapse control for the left navigation panel in wide and two-panel layouts.
- 50f1ddc: Refresh session list message counts from live session status updates.
- c73ac5b: Keep PWA navigation bars visible after returning to the app from the background.
- 2abd1d9: Queue prompts submitted during session compaction in pi-web and deliver them only after compaction finishes.
- 958596a: Make `pi-web status` print a concise service health report without invoking paged system service output.
- f569467: Add an optional terminal soft-key bar for common control, navigation, and Meta-style key sequences, with mobile-friendly defaults and a persistent toggle.
- 61a763a: Keep the chat status indicator bubble above sticky message titles.
- 559c6f6: Add a desktop edge control for collapsing and expanding the workspace tools panel.

## 1.202605.13

### Patch Changes

- 57a6a4a: Improve `pi-web doctor` to report missing commands safely, skip Linux systemd checks on non-Linux platforms, and avoid misleading restart advice after the macOS node-pty permission workaround.
- 34e657d: Add a `pi-web doctor` diagnostic for the upstream macOS node-pty `spawn-helper` permission issue, including the workaround and tracking links.
- 8247281: Add macOS LaunchAgent service installs and a shared development install mode with `pi-web install --dev`.
- 4bfd4ac: Add homepage and remote-first website copy that explains PI WEB's persistent-by-default agent workflow.
- 679008d: Fix workspace and project activity indicators so stale session activity clears instead of reappearing after idle sessions.
- 56fa641: Restore spellcheck and autocorrect for prose in the web chat prompt while keeping command-like input protected from autocorrection.
- 711c4f3: Run workspace deletion and configurable workspace actions in visible PI WEB terminals with reload-safe command-run tracking, mobile-friendly cancellation, and shell continuation after command completion.

## 1.202605.12

### Patch Changes

- 13bb8e4: Add a theme-aware dash favicon and uppercase PI WEB page titles.
- 428f7bb: Add a session list action to archive a session together with its descendant sessions in the same workspace.
- f4aeb06: Make the mobile location breadcrumbs clickable so they open project, workspace, or session selection directly.
- 5bc2542: Extend chat diff row backgrounds across the full horizontal scroll area.
- 9e3d272: Prefill the prompt editor with the selected user message after forking a session.
- 23e82e1: Improve empty states for workspace tools and session selection when no project, workspace, or session is selected.
- a1e903f: Add cached image previews up to 10 MB to the workspace file browser for common image file types.
- df20563: Add refresh controls when PI WEB is launched as a PWA, with action palette commands for refreshing app data or reloading the page.
- 2f5293a: Fix mobile workspace panels, including the PI WEB status panel, so overflowing content remains scrollable on iPhone.
- 3409b0a: Name newly forked and cloned web sessions with readable Fork and Copy counters based on the source session title.
- 6a8f2f2: Prevent the message composer from inserting a stray blank line when starting a new session with the keyboard shortcut.
- 1546143: Add PWA manifest icons so installed PI WEB apps use the project icon.
- 1546143: Standardize user-facing PI WEB branding in uppercase across the app, docs, and install metadata.

## 1.202605.11

### Patch Changes

- 1f06b25: Make the Pi Web light/dark themes the default automatic theme pair and keep Classic as the fallback for missing theme selections.
- 619840a: Clear stale workspace activity indicators when sessions become idle or all remaining sessions are archived.
- 9d4a017: Deep-link terminal selection so action-created terminals open directly and reload back to the same terminal.
- 698a899: Load and watch first-party workspace plugin packages from the single Pi Web development command without requiring local symlinks.
- fb7903f: Document and harden separate Pi Web plugin package development, including the Actions plugin refresh flow and public terminal navigation helper.
- 32182a5: Allow Pi package installs to create systemd services from bundled Pi Web entrypoints when `pi-web-server` and `pi-web-sessiond` are not on the service shell PATH.
- 8fbdd6e: Prevent resize observers from attaching to missing UI elements during panel rerenders.
- 1f06b25: Keep loading other external plugins when one plugin fails during registration.
- 2631a63: Add persistent project, workspace, and session context in the web UI so mobile users keep their location visible while navigating between panels and chat.
- 3da2fcf: Add in-place overflow lenses for workspace rows so truncated workspace labels and plugin links can be read or clicked, and cap long project and session names to two lines.
- 894c4d0: Avoid automatically reselecting archived-only sessions unless an archived session was explicitly selected, and let closing the archived section clear archived session selection.
- cf1b0ed: Replace the workspace hover lens with a workspace actions/details menu so metadata remains accessible without blocking list scrolling or shifting rows.
- ea5d863: Preserve chat scroll positions more reliably across session and workspace changes, and keep live event groups collapsed when users close them during streaming.
- 0a086c9: Keep action-palette plugin actions responsive when they change workspace tools or routes.
- 3cce6d2: Rework chat scroll restoration around explicit bottom and anchor positions so session navigation and streaming updates keep the user's reading position stable.
- e5bc87b: Add a Go to Terminal action with a keyboard shortcut and clarify that plugin shortcuts are default keybindings attached to actions.

## 1.202605.10

### Patch Changes

- fb9e524: Build bundled Pi Web plugins from TypeScript during development and release packaging while shipping browser-loadable JavaScript modules.
- b637add: Update static file serving and WebSocket dependencies to patched releases, removing controlled dependency warnings and npm audit findings.
- ebe5639: Show active session and terminal activity on project and workspace rows so background work is visible from navigation.

## 1.202605.9

### Patch Changes

- 9c028a7: Move archived session files out of active Pi session directories so normal session lists no longer scan archived histories.
- 1d8dba9: Fix the homepage Keep control card icon so it renders clearly across browsers.
- c5dc655: Replace the chat history banner with a count-based conversation position meter that shows approximate message position without extra requests.
- 6f7713f: Contain long edit diff lines inside the diff viewer so they scroll horizontally within the tool card instead of widening the chat transcript.
- ee6f60f: Improve Pi Web tool cards for edit operations with live preview updates, paired call/result display, and rendered diffs that match the TUI more closely.
- 545499a: Add friendlier rotating in-progress response notices when opening a chat mid-reply.
- 71ce2fb: Make workspace navigation bars horizontally scrollable on desktop and mobile, with side shadows showing when more items are available.
- 547b6e6: Expand the live trailing events group while a session is active, then collapse it again once readable conversation output appears.
- e89441f: Make the mobile navigation panel sections collapsible so projects, workspaces, and sessions can each use more screen space.
- babb802: Add a beta-labeled Pi Web status panel with update instructions tailored to global npm, Pi package, or local installs. The panel appears for update/restart messages and stays visible for local or unknown installs, while keeping the bundled Info plugin as the minimal documented plugin example.
- 6f7713f: Keep chat bubble and event group headers sticky while scrolling so long messages remain easier to orient within the transcript.
- b51d56c: Add theme tokens, a theme picker, and built-in current/docs-inspired themes for the Pi Web UI.

## 1.202605.8

### Patch Changes

- c77c47c: Document the Pi Web CalVer release rule so releases use the release month, increment the patch component for additional releases in the same month, and require explicit user confirmation before any breaking major release.
- 3099579: Document and tighten the Pi Web plugin API around explicit `piWeb.plugins` metadata, versioned browser modules, AI-oriented local plugin development, website plugin docs on pi-web.dev, feedback guidance, and resilient discovery that skips invalid plugins without hiding valid ones.

## 1.202605.7

### Patch Changes

- aab9ffb: Preserve newly started empty sessions and their prompt drafts across browser reloads until the user deletes them.
- c5bc855: Improve `pi-web doctor` and `pi-web install` to use the detected bash, zsh, or fish login shell, verify the systemd user service context can find required commands before installation, and print shell-specific PATH setup advice without persisting transient PATH values.
- 9b1b1bb: Fix the docs mobile navigation so FAQ pages no longer overflow and compact the GitHub/theme controls on small screens.
- 0aa0a13: Fix chat history reloads so previously displayed messages are not duplicated from the browser cache.
- 42cad58: Add remote-first development positioning to the website and docs, including a philosophy page and laptop-versus-server FAQ guidance.
- c66d834: Add a static Pi Web website with installation docs, troubleshooting FAQ, and GitHub Pages deployment.
- 6a8f8b6: Add global web UI `/login` and `/logout` flows for configuring API key and subscription provider authentication.

## 1.202605.6

### Patch Changes

- 559436c: Install Pi Web services from the Pi extension using the normal login-shell command shims instead of hardcoded Node paths, so sessions use the same PATH for node and npm.
- c547478: Keep mobile workspace selection in the Sessions view so users can confirm the remembered session before opening chat, and restore mobile URLs without an explicit view back to Sessions.
- 42b9c53: Remove unsupported direct GitHub install instructions from the README.

## 1.202605.5

### Patch Changes

- a807569: Fix browser terminal sizing so progress/status lines update in place instead of wrapping when the PTY size has not caught up with the visible terminal.
- d064c4e: Improve package gallery discoverability for remote web UI and browser control plane searches.

## 1.202605.4

### Patch Changes

- 7a9e7db: Copying selected rendered chat markdown now places the raw markdown source on the clipboard.
- cf43c95: Formalize release notes with Changesets and project-local skills for changelog and npm publishing workflows.
- e12382c: Keep a new prompt separate from the stopped prompt after aborting a session turn.
