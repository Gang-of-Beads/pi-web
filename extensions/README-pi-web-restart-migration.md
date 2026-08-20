# `/pi-web-restart` is now `/pi-web restart`

The standalone `/pi-web-restart` command (a personal extension at
`~/.pi/agent/extensions/pi-web-restart.ts`) is superseded by subcommands of the
built-in `/pi-web` command.

| Old | New |
|---|---|
| `/pi-web-restart` | `/pi-web restart` |
| `/pi-web-restart all` | `/pi-web restart --all` |
| `/pi-web-restart --update` | `/pi-web update` |
| `/pi-web-restart --update all` | `/pi-web update --all` |
| (new) | `/pi-web machines` — list machines with version and online state |
| (new) | `/pi-web restart --machine=<name>` — one machine by name or id |
| (new) | `/pi-web status --all` — every machine's version |

## What changed beyond the name

`--all` is now **hub-scoped and stated**. The old command fanned out from the
machine list of whichever session it ran in, so the covered set depended on
where you were standing. The new command asks the PI WEB server this session
runs on to fan out over the machines *it* knows, and every report names that
server plus each machine's outcome and version. Restart and update also have a
visible home now: **Settings ▸ Machines ▸ Machines and updates**.

## Removing the old extension

Delete `~/.pi/agent/extensions/pi-web-restart.ts` and `/reload`. Nothing depends
on it; the built-in command covers every case above.
