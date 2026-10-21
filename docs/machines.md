# Machines

Most PI WEB setups need one machine. When agents work in more than one place, add the other PI WEB machines to the PI WEB you open, and switch between them from one page. Each machine keeps its own repositories, credentials, sessions, Pi packages and plugins.

- [Machines and the list](#machines-and-the-list)
- [This browser or this server](#this-browser-or-this-server)
- [Add a machine](#add-a-machine)
- [Remove a machine](#remove-a-machine)
- [What works on a selected machine](#what-works-on-a-selected-machine)
- [Credentials stay on each machine](#credentials-stay-on-each-machine)
- [Plugins follow the selected machine](#plugins-follow-the-selected-machine)
- [Update and restart machines](#update-and-restart-machines)
- [Which pages may use a machine](#which-pages-may-use-a-machine)
- [Trust boundaries](#trust-boundaries)
- [Troubleshooting](#troubleshooting)

## Machines and the list

A machine is a PI WEB runtime: a session daemon and its web/API server. The PI WEB you open is the local machine and is always listed. Other machines are ones you add with their base URL.

The list lives on the PI WEB you open, in `machines.json` in its data directory (`~/.pi-web`, or `PI_WEB_DATA_DIR`; `PI_WEB_MACHINES_FILE` moves the file). Every device that opens that PI WEB sees the same machines.

A foreground **Machines** list, in Navigate or Settings, immediately checks every listed machine and keeps checking while the list is visible and actionable. Selecting another machine does not narrow the checks to it; the row tap also leaves this list for that machine's sessions, and returning checks every card again immediately. Hiding the page or leaving the list pauses its checks; returning checks again immediately. An open modal pauses machine lists outside that modal, including a visible background sidebar. A Machines list inside the current Settings modal continues checking. Ordinary row selection is not a modal. Other session and data activity continues independently.

**Online** confirms that both the web/API server and session daemon answered as available. Healthy checks repeat every 15 seconds. Unanswered checks retry after 1, 2, 4, 8, then at most 15 seconds, with a 30-second request budget including response bodies. After 10 seconds without an answer the card says Trying; after 30 seconds it says **Offline**. Both are measured from the check that got no answer: a healthy machine is rechecked every 15 seconds, so Trying can appear up to 25 seconds, and Offline up to 45 seconds, after a machine goes away. An answered server error or explicit daemon-unavailable reply shows its reason instead. A completely stalled daemon, or a front proxy answering 502/503/504, counts as no PI WEB answer and follows Trying → Offline; nested 30-second timeouts do not guarantee that an inner error arrives before the browser's deadline. Offline means PI WEB could not be reached through the chosen path, not proof that the computer is powered off. Availability checks only update machine cards; they do not change chat synchronization notices.

Until the page's first check of a machine concludes, its card shows the last state this browser observed for it, unchanged: Online, Trying, Offline, Unknown or an answered error. It changes only on an answer, an answered error, or Trying and Offline on the timing above. Before the machine has answered the page, Trying does not replace a remembered Offline, Unknown or error, which stays until an answer or 30 seconds; once it has answered, a check without an answer follows Trying → Offline as above. Trying is kept, so a machine that stopped answering during a visit of 10 seconds or more opens on Trying next time, not Online; after a shorter visit it opens on its earlier state. Leaving the list and returning keeps each machine's state: a machine that read Trying still reads Trying and keeps its clock, while a check left before it reached Trying starts over on return. An answer from before leaving counts as remembered until the machine answers again, and browser plugins see such a machine as checking. This browser keeps one state per machine and PI WEB server (address and base path), tied to the machine's URL and connection mode, for at most 7 days. A changed URL or connection mode, a removed and re-added machine, or a state older than 7 days starts from **Checking…**, as does a machine with no state kept in this browser. A rename keeps the state; after a token change the old state shows until the first check concludes. Removing a machine forgets its state.

## This browser or this server

Each machine you add is reached one of two ways, chosen when you add it:

| | This browser (default) | This server |
| --- | --- | --- |
| Who talks to the machine | Your browser, directly | The PI WEB you opened, which forwards the page's traffic |
| The machine must be reachable from | The device you browse from | The PI WEB you opened |
| Setup on the machine | Approve this page once, comparing a pairing code | None |
| Token or extra headers | Not supported | Supported |
| The machine requires an [access token](install.md#require-an-access-token) | Not supported | Supported |
| Availability is checked from | This device | The PI WEB you opened |

Choose **This server** when:

- the machine is reachable from the PI WEB you opened but not from your device;
- the machine requires an access token, or an authenticating proxy in front of it needs a token or headers (a browser cannot add them to images, previews, downloads or WebSockets);
- the machine runs a PI WEB older than 2.202610.5, which cannot answer a browser directly. Adding such a machine with **This browser** says that it does not answer browser access requests and suggests **This server**.

With **This server**, the token you enter is sent as an `Authorization: Bearer` header on every forwarded request: the machine's own access token, or a token its authenticating proxy needs. Extra headers have no field in the dialog; set them as `headers` in the machine's entry in `machines.json`. When the proxy and the machine's access token both need a credential, enter the proxy's token in the dialog and add the access token as a header:

```json
"headers": { "X-PI-WEB-Access-Token": "<the machine's access token>" }
```

The PI WEB you opened never forwards your browser's cookies or `Authorization` header to a machine, and never passes a machine's cookies back. Machines added before browser access existed stay on **This server**.

To change how a machine is reached, remove it and add it again.

### HTTPS

A page opened over `https://` can only reach machines at `https://` URLs; the browser blocks plain `http://` requests from a secure page. If you open PI WEB over HTTPS, serve every machine you reach with **This browser** over HTTPS too (for example through the HTTPS reverse proxy or VPN tool you already use), or use **This server** for it.

## Add a machine

1. Install and run PI WEB on the other machine ([install guide](install.md)), and make it reachable from your device or from the PI WEB you open, through a private path: a VPN such as Tailscale, NetBird or WireGuard, a private LAN, an SSH tunnel, or an authenticated reverse proxy.
2. In the PI WEB you open, choose **Add machine** on the Navigate page, in **Settings → Machines**, or from the action palette.
3. Enter the machine's base URL, including `http://` or `https://`. If it is served under a path prefix, include the prefix, for example `https://devbox.example.test/pi-web`. Do not put credentials, a query string or a fragment in the URL.
4. Accept the suggested name or enter your own.
5. Choose **Connect from: This browser** or **This server**. A machine that requires an access token needs **This server**. For **This server**, paste the machine's access token or the token its proxy needs, if any, then choose **Add machine**.

For **This browser**, choose **Request access**. The dialog then shows a six-digit pairing code and an **Open *name* to approve** link:

1. Open the link. It opens the machine's own PI WEB on an approval page that names the page asking for access (its address and the name it gave) and shows a code.
2. Check that the code matches the one in the dialog, then choose **Approve**. Approving lets that page do everything you can do on the machine: run sessions, read and change files, open terminals. Approve only a page you opened yourself.
3. Back in the dialog, the machine is added as soon as the approval arrives.

A request waits up to ten minutes. If it runs out, or the machine restarts meanwhile, the dialog asks again by itself with a new code. **Deny** is final for that request: the dialog says the machine denied the page. Only the machine's own page can approve or deny; a page from another machine that the machine already approved cannot.

Approval is per page address (scheme, host and port). If you open the PI WEB you add machines from under another address, such as `localhost` on one device and a VPN name on another, each address asks for its own approval.

## Remove a machine

Remove a machine in **Settings → Machines**. Removing it deletes it from the list on the PI WEB you opened and changes nothing else on the machine: its projects, sessions and credentials stay.

For a machine reached with **This browser**, removing it also asks the machine to forget this page's access. If the machine cannot be reached at that moment, the access stays; remove it in that machine's **Settings → Machines**.

## What works on a selected machine

After you select a machine, the rest of the app works in that machine's scope:

- projects and workspaces;
- files, previews, and workspace features such as Git status and diffs;
- Pi sessions, transcripts, prompts, model controls and commands;
- activity indicators and live updates;
- terminals and terminal command runs;
- Pi package list, install, remove and update in **Settings → Pi Packages**;
- the machine's own browser plugins and their server entries.

Settings tabs name the machine they edit. Pi packages, PI WEB plugins, session daemon options, external file access, upload defaults, logs and the update command apply to the selected machine. Host, port, allowed hosts, the machine list and keyboard shortcuts stay with the PI WEB you opened. See the [configuration reference](config.md).

## Credentials stay on each machine

Model-provider credentials, Pi configuration and package settings, plugin settings, OAuth state, repositories and session runtimes stay on the machine that owns them. The PI WEB you open does not copy them.

- API-key provider configuration works from any page that reaches the machine.
- Subscription (OAuth) login and logout work while the machine is selected; the flow runs on that machine and the credential is written there.

A subscription flow's loopback redirect address (`http://localhost:<port>/…`) belongs to the machine, so the redirect page does not load in a browser running elsewhere:

- When the login dialog asks for a code or redirect URL, approve the login on the provider's page, copy the full URL from your browser's address bar, and paste it into the dialog.
- When the provider offers a device-code option, choose it; it needs no paste.
- A flow that offers neither cannot be completed from another device. Cancel it, then log in on the machine directly: **Open selected machine PI WEB** in the action palette opens it.

## Plugins follow the selected machine

The selected machine's session daemon decides its workspaces and active plugins; nothing is rediscovered on the PI WEB you opened. The page loads the machine's browser plugins from that machine (directly for **This browser**, forwarded for **This server**), and plugin requests go back to the same machine, project and workspace.

**Settings → PI WEB Plugins** edits the selected machine's desired plugin state and compares it with what that machine's session daemon is running. A toggle applies at once on that machine, with the exceptions in [Turn plugins on and off](plugins.md#turn-plugins-on-and-off); a change that waits for a restart needs that machine's session daemon restarted, which restarting only a web/API server does not do.

Run the same PI WEB version on every machine: mixed versions are not supported for plugins. Upgrade the machines together, restart their web/API servers and session daemons, then reload the page. When a machine's plugins are incompatible or unavailable, PI WEB says so instead of running this PI WEB's plugin code in their place.

Browser and server plugins are trusted code. A server entry runs inside its machine's session daemon with that user's permissions and is not crash-isolated, so a blocking or crashing plugin can stall that machine's sessions and terminals. Add only machines whose installed plugins you trust. The offline recovery commands (`pi-web plugins disable`, `pi-web plugins safe-start`) run on the affected machine itself; see [Plugins](plugins.md) and [Offline disable and safe start](config.md#offline-disable-and-safe-start).

## Update and restart machines

**Settings → Machines → Machines and updates** lists every machine with its state and version, with **Update** and **Restart** for one machine, and **Update every machine** and **Restart every machine** for all of them. A machine reached with **This browser** is read and started from your browser, so its state, version and result are what this device sees; a machine reached with **This server** is read and started by the PI WEB you opened. Each machine runs its own update; see [Update](install.md#update).

## Which pages may use a machine

Every PI WEB decides which other pages may use it from a browser:

- Its own page may do everything.
- Another site's page may only leave a request for access and read that request's state, until the machine approves the page's origin.
- An approved page gets the cross-origin headers that let it read the machine's answers, and may make every request the machine's own page can, except approving or denying access and removing another page's access.
- A write request (anything but `GET`, `HEAD` or `OPTIONS`) from an unapproved site's page is refused with `403`, and an unapproved page gets no cross-origin headers, so it cannot read the machine's answers.
- A request that does not come from a browser page, such as the forwarded traffic of **This server** or `curl`, is not affected.

The machine tells pages apart by the `Sec-Fetch-Site` and `Origin` headers the browser sets. Approved origins are kept in `machine-access.json` in the machine's data directory. **Settings → Machines → Pages allowed to connect here** lists them, each with **Remove**.

## Trust boundaries

Machines are for trusted users, trusted PI WEB servers and trusted networks. PI WEB has no user accounts: without an [access token](install.md#require-an-access-token), anyone who can reach a machine's page can use it, and with one, anyone who holds the token can.

- Reach machines over a private network, an SSH tunnel or an authenticated reverse proxy; never expose a machine directly to the public internet.
- Approve only pages you opened yourself, and remove approvals you no longer use.
- A PI WEB that holds a machine's access token (**This server**) lets everyone who can use it use that machine too. Protect it at least as well as every machine it holds a token for.
- The origin check covers HTTP requests. WebSocket connections are not checked by origin yet, so the network must keep untrusted pages from reaching the machine, or the machine must require an access token.
- An approved page is never treated as signed in: a machine that turns its access token on refuses every page reaching it with **This browser**, approved or not.
- Treat the browser and server plugins installed on every machine as trusted code.

See [SECURITY.md](../SECURITY.md) for the threat model and how to report a vulnerability.

## Troubleshooting

- **Offline machine:** check that both its web/API server and session daemon are running and reachable from your device (**This browser**) or from the PI WEB you opened (**This server**). Keep a Machines list open; it checks again automatically.
- **"This browser cannot reach *host*":** the URL is wrong, the machine is down, it is not reachable from this device, or the page is on HTTPS and the machine is not. Fix the URL or the network path, or choose **This server**.
- **"*host* does not answer browser access requests at this URL":** the machine runs an older PI WEB or the URL is not its base URL. Update the machine, check the URL, or choose **This server**.
- **The approval page says the request is gone:** it expired or was already answered. The dialog on the requesting page asks again by itself.
- **"*host* requires an access token":** the machine's access token is on, and a browser cannot carry it to another address. Add the machine with **This server** and paste its token. A machine already added with **This browser** shows the same reason on its card: remove it and add it again with **This server**.
- **"This server's access token was refused":** the token saved for the machine is missing or no longer accepted, for example after the machine rotated its token. Remove the machine and add it again with the current token. After a refusal, the PI WEB you opened stops contacting that machine for 10 minutes, so its own background checks, the Machines list's included, cannot use up the machine's allowance of wrong tokens and lock out its other entries; the card says how long. Changing the machine's entry or choosing **Refresh selected machine** ends the pause at once. If the machine refused too many wrong tokens from this server's address already, the card says *This server's access token attempts are refused for now*, and the pause lasts as long as the machine says its window has left (at most 10 minutes). A 401 from an authenticating proxy in front of a machine without an access token is shown as that proxy answered it.
- **Requests refused with "This machine has not approved the page this request came from":** the page's origin is not in the machine's approved list; remove the machine and add it again to request access.
- **Plugin compatibility errors:** upgrade the machines together, restart their web/API servers and session daemons, then reload the page.
- **Logs:** run `pi-web logs` on each machine involved; see [Where are the logs?](faq.md#where-are-the-logs).
- **A machine's session daemon cannot start:** use `pi-web plugins disable` or `pi-web plugins safe-start` on that machine; see [Offline disable and safe start](config.md#offline-disable-and-safe-start).
