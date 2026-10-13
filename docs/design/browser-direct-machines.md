# Browser-direct machines

Owner, 2026-10-13: connections to other machines go out from the browser, not from the server.
This page was the design corrected on paper before code.

Status: built 2026-10-13 with decisions 1b, 2a, 3a and 4 below (`src/server/web/machineAccess/`,
`src/client/src/directMachineUrl.ts`, `fleetFanOut.ts`, `pi-web-plugins/machines/browser/MachineDialog.ts`).
The "This server" path below is still the one a machine takes when it is set to connect from the
server. Part 2 (token authentication) is not designed.

## Before: the server you opened was a gateway

- The browser talks to one origin, the PI WEB it opened. Every machine-scoped call is an
  application path `api/machines/<id>/…` (built in `src/client/src/api/clients.ts`, `urls.ts`,
  `sockets.ts`, `pluginBackends.ts`, and the plugin loader in `PiWebApp.ts`).
- For a remote id the web process forwards: HTTP through the allowlist in
  `src/shared/federatedRoutes.ts` (`src/server/web/machines/machineProxyRoutes.ts`), WebSockets by
  bridging two sockets, and plugin manifests/modules through `machinePluginProxyRoutes.ts`.
- `pi-web-plugins/machines` keeps the list in the gateway's `machines.json` (`baseUrl`, optional
  `token`, optional `headers`) and checks health and runtime from the server.
- The token and headers are added by the gateway (`machineClient.ts`), for an authenticating proxy in
  front of the remote: PI WEB itself checks no token and answers no cross-origin request.
- Fleet operations (update/restart every machine) fan out from the server (`updates/fleetRoutes.ts`).
- The page's "cannot reach machine *m*" state is read from the gateway's own 502/504 bodies, which
  name the machine (`docs/design/object-model.md` section 7, `state-diagram.md` link rows).

Consequence: a machine the browser can reach but the gateway cannot (a phone on a network the
gateway is not on) cannot be used, and every remote byte takes two hops.

## Target: the browser connects to each machine

Each PI WEB already serves itself under `api/machines/local/…` and `pi-web-plugins/…`. A remote
machine *m* with base URL *B* is reached at `B/api/machines/local/…` and `B/pi-web-plugins/…`, from
the browser, with no gateway in between. The PI WEB you opened still serves the page and its own
machine, and keeps the machine list.

### Browser side

- **One resolver.** A machine connection names where *m* is: `local` resolves to the page's own
  origin (today's `resolveAppUrl`), a remote to its base URL. Every machine-scoped HTTP, WebSocket,
  image, preview, download and plugin-module URL goes through it, so the AGENTS.md URL rule ("resolve
  each reference exactly once at the browser boundary") keeps one place: `machineUrl(machine, path)` and
  `machineWebSocketUrl(machine, path)` next to `resolveAppUrl`.
- **Requests.** JSON calls to a remote use `fetch` with `mode: "cors"`, no cookies. A remote that needs
  a token gets it as `Authorization: Bearer`, which only works for `fetch`; see "Gated machines".
- **Sockets.** The four socket kinds (session events, workspace terminal, machine terminal, machine
  announcements) open to the remote directly.
- **Plugins.** The remote's manifest and modules load from `B/pi-web-plugins/…`; the machine-scoped
  plugin ids (`machine.<id>.<plugin>`) are derived in the browser as today in `external.ts`.
- **Reachability.** A request that gets no answer from *B* (a network error, a timeout) is
  `machine-unreachable(m)` from this browser, a new producer for the same row state. Health and runtime
  are read from *B* by the browser, so Online/Offline means "from this device", which is what the
  reader can act on.

### Machine side (every PI WEB that can be a remote)

- **Cross-origin answers, allowlisted.** The web process answers CORS preflights and adds
  `Access-Control-Allow-Origin` only for allowed origins. An unlisted origin gets no CORS headers, so
  a random web page in the same browser still cannot drive the machine (PI WEB has no login; the
  browser's same-origin rule is what protects it today).
- **Where the allowlist lives.** Approved origins are PI WEB-managed state:
  `$PI_WEB_DATA_DIR/machine-access.json`, beside `machines.json` (the user config file can be
  read-only, as on nix-managed hosts). Each entry records the origin, the name the requesting page
  gave, and when it was approved. Settings on that machine lists them with Remove.
- **Access is requested and approved (owner, 2026-10-13: request, then the other side approves).** A pairing
  in the manner of a device code:
  1. "Add machine" on the page you opened (origin *A*) sends `POST B/api/machine-access/requests`
     from the browser. This is the one endpoint *B* answers for any origin; it can only leave a
     request. *B* takes the origin from the browser-set `Origin` header (a page cannot forge it) and
     answers a request id and a short pairing code.
  2. The page shows the code and a link to *B*'s own approval page for that request (owner,
     2026-10-13: a link carrying a device code that opens the other machine's approval page). The
     link carries the request id; opening it does nothing by itself.
  3. *B*'s approval page names the requesting origin and the name it gave, shows the code, and
     offers Approve and Deny. The reader approves when the code matches the one on the requesting
     page, so a look-alike request from another site is not approved by mistake. Approval is a call only
     *B*'s own page can make; an approved page from another origin is refused (403). There is no pending list in
     Settings: a request lives as long as its link, ten minutes.
  4. The requesting page polls `GET B/api/machine-access/requests/<id>` (also any origin; the id is
     unguessable) and finishes adding the machine once approved.
- **Request hygiene.** Pending requests live in the web process's memory and expire after ten
  minutes; a new request from the same origin replaces its earlier one; at most twenty wait at once.
- **Removing a machine** asks *B* to forget *A*'s origin (an approved origin may do that for itself).
  If *B* cannot be reached then, the entry stays and *B*'s Settings can remove it.
- **When the browser cannot reach *B*** at all, browser-direct is impossible anyway; *B* is used
  through "this server", which needs no approval.
- **Older machines** without the allowlist API cannot be reached from the browser; they stay on
  "this server" (decision 1b).
- **Who is asking is the browser's word, not the Host header's.** HTTP requests are classified by
  `Sec-Fetch-Site`, which the browser sets from the page's origin and which no proxy rewrites:
  `same-origin` is the machine's own page; `cross-site` or `same-site` with an approved `Origin` is
  an approved page; any other cross-site request is unapproved. A request without the header and
  without `Origin` is not a browser (the "this server" path, curl) and is not affected. A request
  with `Origin` but without `Sec-Fetch-Site` (an old browser) keeps today's behaviour. Comparing
  `Origin` with `Host` was rejected: a reverse proxy that rewrites `Host` (nginx's default) would make
  the machine's own page look foreign. Measured in Chromium, 2026-10-13.
- **Unapproved cross-site writes are refused (403).** Today any web page can send a body-less POST
  ("stop the session") to PI WEB with `mode: "no-cors"`; the browser sends it, PI WEB acts, and only
  the answer is hidden. The approve endpoint would have the same hole, so the rule is global: a
  request that is not GET, HEAD or OPTIONS from an unapproved cross-site page is refused.
- **WebSockets: no origin check yet.** Browsers send no `Sec-Fetch-Site` on a WebSocket handshake
  (measured), so the only signal is `Origin` against `Host`, the comparison rejected above.
  Browser-direct needs no change here (every upgrade is accepted today). Closing the gap that a
  cross-site page can open a socket is a follow-up for the owner, with the proxy risk stated.
- **Plugin assets** under `pi-web-plugins/` answer CORS for the same origins, since ES modules from
  another origin need it.
- The session daemon is untouched: it is still reached only by its own web process.

### Requirements on the network

- A page opened over https can only call https machines (mixed content), so each machine is served
  over https, for example behind a TLS reverse proxy.
- A machine must run a PI WEB version with the cross-origin support above.

## Decisions

Owner, 2026-10-13: 1b (per machine, browser by default), 2a (the list stays on the PI WEB you
open), 3a (the browser fans out), and for 4: "Add machine" requests access and the remote
approves it in its Settings, with a pairing code to compare; token authentication is a separate,
optional part the user configures (Part 2 below).

1. **What happens to the server path.**
   - (a) Browser only: remove the gateway forwarding. Simplest model; a machine the browser cannot
     reach, or a machine behind a header gate, is unusable from that page.
   - (b) Per machine, "Connect from: this browser / this server", browser by default. The forwarding
     code already exists, so a gated or browser-unreachable machine keeps working. Two paths to keep
     correct.
2. **Where the machine list lives.**
   - (a) On the PI WEB you open, as now: every device that opens it sees the same machines, and their
     tokens reach the page (consistent with the 2026-10-13 settings ruling: whoever opens PI WEB can
     already reach these machines through it).
   - (b) In each browser: nothing on the server, but every phone and laptop is set up separately.
3. **Who fans out "update/restart all machines".** (a) The browser, so "all" means the
   machines this page shows and reaches; (b) the server, as now.
4. **How a remote learns which origins to allow.** Requested by "Add machine" and approved on the
   remote (see Machine side); hand-edited allowlists, tailnet-wide patterns and a gateway writing the
   allowlist server to server were considered and not chosen.

## Part 2: optional token authentication (separate design)

A user may configure an access token on a machine; requests that must present it are refused
without it. Not designed yet: which requests must carry it (other machines only, or also the
machine's own page with a sign-in), how URLs that cannot carry a header (images, previews,
downloads, WebSockets) present it, and how it relates to today's `token` field, which serves an
authenticating reverse proxy in front of the machine.

### Gated machines

A machine behind an authenticating proxy (`token` or `headers` today) cannot be reached by plain
`<img>`, preview or download URLs from the browser, because those requests cannot carry a header.
With 1a such a machine needs the proxy to accept a token in the query string or a cookie; with 1b it
stays on "this server". It affects only deployments that put such a gate in front of a machine.

## Slices (built 2026-10-13)

1. Machine side: the access store, the request/approve API, CORS on `api/` and `pi-web-plugins/`
   for approved origins, the refusal of unapproved cross-site writes, the approval page, and the
   Settings list of approved origins.
   Daemon untouched; web process restart only. Docs: `docs/machines.md`.
2. Browser: the machine resolver and every machine-scoped URL through it; sockets; plugin loading.
3. Browser: reachability producer, health and runtime read directly.
4. Machines dialog: base URL probe from the browser on Add; the "Connect from" choice if 1b.
5. Fleet fan-out per decision 3.
6. Gateway forwarding: removed (1a) or kept as the "this server" path (1b).

Each slice was reviewed, then checked live on a dev stack with a second PI WEB on another host over
https, on a phone layout at 393x850, including a machine this browser cannot reach.

## Not changing

- The session daemon, its protocol, and session ownership.
- Where projects, sessions, credentials and plugin settings live: on their own machine.
- Plugin ids and the machine-scoped plugin id scheme.
