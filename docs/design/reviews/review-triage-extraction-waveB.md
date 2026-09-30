# Wave B review triage — machines plugin extraction

Three anonymous bllm lanes over `08d5c771^..6b88d7a4` (nine commits): glm-5.3-flash:max on the
contract/server seam, glm-5.3-flash:max on the client shell and state, qwen3.8-flash-next:max as the
red-team full pass. Triage verdicts below; every fix landed in this wave's follow-up commits.

## P1 — fixed

1. **The phone context sheet's machines group was dead in production.** Both client lanes found it
   independently, and the live probe had already caught it: the host render site still passed the
   pre-refactor props (`machines`, `selectedMachine`, `machineStatuses`, `machineStatusSnapshots`,
   `onSelectMachine`) that `context-switcher-sheet` no longer declares, and never passed
   `machineSections`/`machineSectionContext`/`onMachineSelected`; `buildMachineSectionContext("sheet")`
   had zero call sites. The component tests passed because they assign the props directly. **Fixed**:
   the host now feeds the contributed section and closes the sheet through `onMachineSelected`.
2. **With the machines plugin absent, the Machine chip blanked the whole panel body.** Section
   visibility was keyed to the roster, not to the contribution: expanding "machines" with no
   contribution rendered an empty slot while projects/workspaces/sessions all hid, and the phone had
   no recovery. The chip and its "+" also stayed actionable and did nothing. **Fixed**: section
   visibility and the chip are contribution-aware; without the plugin the machine step hides entirely
   while the context bar still names the machine.
3. **`machineStore.remove()` silently erased the local machine's alias.** The store read `data`
   (including `localAlias`) but wrote back only `{ machines }`, so removing any remote machine after
   renaming the local one dropped the alias with no error. **Fixed**: write back the preserved fields,
   with a regression test.

## P2 — fixed

4. **Stale machine ids behaved differently per seam.** The section context threw synchronously
   (uncaught in a click handler, no visible feedback) while the palette context returned silently.
   **Fixed**: both tolerate the lookup and surface a notice.
5. **The machine-load retry loop could yank a user who navigated mid-retry.** It only compared route
   identity; a late success re-selected the deep-linked machine and rewrote the URL over the user's
   navigation. **Fixed**: a still-current guard (URL still asks for the route) aborts the restore.
6. **Retry exhaustion gave up silently under a URL that still claimed the machine.** **Fixed**: the
   exhaustion sets the same refused-restore message its remote-route sibling uses, so the refusal says
   it refused.
7. **A second plugin contributing `machineRegistry` was silently ignored while its routes mounted.**
   **Fixed**: the runtime logs a collision warning (first contributor wins, as documented), and the
   same warning covers a duplicate reserved `machines` section id.
8. **Machine route error mapping and input parsing lied.** `sendError` mapped every failure to 400
   (store corruption answered a client-error status) and `machineInput` silently dropped non-string
   members (a `PATCH` with `{"name":123}` answered 200 with no effect). **Fixed**: validation failures
   stay 400, everything else becomes 500, and wrong-typed members are rejected instead of dropped.
9. **Dead machine plumbing.** Five `on*Machine` props on `app-navigation-panel` (plus the host's live
   closures and the unreferenced `openSelectedMachine`) could never fire after the rows moved into the
   contributed section. **Fixed**: deleted.
10. **Test honesty.** The boot-restore probe asserted its own window input (no `history` stub, so the
    URL assertions re-read the test's seed) and duplicated the retry-ladder length. **Fixed**: the stub
    carries a working `history.replaceState` and the ladder length is imported.
11. **The thinking-level drift guard missed the exported union.** The two-direction assertions pinned
    the level array, not the `ThinkingLevel` mirror the contract exports. **Fixed**: the union is
    pinned against pi's union in both directions too.
12. **Stale release prose.** `machines-slot-builtin-fallback.md` described a builtin fallback list
    that no longer exists, and the context docstring repeated it. **Fixed**: the changeset now states
    the honest absence semantics.

## Judged not true

- `@types/ws` zero-host-dep hazard: the published package carries it as a real dependency; the smoke
  installs the tarball's dependency tree. Clean.
- `exactOptionalPropertyTypes` hazard on `MachineCreateInput.token`: the dialog builds with
  conditional spread; an explicit `undefined` fails to compile. Clean.
- thinkingLevels rename drift: covered once the union guard from finding 11 lands.
- Baseline/declaration drift: baselines match sources byte-for-byte; the smoke run is green.
- Zero-plugin dishonesty server-side: the fallback answers local-only, unknown machines 404, and no
  core route collides with the plugin's mounts.
- Sheet keyboard stubs stranding focus: ModalSurface owns Escape; the stubs only no-op arrows.
- A second boot racing the retry timer: `loadProjectsAndRestoreRoute` runs once per connect, and
  `disconnectedCallback` clears both pending restores and their timers.
