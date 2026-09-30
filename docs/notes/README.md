# Notes

Working notes that stay useful to read: operational facts, integration rules and verdicts on pi behaviour. They are not published on the docs site; the user documentation is `docs/*.html` with [config](../config.md) and [plugins](../plugins.md).

- [Mobile gestures: what the platform already owns](mobile-gestures.md): Standing constraint list of OS-reserved mobile gestures.
- [Working with the pi-goal-x extension](pi-goal-integration.md): Rules for reading/writing pi-goal-x owned state; still-useful integration note.
- [sendUserMessage from a slash-command handler never starts a turn](sendusermessage-no-turn.md): Verdict on sendUserMessage in slash handlers; cited by state-sync-redesign.
- [Letting the session daemon finish work before it exits](systemd-killmode.md): Operational note on KillMode for daemon drain; still applies.
