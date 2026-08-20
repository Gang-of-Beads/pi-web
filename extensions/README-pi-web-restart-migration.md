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

## Making the built-in command available

The `/pi-web` command lives in this package's `extensions/` directory, which pi
loads when the package is registered. Installing PI WEB from a release tarball
does not register it, so the command is absent until the release directory is
added as a local package:

```
# ~/.pi/agent/settings.json, "packages"
"/home/you/pi-web-release/current"
```

Point it at the `current` symlink rather than a version directory, so the
command follows the deployment instead of pinning to whichever release happened
to be installed the day it was set up. Then `/reload`.
