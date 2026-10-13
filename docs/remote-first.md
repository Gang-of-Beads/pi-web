# Remote-first development

AI-driven development should live where the work can persist, not where your keyboard happens to be. PI WEB is built around that shift: you supervise the work; you do not have to host it.

## Developer tools assumed the work lived locally

Editors and terminals were built on a simple assumption: the work lives with you, on your device, inside your session. That made sense when one person drove every keystroke from one machine.

AI agents break that assumption. The work can outlive the laptop session, and agents need stable repositories, shells, tools, secrets, build caches, and time to keep running. When all of that is tied to a laptop, the laptop becomes the bottleneck: close the lid, change devices, lose the network, reboot or run out of battery, and the work stops.

## Persistence should not be a workaround

Terminals are ephemeral by default. tmux, screen, background processes and remote shells patch around that, but persistence is still bolted on afterwards.

PI WEB treats persistence as the foundation. Agent sessions live in a long-running session daemon, workspaces stay on the machine that runs the tools, and a browser disconnect does not end the work.

## What a machine that stays on gives you

Run PI WEB on a machine that stays on: a dev box, home server, cloud VM, workstation or private-network host. Keep agents and worktrees there, and connect from whatever screen you have.

- **Always available:** sessions keep running after the browser disconnects and can be picked up later.
- **Parallel:** worktrees and persistent sessions let several agent streams progress independently.
- **One real environment:** dependencies, caches, credentials and repository state stay where the agents run.

## The browser is the control surface

Your device does not have to be the editor, terminal, build server and agent runtime. In PI WEB the browser is where you supervise sessions, redirect agents, read transcripts and review progress, while the development environment stays remote and stable. Laptop, phone, tablet and desktop are windows into the same running work.

Your role moves toward direction, judgment and review: choosing what to work on, setting constraints, reviewing changes and deciding what ships.

## Recommended shape

PI WEB works locally, but it is most useful on a machine that stays on and is reachable through a private path: an SSH tunnel, a VPN, a private LAN, or an authenticated reverse proxy. Use the laptop when you want convenience; use a server or always-on workstation when agents should keep working while the laptop is away.

- [Install PI WEB](install.md)
- [Set up remote access](install.md#remote-access)
- [Use several machines from one page](machines.md)
