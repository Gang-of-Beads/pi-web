# Phone navigation model — three-lane design synthesis

Three anonymous bllm lanes (glm ×2, qwen ×1) traced the phone navigation
model from source at 393×850: hierarchy and ownership, a state-by-state
closed-loop audit, and consistency against the desktop precedent and the
QuickSwitcher. Raw lane reports live in the subagent artifacts under runs
`857b9fca` (nav model), `5ccfd9cf` (closed loops), `97e8437d` (consistency).

## What holds (verified invariants)

- One primary section at a time, driven by tested classifiers
  (`navigationState.ts`); boot lands on projects when nothing is chosen and
  skips the workspace step for single-workspace projects.
- The empty-chat remap and the workspace-change return-to-picker are honest —
  the phone never strands the reader on a dead empty chat.
- SessionList's empty claim renders only when loaded.
- QuickSwitcher is a genuine cross-scope jump surface: workspace rows span
  projects, picking one selects its project first.

## The structural defect (all three lanes, adjudicated true)

**Once a workspace is chosen, the projects level is unreachable from the
phone panel.** The compact scope chip is the only section-changing control
(`AppNavigationPanel.ts:177`) and it toggles workspaces/sessions only; compact
headings are inert spans (`collapsible=false`), the projects list renders
hidden, and the Actions palette has no navigation action. The only escape is
three hops through an affordance styled as a muted label: dim "Sessions" →
QuickSwitcher → "Browse machines and projects" → projects. The chip's own
`aria-label` says "Change project or workspace" and it can deliver one.

History: triage item 9 (lane1-F6) recorded the chip's dead tap on the
fallback-visible section; the applied shape kept toggle semantics and papered
over it with `compactVisibleSection()`'s fallback. This defect is the residue.

Second-order: the machines level is unreachable from the phone panel entirely
(machine list gated on an expand nothing sets; the machines section rendered (the switcher component itself was removed in b0bce2a0)
permanently hidden). Machine switching survives via QuickSwitcher tabs,
management via Settings — report-only.

## The tools grid — answer to "must it always be there?"

No. The grid is **workspace-scoped data, not a global launcher**: it is empty
without a selected workspace, its badges are computed against the selected
workspace, terminal autostart keys on the workspace id, and desktop exposes
the same set as tabs in the workspace panel header.

The defect: the grid renders unconditionally at the panel bottom, including
on the projects/workspaces pickers — where its cards act on the workspace the
user is navigating away from, and tapping one ejects the user from the picker
mid-navigation. The same screen gates plugin-contributed sections by visible
section while the grid ignores the gate.

**Verdict (all three lanes): keep the grid as the single tools entrance,
bottom-anchored, but render it only when the sessions section is the visible
primary list.** Pickers get their height back; the grid returns on selection.
Rejected: moving it to the top (re-creates the retired quick-action bar), a
drawer (second entrance, retired by bars-minimalism B4), collapsing it to a
disclosure row (hides the badges that make it worth scanning).

Related tool findings:
- **Tool view with no session has no visible exit** — the panel toggle is
  hidden on `selectedSession === undefined`, but in a tool view the panel is
  not the whole view. One-line fix: hide the toggle when
  `displayMainView() === "navigation"`, not when no session is selected.
- The grid has no height bound; plugin count sets the floor under the session
  list (`max-height` + overflow needed).
- Desktop renders two simultaneous entrances (panel grid + WorkspacePanel tab
  strip) against the stated one-entrance contract — desktop-side decision.

## Surface contract

| surface | shows | leaves via | scope |
|---|---|---|---|
| Boot / projects | project tiles, "Add project" | pick → next level; switcher | machine |
| Workspaces picker | workspace tiles; honest empty claim (currently missing); a parent step to projects | pick → sessions | project |
| Sessions (workspace home) | sessions or honest empty claim + start; contributed sections; **tools grid** | session → chat; chip → workspaces | workspace |
| Tool view | the tool, full-bleed, no duplicated strip | back gesture; visible exit (hamburger restored) | workspace |
| Chat | conversation + composer + status | hamburger → panel; session name → switcher | session |
| Settings sheet | sections / drilled section | ×; ‹ Settings; back (URL-owned) | global |
| Quick switcher | search, machine tabs, filters, tiles, Browse footer | pick; × | machine (browse) |
| Dialogs | one decision, explicit cancel | cancel; back pops the layer frame | the entity |

## Closed-loop fix set (convergent)

1. **Projects reachable again** — the owner decides the shape (below).
2. **Tools grid gated to the sessions section** — one condition, testable.
3. **Tool-view exit** — `panelToggleHidden` keyed on `displayMainView() ===
   "navigation"` instead of "no session".
4. **Empty workspaces claim** — absence is not negation.
5. **Tree navigator + auth dialog registered as modal layers** — back gesture
   must close them, not restore a route beneath.
6. **Expand-as-request** — `compactVisibleSection()` must not let machines
   outrank an explicitly requested section; the latent trap any fix walks into.
7. **Compact-mode render tests** — the chip's target set, the grid's section
   gate, the tool-view exit; none of these are pinned today.

## Decision points for the owner

**D1 — how projects become reachable:**
- **A (minimal)**: a "Projects" affordance in the workspaces section heading
  wired to open the projects section; chip behavior untouched. Smallest diff;
  two taps from sessions (chip → workspaces → Projects).
- **B (structural)**: the chip opens a "Change context" sheet carrying the
  three levels the desktop breadcrumb carries (machine/project/workspace,
  current marked, `+` add), expanding the requested section authoritatively.
  Matches the desktop semantics; more surface and more work.

**D2 — desktop duplicate entrances** (grid + tab strip): resolve now in the
same wave, or defer to its own decision.
