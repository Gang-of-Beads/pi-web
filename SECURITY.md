# Security policy

## Supported versions

Security fixes go into the next release. Only the latest `2.YYYYMM.x` release is supported; update to it before reporting.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue, pull request or discussion for a suspected vulnerability.

Include the PI WEB version, how it is installed and exposed (bind address, reverse proxy, remote machines), the steps to reproduce, and what an attacker gains. The report stays private between you and the maintainers while a fix is prepared.

## Threat model

PI WEB runs coding agents, terminals and file operations on the machine it is installed on, as the user its services run as. It is built for trusted users working in trusted repositories.

- **No user accounts.** Anyone who can reach the web port, or who holds its access token when one is configured, can start agents, open terminals, and read and write files as that user. PI WEB listens on `127.0.0.1` by default. Reach it from elsewhere through an SSH tunnel, a VPN or tailnet, or a reverse proxy that authenticates users; never expose the port directly to the internet. If you must publish it, use HTTPS and the access token together.
- **An optional shared access token** (off by default) limits a reachable web port to its sign-in page and the PWA metadata ([Require an access token](docs/install.md#require-an-access-token)). It is one shared secret, not accounts: there is no per-person audit or permission. Use it over HTTPS or an encrypted network. It covers the web/API only; the session daemon stays on its socket behind filesystem permissions, and a daemon on TCP (`PI_WEB_SESSIOND_PORT`) is not covered.
- **Browser origin gate.** A request from another site's page that changes state (anything but `GET`, `HEAD` or `OPTIONS`) is refused unless this machine approved that page's origin. Approval happens on this machine's own approval page, which shows a code to compare with the asking page; approved origins are kept in `machine-access.json` in the PI WEB data directory. This protects against cross-site request forgery from other pages in the same browser. It is not authentication.
- **Remote machines.** A gateway can register remote PI WEB machines with a base URL and an optional bearer token or headers, which the gateway stores and sends when it proxies to that machine. Protect each remote the same way as the gateway. A gateway that holds a remote's access token opens that remote to everyone who can use the gateway, so protect the gateway at least as well as every remote it holds a token for.
- **File access.** The file explorer and absolute `@` path completions reach a workspace and the roots listed in `pathAccess.allowedPaths`; agents and terminals run with the full rights of the service user.
- **Plugins and pi extensions are trusted code.** Browser plugins run as page code with the page's access. Server plugins run inside the session daemon or the web process. pi extensions run inside the session daemon. Install only plugins and packages you trust.

## Known limitations

These follow from the model above and are documented rather than defended against today:

- **WebSocket upgrades are not origin-checked.** Browsers send no `Sec-Fetch-Site` on a WebSocket handshake, so a page from another site that the browser lets reach PI WEB can open its session and terminal sockets. Keep PI WEB off networks such pages can reach, as for any unauthenticated service. With the access token on, a cross-site page no longer gets the sign-in cookie (`SameSite=Lax`), but a same-site page (another port or subdomain of the same site) still does.
- **The `Host` header is not checked.** The origin gate trusts the browser's `Sec-Fetch-Site` rather than `Host` (a reverse proxy may rewrite `Host`), so a DNS-rebinding page that gets the browser to treat PI WEB as its own origin passes as the machine's own page. With the access token on, such a page has no sign-in cookie and is refused.
- **Old browsers** that send `Origin` without `Sec-Fetch-Site` are not classified and keep the behaviour PI WEB had before the gate.
- **Plain HTTP and the sign-in form.** Browsers send no `Sec-Fetch-Site` to a plain-HTTP address that is not loopback, so the origin gate cannot classify requests there. The access token's sign-in form refuses a post whose `Origin` names another host, but a browser that sends no `Origin` is let through, and every other route keeps the old-browser behaviour above. Use HTTPS where pages from other sites can reach PI WEB.
- **Development mode listens on every interface.** `pnpm run dev` and `pi-web install --dev` serve the UI and its `/api` proxy on `0.0.0.0:8505`; run them only on a network you trust.

## In scope

- Bypassing the browser origin gate or the approval flow, beyond the known limitations above.
- Reading or writing files outside a workspace and `pathAccess.allowedPaths` through PI WEB's own file routes.
- Leaking a remote machine's token or headers to a browser or to another machine.
- Anything that lets a web page or another machine act on a PI WEB instance it could not otherwise reach.
- With the access token on: any route or socket other than the sign-in page and the PWA metadata reachable without a valid token or sign-in cookie; timing differences that reveal the token; the token or the sign-in cookie reaching logs, page script (the cookie must stay `HttpOnly`), another machine, or the environment of agents and terminals; a gateway passing a remote machine's refusal or cookie through to the page.

## Out of scope

- Actions available to anyone who can reach an exposed PI WEB port without the access token, since it then has no authentication.
- Anything a holder of the access token does.
- Local processes running as the service user, which can read the token file.
- What agents, terminals, plugins or pi extensions do with the rights they are given.
- Vulnerabilities in pi itself or in third-party plugins; report those to their own projects.
