# The extension bus

Owner, 2026-11-24: can an extension expose an extension point or an interface over PI WEB's own
transport, so it reaches the page whatever the network is (localhost, a tailnet, a gateway in
between)? "The philosophy matters most."

## Philosophy

1. **pi's mechanism, PI WEB's transport.** pi already has one way for extensions to talk:
   `pi.events.emit(channel, data)` and `pi.events.on(channel, handler)`. PI WEB adds no second API for
   extensions. It carries that bus to the page. An extension that talks to another extension in the
   terminal talks to its web part the same way, and keeps working where there is no PI WEB.
2. **The owner of a fact publishes it.** A web part draws what its extension says. It does not rebuild
   the extension's state from files, the transcript or `ps` (what `background-runs` does today).
3. **Core carries, it does not understand.** Core knows channels, scopes and limits. It never knows
   what a payload means, with one exception it defines itself: the `piweb` namespace, which is how an
   extension speaks to the shell.
4. **A value travels with its scope.** Every message is addressed by machine + session + channel.
   Nothing published in one session is shown in another.
5. **Absence is not negation.** A channel nobody has published on is unknown, not empty.
6. **Opt in, by declaration.** Only declared channels leave the session. What extensions say to each
   other privately stays private, and the page is not flooded.

## In the terminal

Nothing changes there. pi's core neither emits nor listens on `pi.events`; an emit nobody listens to
does nothing; a handler that throws is caught and logged by pi. An extension that publishes its state
for PI WEB costs the terminal one no-op call per change.

What the bus lacks, and the bridge supplies by convention: a reply, a retained value, and knowing who
emitted. It has no payload rule either; the bridge carries JSON and refuses the rest.

## What exists

- `pi.events`: a string channel and JSON-like data, no reply, no retention. The SDK lets the host
  supply the bus (`DefaultResourceLoader({ eventBus })`), so the session daemon can own one per session
  and see everything that is emitted on it.
- Plugin `operations`: a server part's named request/response, called from its browser part with
  `callOperation`, carried by the gateway to the right machine. Machine-scoped, pull only.

## The model

### Scope

One bus per session, as in pi. A channel is addressed `machine / session / channel`. Operations stay
the machine-scoped form (things that exist with no session open: a store, a list of runs).

### Names

pi has no namespace registry; it names things by an owner prefix and a colon, by convention. The
channels extensions use today are `subagent:async-complete`, `subagent:slash:request` answered on
`subagent:slash:response`, `herdr:busy`, `patty:finished`; skills are `skill:<name>`, built-in
extensions `builtin:<name>`, keybindings `app.*` and `tui.*`. A tool name is flat and a second
registration of it is an error. PI WEB follows that and adds nothing heavier:

`<owner>:<name>`

- A channel is declared by its full name, exactly as the extension already emits it, so an existing
  extension is bridged without renaming anything.
- `owner` is the text before the first colon. The first package to declare a channel under an owner
  owns that owner on the machine; a second package declaring under it is a conflict, reported like a
  duplicate plugin id, and its channels are not bridged.
- Reserved owners: `pi`, `piweb` (the shell's own channels), `core`, `machine`.
- A request is answered the way pi-subagents already does it: asked on `<channel>:request`, answered
  on `<channel>:response`.
- `error` is never a channel: Node's emitter throws on it when nobody listens.

### Declared channels

```json
"piWeb": {
  "bus": {
    "background:runs":     { "kind": "state" },
    "background:finished": { "kind": "event" },
    "background:stop":     { "kind": "request" },
    "background:counts":   { "kind": "state", "access": "public" }
  }
}
```

Three kinds, all built on `emit` and `on`:

| Kind | Who emits | What the daemon does | Page side |
|---|---|---|---|
| `state` | the extension | keeps the last value per session and sends it to every subscriber, a late one included | `bus.state(channel)` gives the value or unknown, and changes |
| `event` | the extension | sends it to current subscribers; nothing is kept | `bus.on(channel, handler)` |
| `request` | the page | emits `{ id, input }` on `<channel>:request`; the extension answers by emitting `{ id, result }` or `{ id, error }` on `<channel>:response`; the daemon returns it, or a timeout | `bus.request(channel, input)` resolves or rejects |

`access`: `own` (default) means only the declaring package's web part may subscribe or ask. `public`
makes the channel an extension point: any plugin may read a public `state` or `event`, or call a
public `request`. That is how one package exposes an interface to another.

An extension needs nothing but `pi.events`.

### The `piweb` namespace: speaking to the shell

The shell's insertion points that an extension, not a web part, should feed are channels in `piweb`,
keyed by the publishing namespace:

- `piweb:states:<owner>`: the session states this extension declares
  (`[{ id, label, tone, busy, count? }]`). This is how `background` leaves core: pi-background-tasks
  and pi-subagents publish their own. A package with no web part and no server part can declare a
  state.

More can follow the same shape (notices, list labels) when something needs them; none is added now.

### Carrying it

- The daemon owns each session's `EventBus`, forwards declared channels over the session's existing
  socket, and delivers requests into it. Across machines it rides the routes every session frame
  already uses (direct or through the gateway), so the access token and origin approval apply
  unchanged. No new port, no new address.
- JSON only. A message over 64 KiB is refused and the extension's emit is reported once in the
  session's warnings. A `state` channel keeps one value; `event` channels are rate-limited per
  channel, and a dropped burst says how many were dropped.
- A session whose runtime is not open has no bus: `state` reads as unknown. Nothing is persisted by
  PI WEB; an extension that wants its state after a restart publishes again on `session_start`, as it
  restores anything else.

## The page side (PR 2)

Status: proposed. Owner, 2026-11-25: a web part reads the bus of the session on screen, as a pi
extension reads its own session's.

### What a web part gets

`context.session.bus`, on the same object that carries `runCommand`: present while a session of this
workspace is on screen and its machine's PI WEB carries the bus; absent otherwise, so feature-detect.

```ts
const bus = context.session?.bus;
const runs = bus?.state("background:runs");          // { known: false } | { known: true, value }
const stop = bus?.onState("background:runs", (state) => redraw(state));
const off  = bus?.on("background:finished", (event) => toast(event));
const answer = await bus?.request("background:stop", { id });   // resolves a value, or rejects with a reason
```

- **Scope.** The handle is bound to the session it was made for (machine + session). When another
  session comes on screen it reads unknown, its listeners stop, and a request rejects
  `session-changed`: rows read for one session never act on another.
- **Unknown is a value.** `state` answers `{ known: false }` until the extension has published in this
  runtime, when the runtime is not open, and for a channel the caller may not read.
- **Access.** `own` channels are readable by the plugins declared in the same `package.json` as the
  channel; `public` ones by any plugin. A read or a request the caller may not make is refused by the
  daemon, not hidden by the page.

### On the wire

- The session's stream snapshot gains `bus: { revision, states: { [channel]: json } }`, read in the
  same tick as the stream position, so a page seeds from it and applies only later frames.
- New session frames, replayed like any other: `{ type: "bus.state", channel, value?, revision }`
  (`value` absent: the channel has no value any more) and `{ type: "bus.event", channel, value }`.
  `piweb:states:*` keeps travelling in the status, as #105 built it; it is not sent twice.
- `POST sessions/:id/bus/request { cwd, channel, input, pluginId }` answers `{ result }` or
  `{ error: { code, message } }`. Codes: `not-declared`, `not-allowed`, `no-runtime`, `too-large`,
  `not-json`, `timeout`, `extension-error`.
- The daemon emits `{ id, input }` on `<channel>:request` and waits for `{ id, result }` or
  `{ id, error }` on `<channel>:response`; 30 s without an answer is `timeout`. A request does not
  open a runtime that is not open: it answers `no-runtime`.
- Limits, both directions: JSON only, 64 KiB a value. Events: 20 a second a channel; a dropped burst
  is announced once with its count.

### Modules

- `daemon/extensionBus/sessionExtensionBus.ts` (exists): gains events, requests and a revision; still
  knows nothing of plugins.
- `daemon/extensionBus/busAccess.ts` (new, pure): who may read or ask a channel, from the channel's
  declaration and the asking plugin's package.
- `shared/extensionBusFrames.ts` (new): the frame and error shapes and their parsers, for both sides.
- `client/src/plugins/sessionBus.ts` (new): the handle above over the session stream; one per plugin
  and session, dropped with either.

### Not in this step

Reading another session's bus; a retained event; streaming or binary values; a server part's access
to the bus (it has `operations`).

## What changes for existing plugins

- `backgroundWork` (a server part's count) stays one release as a shim: its number becomes a declared
  state named `background` owned by that plugin.
- `background-runs`, `subagents`, `workflows`, `goal`: the extension publishes its runs or goals as
  `state`; the web part draws them; requests replace the web part's writes into another package's
  directory.

## Not in this proposal

- Extension-to-extension calls across sessions or machines.
- Binary payloads or streams.
- Persisting bus state in PI WEB.
