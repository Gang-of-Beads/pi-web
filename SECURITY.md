# Security policy

## Supported versions

Security fixes go into the next release. Only the latest `2.YYYYMM.x` release is supported; update to it before reporting.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue, pull request or discussion for a suspected vulnerability.

Include the PI WEB version, how it is installed and exposed (bind address, reverse proxy, remote machines), the steps to reproduce, and what an attacker gains. The report stays private between you and the maintainers while a fix is prepared.

## Threat model

PI WEB runs coding agents, terminals and file operations on the machine it is installed on, as the user its services run as. It is built for trusted users working in trusted repositories.

- **No user authentication.** Anyone who can reach the web port can start agents, open terminals, and read and write files as that user. PI WEB listens on `127.0.0.1` by default. Reach it from elsewhere through an SSH tunnel, a VPN or tailnet, or a reverse proxy that authenticates users; never expose the port directly to the internet.
- **Browser origin gate.** A request from another site's page that changes state (anything but `GET`, `HEAD` or `OPTIONS`) is refused unless this machine approved that page's origin. Approval happens on this machine's own approval page, which shows a code to compare with the asking page; approved origins are kept in `machine-access.json` in the PI WEB data directory. This protects against cross-site request forgery from other pages in the same browser. It is not authentication.
- **Remote machines.** A gateway can register remote PI WEB machines with a base URL and an optional bearer token or headers, which the gateway stores and sends when it proxies to that machine. Protect each remote the same way as the gateway.
- **File access.** The file explorer and absolute `@` path completions reach a workspace and the roots listed in `pathAccess.allowedPaths`; agents and terminals run with the full rights of the service user.
- **Plugins and pi extensions are trusted code.** Browser plugins run as page code with the page's access. Server plugins run inside the session daemon or the web process. pi extensions run inside the session daemon. Install only plugins and packages you trust.

## In scope

- Bypassing the browser origin gate or the approval flow.
- Reading or writing files outside a workspace and `pathAccess.allowedPaths` through PI WEB's own file routes.
- Leaking a remote machine's token or headers to a browser or to another machine.
- Anything that lets a web page or another machine act on a PI WEB instance it could not otherwise reach.

## Out of scope

- Actions available to anyone who can reach an exposed PI WEB port, since there is no authentication.
- What agents, terminals, plugins or pi extensions do with the rights they are given.
- Vulnerabilities in pi itself or in third-party plugins; report those to their own projects.
