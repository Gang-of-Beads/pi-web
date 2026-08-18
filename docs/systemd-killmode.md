# Letting the session daemon finish work before it exits

PI WEB's session daemon waits for in-flight agent runs before exiting, bounded
by `PI_WEB_SHUTDOWN_DRAIN_MS` (60s by default). Under systemd's **default**
`KillMode=control-group` that wait is useless: `systemctl restart` sends SIGTERM
to *every* process in the unit's cgroup, so the agent subprocesses the drain
exists to protect die at the same instant the daemon is asked to stop. The drain
then looks for work, finds none, and returns immediately.

Observed in the journal — note the timestamps:

    11:35:21  {"signal":"SIGTERM","msg":"shutting down session daemon"}
    11:35:21  Stopped pi-web-sessiond.service

No drain line at all, and the conversation that was running was simply cut off.

To let the drain do its job, send SIGTERM only to the main process:

    systemctl --user edit pi-web-sessiond

    [Service]
    KillMode=mixed
    # Long enough for the drain to finish before SIGKILL follows.
    TimeoutStopSec=120

`mixed` sends SIGTERM to the main process and, only after `TimeoutStopSec`,
SIGKILL to anything left. `TimeoutStopSec` must exceed the drain window or
systemd will kill the daemon part-way through waiting.

This is a deployment setting, not something PI WEB can set for you: the unit
belongs to whoever installed the service.

## What still happens without it

Runs interrupted by a restart are recorded regardless. The record is written
when a run starts and removed when it ends, so whatever remains belongs to a
process that is gone — which also covers SIGKILL, a crash, and the power going
out. Those sessions appear under "Interrupted" in the session switcher, above
work that is merely idle, because they will not finish on their own.

Recording is not resuming, and is not meant to look like it. An agent run is a
live streamed request and a tool loop; once the process is gone there is no
execution point to return to. What can honestly be offered is not losing track
of the work.
