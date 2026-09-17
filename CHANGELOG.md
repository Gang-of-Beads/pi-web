# @gang-of-beads/pi-web

## 2.202609.0

### Major Changes

- PI WEB is now a small core with everything else as plugins, and that is the
  baseline this project builds on from here.

  Files, workspaces, machines, goals, git, terminal, relays, updates, voice,
  tasks, themes and Mermaid are plugins contributing panels, dialogs, routes and
  settings through a published plugin API; the web process hosts server plugins
  alongside the session daemon. The shell keeps only what every plugin needs:
  sessions, transcripts, navigation, delivery and the surfaces they render into.

  Because this changes contracts rather than adding to them, it is a major
  release: plugin and theme authors target the published API, extension dialogs
  and slash commands follow pi's own semantics, and panels that used to be built
  into the shell are gone from it.

### Patch Changes

- ff100d6: Five-lane review round: the bars, rows and overlays line up.

  The stuck message header keeps a visible sliver again; list rows and
  chips stop painting outside their bars; the fold controls ride 36px with
  a disabled state; failed images in the workspace trust menu stop painting
  stray strokes; the workspace list no longer claims "no workspaces" while
  loading or failed and offers a retry; the quick switcher, the settings
  rows, the answered-dialog chip and the status bar join the same shape;
  the light palette carries the full colour token set with a parity guard.
  Triage: docs/design/review-triage-phone-template-5lanes.md.

- 6f6e827: An accepted message reads as queued, not as a second Sent state.

  The transport receipt (HTTP answer landed) used to show its own "Sent"
  mark, so one message could sit between Sent and Queued and read as two
  different things. The daemon owns a message the moment it answers, so
  the receipt now wears the queue state it becomes: one Queued mark, then
  Read when the agent takes it.

- 4458fb4: The add-project dialog is now the workspaces plugin's too, opened through the host's dialog seam: the shell keeps the modal surface - focus, escape, backdrop, layer order - and the plugin hands in the form. The dialog's folder suggestions, the path's server-resolved trust read, and the create call ride new host context actions (`createProject`, `projectDirectories`, `projectTrust`), so the form never calls a PI WEB API or spells a URL. The core dialog and its app-state flag retire; the shell's add-project affordances (empty state, context switcher, action palette) run the plugin's reserved `add-project` action and hide when no plugin provides it.
- f1aa46c: The assistant header wears its own colour.

  In the graphite palette the assistant strip was identical to the card, so
  user and assistant read as one (owner, phone round). The assistant and
  tool-output headers take a purple wash with a purple rail, against the
  user header's amber - warm is you, cool is pi, readable at a glance in
  both light and dark.

- cf7da32: Keep project, workspace, session, navigation catalogs, and workspace-scoped panels on one scope when the global session switcher crosses projects, including workspaces rooted at the filesystem root.
- a899719: Drawer tab badges say what they count.

  The goals tab's badge was a bare number - the owner asked "what is
  this 1?". The badge now carries a title and aria-label naming the
  section and the count ("Goals: 1 open"), so the number has its meaning
  attached on hover and to screen readers.

- b0bce2a: A banner's lifetime now follows the retirement model instead of the wording.

  An HTTP status error used to be treated as a transport complaint, so the next
  successful poll - any poll - erased it about 1.5s after it appeared: a red
  flash with no explanation. An HTTP status is an answer (the link worked, the
  operation failed), so it now stays until the reader dismisses it or another
  message replaces it. Genuine link failures keep self-healing, and recovery is
  now vouched for per machine: a success from machine A no longer erases
  machine B's complaint. The six-second expiry checks the retirement mark
  instead of guessing from the wording, and a failed interrupted-runs read says
  "status unknown" instead of quietly adopting "none".

  The state rail now wears the exact colour the row's own dot wears - running
  blue, asking amber, unread purple - so a row reads as one state at any
  distance. The machines plugin's compact switcher, mounted permanently hidden
  and never displayed since the context row took over, is removed along with
  the phantom it put under the UI audit's context trigger.

  <!-- ERRATA (round 29): the six-second expiry gates on BOTH the retirement mark and the wording verdict (round 22); and "the rail wears the row's own colour" holds only for non-healthy rows - an online machine row wears success while its dot reads online, by design. -->

- 5221afa: One bar template for every header, footer and toolbar.

  The phone drawer header, the chat bar, the sessions toolbar, the tool page
  header and its fold, the plugin toolbars, the composer action row, the
  status footer, the context sheet and the settings header now share one
  shape: 44px tall, 36px controls centred inside, and an 8px inset from the
  screen edge so no control touches the boundary. Page content sits 8px from
  the phone edge. A source-level contract enumerates every producer.

- 8b1d3dc: Follow-up fixes from the three-lane bllm review of every element surface

  The review converged on two settings-history bugs, both now fixed: closing
  the sheet left its stacked URL frames below, and the back gesture died on
  them because the route comparison could not see the settings parameter - a
  settings frame is now a meaningful back target in both directions; and the
  drill-down's "‹ Settings" control guessed at history depth, so a deep link
  or a plugin's section entry exited the sheet - the list frame is now
  tracked, settings writes always push their own frame, and the back control
  pops only when it owns a frame. The landscape follow-ups land too: the
  shell's paired CSS rules and the settings sheet's phone detection follow
  the same coarse-or-mobile rule the layout predicate uses, so a landscape
  phone no longer gets a hybrid shell or a desktop-sized settings modal.
  Also in this wave: the composer's pending attachments clear on a session
  or machine switch instead of delivering session A's image into session B;
  the prompt editor regains the lost media-query opener around its compact
  footer rules; the sessions heading stops claiming "0" while the listing is
  in flight; settings controls get accessible names; small touch targets
  meet the coarse-pointer floor; tool-card badges ellipsize instead of
  crushing the label; and the context-bar panel toggle reports the state the
  shell actually renders.

- 262f978: A failed interrupted-runs read at cold boot stays quiet.

  The unknown-state banner was raised on every failed read, including the
  first one at boot - over a slow link the reader got a red "status is
  unknown" banner over an otherwise empty screen, before anything was on
  display to lose. The record is unread at that point, not lost: the next
  successful read delivers it without a banner. The banner now appears only
  when a machine that already read successfully fails again - that is when
  markers the reader may be watching are genuinely in question.

- 7ac7daf: The bordered-control guard reaches plugin components, and the upload dialog's
  close key gets its box.

  The guard only read `src/client/src/components`, so plugin chrome could keep
  drawing bare glyphs; extending it immediately found the files plugin's upload
  dialog closing with an unboxed character. The guard now also accepts a border
  inherited from a file's shared `button` rule, so it names real offenders rather
  than every component that styles its controls once.

- b9e0a82: A guard for the box model. Three separate defects shipped in one shape — a
  state ring drawn 12px from an 8px token, seven dialog close controls drawn 34px
  from a 32px token, a rename action 2px larger than its neighbours — and every
  scale guard passed each time, because the token in the declaration was correct
  and only the box model was missing. A rule that states a width, a height and a
  visible border now has to state its box model too; forty rules that did not
  have been given one. The conversation meter's marker keeps its full dot size by
  drawing its separating halo outside the dot rather than inside it.
- 3ce059f: Selecting a session that lives in a subdirectory of the chosen workspace no longer hands the Project chip to a deeper project while the session list keeps answering for the chosen one - an explicit broad selection that already contains the session stays selected.
- 75a57ed: The transcript's top edge fades instead of slicing text mid-glyph.

  Assistant surfaces are border-less, so a scrolled-out message's text cut
  at the scroller's top edge read as stray lines with no boundary. A short
  gradient mask makes the same clip read as intentional depth on every
  surface at once.

- a5ddc8f: Control chrome no longer selects its own labels on press-and-hold.

  Tapping and holding the navigation, context bar, status bar or composer
  toolbar used to pop the text-selection callout over buttons and labels -
  chrome nobody copies. Those four surfaces now disable text selection
  within themselves (the composer's own text controls explicitly re-enable
  it), while message content, notices and code stay selectable per the
  text-selection guideline.

- 54e0983: Clay becomes the default theme: a fresh browser follows the system light/dark preference through the clay pair (Clay in the dark, Clay Paper in the daylight) instead of the PI WEB pair, and a stored preference still wins. The settings dialog drops its desktop accent on phones: section tabs become single-line pills that meet the 44px touch floor, field labels lose their all-caps styling, and the close control meets the touch floor too.
- 09a750e: Cleanup can archive every session whose folder is gone.

  The cleanup dialog gains "Archive sessions whose folder no longer
  exists": a checkbox beside the idle-day threshold, independent of it.
  The daemon's planner probes each non-archived session's folder and
  archives the missing ones (busy sessions still skipped), so the
  dead-folder rows that can never open leave the live list in one
  deliberate sweep instead of one row-menu archive at a time.

- 7f94b08: Cleanup previews itself, badges lead the meta line, and the phone type
  drops a step.

  The cleanup dialog opened with a dead Run button and no explanation
  that Preview had to run first - the reader checked boxes, Run stayed
  disabled, and cleanup looked broken. The dialog now previews itself on
  open and re-previews when the valid request changes; Run enables as
  soon as the preview lands. Dead-folder rows carry the badge at the
  start of the meta line so every row aligns. The phone type scale drops
  one step (base 13px, 12px meta floor holds) - the owner read the old
  sizes as elderly-phone large.

- 6209dc1: Every close control wears a border.

  The prompt-history sheet, the quick-access menu, the cleanup dialog and the
  session tree each drew their close key as a bare glyph, which on a phone reads
  as a stray mark rather than a control. They now draw the bordered box the rest
  of the chrome uses, and a guard fails when any component in the directory
  declares a borderless close control.

- 39ea0b5: Plugins can claim a fenced code language in the transcript.

  A new `codeFenceRenderers` contribution names a language (for example
  `mermaid`) and returns a DOM node for a settled code block's source; the
  transcript draws it above the block and keeps the source underneath for
  copy. One claimant per language per machine; a renderer that throws or
  rejects leaves the plain code block standing. Markdown parsing and
  sanitizing are unchanged - the drawing is added after the safe parse, never
  through it.

- 319aee0: When answering a question needs the space, the composer steps aside - and what
  it stepped aside to was a dashed, transparent pill labelled "Message pi…",
  which is exactly what a text input looks like and nothing like what a button
  looks like. The owner read it as a broken input box, and the reading was fair:
  an affordance that mimics typing and refuses typing is a lie about itself.

  The collapsed state is now visibly a control - solid surface, a squared corner
  where the pill was, and a chevron that says there is more behind this line.
  The collapse behaviour itself is unchanged; it exists so a question form gets
  the keyboard space, and that reason still holds.

- 6161ba5: Colour marks the rare message, not the constant one.

  The assistant answers on nearly every turn, so tinting its header purple
  coloured most of the transcript and made the roles compete. The assistant card
  is the ordinary surface now with no hue; the reader's own messages keep the
  accent tint that makes them the landmarks to scroll between; system lines get
  their own quiet colour, because those are the exception worth spotting.

- 45526bd: A compact density tier for phones: content first.

  The phone breakpoint drops the row minimum to the 44px touch floor
  (from 56px), tightens the message rhythm one token (16px gaps to 10,
  card padding to 10), and management tiles lose the two-line path clamp -
  paths ellipsize on one line and the tile grid tightens - so a screen
  that showed twelve projects now shows fourteen with cleaner edges.
  Everything moves through the spacing tokens, so the surfaces tighten
  together instead of per-rule guesswork.

- b0a277e: Composer buttons are bordered 36px controls again.

  The ghosted, 44px-square composer controls read as too big and
  indistinguishable from decoration on the phone. They return to the bordered
  36px box the rest of the phone chrome shares; on touch screens the tap
  reach still extends to the 44px floor invisibly, so nothing got harder to
  hit.

- 3c80d1e: The composer action row is one bar tall on phones again.

  The ≤760px button padding stacked 6px vertical on the 36px line-height
  and grew the row to 50px with a 50px model chip; the bar blocks now pad
  horizontally only, so the row and every control sit at the template
  heights.

- 6a09654: Journey fixes from the UX audit: an unset context chip renders its own step word instead of a mid-word "Choo..." cut (the verb stays in the aria label), and the shell probe pins the remaining journey contracts - the collapsed drawer strip's geometry, the chip picker opening in the panel, and the phone's panel path to a session.
- 67d64a6: Context chips are one size per pointer, not one size per container.

  The chips' value text stepped down by container width: the projects nav
  renders them ~103px wide, the sessions drawer ~150px, so the same control
  changed size when the reader moved between the two surfaces - the growing
  and shrinking the owner reported. Coarse pointers now get the compact size
  everywhere (the fallback words still fit the narrowest step), and fine
  pointers keep the container step for genuinely narrow windows.

- ab8b6ce: The quick-access menu shows a context path instead of mixed chips.

  Machines were a tab strip and projects were chips, and choosing a project made
  a folder chip appear beside the project chips with nothing saying which kind
  each one was — tapping "repo" produced a "main" that could have been anything.
  The menu now shows one path, Machine › Project › Folder, where each level says
  what is chosen there and opens only its own options. The third level is named
  for what it is, a folder on disk; whether that folder is a git worktree is the
  git plugin's business, not the shell's.

- 21edc42: The context path says only what it can act on.

  Review lanes found the new path able to lie: a stored project or folder that no
  level offered still narrowed the session list while the path read "All
  projects", leaving an empty room with no control to widen it, and browsing
  another machine — where the host passes no projects — lost every level at once.
  The path now reconciles its filter against what it offers, falls back to
  listing folders when there are no projects to group by, reaches the 44px touch
  floor, and owns the option list it announces.

- 34c6f7b: The context sheet asks "Where am I working?" instead of "Change context".

  "Change context" was implementation vocabulary - the sheet switches the
  machine, project and workspace triple. The new title states the user's
  task: seeing and changing where they are working.

- e47ce34: The context sheet covers the true viewport on phones.

  The app shell is `position: fixed` with its top pinned to the visual
  viewport's offset, which is non-zero on real phones once the page scrolls
  under a collapsed URL bar. The sheet's `inset: 0` resolved against that
  shifted shell, so its top edge sat tens of pixels below the real viewport
  top and the page behind peeked out above the sheet. The sheet now renders
  at the app template root and anchors itself to the dynamic viewport with
  the shell offset compensated out, so it covers the whole screen wherever
  the browser reports its viewports.

- d7c79a2: The context sheet is a Projects page, and the phone sessions toolbar
  rides the banner token.

  The sheet was titled Projects while opening with a Machines section and
  a second Projects heading; the machines plugin keeps its own drawer
  section, so the sheet reads as what it is - projects, then workspaces.
  The sessions toolbar's Clean up and New session actions size on the
  panel-header control token like every other banner row instead of 44px
  form buttons.

- 3fc05b8: The context sheet reads like a page: name first, controls quiet.

  Project rows put the folder name on its own line with the path as a muted
  second line; the provider chip drops under the workspace name and centres;
  Add project loses the touch-floor square for the 36px control the rest of
  the chrome uses, its glyph off the text flow. The title of the context
  sheet names the context it edits instead of repeating the first section's
  heading, and the action palette row is a bar with two-line entries.
  Sessions and Chat get icons in the Go to sheet, where every tool row
  already had one. Failed deferred images retry on their own when scrolled
  back into view; the tap remains.

- 675986f: Control heights follow one scale. The step between the mouse height (32px) and
  the touch floor (44px) had no name, so 30, 34, 36, 38 and 40 all shipped as the
  same intention — a search field 6px shorter than the one in the next dialog, a
  model chip taller than the icon buttons beside it. `--pi-control-height-comfort`
  names it, every control-sized declaration reads the scale, and a contract test
  fails the suite on the next control-sized pixel literal (text metrics carry a
  recorded exemption).
- 695e5c1: The conversation meter no longer lets scrolled text bleed through.

  The meter floated over the transcript's first visible line at 58%
  opacity with no background, so the message text scrolling beneath it
  showed through as clipped stray lines - read as broken rendering
  mid-scroll. The meter now carries an opaque chat-background band and
  only the indicator itself is translucent, giving the transcript's top
  edge a clean boundary.

- 4531acc: The cwdMissing stamp actually reaches the wire, and the heading wrap ships.

  Erratum to the earlier changeset: the daemon stamped list entries, but the
  mapper that rebuilds each row for the client dropped the field, so the
  "folder gone" gate never fired and dead sessions still opened into the
  daemon's load error. The stamp now crosses to the client (regression test
  pins the wire), and the sessions heading wrap - recorded as fixed in the
  pro-phone triage but never written - is actually in.

- 2d70813: A dead session's menu no longer offers History and branches.

  Browsing the tree runs /tree against the selected session, and a dead
  session can never be selected - offering the entry traded the inert row
  for the red banner again through the row's own menu. The menu on a dead
  row keeps only actions that never select: mark read, archive, rename,
  detach, stop. Delivering this also confirmed the phone cache story:
  index.html is no-store, so a pull-to-refresh always picks up the current
  build.

- 875ccc9: A session whose folder is gone is no longer offered as if it could open.

  The preferred-session choice (restore, deep link, latest-memory) could
  still land on a dead session, which selected a row that can never load
  and raised the same "folder no longer exists" notice on every boot - the
  fourth occurrence. The preference now skips dead sessions on every
  branch and falls through to the next live one, and a dead row renders as
  a resting fact - a plain row with its "folder gone" badge - instead of a
  button whose click does nothing.

- 5722eec: A dead workspace disables its start button and tells the truth.

  The workspace listing's cwdMissing stamp now reaches the sessions
  panel: the "+ New session" button renders disabled with the reason on
  hover, and the empty state says the workspace's folder no longer
  exists instead of inviting the reader to start a session that can
  never work.

- 9e5fc31: A dead workspace says so before offering a new session, and says it once.

  The workspace listing now stamps cwdMissing the way the session listing
  does: a workspace whose folder is gone renders its row inert with a
  "folder gone" badge, and "+ New session" inside it fails fast with one
  sentence instead of creating a phantom "New session" that sits selected
  on an empty chat while the daemon's folder error repeats in two
  different places.

- 25a5989: Opening a terminal in a workspace whose folder is gone fails fast with one
  sentence.

  The daemon validated the session start path but not the terminal spawn: a
  pty spawned in a missing directory started a shell that chdir-failed and
  exited code 1 instantly, leaving a dead "Shell · exited" tab and no
  explanation. The terminal create now stats the workspace folder first and
  answers "Workspace folder does not exist: <path>" before any process is
  spawned.

- 6b88d7a: A machine deep link survives a failed machines roster: on boot the shell no longer rewrites the URL to the local machine when the roster listing fails - it retries the listing on the same ladder the remote-restore loop uses and re-enters the boot restore once it recovers, leaving the machine, project and session in the address bar the whole time. Exhaustion leaves the failed-roster panel speaking and the link intact.
- 6274cc4: Drawer tabs now honor the availability contract they document: a section
  answering `false` loses its tab instead of keeping a dead one, and the drawer
  disappears entirely when every contributed section is unavailable - so the
  goals section on a workspace without goal records no longer shows a "Goals"
  tab wrapping an empty body. The goals section's unread window says "Reading
  goal records…" in the section's muted micro style instead of rendering a bare
  "No goal records found." paragraph once the empty read lands.
- e14f605: The daemon remembers what it accepted across a restart. Its ledger of accepted
  prompts was in memory and said so — "a daemon restart forgets the ledger" — so a
  browser retrying after a lost answer, which is the correct thing for it to do,
  made the daemon run the same prompt a second time. Operations are durable rows
  now, with four outcomes, the payload's fingerprint, and capacity that refuses
  rather than evicting, because dropping a row to make space turns a later replay
  back into a second execution. A restart downgrades anything that was in flight
  to `unknown` instead of guessing, a repeat with a different payload is refused
  as a conflict rather than answered with the first result, and a reconnecting
  client can ask which of its operations are still open.
- 0febd3a: An empty quick-access menu says which kind of empty it is.

  "No sessions yet." was printed for four different situations: sessions still
  loading, a failed read, a search that matched nothing, and a context path
  narrowed to a scope that holds nothing. Only the last is about the chosen
  scope, and it now says so and offers to widen back to every project; loading
  and failure are named as themselves, so the menu never claims a machine is
  empty when it merely has not been read.

- f1f5e76: Review round on the workspaces extraction: the add-project dialog closes when a create succeeds and stays open on a failure reason; unknown project or workspace identities answer the 400 not-found contract instead of leaking a 500; the desktop context-switcher slots dropped a collapse toggle the core pickers never had; the plugin adopts the shell's list and surface styles through the host seam instead of stale copies; and a workspace search left running is retired when its section is hidden, matching the projects picker.
- 39ddf71: A phone that regains signal reconnects in seconds instead of a minute. A
  connection the network kills without a FIN stays OPEN and silent in the
  browser, and the only thing that retired it was a 50s silence budget sampled
  every 15s — up to 65s of stale screen after the network was already back. The
  budget is now two daemon keepalives plus a margin (42s), sampled every 5s, the
  handshake budget drops from 15s to 10s, and a tap probes the sockets
  immediately: somebody touching the screen is somebody waiting.
- 98d18e5: The files viewer turns a selection into a line-range mention.

  Selecting text in a file's raw view offers a chip carrying @path:start-end

  - the format the @-completion already understands; one tap inserts it at
    the composer cursor. The chip anchors where the selection ends.

- 156b47b: Final review wave for the phone shell: one tap always reaches the settings
  list even after a machine dialog was cancelled above the sheet, the machine
  dialog paints above the settings sheet it was opened from, edge controls
  disappear on the same coarse-or-mobile query the shell uses (no stray strip
  in landscape), the context bar hides its panel toggle when the panel is the
  whole view, composer attachments and failed-send restores stay in the session
  they belong to, "Select visible" selects only the rows on screen, selection
  mode shows collapsed subtrees flat, and the coarse subtree toggle no longer
  overlaps the first characters of a session name.
- 3f67410: Require the Pi 0.85 runtime suite together, and publish releases only after the native ARM Linux and Darwin Nix builds succeed.
- a9af31f: The git panel can add a worktree.

  A "New worktree" button beside the branch name opens a dialog for the
  branch (new or existing) and the directory, suggested beside the repository
  as <repo>-<branch>. The plugin runs git worktree add through its own
  provider seam, keeps git's refusal in the dialog for correction, and the
  new checkout appears in the workspace list and the git panel without the
  app switching to it. Workspace panels gain host.refreshAppData for exactly
  this: report a catalog change, never edit the catalog.

- 622d8ac: The phone reaches every view through a Go to sheet.

  The tool tiles stacked under the session list are gone from the phone. A
  Go to control in the bar - on the sessions page and on every chat and tool
  page - opens the extension page: Sessions, Chat and every workspace tool by
  name, the one on screen marked, a tap to switch. The system back gesture
  closes it like every other layer.

- 3b131bc: The palette option rules stand as siblings again, and the action menu
  answers presses.

  The Round E small-family insert consumed the `.options button` rule's
  closing brace, collapsing the palette's selected highlight, hover,
  disabled dimming and empty-state padding into dead nesting - keyboard
  users could not see which option was selected. The brace is restored
  (CSSOM-proven siblings), and the action-menu-panel items join the coarse
  pressed-state family that every prior sweep missed because the panel
  renders on demand.

- cad9135: Layout coordination wave: boundaries you can see, one edge per column,
  breathing room where it was missing.

  Three measured audits converged on the owner's four complaints. The
  flat theme's hairline sat below perceptibility - borders lift a visible
  step, and the borderless touch controls answer presses now. The phone
  header's fold button hardcoded a circle tangent to the screen top; it
  joins the header radius token and the header gained insets. The sessions
  heading ran two competing distribution mechanisms - one remains, evenly.
  The nav column's three left edges collapse onto one reading edge, the
  quick switcher's title aligns with its lists, empty states center
  everywhere, the Files toolbar takes the touch floor, and the tasks title
  matches its tab.

- 1dde944: The re-review wave: empty states that actually center, theme cards that
  keep their height, boundaries for the buttons on raised cards.

  Two Round A claims failed pixel verification and are fixed properly: the
  new-session empty state's `margin: auto` resolved to zero in the block
  scroller (the state never centered), and the settings-controls height pin
  crushed the Appearance theme cards to 32px across three breakpoints - the
  cards are buttons, so buttons keep min-height while inputs and selects
  stay pinned. The tasks and relays viewers fill their panels so their
  dashed empty states center for real. The re-review's own finds: five more
  borderless touch controls get pressed states (the family is complete per
  the stylesheet scan), the extension card's buttons gain a boundary on the
  raised surface they sat darker than, the panel's fold-expanded actions row
  joins the header's reading edge, and the message-header dividers lose
  their sub-perceptible alpha mix.

- 9fd3f92: Deliver the Round C fixes to readers, and complete the pressed-state
  family on shared list rows.

  The plugin bundle served to readers predated the Round C commit by five
  minutes, so the tasks viewer's centering fix and the goals refresh rule
  never shipped - dist is rebuilt with both. The project, workspace and
  machine rows in the navigation panel and context sheet take the coarse
  pressed state through the shared list styles (session rows already had
  it in their own shadow). The desktop rail header takes the same vertical
  breathing as the context bar, so the two header rows across the divider
  are symmetric again, and the queued-message header joins the solid
  divider rule.

- 654fdc1: Restore the action palette's selection highlight, hover and disabled
  dimming, and give the action-menu-panel items their coarse pressed state.

  The Round E small-family insert consumed the `.options button` rule's
  closing brace, so every following rule collapsed into dead nesting: the
  palette's selected highlight, hover feedback, disabled dimming, coarse
  single-column override and empty-state padding all measured dead at the
  reader - keyboard users could not see which option was selected. The
  brace is restored, and the action-menu-panel items join the coarse
  pressed-state family.

- 1878036: Goals returns as a native plugin on the plugin architecture: a new
  `pi-web-plugins/goals` contributes one quiet drawer section - status dot,
  objective clamped to two lines, muted task progress, and a ghost refresh
  button sized by the host touch token - fed by a `goals.list` daemon operation
  that reads the workspace's `.pi/goals` records (session-cwd overlays included)
  and hides itself entirely when no goal exists. The section consumes host
  surface styles and tokens instead of shipping its own chrome, and badges the
  remaining task count on the drawer tab.
- d474a69: Goals ships as a plugin: the panel, its progress rules and its reads now belong to it, and the drawer and navigation panel render it as a contributed section.
- e532db0: The goals plugin no longer ships inside PI WEB: it lives in its own repository and installs as the `@gang-of-beads/pi-web-goals` package (npm or git), the same move the theme pack made. The drawer and navigation panel keep rendering any goals section a plugin contributes; a checkout that wants goals installs the package into the agent directory.
- 2646735: The default theme is graphite and amber, with a native light side.

  The stock blue-on-black reads like a default; the owner picked graphite
  with a single amber accent. The core theme now ships both sides of that
  hue - the dark palette and a warm-paper light one under the system
  prefers-color-scheme media query, so it follows the device without a
  plugin, and Appearance keeps overriding with any theme pack as before.

- c36c496: The scale guards now see through the places literals were hiding: spacing
  inside `calc()`/`max()` and negative offsets, sizes inside a `font:` shorthand,
  and the focus ring's width. Seventy-five hidden spacing values, forty-six font
  shorthands and eighteen ring widths read their tokens instead. The panel-header
  token equals the control height it contains, so the navigation rail and the
  chat drawer draw one horizontal rule instead of 44px beside 40px; the cleanup
  entry keeps the mouse control height; and the multi-select checkbox is
  concentric with the subtree toggle it shares a slot with.
- 304537e: A reload or reconnect replays committed history from the watermark instead
  of re-fetching the page.

  The transcript refresh always re-fetched its full page over the wire, even
  when this browser had just read one moments before. The refresh now cites
  the stream seq its cached page is current through, and the daemon's replay
  window answers with just the frames after it - applied to the cached view,
  no history payload. A watermark older than the replay window, a trimmed
  tail, or any replay failure falls back to the full fetch, which restamps a
  fresh watermark; the fallback path reads status only after the replay
  verdict so a resync costs nothing extra.

  Together with the span cap this keeps long sessions cheap on flaky links:
  the live tail rides the seq ring, and the pages behind it stay cached.

- 3a15923: The host actually hands plugins the sheet-adoption mechanism.

  The PluginHostUi gained adoptSheets as a type but the runtime object never
  implemented it, so every plugin wrapper that routed adoption through the
  host (workspaces, goals, terminal) silently stopped adopting: the context
  sheet rendered unstyled headings, edge-to-edge rows, and stray buttons.
  The member is now on the object the shell hands to plugins.

- 6088415: Review-lane findings from the dead-session and chrome-selection wave.

  The dead-session skip lived in one producer; the archive, delete,
  cleanup, refresh and cached-new flows could still auto-pick a dead
  session and re-raise the notice the wave removed - all five now share
  one isOpenableSession predicate, and a workspace reduced to only dead
  rows deselects honestly instead of raising a banner. A dead row keeps
  its bulk-select gutter and unread indicator like every other row. The
  attachment error line is copyable again, the session search input
  re-enables selection against the panel's chrome no-select rule, and the
  composer's selection test now asserts the contenteditable clause the
  component actually renders.

- 0c5beb1: Review-lane fixes for the cleanup criterion, the recreate path and the
  fade rule.

  The missing-folder cleanup criterion combined with the idle-day cutoff
  in the wrong order: with only the missing-folder checkbox enabled, the
  planner archived every non-busy session in scope instead of just the
  dead-folder ones - the guards are now independent. The cached-new
  session recreate path was the last producer of starts that bypassed the
  dead-workspace fail-fast; it now answers with the same one sentence.
  The workspace stamp probes statSync().isDirectory() like the session
  listing does, and the fade rule loses a stray declaration fragment.

- cd5d3ed: The dialogs you have not opened no longer ship with first paint. Settings, the
  quick switcher and the session tree were part of the entry bundle every visit
  paid for; they are now separate modules, fetched once the app is past boot and
  awaited at the moment something opens them. The entry bundle went from
  1,021,012 to 781,205 bytes. Opening waits for its own module rather than
  rendering an empty frame, because a dialog that appears blank claims to have
  nothing in it, while one that appears a moment later is merely slow.
- 5abd21b: A dialog that cannot load says so. Now that settings, the quick switcher and
  the session tree arrive as separate modules, a tab that has outlived a deploy
  can ask for a module the server no longer has - and the control would simply do
  nothing, forever. The failure is reported with the reason and the remedy, and
  it is not remembered as an answer, so the next attempt is a real attempt rather
  than a replayed rejection.
- 4c36c86: Machines management routes move into the machines plugin.

  The bundled machines plugin now serves the whole `/api/machines` management surface (list, add, get, patch, delete, health, runtime) over its own service, while the core keeps only the proxy and fleet consumers, fed by the plugin-registered machine registry. A host that already owns a machine registry can hand it to the plugin through the new `machineRegistry` port so both sides share one source; without it the plugin builds its own from the store-path and local-runtime ports, and a host with none of those sees the plugin report unhealthy instead of half-answering. Route contributions gain `PATCH`, mounted alongside the existing verbs, and the server plugin contract ships `localRuntime`, the runtime parser, and the remote request error class so plugins parse remote runtimes themselves. A host without the machines plugin keeps the fleet honest with a local-machine fallback registry.

- e9f4552: The machine palette actions belong to the machines plugin: add, refresh, open and remove now come from the plugin's contribution set, and the four selected-machine callbacks leave the runtime context in favour of optional, id-addressed `removeMachine`/`refreshMachine`/`openMachine` capabilities the host offers over its core selection engine. The published plugin contract stops transitively depending on the host runtime - the thinking-level union is mirrored locally with two-direction drift guards instead of re-exporting pi's type - and `@types/ws` ships as a real dependency because the server face's declarations reference it. The installed-package smoke knows the full declaration graph the contract now carries.
- 08d5c77: The plugin contract gains a `machineSections` contribution point: a plugin can bring the machines section of the context navigation the way workspaces brings the project and workspace pickers. The shell reserves the `machines` slot and keeps the order, keyboard machine, collapse state and tile display; the section renders from a host-fed snapshot (roster, selection, per-machine activity flags) and acts only through host callbacks. Nothing consumes the point yet - the machines plugin arrives in its own wave.
- 5b9d21d: The machines roster carries the same four-state load discipline as projects: `machinesLoad` moves through loading to loaded, and a failed listing keeps the previous roster on screen, sticks until a load succeeds, and feeds the retry and deep-link retention work that follows. No surface reads it yet, so nothing user-visible changes.
- ebfb2de: The machine fleet moves into the machines plugin's browser module: the navigation section, the compact switcher and the add-machine dialog are now contributed bodies rendering from the host-fed snapshot, with the list, switcher and dialog elements living in the plugin and acting only through host callbacks. The machines slot no longer falls back to a core-rendered list - with the plugin absent the slot is honestly empty while the proxy and fleet routes degrade to the local machine - and the add dialog opens through the same dialog seam the add-project dialog uses. The shell keeps the selection engine, the section order, the keyboard machine, the collapse state and the URL machine dimension.
- 3d5175d: The context navigation's machines section becomes a slot: the machines plugin contributes the section body, rendered from a host-fed snapshot (roster, selection, per-machine activity flags) and acting only through host callbacks. With no contribution the machine step hides from the context switcher and the navigation panel instead of rendering a core list - the proxy and fleet routes keep degrading to the local machine, and the context bar still names the selected machine.
- 9272a2e: Three review lanes and a live 393x850 probe over the machines wave. The phone context sheet actually receives the plugin's machines section now (its host binding still passed the pre-slot props, so machine switching from the sheet was silently dead), the machine step hides from the context switcher and the navigation panel when the machines plugin is absent instead of blanking the panel body, and removing a remote machine no longer erases the local machine's alias. Machine management routes classify client errors (400) from store failures (500) and reject wrong-typed request fields instead of silently dropping them; a second plugin claiming the machine registry logs a collision warning. The machines plugin opts out of machine-specific loading - its machine dimension UI belongs to the gateway and survives switching to a remote machine - which required the plugin catalog to accept an explicit host-level declaration for dual-module plugins. Boot's machine deep-link restore yields to navigation made while the retry ladder runs, says it refused when the ladder exhausts, and the host injects the machines store path and local runtime ports the plugin's registry resolves through.
- f7cfd8a: A guard for the mark language. Typed glyphs were reported in six separate
  rounds and each sweep fixed the producers it happened to read, because a
  character carries no evidence of being a mark. A glyph that is the whole
  visible content of an element now has to come from the icon modules; a glyph
  inside a sentence is prose and is left alone, since that is a product question.
  The guard immediately found the producer the last sweep missed — the dictation
  control's state glyph, dead since its icon landed — which is now gone.
- a568139: The drawn marks actually draw. Since round twelve the icons composed their
  shapes through a nested template, which puts them in the XHTML namespace where
  an `<svg>` paints nothing: the send and read receipts under user messages, the
  copy, resend and recall controls, the tool status marks and the status-bar
  arrows have been blank boxes, while every geometric check agreed they were 14px
  and centred. Each icon is inlined in one template now, a unit test fails if a
  shape leaves the SVG namespace, and a probe fails if any rendered shape does.
  The close mark is one language too: thirty-two typed × characters across ten
  dialogs, the pickers, the sheets and six plugin surfaces now draw the same mark,
  with contributed surfaces borrowing it through the plugin host.
- 5ba2a8c: The chat surface stops blinking while a turn runs. Row activity marks and the
  working chip were created and destroyed whenever their state changed — a
  different template shape per state, and nothing at all when idle — so every
  list row's dot and the header chip were rebuilt repeatedly while an answer
  streamed. Measured on a real turn at 393x850: seventeen node removals in twenty
  seconds before, six after, with the row marks and the working chip down to
  zero. Each mark is one element that stays mounted and changes state, which is
  also why a hidden mark is now the honest way to say "nothing to show".
- f2f91c2: The phone's ≡ key opens the quick-access menu instead of jumping to projects.

  A hamburger promises a menu that can be dismissed back to where you were.
  Tapping it covered the screen with a Projects/Workspaces page whose only exit
  was its close button, and picking anything there left the open session behind,
  so getting back was the reader's problem. The key now opens the quick-access
  menu — search, session switching, pin, new session, machines and projects,
  and now Settings — and closing it returns to the session untouched. The bar
  title beside it is a label again, with hold-to-rename, since the key owns the
  menu. Sessions pinned there are grouped at the top of the sessions list, which
  can pin and unpin from its own row menu.

- c10ad7e: The quick-access menu says when its list is wider than the chosen path.

  Folders load per project, so a project chosen before its folders arrive cannot
  be filtered against anything, and the list deliberately stays unfiltered rather
  than hiding every session including the open one. Until then the path claimed a
  scope the list was not keeping; the menu now says the listing is provisional
  instead of leaving the reader to spot the mismatch.

- 2465097: Mermaid fences render as diagrams.

  A bundled Mermaid plugin claims ```mermaid fences through the code-fence
  renderer seam: the diagram engine is vendored with the plugin and loaded on
  the first diagram, never at boot; each fence is parsed before it is drawn
  in strict mode, matches the page theme, and a fence that does not parse
  stays a plain code block. The source stays available to the copy button
  under a drawn diagram.

- 15f1a43: The message info control wears the same box as its neighbours.

  On touch it was a borderless glyph beside two bordered buttons, so it read as
  a stray mark rather than a control, and the inherited line-height plus the
  right-aligned text pushed the ink off centre. It now draws the same 22px
  bordered square with the icon centred, measured identical to the retry and
  copy buttons in the same header.

- 38df617: The conversation meter stays below the session drawer's border.

  The meter's opaque band poked 8px above the transcript into the open
  drawer, covering the drawer's bottom border across its span - the lane
  finding recorded for scheduling. The band now starts at the
  transcript's own top edge, so the drawer's border line stays visible
  and the two boundaries do not stack.

- 3c951ab: The shell's resident row shrinks to three controls: the panel toggle, the session name, and the working indicator. Quick access, machine/project/workspace switching, workspace tool views, actions, settings, and the app refresh move into the single collapsible panel (side panel on desktop, full-page panel on mobile), and the mobile tool sheet is retired. Every row control meets the 44px touch floor, the bar no longer scrolls sideways, and the bottom status bar is unchanged.
- 620d6f2: The projects and workspaces pickers are now the bundled workspaces plugin's browser half, contributed into both switcher surfaces through a new `navSections` seam: the desktop navigation panel and the phone context sheet reserve the slots and keep the section order, keyboard machine, and collapse state, while the plugin brings the picker bodies and focuses them on the shell's behalf. The host feeds one context - the app snapshot, the label items, and the select/add/close/delete/trust actions - so the pickers never call a PI WEB API or spell a URL, and when the plugin is absent the slots render nothing. The plugin contract gains the nav section face, and the workspace trust checkbox now rides host-provided reads and writes instead of the plugin reaching for the API.
- b8072ba: Accent-filled primary buttons take their label colour from a theme's
  `--pi-on-accent` instead of its background colour: a background is chosen to
  sit behind content and promised nothing about carrying a label, and the shipped
  dark theme measured 3.74:1 on its own primary buttons. Themes that do not name
  it keep the previous fallback, so the token is additive. Picker option rows
  inherit the app font instead of falling back to the browser's 13.3px Arial,
  `small` reads the type scale instead of the UA's `smaller`, row menus meet the
  touch floor in every list (not only tiles), and the message-meta control draws
  the app's focus ring rather than a 1px border at 1.09:1.
- f4e5b33: The phone's lists spent 90px of chrome - a fifth of what the keyboard leaves -
  on two stacked bars before any content: the session bar and the panel header.
  They are one bar now. The scope, the session, and a fold control share the
  single 45px row; refresh, settings and the action palette live behind the fold
  and come back with a tap. Measured on the 8505 stack: 90px to 45px folded, the
  transient actions row 53px, the chat view's own single bar unchanged.

  Nothing lost its one-tap path: the "Sessions" segment keeps the quick switcher
  where the old bar's empty state had it, the scope chip still opens the context
  sheet, and a working session still shows its dots - the indicator moved with
  the bar it belongs to.

- fa734b7: One toolbar rhythm for the workspace panels.

  The Files, Tasks and Relays panels each tuned their own toolbar
  padding: Files on the shared 8px, Tasks and Relays on a wider 10/12px
  override, so switching panels shifted the header rhythm. All three now
  share the same token padding and the panel-header height, matching the
  diagnosis item "six tool panels, three rhythms".

- f671e25: One word for the state between answered and refused. A request that goes
  unanswered is `unverifiable` everywhere now — it was `unanswered` in the message
  lifecycle, "did not answer within 30s" in a page-level banner, and `failed` on
  the delivery row, three names for the state a flaky link produces most often. A
  message whose answer was lost says "No answer yet" on its own row and stays open
  for a later answer to close, instead of claiming it was never sent; the page
  banner speaks only for the link and stays quiet while the socket is proven live;
  and an ambiguous settlement now carries whether the bytes ever left this
  process, which is the fact that decides whether resending is safe.
- 4055bea: The panel fold survives reload.

  Folding the navigation or workspace panel was memory-only, so every refresh
  handed the screen back exactly the way it was before the reader folded it -
  the reshuffle that made reloads feel wrong. The fold is now a stored layout
  preference (a global key: it is about the reader's screen, not about any
  machine's or workspace's data) and is restored before the first render.
  Storage being unavailable costs nothing but the persistence.

- e6767f8: The two side panels default to the same width.

  The navigation panel was a fixed 340px while the workspace panel
  defaulted to minmax(340px, 32vw) - on a common desktop the right panel
  opened a hundred pixels wider than the left for no reason. Both now
  default to 340px; resizing still works within the existing limits.

- a2bd6d2: The context path announces a group of choices, not a listbox it does not implement.

  Its options were buttons labelled `role="option"` inside a `role="listbox"`,
  which promises roving focus and `aria-activedescendant` that were never there,
  so the announced widget behaved unlike the one screen readers described. The
  level is a labelled group of toggle buttons now, each saying whether it is the
  current choice, which is what the markup actually does.

- 76ac7bd: Opening a context-path level moves focus into it, and closing brings it back.

  The options were reachable only by walking the DOM, and closing a level left
  focus on the sheet rather than on the level that was just operated. Focus now
  follows the level the reader opened and returns to it when the level closes.

- 31eb8a9: The context path names an unknown machine and offers each folder once.

  A machine id no machine answered for was labelled "Machine", which reads as a
  chosen scope rather than an unknown one; it now says so, and the level still
  lists every machine to move to. Folders are keyed by path because the path is
  the filter, so two folders sharing one path appeared twice with both marked
  current; the level offers each path once.

- dbe4e10: The phone's fixed bars ride low.

  The panel header height, its control height, the scope button and the
  session chip ride a 36px strip on phones (down from 44/49) - fixed
  single-line bars that never wrap were spending the transcript's space.
  The bars' controls stay 36px, still above the 24px button minimum; the
  context bar's session title keeps its 44px touch minimum and list rows
  keep theirs.

- 82d1409: Phone details: centred labels, Go to from the top, hold to rename.

  The + on New session no longer takes space, so the label is centred where
  the button reads. The Go to sheet drops from the top, under the control
  that opened it. Holding the session name in either bar opens rename; a
  tap still opens the switcher.

- 2d47538: The phone keeps its own shell in landscape, and an empty chat never blocks it

  Two phone reports landed in the same place. A camera return can leave the
  page in landscape, where the width-only breakpoint handed the phone the
  desktop shell squeezed into its height; the navigation layout now follows
  the coarse-or-mobile rule the rest of the app already uses, so a
  coarse-pointer device keeps the phone shell at any size. And the system
  back gesture out of a tool panel could land on the empty "Select or start
  a session." page - a dead end under touch; a phone with no session
  selected now shows the navigation panel instead, matching what boot
  already does. Desktop keeps the empty state, where the panel is always
  on screen.

- e491ab2: Phone navigation closes its loops: the scope chip opens a Change context sheet listing machines, projects and workspaces with the current one marked, so switching project is one gesture from anywhere; the tools grid renders only on the sessions section whose workspace its cards act on; a tool view without a session regains the labeled panel toggle as its exit; an empty workspaces list says so; the session tree navigator and the auth dialog own their back gesture; and the unreplayable-thinking warning names the fork that recovers the branch.
- 98fd0aa: The phone's session panel names its scope and its tools look designed

  The workspace tool list at the bottom of the phone panel rendered as bare
  text rows, and the header row floated gear and Actions over dead space with
  nothing naming which project or workspace the reader was in - so picking a
  workspace from the cross-project switcher could look like every session
  vanished. The panel header now names the scope (project · workspace) and
  opens the matching picker when tapped, tools render as icon cards with a
  clear selected state, section headings drop their uppercase styling, and a
  workspace change that leaves the phone without a session returns to the
  picker instead of an empty chat invite. Route writes no longer attach a
  tool parameter when no workspace is selected.

- 28abf79: The phone readability and loop-closure round.

  Bar labels sit on an even line box, so a title no longer reads 1px high
  and tilted. Session rows are one line with an ellipsis at a uniform
  height; the row menu is a bordered single-line list with short labels.
  Message headers are one aligned row of bordered 22px controls, slightly
  shorter. The scroll meter is a thin rail on the right edge instead of a
  bar across the top. A transport failure earns its banner: one blip shows
  nothing, a claim still standing after four seconds reads "retrying in
  the background" and withdraws when the connection answers; a 5xx is
  classified as that transport claim. The phone settings open on a single
  title bar and its rows match the list style, with the duplicate General
  heading gone. The hamburger opens the menu as an overlay instead of
  navigating away from the chat, so returning needs no re-selection.

- 740891e: Phone margins breathe again.

  The compact tier took the reading edge down to 10px, which pressed every
  list, toolbar and transcript against the screen glass. The edge returns
  to 16px, matching the production build's breathing room while keeping
  the compact row heights.

- e6656e1: A picker opened from the settings dialog is visible again. The layer tokens
  rank kinds of surface — a popover sits below a dialog — so opening the theme or
  model picker from settings dimmed the backdrop, painted the picker underneath
  the panel, took Escape with it and left the dialog unclickable. A picker opened
  over a dialog now says so and paints above it, while a picker opened on its own
  keeps the popover layer.

  Also: the rail header and the resident context bar share one height (45px, not
  45 against 53), the message row's touch expansion clears the info control it
  sits beside instead of claiming 2px of it, the context switcher's chip and add
  control share one font, and the theme preview's nested corners are derived from
  the corner and padding around them so the arcs stay parallel.

- 00ef738: The Pinned rows are a named group, and the menu footer stops stacking flush.

  Pinned sessions are lifted out of their position in the list, so the heading
  now labels a real group rather than floating above unrelated rows. The
  quick-access menu's footer lays its entries out with the shared gap instead
  of pressing two full-width buttons against each other.

- e532401: Pinned sessions belong to the machine they were pinned on.

  Pins were stored as one flat list of session ids with no machine key, so a
  recycled id from another machine could arrive already pinned, and the list
  grew without bound. The store is keyed by machine now, the visible set is
  re-read whenever the selected machine changes, and an existing flat list is
  read as the local machine's pins and preserved on the next write.

- 1f923ca: Plugin dialogs can request the `fullscreen` presentation: the host renders
  them edge-to-edge with no card chrome, so content authored against a large
  canvas survives direct load and refresh instead of being squeezed into the
  centered overlay card. Default stays `overlay`.
- 852989b: The plugin contract wave: a browser plugin can ask the host to present a dialog — the shell owns the shared modal surface, the focus trap, Escape and the back gesture, the plugin owns only its content — via `ui.showDialog`; the preview response policy, preview headers, workspace route errors, and the workspace context resolver move to the server-shared layer where the machines proxy and core routes already meet, so the workspace extraction cannot fork the protocol; and the published plugin API declarations ship the same shape.
- f718dad: The bundled themes and terminal plugins load again, and dictation asks the right endpoint: a reserved id kept the theme pack from ever registering, browser plugin entries now bundle what they import, and voice calls its own daemon operation.
- 4a7be0d: A custom message the app does not itself understand now renders as a card a plugin can draw, and as an honest "unrecognized message" card when no plugin claims it, instead of falling through to its raw model-facing text.
- aa006ed: Third polish wave. A drawer tab's count is drawn as a badge instead of a bare
  "(3)" wearing the label's own size and colour, the appearance panel marks the
  theme actually on screen with a dot rather than an 11px "· in use" suffix on a
  card drawn like every unrelated one, and the composer toolbar keeps one control
  height instead of a 40px model chip beside 36px icon buttons.
- 4f79d90: Second polish wave across the overlay family. Quick switcher tiles reserve the
  menu button's width once instead of twice, so a session name keeps the room a
  140px tile has and the title and subtitle end at the same edge; the menu button
  is one rule rather than a dead 40x52 base under a 32px override, and the
  session state mark moved out from under it, where tapping the state opened the
  menu. Project and workspace tiles put the activity dot on the menu button's
  centre line (it sat 10px above it). The machine dialog and the machine row menu
  get the coarse-pointer floor their siblings already had, the add-project footer
  keys its floor to pointer type rather than viewport width, and the model and
  command pickers draw a focus ring on the search field and the option list
  again. The refresh control matches the header controls it sits beside instead
  of standing 8px shorter.
- b22858f: A session opens from what was already read. Hovering or focusing a session row
  is the earliest honest signal that it is about to be opened, so its first page
  is read then and stored where opening looks for it. Measured on the 8505 stack:
  after a hover, the click paints its first messages in 11ms. The prefetch costs
  one read the click would have made anyway, failures are dropped rather than
  raising an error for something nobody asked for yet, and on a touch screen
  nothing changes because there is no hover to read.
- 67955c3: The "Pro (native)" theme card actually selects the native look.

  The appearance panel's click handler routed every card through the plugin
  theme registry - but the native pro look is a sentinel, not a plugin
  theme, so the lookup silently returned and the card did nothing. The
  sentinel is now handled before the registry lookup: picking the card
  switches to the core's own look (and persists), like every other card.

- fc96aac: The app's own look is the flat mono TUI - themes become departures from it.

  Without a theme extension the app now renders the pro shape: the
  monospace stack as the UI face, square corners on the published radius
  scale, and no elevation - the shadow colours go transparent so every
  box-shadow collapses without touching the rules that consume them. The
  44px coarse touch floor stands. The theme contract gains optional
  shape/typography stops (fonts and the radius scale) so a soft theme can
  pin the rounded sans look it was designed with; a theme that omits them
  inherits the pro shape. The default preference is the native look - the
  appearance panel lists "Pro (native)" first even when theme extensions
  are installed, and selecting it clears every theme token back to the
  core's own defaults.

- fa0cde3: Overlays separate again, the sessions heading wraps instead of crushing,
  and same-category controls stopped changing size between surfaces.

  The pro redesign flattened the shadow colours and left the overlay at a
  50% black that is invisible over the dark base - palettes, dialogs and row
  menus read as text printed over text, which is the phone "pages piled up"
  report. The overlay deepened; the sessions heading wraps on coarse
  pointers instead of letting the unread badge crush the title under the
  checkbox; the context chips are one size per pointer instead of one size
  per container; the settings form controls are height-pinned (the select
  out-grew the input beside it); the quick switcher search reads at the
  control size; the compact header buttons and panel edge handle join the
  pro radius scale; the conversation meter slides under the first card's
  header instead of over it; the scope chip dedupes a workspace named after
  its project; Escape closes the project row menu; and the Tasks panel title
  matches its tab.

- 2216843: Server-plugin lifecycle reconciliation is now process-role aware. The web
  process reports its own runtime snapshot alongside the daemon's, so a plugin
  addressed to the web (`runs: "web"` or `"both"`) is judged by the snapshot
  of the process that actually runs it: a web-activated plugin no longer
  shows as missing while the session daemon is unreachable, and a `both`
  plugin's browser module only publishes when both processes hold the current
  revision, with a restart required when either process has drifted. The
  daemon-to-web handshake now forwards the `runs` field, browser-asset cache
  freshness follows the web view, a web-only record of a since-removed plugin
  renders as undiscovered instead of vanishing, and the route mount uses the
  shared request-cancellation helper so a client that disconnects between
  request acceptance and handler start aborts the plugin handler too.
- 0d584c2: Quiet the phone surfaces: composer buttons, message action icons, tile menu
  buttons, quick switcher chips, and extension dialog options lose their
  outlines and carry state in tints instead - visible borders on the chat
  surface drop from 136 to 12 and boot from 17 to 4 - while hover, focus, and
  press states keep every affordance and the touch floors stay enforced.
- e47485a: Every corner in the client now comes from the published radius scale. Literal
  radii had beaten the tokens — 8px appeared 44 times and the off-scale values 5,
  7, 10 and 14 together appeared more often than `var(--pi-radius-lg)` was
  referenced at all, so four curvatures could stack inside one dialog and moving
  a token moved only half the app's corners. A contract test keeps the line:
  a client surface that declares a pixel radius fails the suite.
- da1479a: One reading edge. Lists, sheets and panels answered "how far from the screen
  does text start" five different ways - 6, 10, 12, 15 and 16px coexisted on one
  phone screen - because the spacing scale names arithmetic steps and nothing
  named the role. A role token now does: --pi-reading-edge, 16px on desktop and
  10px on the phone, derived from the scale at each breakpoint, and the shared
  list row and the tools grid use it. The phone measures unchanged; the desktop
  lists sit at the same edge the settings panels already had. A contract test
  keeps the token published at both breakpoints and catches the next list that
  answers the question privately again.
- f6b41d3: Reads for the same path share one round trip while it is unsettled. Several
  surfaces ask for the same thing at the same moment — a session switch, the
  panel behind it, a reconnect — and each ask was its own request, which costs
  latency on exactly the interaction being watched. Writes are never shared: two
  sends that look identical are two messages, and what makes a repeat safe lives
  in the daemon's operation ledger, not in a client-side map. A caller that
  brought its own abort signal keeps its own request, so one caller's cancellation
  cannot settle another's read, and a shared entry is dropped the moment it
  settles — it is a shared flight, not a cache.
- 5fddd0e: A reconnect asks rather than resends. Messages whose answer the link lost stay
  open on their own row; when the socket comes back the browser hands the daemon
  the identities it is still holding and takes the answer, so a message that was
  accepted settles and one the daemon has no row for stays honestly unknown
  instead of being resent blind or being reported as gone. Identities the daemon
  did not answer for are absent from the reply, and the client keeps them open —
  "we have no row" and "it did not happen" are different facts, and only the
  second would justify telling the reader the message failed.
- 6f45aac: A remembered session whose folder is gone is deselected at the first
  listing, not opened into a red banner.

  Boot restore replays the last selection from stored state, and that stored
  shape carries no folder stamp - so a session whose working directory was
  deleted after the last visit sailed past the row gate and opened into the
  full daemon error as a banner. The first workspace listing is where the
  app learns the folder is gone; the selection now steps down to that fact
  with a notice, and the transcript-failed state stays only for the race
  where the folder disappears between listing and click.

- 925ae00: Round eight, lane C. A dialog that names no first control takes focus on its
  own shell, which wore the platform's blue ring beside the app's accent one;
  measured blue 1px before, accent 2px now. The model picker's catalogue rows
  state their own type and touch floor, so switching scope no longer resizes
  every row, and the add-project suggestions take their touch floor from the
  pointer rather than the viewport — the same accident its own footer comment
  records. Row-list activity dots share a centre line with the row menu, as the
  tile variant already did, and the quick switcher's state mark sits on its
  subtitle's line. Offsets join the spacing guard: a badge placed with `top: 6px`
  is spacing spelled as a position, and thirty-three such literals are now steps.
- 273f82b: Round eight, lanes A and B. Stacked chrome rows share one reading edge on a
  phone: the session name, the compact header and the conversation below them all
  started at a different distance from the screen edge (10, 8 and 6px), and now
  read from one `--pi-chrome-inset`. The context sheet keeps its title and close
  in place while its three lists scroll, and drops a heading rule that could not
  reach the headings it named. The quick switcher's close joins the two-step
  sizing its sibling dialogs use, the panel edge control reads the touch height
  instead of an unnamed 48px, and the compact row's corner language applies to the
  control that renders itself into it. Search hints and child markers step off
  `--pi-dim`, and the last two checkbox rows that positioned a 24px box with a
  stale top margin centre it like the rest.
- ed0cd40: The convergence lanes audited the previous round's fixes and caught two that
  were never landed. The self-update banner's coarse 44px floor is now really
  above the media block that raises it, and the pointer-query guard really
  checks the first rule of every media block - proven by turning the broken
  order red before turning it green.

  The phone header no longer mounts a second, visible machine list next to the
  panel's own; the state rail's unread row class no longer paints working rows
  purple over a blue dot, and the background state plus the machine unread dot
  joined the same purple vocabulary. Error reporting now always travels with
  its retirement mark and machine scope - a stale scope could let one machine's
  success erase another's complaint, and self-update failures could inherit a
  stranger's expiry. The interrupted-runs "status unknown" banner only
  announces onto a quiet screen and retracts itself when the read recovers.
  The quick switcher's row menu is fixed and viewport-constrained like every
  other row menu, and the session tree's disclosure and close buttons got
  their coarse touch floors.

- b3ae9c8: Round eleven, lane C. The context bar's title had a dead declaration, so the two
  stacked chrome rows on a phone started their text 4px apart; the transcript's
  "showing messages" line and two settings hints inherited sizes that are not on
  the type scale; three picker close controls and a plugin refresh button had no
  font at all and fell back to the browser's; the row menu's ellipsis drew a third
  larger in one list than the other; and workspace-panel buttons and file-tree
  rows sat below the control floor. The message info mark is drawn rather than
  typed, so it matches the icons beside it instead of taking whatever font
  resolved the character. The box-model guard also reads a floor and a padding
  declared for the same selector in two separate rules, which is how the
  add-project footer rendered 50px for a 32px token.
- 964ada3: Round eleven, lanes A and B. The activity dock's working colours were written
  for a class the renderer never emits, so a session that is working looked like
  one that had just started; the rule now names the state it styles. The message
  header shares the left edge of the body it titles, the empty screens keep the
  rhythm they declare instead of the browser's paragraph margins, and the two
  stacked chrome bars on a phone draw the same rule weight.

  In the dialogs: the add-project footer floors on a content box and rendered 50px
  for a 32px token, three picker search fields take one height instead of the
  browser's, and the quick switcher reserves its menu column only on rows that
  have a menu. Picking the theme you are already running keeps its selection
  border, the `main` chip is out of the two-line clamp that was discarding it, and
  the theme card's sentence has room to be read. Jump-to-bottom, the settings back
  verb and the pinned mark are drawn rather than typed.

- 5b63f49: Round 15 of the convergence review ran over the architecture wave and found
  nine true findings; all are fixed.

  The two that mattered most were lies the screen told. An idle session wore
  three bouncing working dots forever, because the persistent mark's own display
  rule beat the hidden attribute it was toggled with - the test asserted the
  attribute, the screen showed the mark. And every idle row in the machine,
  project and workspace lists carried an unread-class marker inside a hidden
  wrapper, which the state rail's :has() selector could still see, lighting the
  whole list's rail as if everything were unread. Idle now means idle in the
  computed style, and the unread class belongs to rows that are actually unread.

  The session tree dialog could freeze the page: the load call sat in the render
  path, and once the module had settled every render scheduled another render
  through a microtask, starving the macro task that paints. The load now fires
  when the dialog first appears, outside render.

  The rest: the fold button's dead padding override replaced with a real box,
  the tile path line's assumed line height pinned, the collapsed composer
  aligned to the conversation column instead of a private inset, the prefetch
  write keyed to the machine it asked rather than the one selected at merge
  time, a failed prefetch forgotten so the next intent retries, and a
  load-failure banner that retires itself when a retry succeeds.

- 0e40b77: Follow-ups from the round-15 verification lane. The load-failure banner now
  really retires itself when a retry succeeds: the first version of that fix put
  the retirement behind a branch that could never run, because a settled load
  and an absent entry were indistinguishable at the call site - the verification
  lane caught the dead branch behind a published claim. Also: the fold button's
  padding override now wins instead of sitting dead in front of the rule it was
  meant to beat, the module docstring says what the open path actually does,
  and the companion [hidden] rules are pinned by tests so the attribute-only
  blind spot cannot come back quietly.
- d6f5972: Round five, lane C. The context sheet let each contributed list shrink inside a
  surface that already scrolls, so a second machine rendered as an 8.9px sliver
  that reads as a rendering artefact rather than a row; the lists keep their
  height and the sheet does the scrolling. That sheet also printed "Machines"
  twice, in two sizes, because it drew a heading above a section that renders its
  own. The message meta control was dimmed to 1.37:1 at rest — the round-four
  readability fix had only reached the touch branch — and the chat drawer's body
  had no gutter, so a plugin's status dot sat against x=0 and its refresh button
  against the screen edge. The model picker's catalog rows, the quick switcher's
  row menu and the navigation panel's controls state their own type instead of
  the browser's, and the settings close control and the follow-the-system
  checkbox align with the rows they belong to.
- c7fa10d: Round five was almost entirely "the previous sweep did not reach here", so the
  sweeps are now guarded: font weights and the disabled-state opacity fail the
  suite as literals, the way radii, sizes, spacing, dots and token references
  already do. The action palette and auth dialog state their own type instead of
  the browser's, the auth dialog gets the coarse floor every sibling dialog has,
  settings checkboxes read `--pi-checkbox-size` rather than shipping 14, 16 and
  18px targets, and close controls in the quick switcher, auth dialog and context
  sheet follow the same two-step sizing as the rest of the family. The chat
  drawer's collapse control reads the panel-header control height its left-rail
  peer uses, message-card headers dock at the same offset as their siblings, the
  workspace view rows derive their height, the tile menu derives its inset, and
  the drawer no longer draws a second 1px rule under the first.
- 8e131a1: Round four. The activity dock's asking and error states named three tokens that
  do not exist, so a waiting dock lost its amber wash and an errored one its red;
  they use the palette's real ones. A desktop panel header refused to shrink, so
  an unnamed session — whose title falls back to its whole first message — pushed
  the settings and Actions buttons out of the panel; the title truncates now.
  Update and error banners meet the touch floor their column neighbours already
  had, the multi-select checkbox no longer overlaps the name it sits beside, and
  one count badge, one close glyph, one header icon size and one banner edge are
  used where three each had appeared. Focus-ring offsets, mono font stacks and
  checkbox sizes read tokens instead of literals.
- d1c2e9b: The phone settings detail header aligns its close control with the row a
  reader arrives on instead of floating between a two-line heading, and the quick
  switcher marks a main workspace with a tag rather than the prose "· main",
  which a two-line clamp cut off exactly when the name was long enough to need
  it.
- 6a5221a: Round fourteen, lanes A and B. The last typed marks in the app are drawn: the
  rename confirm and cancel actions, the code-block copy control, the workspace
  path copy, the goals refresh, the machine switcher's chevron and the git file
  twisties all take a real icon instead of whichever glyph a font supplied. The
  boot empty state gets a hairline dashed frame with breathing room rather than
  the browser's 3px default drawn tight against its button, the "starting
  session" row's frame is visible at all, the shared modal shell reads the named
  elevation instead of inventing a fourth, the status bar shares the chat gutter,
  and the compact header states one size for one verb. The 8505 stack script also
  stops reporting failure when it is serving a healthy stack.
- e67c05e: Round fourteen tail. The quick switcher's machine tabs draw the strip rule they
  were shaped to merge into — the `border-bottom: 0` tab idiom needs a baseline,
  and without one the tabs were three-sided boxes over nothing — and the pinned
  mark joins the icon scale. The extension dialog card drops an empty media block
  and a comment describing a rule that no longer exists. The audit and touch
  probes now separate "the stack is not up yet" from "the UI is broken": six
  bounded retries, then a named failure, verified by running them against a
  stopped stack.
- 3e45b97: Round nine, lane A. Control floors get a box model: `min-height` plus padding
  on a content box added the padding on top of the token, so the boot screen's
  only primary button declared 44px and drew 62. Eighteen rules are corrected and
  the box-model guard now reads this second shape as well as the first. The
  resident bar keeps its height while a session works, the context sheet's sticky
  header spans the sheet instead of letting lists slide through 8px gaps beside
  it and no longer names a token that was deleted, and the phone drawer's sticky
  header keeps the drawer's own tint. Lists spell "this section opens" with the
  same chevron the chrome uses rather than text arrows.
- 0acbe36: Round nine, lane B. Hover and the keyboard cursor stop painting the same fill
  in the model picker, the command picker and the auth dialog, so a click target
  and the row Enter would take are told apart the way the quick switcher already
  tells them apart. The Appearance and Machines settings panels use the frame's
  heading instead of their own, which puts their titles at the same height and in
  the same treatment as the other five. A rename row keeps the inset of the row it
  replaces, so text does not shift under the caret; the ask-user divider is
  centred in its gap and the custom answer lines up with the option copy above it;
  the extension dialog's controls are touch targets wherever the card is shown,
  and its input stretches with the card instead of guessing its own width. Two
  state lines that were sized by the browser now read from the type scale.
- d167533: Round nine, lane C. A `(pointer: coarse)` floor written before a base rule with
  the same selector loses to it — a media query carries no extra specificity — so
  row menu items and the rename controls shipped mouse sizes on a phone (36px
  measured against a declared 44). Those three rules are reordered and a guard now
  fails when a raised selector is redeclared afterwards. The conversation meter's
  cursor keeps the halo a second shadow declaration had been erasing, settings
  fields land on the control scale instead of on whatever their padding produced,
  the theme preview draws the height it declares with its dots centred, and the
  machine list states its status as the mark-and-word the switcher uses, with
  offline no longer painted like online. Focus goes back to the app's ring in the
  two settings panels that had replaced it with a 1px shadow.
- 1c2013f: The banner retirement model's seams closed.

  The session tree dialog's stylesheet was structurally broken - an unclosed
  media block silenced every rule after it on desktop. The quick switcher's
  row menu now actually receives its computed fixed placement (the previous
  round shipped it as a literal attribute), including on long-press. The last
  bare error producers go through the reporting seam, and every clear resets
  the retirement mark and machine scope together, so no banner can inherit a
  stranger's lifetime. A gateway 502 whose body is a transport claim heals
  again instead of sitting as raw ECONNREFUSED; a timeout names the machine it
  failed against; any server response - not only a 200 - counts as proof the
  link is up. The reader's dismissal can no longer be outvoted by the banner's
  minimum-visibility window, and the interrupted-runs banner retracts on
  recovery by flag rather than by matching its own wording.

- bb9f865: Round seven. Dialog and picker close controls are border-box, so the glyph is
  centred in the box the token sizes rather than in an inner box the border pushed
  off-centre. The chat drawer header keeps its padding inside the control it holds
  (52px before, matching the 45px the rail and resident bar share), the resident
  bar draws the same rule weight as the header beside it, and its toggle icon is
  16px like every other header icon. The orphan marker carries information at a
  readable strength instead of `--pi-dim` at 0.65 opacity (~2.3:1), the
  bulk-selection toolbar meets the mouse control height its neighbours have, and
  the settings list, the add-project suggestions and the quick switcher's rename
  actions state their own type and height rather than the browser's.
- 646a0d5: Round 17 of the convergence review: the mechanical findings fixed.

  The self-update banner's coarse 44px floor was dead - its base rule sat after
  the media block meant to raise it - and the pointer-query guard that should
  have caught it never checked the first rule of any media block. Both fixed;
  the guard's blind spot was the reason the dead floor reached CI.

  The reconnect banner no longer pastes itself into itself once per retry: its
  detail is what the health read reported, never the banner's own previous
  text. The error producers in the machine and session controllers now travel
  with their retired-by mark, so a banner's lifetime is decided by the error
  that set it rather than by whatever was cleared before it. Stale docstrings
  and a dangling triage pointer repaired.

  The banner retirement model, the rail's colour vocabulary, and three smaller
  product questions are the owner's; they are recorded with evidence in the
  round-17 triage page.

- a0c27fc: Round six, lane A. The phone panel header measured 53px where the desktop rail
  and the resident bar measure 45; it reads the same panel-header height they do.
  Informational text moves off `--pi-dim` (4.12:1 on the page) onto `--pi-muted`
  (6.15:1): the status readout, the "showing messages X–Y of Z" boundary, the
  delivery mark and the session search placeholder are things a reader needs, not
  decoration. The load-earlier control and the empty-transcript button meet the
  control heights their neighbours already have, the chat drawer's header shares
  its body's gutter so the tab strip lines up with the cards below it, and the
  message meta control is 24px square like the actions beside it.
- cf36579: Round six, lane B. The quick switcher's interrupted ring drew at 12px because
  it added a 2px border to an 8px content box, which also pulled its centre 2px
  away from the corner every other state mark shares; it is border-box like the
  house rings. The ask-user card's header starts on the same column as the
  question, options and buttons beneath it instead of 6px to their left, and its
  custom-answer block hangs from a derived indent rather than a 32px literal that
  assumed a browser-sized radio. Native tick boxes in the ask-user card and the
  model picker's catalog take the checkbox token instead of rendering at the user
  agent's 13px, and the machine row menu is a published control size on a mouse
  rather than 26px.
- 14b42f7: Round six, lane C. The tile activity dot was derived with a hard-coded 5px
  radius from when the dot was 10px, so it sat 1px above the menu button it is
  supposed to share a centre line with; it derives from the dot token now
  (measured 1px, now 0). The message info control gets the same touch reach its
  siblings have instead of standing as a 24px target beside 44px ones, and the
  error banner's dismiss is a square control rather than a ~19px strip. The
  follow-the-system checkbox loses the 2px margin left behind by an alignment
  change, the add-project dialog's footer buttons use the app font like every
  sibling dialog, the child-row indent reads the gutter formula, and a block of
  list rules that had been copied into the composer — where nothing matches them
  — is gone.
- 0e40b77: Round 16 of the convergence review: twelve true findings, ten fixed.

  The state rail - the one place the design spends colour on identity - never
  painted: its colour rules were written against a borderless element, its
  :has() specificity silently outranked every row-state rule, and the session
  list's state vocabulary was never named to it. The rail now colours the row,
  holds class specificity so selected and archived win over work states, and
  speaks both vocabularies.

  Also: bulk-selected rows finally look selected (their one style was written
  against the same borderless element); a failure banner can no longer be erased
  by an unrelated successful request, because the retired-by half travels with
  the text again; a settings route restored from the URL actually loads its
  panel; the workspace menu's copy button meets the coarse floor; the machines
  list retires its search query when hidden like its sibling lists; and the
  box-model guard's second shape - which had been silently passing because it
  pushed nothing - now reports, and caught two real offenders on its first
  talkative run.

- 24fe403: Round ten, lane A. One disclosure verb, one glyph: the machine, project,
  workspace, file, git and session-tree lists all borrow the shell's chevron
  through the plugin host instead of spelling "this section opens" with a text
  arrow, and the chevron sits on the text baseline. The self-update banner can
  draw its working mark again — the three dots had no size rule in that shadow
  root at all. The rail header reads the shared chrome inset like every other
  chrome row, the phone drawer's sticky header paints the drawer's own tint
  rather than a near-match, and a bulk-selected row uses the one selection
  channel instead of stacking a second 3px edge on it.
- 2e5beb4: Round ten, lane B. List rows read one `--pi-row-min-height` instead of drifting
  to 52, 56, 58 and 60px for the same shape, and dialog close controls are one
  size rather than two families of five. A machine that is offline reads the same
  way in all three surfaces that show it — mark and word, with offline distinct
  from online — instead of grey in one place, red in another and colour-only text
  in a third. The quick switcher's state mark actually sits on the centre line its
  comment claims, the row-list comment now describes the geometry it really has,
  the extension dialog's answer input takes the touch floor its buttons have, and
  a settings textarea derives its height from the control scale.
- 843e103: Round ten, lane C. Secondary copy on a selected row steps up to the secondary
  text colour: the selection tint is lighter than the surface the muted colour was
  toned against, and it measured 4.42:1 there — 7.27:1 now, without touching a
  theme's palette, which is the owner's to change. Marks are drawn rather than
  typed in the last places that typed them: the dictation control gets the icon
  its plugin already exported, prompt history and bulk selection get real icons
  instead of 8px text glyphs, and the settings drill-in reads the shared chevron.
  The compact header's Actions pill no longer lets its label overflow the border
  when a scope name is long, row overflow menus share one ground and one corner,
  the context sheet's title outranks an inner list's sticky search, and the
  extension dialog is one card colour instead of two.
- 84038d6: Round thirteen, lane C. The dialog hint fix from the previous commit was a
  no-op — the rule already ended in `white-space: nowrap`, which wins — so the
  sentence that states a consequence is only now allowed to wrap. Add-machine
  fields rendered at 12px in the UI face rather than the 16px monospace they
  declare, because a bare `input` selector loses to the host stylesheet appended
  after it. Tool cards and delivery receipts draw their marks instead of typing
  them, so the double tick is a drawn glyph rather than two characters squeezed
  with negative letter-spacing. The composer's trigger hint and collapsed draft
  step off `--pi-dim`, the two row overflow menus paint alike, dead status-bar
  rules are gone, and the chat gutter's base value reads from the spacing scale.
- 62c3345: Round thirteen, lanes A and B. The activity dock's state mark is drawn at full
  strength: an opacity layer left idle, asking and error between 2.18:1 and
  2.42:1 — under the 3:1 floor for a graphic — while working and background were
  exempt, so the two states that most need attention were the faintest. List rows
  read the row-height token that was written for them, instead of only machines
  and tiles reading it and neighbouring lists sitting 9px shorter in the same
  sheet. The extension dialog's buttons are the height they declare rather than
  16px taller, and its two no-op copies of that floor are gone. A dialog hint
  keeps its sentence instead of losing the consequence to an ellipsis inherited
  from list chrome, the cleanup dialog's day field rises with the buttons beside
  it, the rail's two header icon buttons are the same width, and the phone
  gutters read from the spacing scale.
- 4569152: The restore ladders read their own signal, and machine-specific failures
  retire with their machine.

  Round 29 removed the load-start banner clear, which silently broke the
  deep-link restore ladders: they read a leftover banner from any machine as
  "the listing still fails", burned their retries, and announced "X is still
  unavailable." over a machine that answered every probe. The ladders now
  probe the load's own status, the local ladder's wording guard covers every
  attempt, and a reader-retired failure keeps the machine it belongs to - so
  deleting that machine retires the claim, as the model always said. The
  interrupted-run marker set is stored per machine (adopting one machine's
  read no longer evicts another's), the terminal soft keys and the machine
  dialog keep their declared type and height against the adopted host sheet,
  and the tree navigator's coarse disclosure track reserves what it draws.

- c16a09d: The self-update strip can be dismissed by the world again, and machine
  failures keep their name through composition.

  Tapping "Update now" set an applying strip that nothing ever cleared - if
  the restart landed on the same version, a blinking strip occupied the top
  of the screen forever, the one banner in the app without an exit. The
  socket reconnecting to the same page is now its end, and that reconnect
  also re-runs the client-freshness probe - the highest-probability path to
  a stale bundle was the one path that never checked, because the reader
  never left the tab. Hand-composed failure notices (bulk archive, bulk
  delete, failed session start, workspace removal) keep the machine stamp
  round 30 gave transport failures, so deleting the machine retires them,
  and a late session-start answer can no longer drag machine A's state into
  machine B's view.

- 86173ac: The last round-three drift: the resident bar's session name truncates with an
  ellipsis instead of being cut mid-glyph, the idle activity dock is quiet
  through colour rather than a 0.75 opacity layer that put its label at 3.96:1,
  the clear-queue pill meets the mouse control height, the settings and cleanup
  dialogs close with the same control, and weights and elevations read the
  `--pi-weight-*` and `--pi-elevation-*` scales — including the emphatic 650 step
  those surfaces had been spelling by hand.
- 64045ac: Round-three lane C fixes. A failed command receipt referenced three tokens that
  do not exist, so it lost the danger colour _and_ the fill its pending sibling
  has; the add-project dialog's hints were clamped to one nowrap line by the host
  sheet, which pushed the project-trust link past the dialog edge where it was
  clipped away entirely; and the settings back control kept the button surface as
  a white block above the heading. Picker close controls are sized on both
  pointer types instead of inheriting the user agent's 24x25, option descriptions
  read the type scale, the theme preview dot joins the dot scale, the tile
  activity dot sits in the slot reserved for it, the multi-select checkbox is
  concentric with the toggle on touch as well, and the global error banner's
  dismiss meets the control height. Control sizes hidden inside custom properties
  are now caught by the same guard as the controls themselves.
- 2fc98ec: Round twelve. The transcript and the status bar draw their marks from one
  module instead of typing ⧉ ↻ ↩ ✓ ✖ ▶ ↑ ↓, so a message header no longer carries
  two graphic languages at once and each mark is the size it was given rather
  than the size a font chose. The bulk-selection tick, which round eleven drew but
  never sized, is 16px again instead of filling its whole control. Status words in
  the two transcript cards carry their hue on a mark and their text in the body
  colour — success, warning and accent all measure under 4.5:1 at 11px on the
  raised card, and a palette is the owner's to change. The context sheet's sticky
  header sits on the sheet's own ground, the cleanup dialog's coarse floor is no
  longer shadowed by a more specific rule, the add-machine dialog's buttons use
  the app font, single-line dialog fields converge on one height, and the rename
  field is 16px so iOS stops zooming when it takes focus.
- 6c32b43: The error scope model's two ends are wired together.

  A web-owned success no longer vouches for any machine's link: the
  "daemon unavailable" banner survives harmless requests like theme switches,
  and a remote machine's timeout claim is retired only by that machine's own
  answers. The controller seam carries the machine scope it computes instead of
  stamping over it, retirement follows the evidence in an error's message
  rather than its exception class, and the last bare error writes - including
  a queued-send warning that could self-destruct before the reader obeyed it -
  go through the seam. The quick switcher's row menu really receives its fixed
  placement this time, re-proven against the quick switcher itself; the unread
  ring's rail entry and a sending entry align the rail table with the dots it
  follows; the status flag wire contract is exported from the plugin API so
  renaming a flag breaks the build instead of blanking every work mark; and the
  interrupted-runs unknown banner announces per machine and retracts by flag.

- 2851f3f: Late failures stay where they belong, and two waves of touch floors
  actually fire.

  Five session-action catches (prompt, shell, command, both archive paths)
  painted a late failure's banner onto whatever machine or workspace the
  reader had since switched to - a 30-second timeout or a gateway 4xx
  arriving after a switch replayed machine A's complaint over machine B, the
  exact replay the banner design sentence forbids. They now carry the same
  selection guard their transcript writes always had. Two stylesheet
  repairs: the relays panel's coarse 44px floors from round 25 never fired -
  their insertion swallowed a closing brace and nested the media block
  inside the active-tab rule, matching no element - and the updates panel's
  floors from round 27 lost the specificity tie against the adopted host
  sheet, so both now stand alone and out-rank. Also: the interrupted-runs
  retraction consumes the read plan's own decision, a successful upload
  vouches for the machine it touched, and the box-model guard's border
  exemption actually exempts.

- 0ae86be: Scope switches keep reader-retired failures visible, and machine banners
  carry the machine's name.

  Leaving a workspace or machine no longer silently eats the banner recording
  a failure the reader acted on - the claim survives the switch and is still
  there on return, which is the notification. Gateway health and runtime
  failures now compose the machine's name - "lab-mac is unavailable;
  reconnecting… connect ECONNREFUSED…" - the same wording the deep-link path
  already writes, instead of an anonymous "Reconnecting to the machine…" that
  erased the one fact the reader could not see anywhere else.

- 3ec25d8: The recovery the banner promised can now deliver, and the plugin panels get
  the floors the shell always gave.

  The "interrupted-run status is unknown" banner told the reader to reconnect
  to resolve it, but the empty-record guard ran before the retraction - and
  after the boot read, emptiness is the only answer a recovery can bring, so
  the promise was undeliverable by construction. Any successful read now
  clears the unknown state. The unread ring stops wearing the running colour
  (a machine row that is unread and working used to be indistinguishable from
  one that is just working), the terminals refresh checks the machine the
  reader is on before painting a late failure, the plugin-backend failures
  keep their machine scope, and the workspace-tasks and relays panels take
  the 44px touch floor, the disabled-opacity token and the box-sizing their
  siblings always had.

  <!-- ERRATUM (round 28): the relays floors shipped nested inside .document-tab.active and matched no element; restored in 0ae86be1's successor. -->

- a8cc045: The expiry schedule is a claim, and the boot read happens once.

  Two machines down in a row produce identical banner text; the expiry timer
  that was armed for the first machine's claim deleted the second machine's
  banner that never answered once, because both the re-arm gate and the
  timer's own guard compared wording only. The schedule now carries the
  machine it was armed for. A machine switch re-enters the boot read path,
  which re-read the already-spent interrupted-runs record with boot semantics
  and erased markers the reader was on their way to act on; the boot read is
  now once per page. The expiry timer resets the schedule marker it fires on,
  the settings nav button and two touch floors draw at their declared
  geometry, the dead deadline branch and the dead ReportedError helper are
  gone, and the unknown banner promises only what a reconnect can deliver.

- c4b2332: A load start is not a retirement event, and the failed-listing ladder
  stops promising reconnects it never performs.

  Machine switches and browser resume both pass through the projects load,
  whose first act silently cleared any reader-retired failure banner -
  exactly the eating the round-28 owner decision forbade - so the clear is
  gone and a load beginning no longer counts as a retirement event. The
  boot ladder for a local deep link no longer borrows the machine wording
  ("reconnecting…" from a machine that was never probed) and no longer dies
  at its first retry: it retries the projects listing itself, which is the
  whole recovery, and its still-current guard accepts the local machine.
  Also: the coarse session row reserves the gutter its toggle actually
  draws, the hidden-attribute guard now sees the machine list and property
  bindings, and the interrupted-runs retraction is scoped to the machine
  whose read raised it.

- 535fb94: The gateway's own failure labels join the retirement model.

  A 502 from the machine proxy used to land as a permanent red alert reading
  the raw internal label, with the evidence and the machine id dropped on the
  floor: the banner stayed until dismissed even after the machine came back.
  It now carries the detail and the machine it failed for, heals on that
  machine's own answers, and reads "Reconnecting to the machine…". Background
  health failures are sequenced so a late failure cannot paint machine B's
  complaint onto machine A. The 1.5s minimum-visibility window works again for
  poll-clears (the reader's own dismissal remains decisive), page-level claims
  are retired by any response as every comment already promised, and composed
  messages keep the machine's name where the wording table used to erase it.
  The plugin API's status flags come from their one defining module through a
  runtime export, the tile's activity dot no longer sits inside the text
  column, and the last bare error clears go through the seam.

- a5d3f39: A link failure keeps the browser's own words, and onopen stops retiring
  claims it cannot prove.

  The plugin-backend wrapper prefixed "Plugin backend request unavailable:"
  onto the browser's "Failed to fetch", which the anchored transport rules
  match whole-message - so a dropped connection became a permanent red banner
  that survived every poll on every machine. The wrapper now throws the raw
  text, keeping the failure's transport lifetime and machine scope, and the
  two direct fetch legs stamp the machine they were talking to so the
  commonest link failure is no longer page-scoped. The realtime socket's
  onopen no longer retires claims: the proxies accept the upgrade before
  bridging upstream, so onopen proved the web process alive while the daemon
  was down, retracting the banner half a second after raising it. Also: the
  dead live-link parameter is gone, a third-party manifest no longer vouches
  for PI WEB's link, the hold window and expiry timer reset the whole
  schedule marker pair, and the updates panel, the workspace trust row and
  ProjectList's retry button take the 44px coarse floor.

- 0022010: The interrupted-runs retraction is now actually reachable, and the plugin
  layer joins the guards and the rail.

  Round-25's fix moved a flag write above the emptiness check and left the
  banner retraction behind the same early return - the promise shipped, the
  behaviour did not. The read's outcome is now one tested plan module: a
  failed read announces unknown on a quiet screen, a successful read always
  resolves the unknown banner (after the boot read, emptiness is the only
  answer a recovery can bring), and on-screen markers are erased only when
  the record truly says so. The plugin-backend leg vouches for the machine it
  holds instead of asking a URL that cannot answer, the reachability report
  accepts an explicit scope, offline and error machine rows wear the danger
  rail their dot always had, hoverGuard walks the plugin tree (two live bare
  :hover offences in the git panel are wrapped), a machine or workspace switch
  no longer replays the previous context's banner for 1.5s, and the coarse
  checkbox centring formula names the slot it actually centres in.

- a35c5b7: The fourth copy of the late-failure guard, and the spent record that read as
  a retraction.

  A background runtime refresh whose failure arrived after the reader switched
  machines painted the new machine's screen - round-22 delivered the selection
  guard for the health refresh but left its runtime twin unguarded; the guard
  is now shared, with an opt-out for the settings path whose failure is the
  answer to an explicit ask. Deleting a machine retires the claim about it: a
  scope with no future replies can never be disproved. The interrupted-runs
  record is read-and-clear, so a later empty read is no longer adopted as "the
  runs have since continued" - only the boot read adopts emptiness, and the
  live session state arbitrates continuance. The reader's dismissal cancels
  the expiry timer, the last three width:100%-with-padding overflows draw
  border-box, the rail table stops writing two colours for the running state,
  the unread halo is one purple motif, and the fork/terminal/manifest/backend
  fetch legs both report reachability and keep their machine scope on failure.

- fb975a0: The machine scope a producer chose survives classification, and expiry stops
  contradicting what messages render as.

  A gateway 502 that names the machine it failed for was stamped page-scoped by
  branch order: any other machine's success erased the banner, and the rewrites
  deleted the machine's name from the text. The scope now follows the evidence
  the error carries - the body's machineId, else the machine the URL speaks
  about - and a message the wording layer declines to shorten (a composed
  "X is unavailable; reconnecting… <detail>", the retry ladder's terminal
  sentence) stays until its machine's answers or the reader retire it, instead
  of being deleted six seconds in while styled as permanent. A late background
  health failure can no longer paint machine A's complaint onto machine B, the
  hold window re-arms an identical returning failure, and a sessiond restart's
  banner survives other machines' polls. Also: three width:100%-with-padding
  overflows are border-box, the spacing guard sees logical properties, the
  session list clears its filter when hidden like the plugin lists, and the
  dead machineStatuses property and 26 orphaned CSS rules are gone.

- 9b08fa0: Round-two polish fixes. In multi-select the inert subtree toggle covered the
  row's checkbox — on a coarse pointer it covered it entirely — so a tap aimed at
  the checkbox hit a control that does nothing; inert now means inert. The
  cleanup entry meets the mouse control height its neighbours already had, the
  cleanup dialog and the ask-user card raise their controls by pointer type
  rather than container width, and the add-project and add-machine confirms use
  the app's accent fill (7.5:1) instead of a border token pressed into service as
  a fill (4.1:1). The unread count in a section heading is a badge like every
  other count, both image lightboxes close at the same size, and the "+" glyph is
  the same size in every add control.
- 14e9d13: More round-two polish. A session row's state mark had no position of its own,
  so an 8px dot took a whole line under the subtitle and added 18px to every row
  carrying one. Appearance cards clamp their description to two lines, so the
  grid keeps one card height instead of three, and the "follow the system"
  checkbox stays square on a phone instead of being squeezed to 15.8x24 by the
  text beside it. Picker rows state their own type, which also retires the 1px
  taller row the ✓ marker used to create, the quick switcher's group headings
  align with the cards they label, and the thinking picker's last level carries a
  description like every other level instead of collapsing a row.
- c9ab1c6: The token-layer audit's five fixes: visible boundaries, one distribution,
  one radius language.

  The lane measured the flat theme's hairline at 1.35:1 against the surface -
  below perceptibility, which is why buttons read as borderless - so the
  border lifts one visible step. The phone heading's two distribution
  mechanisms (space-between plus an auto margin) produced one uneven void
  after the title; the auto margin is gone and the shared space-between
  distributes evenly. The fold button joins the header's own radius
  mechanism instead of hardcoding a full circle tangent to the screen top.
  The control-shaped pills (activity dock, history load, queued strip,
  quick-switcher chips, create tile) join the square language - badges keep
  the pill as the written convention - and the quick switcher's create tile
  centers its content like the empty states it sits among.

- b26a4a7: The session row's leading gutter is one formula instead of five literals: the
  slot starts where `--pi-row-gutter-start` says, is `--pi-row-gutter-size` wide,
  and the row text clears it by one breathing step. Spelled out by hand, that
  step was 8px under a mouse and 2px under a finger, and the depth indent used a
  raw 16px beside neighbours reading the spacing scale.
- a9c8689: A freshly started subagent run says Running instead of "No report yet" - the pill read as a problem when the run simply had not written anything yet. The tooltip still tells the two live states apart.
- 3361ef8: Introduce the semantic surface ladder (canvas, panel, card, raised) with a state vocabulary and a composed elevation scale, re-base message cards, the ask card, and popover menus onto it, and ship the matching ladder stops in the themes pack so every theme renders coherent hierarchy. New tokens are optional for theme authors: packs written before the ladder keep working through derived fallbacks.
- 2345fe3: Server plugins can now declare routes and receive host ports. The activation
  contract gains `routes` (core-shaped paths the host mounts under both `/api`
  and `/api/machines/local`, with streaming answers expressible as async
  iterables) and an optional `ports` object (workspace-catalog and per-project
  config lookups today). A route handler's signal is request cancellation and
  is never bounded by the lifecycle timeout; a route whose path is named by
  the federated route table inherits that entry's transport bounds. An
  activation carrying unknown fields is warned about instead of silently
  dropped, so an older host running a newer plugin says so out loud.
- e12be01: The session drawer's built-in Activity and Notifications pages are removed
  rather than converted. The drawer now renders exactly what plugins contribute:
  with no contributed section it disappears entirely, and a background activity
  dock is a silent pill instead of a drawer control. The notifications data layer
  (socket inbox frames, inbox controller and state) went with the page; session
  notifications are still filed server-side - warnings, dialog outcomes, command
  receipts and runtime notices - and stay invisible until a plugin page returns
  for them. Subagent run and background-task conversation viewers retired with the
  activity panel; the dock pill still names live background work.
- df8c1aa: Session listing refreshes that changed nothing cost a verdict, not a payload.

  The workspace session list re-fetched its whole payload on every focus,
  resume and socket event even when nothing had changed. The listing now
  carries a stateless revision (a hash recomputed from the fresh payload):
  the refresh echoes the revision it stored, and an unchanged backend
  answers `{ unchanged: true }` so the rows already on screen are kept
  without a byte of listing payload or a state churn.

- 4f5a393: Daemon plugins can read session transcripts through a host port.

  `ServerPluginHostPorts.sessionTranscripts` lets a plugin running in the
  session daemon list a workspace's sessions and page one session's
  transcript, in the same bounded browser projection the transcript UI gets.
  There is no write path, so the daemon stays the only producer of session
  files; the port refuses reads with a named error while the session service
  is still starting rather than answering an empty list. Web-process plugins
  see no port. This is the seam full-text search and export plugins build on.

- d25f7b4: Sessions whose folder is gone no longer open into a red banner.

  Opening a session whose stored working directory had been deleted navigated
  first and failed after: a red banner over a dead transcript, the one shape
  the owner rejected. The daemon now stats each listed session's folder - the
  machine that owns the directory answers for it - and stamps the row, so the
  list renders "folder gone" where the unread badge would sit, the row cannot
  open, and the quick switcher stops offering it. Deep links and keyboard
  paths that route through selectSession get the fact as a notice instead of
  a navigation into failure; the transcript-failed state remains for the race
  where the folder disappears between listing and click.

- babad47: The settings gear in both navigation panel headers is drawn as a stroke SVG
  icon instead of a raw ⚙ text glyph. The glyph rode font baselines and sat
  8.8px off the button's center in the phone header; the icon centers exactly
  in both the desktop header control and the 44px phone touch target.
- cf5f0ce: Settings panels join the control scale. Sixteen panel files had grown their own
  form styles with no control height and no coarse-pointer floor between them, so
  one General screen shipped a 40px input above a 42px select above a 35px save
  button — the control a finger has to hit, 9px shorter than the close beside it.
  A shared `settingsControlStyles` sheet gives every panel the scale and the
  touch floor, and a panel writes only what makes it different. The add-project
  dialog sizes its checkbox, path field and footer buttons on a mouse as well as
  on touch, row overflow menus and the model picker's scope control take the
  comfort height their siblings use, and the context sheet keeps the "Machines"
  and "Workspaces" headings the phone panel drops — that panel has a row above
  naming the step, and the sheet does not.
- 73845da: Settings on the phone now drill down instead of swiping through a tab strip

  Research into mobile settings patterns (Chrome's stack drill-down guidance,
  NN/G on tabs) pointed at the iOS Settings model: the phone opens on a section
  list - rows with titles and descriptions, no horizontal strip to swipe - and
  picking a row pushes a full-screen page with a "‹ Settings" back control. The
  phone's own back gesture walks the same chain because every step lives in the
  browser history: `?settings` is the list, `?settings=<section>` a page, and
  back from the list closes settings. Desktop keeps the sidebar layout and can
  still deep-link straight into a section.

- fe4c113: The phone's context sheet renders the machines group from the plugin's contributed section through the same host-fed snapshot the desktop slot uses; picking a row closes the sheet and selects through the host. The group still hides itself below two machines <!-- ERRATUM (round 31): relaxed to one machine in dd95229c - a single-machine user could not find devices at all; the panel doc comment carries the reason. -->, and with no contribution it renders nothing rather than a core fallback. The `createMachine` contract action lands as optional, so hosts without machine creation keep working unchanged.
- e19a84b: Restore the PWA refresh control to the mobile panel header (it was lost with the old context bar), pin the workspace tool views to a single entrance by hiding the panel's own tab strip on phones, raise the desktop panel header controls to the 44px touch floor, and retire the dead quick-switch wiring and breadcrumb helper.
- baa7545: Publish the short-viewport breakpoint to plugins: `ui.breakpoints` now carries
  `shortViewport` (max-height 620px) alongside the width and pointer axes, so a
  contributed surface can respond to the keyboard-up, landscape-phone case the
  width classes cannot see.
- d5f527c: Slash commands read like messages.

  A typed or button-issued command now shows as a user bubble carrying the
  command text, its result beneath it, and the same delivery mark a sent
  message wears: Queued while the daemon holds it for after the current
  reply, Running while it executes, Read once it ran, Not sent when it
  refused or the reader closed its question unanswered. The daemon now says
  when a result is deferred, so a forwarded command or a parked reload is
  never marked Read before it runs, and the mark settles once the session
  goes idle. The warning-coloured receipt strip and its dismiss button are
  gone, and the result is no longer injected into the transcript a second
  time. This mirrors pi: a built-in command is not a message and writes no
  transcript entry, so the model never sees it; a runtime command is
  forwarded to the agent and streams back as its own message.

- fda40e9: The pro palette moves to a space-gray ladder, and the chat header stops
  scattering its buttons.

  The research is the Linear/GitHub-dim school: depth by lightness steps on a
  near-black canvas, hairline borders, no shadow theatre. The base drops to
  #0b0d10 with a quieter four-step surface ladder, borders come down to
  hairline contrast, and the text ramp cools to match. On touch, the message
  header's copy/info actions are now always visible - a hidden-until-focus
  cluster on a surface that re-renders every streamed chunk is the flicker
  the owner reported - and the 24px coarse gap that scattered the buttons
  into a cheap-looking row tightens to the control rhythm.

- 19bcd23: Spacing follows the published scale: 582 declarations named their gaps in
  pixels, including steps the scale does not have (3, 5, 7, 9, 14px), which is
  how sibling rows ended up breathing differently for no stated reason. The
  transcript's sticky headers now derive their offset from the same step as the
  padding they hang off instead of repeating -26px in three places. A contract
  test fails the suite on the next rhythm-sized literal; values that mix spacing
  with layout maths or device insets, and reserves wider than the scale's top
  step, carry recorded exemptions.
- f2e4e0e: State dots follow one scale. The same "this is working" motif shipped at 4, 5,
  6, 7 and 8px with 2px and 3px gaps, so one screen could bounce a 6px triplet in
  the context bar above a 4px triplet in the activity dock beside a 7px mark in
  the status bar. `--pi-dot-xs|sm|md` names the three sizes, every mark reads
  them, and a contract test fails the suite on a sixth.
- 1c0d663: Review fixes for the surface-ladder wave: regenerate the committed plugin-API declaration baseline for the LegacyThemeToken/SemanticSurfaceToken split, put the message card's sticky header, the extension dialog, and the jump-to-bottom control on the same ladder steps as their siblings, move pressed states onto the shared surface-active token, bring the machine switcher's popover geometry onto the radius and spacing scales, drop the remaining all-caps labels from the ask card and tool-execution cards, word the failed-projects empty state honestly, pin the ladder in the design-token contract test, and guard the theme-token list against silent drift.
- ed5c4db: The task panels join the fold, and adoption replacement is real.

  workspace-tasks moves Refresh and Open Terminal into the tool header'
  fold like every other bundled tool. The files stale summary clears when
  the refetch lands (and on workspace switches) instead of claiming stale
  over a fresh tree; the relays summary follows the scan and the open
  relay, and the picker row disappears when a workspace has none. Adopting
  the shared sheets now replaces a previous adoption instead of stacking
  copies, the machines wrapper drops its private copy of the mechanism,
  and the adoption seam has a regression test at the host.

- cfdc4df: The transcript reads like the log it is: role and group headers render as lowercase mono instead of all-caps, drawer tabs lose their caps treatment, the status bar labels its readouts in the log voice (sent and received tokens, context share of the window), an over-long extension dialog title is partitioned between heading and body instead of shown twice, and an empty chat surface offers the action that unblocks it - add a project or start a session - instead of a lone sentence.
- 15062f0: The terminal panel is now a bundled plugin. Its behaviour is unchanged; the pty capability stays in the core daemon and the panel reaches it through the published plugin API.
- e1c9d56: The theme pack no longer ships inside PI WEB: it lives in its own repository and installs as the `@gang-of-beads/pi-web-themes` package (npm or git), which also ends the id conflict between a bundled copy and an installed one. The appearance panel's contract is unchanged - any plugin may contribute themes - and a checkout that wants the packs installs the package.
- e52dd05: The theme pack ships as a bundled plugin rather than app code. The themes and their light/dark pairs are unchanged.
- 7f08d5c: Project and workspace tiles are one shape. A long name or a long path made its
  tile taller than the one beside it — measured 82px against 95px in the same row
  — and a path that did not fit was cut mid-word with up to 131px of text simply
  gone. Titles clamp to two lines and paths to two, so every tile in a grid is the
  same height (measured 85px) and an overlong path ends in an ellipsis instead of
  a severed word.
- 2a1a4bc: A request deadline is now an honest, self-withdrawing notice. When a request
  crosses its 30s deadline, the banner said "The server did not answer within
  30s." and then stayed forever - a plain Error landed on the reader lifetime,
  and the self-healing word list had no rule for it. Measured live: a remote
  machine answered /status at 30.007s against the browser's 30.000s deadline,
  and the banner outlived a session that went on replying. A timeout notice
  now retires on the next successful exchange and expires like the other
  self-healing complaints.
- 509bfcf: A reference to a token nothing defines now fails the suite. Three of them had
  shipped — a failed command receipt, the activity dock's waiting and error
  states, and a rename dialog field — each silently dropping the property it was
  written for while every other guard passed. References that carry a fallback
  stay legal, because a fallback is the contract an optional token needs.

  Round-four fixes: the quick switcher routes its row mark through the same
  arbiter the session list uses, so an unread finished session shows one mark
  instead of a blue dot painted over a purple one; its rows and footer state
  their own type instead of dropping to the browser's Arial; dialog close
  controls are one size on a mouse; the message meta control and the disabled
  row's remedy line are readable instead of dimmed to 2.55:1 and 2.14:1; the user
  role label reads at full contrast on its own fill; theme cards clamp both
  variable lines; and "disabled" is one opacity token rather than .5/.52/.55.

- e381f1c: The remaining bundled tools fold under the host header.

  Files, Relays, Updates and Info each stacked a titled bar of their own
  under the tool header - the exact stacking the git fold retired. Files'
  Upload and Refresh move into the fold (stale rides the summary); Relays'
  toolbar becomes a plain picker row with Refresh in the fold and the open
  relay named beside the title; Updates shows its message count as the
  summary with no bar; Info simply loses its bar. The files stale flag is
  shared module state so the host header can read it, and the panel asks
  the host to re-render when it flips.

- c20983f: Tool pages fold their controls under one host header.

  Every workspace tool page now opens with a single header - the tool name,
  its summary (the git branch), and a fold that holds the tool's controls,
  remembered per tool and collapsed by default - instead of stacking a bar
  of its own under the app's. The git panel moves its mode, view, refresh
  and worktree controls behind that fold, and the phone title names the tool
  page on screen instead of "Sessions".

- b5cdbf4: Tool-result screenshots travel as references, not inline bytes.

  A transcript page whose tool results carried screenshots still shipped every
  image as inline base64 - a 200 KiB screenshot was 200 KiB of page, six of
  them 1.2 MB - and the browser's per-session history cache skipped exactly
  those sessions, so screenshot-heavy transcripts were the slowest to reopen.
  Image blocks above 8 KiB now travel as a `{toolCallId, index}` reference and
  the browser fetches the bytes through a per-image route when the image
  scrolls into view; small images stay inline. The session file is untouched.

- 5857014: Review fixes for the touch-density wave: the attachment chip grows with its
  44px remove badge so the zoom target keeps an AA-sized corner, the quick
  switcher pays the wider corner menu button from the title's reserved gutter,
  session-list and extension-dialog comfort floors move from width gates to
  pointer gates (tablets keep the floor), shared row action menus and the quick
  switcher's search input get the coarse floor, the plain-text composer path
  pays for the wider attach overlay, all new coarse blocks consume
  `--pi-control-height-touch`, the session checkbox reaches the AA floor, the
  probe enforces AA before exemptions and fails loudly when its emulation does
  not report a coarse pointer, and the fullscreen dialog contract states that
  content must provide its own close control.
- fe71b6b: Touch density lands the two-token policy: 24px stays the AA floor everywhere and
  coarse pointers now get the 44px comfort floor across the surfaces that were
  still shipping mouse-sized targets on touch - the session list toolbar and
  search row, the quick switcher (close, tabs, chips, row menus), the composer's
  icon buttons, model picker and thinking gauge, the context switcher add button
  and phone header actions, the shared list search row, section add buttons, and
  extension dialog actions. Message timestamps collapse to 24px (AA met, inline
  exception recorded) and the tile menu keeps its documented 36px exemption. A
  new fail-loud probe (`scripts/probe-touch-targets.mjs`) walks every shadow root
  at 393x850 coarse and asserts the floors with the recorded exemptions.
- 4d0a0c1: The transcript offers Ask here on a text selection.

  Selecting transcript text raises an Ask here chip anchored under the
  selection; one tap drops a quoted prompt (> every line, then a blank
  line) into the composer at the cursor and focuses it, so the reader
  continues from exactly the line they selected. Selection containment
  walks shadow boundaries, because the transcript's text parts render in
  their own roots.

- b2c5cbd: Big transcripts are cached again. The history cache wrote to sessionStorage and
  swallowed the quota failure with no eviction, so any page too large for what was
  left of the origin's shared budget was never cached at all — and those are
  exactly the sessions where reopening is slow enough to feel. A page that does
  not fit keeps its tail, which is the part a reader lands on, and a full store
  gives up its oldest other session rather than giving up on caching. The cache
  takes its storage as a parameter now, so this behaviour is tested against a
  store with a real capacity instead of against whatever a test environment's
  Storage stub happens to implement.
- 0e08986: Long reading walks stop pinning every loaded row to the DOM.

  The in-memory transcript span is capped at four pages: when a merge
  pushes it past the cap, the far side from the reader's current focus is
  dropped from memory while the full span persists in the history cache.
  Scrolling back to an evicted side reloads it from the cache, not the
  wire, and the existing "Load earlier messages" boundary stays honest.
  When the reader is at the live tail, the newest side is kept - the
  oldest side is the one to let go, and vice versa while walking history.

  When the span is trimmed at the bottom, the transcript now says so: a
  "Load N newer messages" boundary appears, transcript events that arrive
  while the tail is trimmed park on it instead of silently appending
  after an invisible gap, and tapping it reloads the live tail.

- 75a57ed: The transcript's top edge fades instead of slicing text mid-glyph.

  Assistant surfaces are border-less, so a message clipped by the chat's
  top edge read as stray floating text with no boundary (the owner's
  "this is a bug?" screenshot). A short mask fade at the scroller's top
  makes the same clip read as intentional depth on every surface.

- fb83cf2: Transient refresh failures retry themselves instead of sitting as a
  dead banner.

  A 5xx on the workspace sessions refresh painted "The request failed
  (502)" and left it there until the next unrelated trigger - the reader
  stuck with an error that explained nothing and fixed nothing. The
  refresh now retries itself with backoff (up to four attempts), the
  banner reads "… — retrying…" while it does, a success clears it, and
  permanent 4xx errors keep their message without a loop.

- 40ca364: Every font size in the client comes from the type scale. Ninety-seven
  declarations named their size in pixels, including steps the scale does not
  have — a 10px eyebrow no token move could follow, an 18px glyph beside a 17px
  one, a 22px close control next to a 20px one. A contract test fails the suite
  on the next pixel font size.
- cfb9a21: The Updates fold says how many messages it holds.

  The fold migration claimed Updates showed its message count as the collapsed
  summary, but the panel only ever registered a badge, so the summary read empty
  on a collapsed tool. It contributes the count as a summary now, and the menu
  probe additionally asserts the context path it was blind to.

- 4dc5e8d: Visual-polish wave: three undefined design tokens stopped silently disabling
  their declarations. The phone settings list drew descriptions and chevrons in
  `--pi-text-muted`, which is defined nowhere, so every row rendered at title
  brightness; accent-filled confirm buttons fell back to `white` at 2.5:1 on the
  accent fill, and the add-project confirm inherited body text at 3.3:1 on its
  green fill. Keyboard focus no longer squares off rounded buttons (the focus
  rule inherited the parent's radius), message-row actions no longer overlap
  their neighbours' hit boxes, and the rename dialog draws real fields and
  buttons instead of platform defaults.
- 20c3b02: Dictation is now a plugin. Existing installs must move their `speechToText` and `azureSpeech` config blocks under `plugins.voice.settings`; the core config no longer names them, and an unconfigured install simply does not offer a microphone.
- e0d422e: The web process now hosts the plugins addressed to it. A plugin package can
  declare `runs` in its metadata (`daemon`, `web`, or `both`; absent means
  `daemon`, so existing packages activate exactly where they always did), and
  the web app assembles its own plugin runtime at startup: routes contributed
  by web-addressed plugins are mounted under both `/api` and
  `/api/machines/local`, the runtime shuts down with the app, and a runtime
  that fails to activate (for example, while the daemon profile is briefly
  unavailable) starts the web process with those routes honestly absent
  instead of taking it down.
- 34c6f7b: The context sheet and the strip speak the reader's language.

  "Change context" was implementation vocabulary - the sheet switches
  where you are working, and now says so: "Where am I working?". When a
  tool surface is the main view (Files, Terminal, Tasks...), the context
  bar names it beside the session instead of leaving the reader to guess
  which page they are on.

- 409ef71: Workspace panels refresh when files change on disk.

  The files and git panels refreshed only on demand: an agent editing a file
  next to the reader left the panel stale until a tap. The session daemon now
  watches the working directory of every session it holds open and publishes
  one `workspace.changed` per burst; the browser refreshes the panels of the
  workspace it shows when the directory and machine match, and ignores every
  other machine's or directory's news. Manual refresh stays; a directory that
  cannot be watched is simply as fresh as before.

- b00a070: The workspace file family is now served by the bundled workspaces plugin's server half instead of core routes: tree, read, write, delete, move, preview, and suggestions ride the route-contribution seam with the same core-shaped paths, status codes, and preview policies, resolving workspace identity through the injected catalog port and path access through the injected config port. Route contributions can read text and binary request bodies, and the suggestions and file-content types the plugin serves are part of the published server contract.
- 299a8da: Workspace files become a bundled plugin. The tree, viewer, uploads, and file deep links move out of core into `pi-web-plugins/files`, driven by new plugin seams: `files.previewUrl`, `files.uploadFiles` with progress and cancel, `files.limits`, `files.uploadFolder`, `ui.renderMarkdownHtml`, `ui.textStyles`, `ui.registerModal`, `ui.query`, and the `session-activity-settled` lifecycle event. Every existing file URL, saved machine-navigation snapshot, and shared file link keeps working: the panel answers to the `files` and `core:workspace.files` route values and keeps the `core.workspace.files--file` and `--mode` deep-link namespaces.
- abcea65: The bundled workspaces plugin declares `runs: web`, which its server half always was: without the declaration the catalog treated it as daemon-owned, so the web process neither activated its file routes nor published its browser module, and the pickers, dialog, and file endpoints went missing on any real deployment. Caught by the live 393x850 stack probe, which now covers the whole wave: pickers in the context sheet, the add-project dialog through the shell's dialog seam, project create, and file write/read through the plugin routes.

## 1.202609.18

### Patch Changes

- 7db63ce: pi SDK 0.85.0. The coding agent, ai, agent-core, and the newly split pi-server package move together; the whole suite passes against the new runtime.
- 367447f: Releases now feed a public binary cache. The publish workflow pushes the Nix builds - including an aarch64-linux build made under emulation - to gang-of-beads.cachix.org, so machines substitute binaries instead of compiling each release themselves; the Raspberry Pi stops spending an hour rebuilding what CI already built.

## 1.202609.17

### Patch Changes

- 6cae7d9: Choosing a theme means getting that theme. Picking Clay Paper under system dark used to render the dark pair member with a "chosen, but following your system" label - a choice something else could override. An explicit pick now turns system-following off; the Auto toggle re-arms it deliberately. A re-pick of the active theme also stops repainting the whole document for nothing.
- b46f120: Card corners stop breaking and taps stop flashing blue. The ask and dialog cards join the one-corner-owner contract the message cards already obey - the card clips, children paint square - which removes the interrupted upper corners on the phone. And a single inherited rule at the document root turns off the Android tap highlight for every button in every shadow root, including the two components the per-component sweep had missed.
- 6157264: One message, one copy, everywhere. The durable queue refuses a second entry with the same id, the queued-message list dedupes across every queue lane and filters consumed entries, recall-to-composer never joins the same text twice - the duplicated draft line the owner photographed - and the daemon republishes status after its queue file loads, so the restart window can no longer report an idle empty session while parked messages exist.
- fe02e73: Update Fastify and Vite dependency trees to remediate published security advisories, including Fastify request-validation and proxy-header issues plus fast-uri, PostCSS, and Nano ID vulnerabilities.

## 1.202609.16

### Patch Changes

- 10c9e02: The daemon owns its prompt queue, durably. A follow-up accepted while the agent is busy parks in the daemon's own on-disk queue with its sender's id, drains one at a time when the runtime settles, and survives a daemon restart - the restart that used to erase queued messages without a word now reloads and delivers them. Recall acts on identity, steers still join the running turn immediately.
- 0fd003d: The session daemon survives plugin failures instead of dying with every active run. A pi-updater timer touching a disposed extension runner crashed the whole daemon mid-turn - two in-flight agent runs died with it, seen by the owner as agents stopping for no reason. Unhandled rejections and uncaught exceptions are now logged loudly and survived; the daemon is the long-lived owner of active runs and a plugin bug must never take it down.
- d825311: The activity list shows running work first on every path: the retained rows drawn under a failed refresh now obey the same active scope as a healthy list, instead of flooding finished rows to the top exactly when loading hiccups.
- 746b6bc: The tab icon follows the theme. A pixel pi glyph is drawn in the active theme's accent on its background tile and swapped in whenever a theme applies - choose Clay Paper and the tab shows a clay glyph on warm paper. Desktop and home-screen icons stay fixed at install time by platform rules; the tab is the surface that can honestly follow.
- e2b7f2f: The last traces of the upstream domain are gone from living files. The sitemap that advertised the upstream site as this project's canonical identity is deleted, robots.txt no longer points at it, the dev-docs deploy config stops routing to a zone this repository does not own, canonical links point at the repository docs, and the screenshot tooling defaults to a local stack.
- b90f5dd: The durable queue arc survived its own adversarial review. Parked prompts now drain on the runtime's true settle signal with a heartbeat backstop, a refused submission restores the entry instead of destroying it, restart retries settle as duplicates instead of running twice, queue persistence is serialized with corrupt files quarantined and logged, and the unsent-message flush deletes exactly what was accepted - a message discarded mid-flush stays discarded, and another session's unsent rows can never render here.
- e817b08: A pinned reader's ground is the bottom edge, and it stays held even while a finger is down. The old press-freeze let streamed growth slide the bottom-anchored ask card 347px under the finger - the two-tap theft, back through the door built to stop it. Dragging away still flips to reading protection.
- d2d3b1d: One queued representation, structurally: a row whose receipt says Queued always wears the queued card, because the card and the words now read the same fact. The ordinary-card-with-a-stale-Queued costume cannot be rendered any more.
- e733e41: The round-2 review wave. The bottom hold now actually reaches touch: a stationary finger press no longer reads as a scroll gesture, so the phone path holds the ask card still where the first fix only covered mouse and pen. The daemon registers its plugin-failure survival only after startup succeeds, so a failed startup crashes loudly instead of holding the state claim as a zombie. The unsent flush cannot act across a session switch or with an unwired handler. Settled dialogs seed the stale-snapshot guard at the moment they settle, so no old status frame can re-open an answered question, and the dead dismiss plumbing is gone end to end.
- 730222b: A settled dialog never asks for anything again. A cancelled or timed-out extension dialog - the update prompt the owner dismissed more than ten times - rendered as a card with a live Dismiss button under a label that already said "Dismissed without an answer". Every closed reason now renders as the same quiet receipt row the answered branch earned earlier: settled is settled.
- ddca1c5: The quick switcher can no longer show one machine's sessions dressed as another's. After switching machines from the header, the reopened switcher rendered the previous machine's cached rows under the new tab with the new machine's badges, and a tap acted on the wrong machine; the loader now clears rows whose machine is not the one being loaded, and actions key on the machine the displayed rows actually came from. The failed-plugin sentences stop blaming a specific plugin for a shared diagnostic and point at Notifications, which exists.
- 0d519db: A message caught mid-send when the page closes is no longer invisible. The outbox already kept it; now it renders above the composer as Unsent with Retry and Discard, retries automatically on load and on reconnect, and nothing is ever dropped without an explicit acceptance - an unconfirmed handler answer keeps the message instead of silently clearing it.

## 1.202609.15

### Minor Changes

- 3d05e34: Play audio and video workspace files in the file viewer. MP4, WebM, MOV, MKV, OGV, M4V, MP3, WAV, OGG, OGA, M4A, AAC, and FLAC files now open in a native player instead of a download prompt. Media is streamed rather than buffered and answers byte-range requests, so seeking inside a long clip does not refetch it, and clips up to 512 MB preview. Existing image, HTML, and PDF previews keep their previous limits and containment.

### Patch Changes

- 6f186c2: Starting a subagent or background task now tells the browser. The daemon publishes an activity change the moment such a tool starts or ends, and the activity panel refreshes on the event instead of waiting for a poll that was gated by luck.
- 9181eae: Every activation from a browsed machine tab moves the app there first - workspace rows included - and the create row, project filters, badges and selection all empty while browsing elsewhere. The goals panel now also says "not installed" only on the runtime's definite word, and one unrecognized surface value no longer discards the others.
- 10cc6f3: The drawer keeps its room and every tab speaks its own truth: goals-absent no longer hides activity and notifications, failed plugins say so instead of posing as tidy empties, rename and pin from a browsed machine tab move there first, workspace rows land with their project so the session list stops waiting forever, filters reset when the tab changes, and a failed load can actually be retried.
- 49c3fcd: One row per identity, enforced where state is written: duplicate copies of a message collapse at the single transcript write point whatever produced them, a receipt stuck at Queued settles the moment the runtime goes idle without it, and the queued state has exactly one wording on exactly one card.
- 021273b: The activity drawer now tells apart "subagent tools are not installed" from "installed with nothing running". The runtime reports the subagents surface like it already reported goals, and only a definite absence changes the sentence - unknown keeps the ordinary empty line, because absence needs evidence.
- b53fe9f: The quick switcher keeps machines apart under pressure: switching tabs clears the previous machine's rows instead of letting them sit under the new tab's name, a late answer for a tab you already left is dropped, and a failed load reports inside the sheet instead of behind it.
- 3b10225: The pre-ask void judges messages by identity, not words. A captionless photo or a template the runtime expanded still voids the form it predates, and a remark whose words collide with something queued earlier no longer closes the form - the id is the key, text only a fallback for senders without one. The reload banner also stops treating the server's placeholder version as an update.

## 1.202609.14

### Patch Changes

- c09e84b: The background-task poll stops re-proving what cannot change: registry files are re-parsed only when their stat changes, and only a running task's process is probed - finished tasks no longer cost a process spawn per poll.

## 1.202609.13

### Patch Changes

- 9c7cbcd: Speaking beside an open question form no longer closes it when the message is delivered. Only messages that were already queued before the questions appeared void the form - a remark sent in its presence is an addition to the request, and the questions stay answerable.
- d0e4cff: The status bar no longer counts the queue. The queued message's gold card is the one representation of queue state - position included - and the footer counter was a leftover second count of the same fact.
- bf7e68b: A stale tab now knows it. When the server is upgraded, an open page keeps running the bundle it loaded and every fix shipped in between looks still broken; the page now compares versions when it becomes visible and offers a Reload banner - an offer, never an automatic reload.

## 1.202609.12

### Patch Changes

- f38d16f: The app icon is a pi mark now. The old icon was a single horizontal bar; the new one draws a geometric coral pi on a warm dark tile, full-bleed for launcher masks with the glyph inside the safe zone, at every size the manifest and iOS ask for.
- 677e687: The background-task poll no longer reads whole transcripts. It used to read the entire session file - hundreds of megabytes for a long-lived session - on every poll, which starved the event loop and made everything feel stuck. A transcript only grows, so the scan now keeps a watermark and reads just the growth.
- 001cdc3: The quick switcher grows machine tabs: browse and search any machine's sessions without leaving the sheet, and opening one moves the app to that machine first so the session actually opens. While browsing another machine the rows carry no status badges, because those describe the machine the app is on.

## 1.202609.11

### Patch Changes

- 44df0e0: A message that speaks in images renders once. Supersession now compares words and images both, so a photo without a caption replaces its own echo instead of appearing twice, and two different photos sharing a caption are no longer merged into one message.
- 44df0e0: One breakpoint authority for the whole client. Every viewport line is named once and tested against copies, the quick switcher and cleanup dialog join the named lines, context-bar buttons keep the 36px touch floor at every width, and the shell's dead responsive CSS is gone.

## 1.202609.10

### Patch Changes

- bc3ceea: Message card corners cannot break any more: the card clips its children
  instead of trusting them to replicate its curve. Every earlier fix needed two
  drawings of the same arc to agree - a sticky header guessing the card's inner
  curve, latterly through a token in one file consumed by CSS in another. One
  arc, one owner, one file now, with a graceful fallback for browsers that do
  not parse overflow: clip. Verified pixel by pixel at three device pixel
  ratios with a probe-owned palette, against both failure shapes, on every
  card type.

## 1.202609.9

### Patch Changes

- 8e09f58: Two delivery guarantees for bad networks, reviewed and hardened.

  A retried message runs once. The browser resends from its outbox with the same
  identity whenever a response was lost; the daemon now keeps a bounded ledger of
  accepted identities and answers a repeat by repeating the acceptance instead of
  running the prompt again. A deliberate resend carries a fresh identity and is
  never swallowed, and a submission the runtime refused gives its acceptance
  back, so a retry can genuinely re-attempt.

  A recall is announced, not just performed. Taking a queued message back - a
  recall, a queue clear, or pressing stop - now publishes the withdrawn identity
  to every device, so another browser's bubble no longer waits forever on a
  delivery that can never come. The frame is terminal: the line and its outbox
  entry go, and nothing offers to re-send what the reader explicitly took back.
  A withdrawal never names a delivered identity, and a device never deletes a
  row the transcript already claimed.

## 1.202609.8

### Patch Changes

- fd0e17a: Messages survive, live surfaces refresh, and panels say what they know.

  A message is durable from the moment you send it: it enters the outbox before
  the request rather than inside the catch of a settled failure, so closing the
  page mid-send no longer loses it without a trace, and it carries one identity
  from the composer through delivery so a retry revives the bubble you already see
  instead of adding a second one.

  The activity list refreshes when the daemon says it changed. The signal was
  computed, compared and invoked, and nothing ever supplied an implementation for
  it, so the tab counted running work above a list that claimed nothing was
  running.

  A connection that stalls recovers by itself. A socket stuck mid-handshake was
  examined by nothing - no open event, no close event, no scheduled reconnect - so
  the only way back was the manual refresh; and dropping a dead socket detached
  the very handler that would have reconnected it.

  Panels stop overstating what they know. Compaction qualifies the activity chip
  instead of replacing it, so a streaming reply no longer reads as stopped. The
  activity panel
  names the two things it can see rather than declaring the session quiet. A
  subagent run that has not reported says so, instead of "Unknown" beside "Lost".

  Sending a message while questions are open no longer closes them: every question
  carries a Custom answer, so a remark is an addition, not a withdrawal.

  A queued message whose turn ended before it was handed over is sent outright
  instead of parked where nothing would drain it - the "Sent, and then nothing"
  report, and the same fault seen from the other side as a message consumed out
  of order long after it was sent. Recalled-message replay takes the same
  decision at the moment of submission.

  A goals panel that has read nothing can start a read: "not read yet" no longer
  renders as "Loading goals…" with the refresh control disabled, and the drawer's
  panel - the one a phone uses - has a working refresh at all.

  A session whose branch carries a thinking block the provider refuses says why
  every retry fails the same way, instead of a bare 400 that reads as random.

  Renaming a session uses the project's own dialog; the native prompt() it
  replaces is suppressed in iOS standalone mode, so on a phone the control could
  do nothing at all.

  Ask-form option rows meet the coarse-pointer floor, and the Custom row carries
  a drawn divider, so a thumb's few pixels of drift stop answering Custom.

  The transcript stops shaking under a streaming reply, message card corners
  close, and between 761px and 1180px there is once again a control that switches
  workspace tools.

## 1.202609.7

### Patch Changes

- 4dd2c96: Add a shareable full-canvas desktop view for every workspace tool.

## 1.202609.6

### Patch Changes

- 3db462f: Documentation links point at this repository instead of the upstream site

  The README, the docs pages, the example plugin and the Nix package all linked to
  `pi-web.dev`, which is the upstream project's live site and carries its install
  instructions and its package name. Anyone following the README was sent there.
  The rename fixed repository URLs and the package name and missed the domain
  entirely; this finishes it - 78 references across 14 files, plus the banner image
  now served from this repository.

  The two documentation deploy jobs are unchanged and still skipped here, but no
  longer describe themselves as publishing to a domain this project does not own.

- c4f7a0e: Reach another machine's sessions without leaving where you are

  Quick access only ever listed the machine you were pointed at, so finding a
  session elsewhere meant switching machines first and finding your way back
  after. A row of machine tabs now scopes the list. Browsing another machine does
  not move you to it, and the list you see always belongs to the tab you are on:
  switching faster than the read lands shows that it is still loading rather than
  the previous machine's sessions under the new machine's name.

  Project tiles in a row are also the same height again, and a long project name
  no longer runs underneath the actions button beside it.

- c4f7a0e: A message you sent appears once, not twice

  The browser marks its own message so the transcript does not draw it a second
  time, and it does that by an id it mints when you send. Four separate places
  lost that id and fell back to comparing the text instead, which fails whenever
  the text is not what you typed: a slash command the runtime expands before
  queueing, a message whose payload is a screenshot and carries no words at all,
  and a prompt parked while the session was compacting. Pictures were dropped
  from messages that had them for the same reason.

  Sending a screenshot no longer produces two copies with the reply between them.

- c4f7a0e: Panels and sessions say what they actually know

  A transcript could sit on "Loading this session…" for good. Clearing that
  notice was restricted to the read that set it, which is right, but two ways of
  leaving a session advance past a read without starting another one, so nobody
  was left to clear it.

  The Goals drawer asked for room whether or not the plugin behind it was
  installed: an uninstalled plugin and an installed one with nothing in it drew
  the same empty panel. The runtime is now asked directly. A plugin that failed
  to load still shows its panel, so a broken install is visible rather than
  tidied away, and a runtime that cannot answer keeps the panel too - not knowing
  is not the same as knowing there is nothing there.

  A session too young to be written to disk no longer reports "Session not
  found", which is accurate about the machine and misleading to you: the same
  words describe a deleted session. Nor does it invite a first message into a
  session that is not there yet. It says it is still syncing.

- c4f7a0e: Scrolling back through a long session stays where you put it

  Holding your reading position was measured on every frame, which on a long
  transcript meant walking every message and forcing a layout several times a
  second while a reply streamed. The transcript crawled, never quite reached the
  bottom, and snapped back under your thumb. It is now measured only when
  something above you can actually have moved, and never while your finger is
  still on the screen.

  Screenshots load lazily, so scrolling back decodes them as they appear. One
  finishing above you used to carry the page down with it, because the scroller
  turns off the browser's own anchoring and nothing else put your place back.

- 5c3961d: Add read-only Git commit history, shareable review routes, and a lazy multi-file diff view to Git workspaces.

## 1.202609.5

### Patch Changes

- 9ff05b7: Large tool output no longer weighs down a transcript, and stop reaches compaction

  A single transcript page answered a request for a hundred messages with 15.6 MB,
  five tool results accounting for two thirds of it. Tool output is now bounded on
  its way to the browser - on the page as well as on live events, and on the field
  that is actually displayed - cut on whole characters, with the row saying how
  much the whole output weighed so a stump is not mistaken for the end of it.

  Stopping a session also now ends compaction. The runtime counts itself busy
  while compaction runs and offers a way to abort it, which was never called, so a
  session stuck compacting ignored the stop button entirely and new prompts could
  only queue behind it.

- 9ff05b7: A clay theme pair, in warm ink on paper

  Two new themes drawn from Anthropic's published brand palette: Clay for dark
  and Clay Paper for light, registered as a pair so the system light/dark
  preference can switch between them. Their neutrals and accents are the
  published values; two were darkened to stay readable as text rather than only
  as fills, and a contrast test now holds both themes to 4.5:1 for body text
  against the page and against a raised surface.

- 9ff05b7: Dictation writes what you said, once, and hears the end of the sentence

  Microphone audio was sent as a text frame. The speech service carries audio in
  binary frames and discards anything else without an error, so speaking produced
  nothing at all: no text, no failure, no clue. Audio now travels in the frame the
  service reads, which was confirmed against the live endpoint - the same token
  and the same samples answered only `turn.start` as text and the full
  recognition sequence as binary.

  That exposed two more faults on the path behind it. Live dictation reports
  everything it has heard so far on every update, and the composer appended each
  report to the last, so "hello world" arrived as "hello hello world" and grew
  with every interim result; a report now replaces the span dictation owns and
  leaves anything typed by hand alone. And stopping closed the connection without
  the empty chunk that declares the utterance over, so stopping mid-sentence
  dropped the final words.

- 9ff05b7: A message is marked delivered on evidence, and a command reports what it did

  A sent message was promoted to delivered whenever the current queue snapshot
  omitted it. A snapshot omits a message for several ordinary reasons - while the
  agent expands a prompt, between taking it and writing it, and whenever its id
  could not be stamped on at all - so one message could appear twice, as two cards
  in different states, or vanish. Delivery is now proved by the agent's committed
  copy, and pending rows are keyed so they cannot collide with history and make
  the transcript jump.

  Command receipts were settled by whether the request threw, so a refusal the
  server returned successfully still showed a green "done" beside the server's own
  "not implemented" line. A receipt now reports the outcome, and a command whose
  answer is a dialog leaves no receipt behind rather than one stuck pending
  forever.

- 0941a39: Prefix web browser tab titles with the Pi mark for faster recognition.
- 9ff05b7: A transcript no longer claims to be empty while it is still loading

  "Empty" was standing in for two different states. A session whose history had
  not arrived yet said "This session is empty" and offered to write the first
  message, then dropped the history on top of it. Loading and empty are now
  distinct, and the loading state belongs to the selection that started it, so
  switching sessions while one is still arriving cannot make the other look empty.

- 9ff05b7: A waiting card can be read to the end, and reading holds its place

  A card asking a question was held outside the transcript with a height budget,
  so on a phone its own confirm buttons fell past the fold and the page would not
  scroll to reach them. It is now the last row of the transcript, in normal flow,
  with nothing pinned inside it, so it can be read at any length.

  Separately, growth above the viewport used to move a reader who had scrolled up,
  because this scroller turns off the browser's own scroll anchoring. A reader who
  is not pinned to the bottom now keeps their place while new content arrives.

## 1.202609.4

### Patch Changes

- 8a02442: Tapping a control no longer flashes the platform's dark blue block or waits out the double-tap-zoom delay. A shadow root inherits nothing, so each component had to declare `-webkit-tap-highlight-color` and `touch-action` itself and most never did — the session list, the project list, the quick switcher, the settings dialog and the app shell among them. The declarations now live once and every component includes them, with a contract test that fails when a component drawing a control omits it. A message card's top corners also no longer show a notch: the header is pulled flush with the card's edge, so it rounds by the card's radius rather than a smaller one.

## 1.202609.3

### Patch Changes

- Install instructions and asset links point at this project instead of the repository it grew out of. The docs told readers to `npm install -g @jmfederico/pi-web` — a real but separate package last published in August — and the Docker one-line installer fetched its script from that repository, so anyone following the published guide installed something other than what these docs describe. Repository links, raw asset URLs, and package names across the site, the Docker guide, and the skills README now name this repository and the package it actually publishes. The LICENSE keeps its original copyright and adds the project's contributors.

- PI WEB is now published as `@gang-of-beads/pi-web`, under the organization that owns the project, instead of a personal scope. Install with `npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty`; plugin authors import `@gang-of-beads/pi-web/plugin-api` and `@gang-of-beads/pi-web/server-plugin-api`. The previous package name is deprecated with a pointer to this one and stops receiving releases, so an existing global install must be reinstalled under the new name rather than updated in place.

## 1.202609.2

### Patch Changes

- c57f2bb: Typing `/` offers commands again in a session whose workspace has not resolved yet. The composer looked up slash commands against the selected workspace's directory alone, and that lookup is guarded on a non-empty directory — so a session opened before its workspace listing landed (or a route restored session-first) silently offered no completions while the rest of the composer kept working. The composer now falls back to the directory of the session it is composing into.
- 6c0c91c: An assistant reply no longer renders twice when its own tool runs land between the streamed text and the final message: the finalizer now walks back over the reply's tool rows to replace the half-done line in place.
- 9417e66: Keep the app shell aligned with iOS Safari's visual viewport when focusing the composer, so the keyboard does not leave the input offscreen.
- 0638282: Fix Nix package dependency resolution and validate the installable Nix package in CI.
- cdf1eda: The turn clock counts from the turn's own start rather than from when a tab first looked at it. The session status now carries `turnStartedAt` — the transcript's last input boundary, published while the session is working — and the transcript clocks from it. A tab that joins mid-turn, reloads, or reconnects shows the elapsed time the turn has actually been running instead of restarting the count, which is what made a long turn indistinguishable from a stuck one. A daemon that does not publish the field degrades to the previous first-sighting anchor.
- 8b27699: A waiting card's actions stay on screen. The question and dialog cards each carried their own height cap, so a tall one — an ask-user question with many options, a task-confirmation dialog above a queue strip — pushed its confirm buttons below the fold of an inner scroller the thumb could not drive. The height budget now lives once in the waiting slot: the slot owns it, every card fills it as a flex column whose body is the single scroller and whose action row never scrolls away, and a new waiting card inherits the contract instead of needing a cap of its own.

## 1.202609.1

### Patch Changes

- Correct package repository metadata so npm provenance identifies the active PI WEB source repository.

## 1.202609.0

### Patch Changes

- 598e19b: Avoid periodic detached-work scans while filesystem watches are healthy and no background work is running, while preserving immediate watcher refreshes and fallback reconciliation.
- e142cd6: Bound the browser's in-memory transcript cache to recently used sessions so long-lived tabs release history from older conversations.
- f85c356: Bound session replay memory and disconnect slow realtime clients so long-running daemons recover through reconnect/resync instead of accumulating buffered data.
- 7a6fb43: Reduce session daemon heartbeat overhead by sharing background-work scans, suppressing unchanged activity projections, and aggregating workspace activity in one pass.
- 33e915f: Refresh detached task and subagent status promptly when their runtime files change, while retaining periodic reconciliation when filesystem watching is unavailable.
- 21d1d24: Apply immutable caching to hashed client assets on Windows hosts as well as POSIX hosts.

## 1.202608.78

### Patch Changes

- 0e1f150: Improve iPhone and iPad Safari home-screen installation with standalone app metadata, icon sizing, and installation guidance.
- f05f006: Add reproducible Nix flake packages and Home Manager service configuration for NixOS and Apple Silicon nix-darwin.
- f816309: Update the pi SDK to 0.84.4 (both packages together, which is what makes the earlier attempt's type conflicts disappear).
- 92cb024: Reorganize `src/server` by process ownership: modules loaded only by the web/API process now live under `src/server/web/`, session-daemon-only modules under `src/server/daemon/`, and modules shared by both processes under `src/server/shared/`. The former `src/sessiond/` daemon client moved to `src/server/shared/sessiondClient/`, and the mixed `src/server/sessiond/` directory was dissolved into its web and daemon sides. Entry points (`src/server/index.ts`, `src/server/sessiond.ts`) and published bin paths are unchanged; no runtime behavior changes.

## 1.202608.77

### Patch Changes

- dcb48a2: The waiting dialog's action row stays on screen: long details (task lists, contracts) cap and scroll inside the dialog card, and the waiting slot no longer scrolls the whole card — the confirm buttons no longer land below the fold of an inner scroller when a queue strip shares the screen.
- d30de52: A tool call whose turn died (e.g. a daemon restart mid-tool) now displays as "interrupted" instead of "pending" forever: pending means work in flight, and with no live turn the result is never coming.

## 1.202608.76

### Patch Changes

- de0486d: A reload whose projects listing fails now retries the restore instead of landing on "Select or start a session." — the route survives and re-restores once the listing recovers.
- 2f6ea60: The activity chip says "compacting" during /compact instead of the generic "updating session": the entry mutation the compaction runs inside no longer masks the specific state.
- 20b2aa4: Command receipts stay until read (no-auto-leave) but can now be closed by hand: settled rows get a dismiss button. Pending rows are live work and refuse dismissal.
- de0486d: Goals from another project no longer appear in the goals panel: the goals read only unions a session directory that lives inside the selected workspace.
- de0486d: A reconnect no longer erases the selected session's status when the status catalog transiently omits it — the indicator row (streaming dot, token stats) stays until a live frame corrects it. The queued-message area also reconciles against the daemon's queue state.
- 5ecd5ae: Remove the interface size setting from Appearance. It did not apply on real devices, and a control that does nothing is a lie; the panel keeps themes and the system switch.
- f9ca15e: Hours-old subagent runs that never wrote anything now report as Lost instead of Unknown when the parent is not streaming: the launch-grace silence rule applies to both branches. Unknown stays for the young window where nobody genuinely knows yet.

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
