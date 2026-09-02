# Quick access, and where the two form factors disagree

Status: findings for task-3 and task-4. No code changed yet; the interaction
shape is the owner's call.

## Quick access is single-machine by construction

Not a styling difference and not a bug in one form factor - the surface has no
concept of a machine at all.

- `QuickSwitcher.ts` mentions a machine exactly once, at line 115: a
  `Browse machines and projects` button that closes the switcher and navigates
  away. There is no machine property, no machine chip, no machine grouping.
- Its filter chips are projects and workspaces only
  (`QuickSwitcher.ts:278-297`).
- Every fetch is scoped to the selected machine:
  `openQuickSwitcher` reads `selectedMachineId(this.state)`
  (`PiWebApp.ts:2128`) and `loadQuickSwitcherData` fetches projects and
  workspaces for that one id (`PiWebApp.ts:2150-2165`), caching under
  `quickSwitcherMachineId`.

So switching machines requires leaving the fastest surface in the product and
using the slowest one. The owner's report - "quick access should switch machines
from a tag at the top" - is asking for the surface to gain the axis it never
had.

## What that costs today

The switcher already answers "which session should I be in" across projects and
workspaces. Machines are the one axis it drops, so a fleet user's mental model
breaks exactly where the tool is most used: the list looks complete, and is
silently scoped.

There is no indication on screen that it is showing one machine's sessions. That
is the same fault as an empty list that means "unloaded": the surface presents a
filtered view as if it were the whole.

## Form-factor differences found

Breakpoints in the client are spread across eight values - 420, 430, 520, 620,
640, 680, 760, 1180 - with 760 carrying eighteen of the rules. Several of these
are one-off and undocumented, which is how two form factors drift apart without
anyone deciding they should.

`QuickSwitcher` itself carries only one width rule (`max-width: 420px`,
line 426) plus `hover: hover` guards. Its layout is therefore nearly identical
across form factors, which means the differences the owner sees are not inside
the switcher - they come from what the switcher is given and from the surfaces
around it.

That makes the machine axis the substantive parity item, not a CSS sweep.

## Options for the machine axis

| option | what it does | cost |
|---|---|---|
| A. machine chips beside project chips | one row of filters gains machines; selecting one refetches for it | switcher becomes multi-machine; fetch fan-out grows with fleet size |
| B. machine as a separate top row | machines above, projects below, so the hierarchy reads correctly | one more row of height on a phone |
| C. aggregate every machine, label each row | no switching at all - show everything, say where each session lives | most fetches; slowest open; but answers the question directly |

A and B keep the current one-machine-at-a-time fetch and add a switch. C changes
what the surface *is*, and would need the fetch to fan out across the fleet on
every open.

Recommendation: **B**, with the current machine preselected. Machines and
projects are different axes and stacking them in one chip row reads as if they
were siblings. B also leaves the fetch shape unchanged - one machine at a time -
so a large fleet does not slow the switcher down.

## Open decisions for the owner

1. Which option above.
2. Whether the switcher should say which machine it is showing even when only
   one machine exists - I would say yes, because silence is what made the
   current scoping invisible.
