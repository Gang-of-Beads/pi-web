# Research: Minimal, modular, extensible UI/UX — philosophy plus the productization details that make it feel finished

## Tooling limitation (read this first)

**This run had no web tools.** The only tools registered for this subagent were `Read` and `Write`; `web_search`, page fetch, and `source_check` were not available, so nothing external was fetched or validated in this run.

Consequences, applied honestly throughout:

- Every **repo claim** is direct evidence: I read the file and cite `path:construct`. These are high confidence.
- Every **external claim** (Linear, Raycast, VS Code, WCAG, HIG, etc.) is **UNVERIFIED-BY-FETCH**: it comes from prior model knowledge, with the canonical URL where the claim should be checked. I have marked each one, avoided fabricated quotations and fabricated numbers, and flagged the ones most likely to be misremembered.
- Where a decision depends on an external number (target-size thresholds, latency thresholds), I say so explicitly and name the one document to open before acting.

Do not ship a doc or a public claim quoting the external half of this brief without a verification pass.

---

## Summary

Minimalism that works is **subtraction of chrome, not subtraction of affordance**: the products people cite (Linear, Raycast, iA Writer, Things) keep every operation reachable and *labelled* on a predictable secondary surface (command palette, contextual menu, settings) while removing persistent visual weight; minimalism that fails removes the *signifier* and leaves the user to guess (the widely told Arc cautionary tale). The productization gap — the thing that makes it feel finished — is almost never taste; it is **mechanical enforcement**: tokens that every surface must read, a placement classifier that decides where an operation lives, contract tests that fail CI when a control drifts, and a plugin API that hands out host-rendered chrome instead of a blank canvas. PI WEB is unusually far along on the first and last of these (`src/client/index.html` token block, `THEME_TOKENS` exhaustiveness guard in `src/client/src/theme.ts`, `PluginHostUi.surfaceStyles/listStyles/workspacePanelStyles/textStyles` in `src/client/src/plugins/types.ts`) and has no mechanical enforcement layer that I could find — that is where the remaining "unfinished" feeling will come from.

---

## Findings

### A. Philosophy: what separates working minimalism from hidden affordances

1. **Claim:** The operative distinction is *chrome vs. signifier*. Minimalism succeeds when the visual weight of a control is removed but its discoverability path stays deterministic (one palette, one menu, one settings tree, all searchable by the word a user would say). It fails when an operation exists only as an unlabelled gesture, hover-only reveal, or undocumented key.
   **Sources:** NN/g progressive disclosure (https://www.nngroup.com/articles/progressive-disclosure/); NN/g on signifiers/discoverability in flat UI (https://www.nngroup.com/articles/flat-design/).
   **Support:** interpretation of well-established HCI guidance — **UNVERIFIED-BY-FETCH**.
   **Confidence:** medium-high on the principle, low on any specific wording attributed to NN/g.

2. **Claim:** The public "rules" these teams state are thinner than the internet implies. Linear publishes *The Linear Method* (https://linear.app/method) — the durable, safe-to-cite gist is opinionated defaults, keyboard-first operation, and speed treated as a product feature rather than an optimization. Raycast publishes hard *API* constraints rather than philosophy (see finding 18). iA Writer's public position is focus/removal of interface during writing. Superhuman's "every interaction under 100 ms" is widely attributed to founder interviews.
   **Sources:** https://linear.app/method ; https://ia.net/writer ; https://developers.raycast.com/
   **Support:** recalled positioning, not fetched. **UNVERIFIED-BY-FETCH.**
   **Confidence:** medium for Linear/iA/Raycast existence and general stance; **low** for the Superhuman 100 ms number — treat as folklore until sourced.

3. **Claim (cautionary tale, decision-relevant):** Arc is the canonical example of minimalism that hid affordances. The Browser Company publicly stepped back from Arc (2024–2025) and its leadership's stated retrospective was, in gist, that Arc introduced too many novel, hard-to-discover concepts for mainstream users, which capped adoption despite loyal power users.
   **Sources:** The Browser Company's public letters/posts (https://browsercompany.substack.com/ ; https://arc.net/).
   **Support:** recalled public statement, **not fetched, wording not verified**. **UNVERIFIED-BY-FETCH.**
   **Confidence:** medium on the direction; **do not quote** without fetching. Researcher inference: the transferable lesson for PI WEB is that *novel concept count*, not pixel count, is the adoption tax — PI WEB already asks users to learn machine → project → workspace → session (`README.md`, "Core model"), which is four novel nouns before a first message. Every new surface should reuse those four, not add a fifth.

4. **Claim:** A practical, defensible test for "hidden vs. minimal": an affordance is *minimal* if it satisfies all four — (a) it is reachable from a surface the user can reach without knowing it exists (palette, menu, settings search); (b) it has a text label containing the word a user would search for; (c) its state is honestly rendered when unknown; (d) it is keyboard-reachable and screen-reader-announced. If it fails any, it is *hidden*.
   **Support:** **researcher inference**, synthesized from WCAG 2.1.1/2.4.7 and progressive-disclosure guidance; not a published rule from any of those teams.
   **Confidence:** medium (as a heuristic, not as a citation).

### B. Placement: primary surface vs command palette vs settings

5. **Claim:** No vendor publishes a numbered "core operations" heuristic. The closest published artifacts are structural: VS Code's guidance that *everything* should be a command in the Command Palette while only high-frequency commands earn menu/toolbar/keybinding placement (https://code.visualstudio.com/api/references/contribution-points#contributes.commands and the UX guidelines at https://code.visualstudio.com/api/ux-guidelines/overview), and Raycast's single `ActionPanel` with one designated primary action (https://developers.raycast.com/api-reference/user-interface/action-panel).
   **Support:** recalled documentation structure. **UNVERIFIED-BY-FETCH.**
   **Confidence:** medium-high that VS Code's docs express "all commands in the palette, few in the toolbar"; medium that the palette is *required* rather than conventional.

6. **Claim (recommendation):** PI WEB should turn placement into a **pure classifier**, not a habit. Proposed states: `primary` (always visible in the surface's own chrome), `contextual` (visible only on the object it acts on), `palette` (action only), `settings` (durable configuration), `hidden` (internal/dev). Proposed inputs, all cheap to answer at review time: *frequency per session*, *does it need a selected target*, *is it reversible*, *scope of blast radius* (browser-local / session / workspace / machine / fleet), *is it destructive*.
   **Trade-off:** an explicit classifier adds a registry and a review step for every new operation; it costs one file plus test enumeration, and it will occasionally force an argument the team currently avoids by just adding a button.
   **Failure mode it prevents:** header/toolbar accretion — the standard way a minimal app stops being minimal — and the inverse failure of burying a destructive operation behind an unlabelled icon.
   **Maps onto this codebase:** the pattern is already the house style (`AGENTS.md`: "Prefer state machines and enums over string comparison and if/else ladders", naming `revisionVerdict`, `replayDecision`, `bottomAnchorAction`, `promptDeliveryBehavior`). A `surfacePlacement` classifier belongs beside the shell controllers already in `src/client/src/appShell/` (`appShellController.ts`, `panelCollapseController.ts`, `navigationState.ts`), consumed by `ActionPalette` (`src/client/src/components/ActionPalette.ts`) and the settings route (`src/client/src/settingsRoute.ts`, `SettingsSection`).
   **Support:** researcher inference + direct repo evidence for the surrounding modules.
   **Confidence:** high that it fits the codebase; medium that it is worth the ceremony today (it pays off once contributed operations outnumber core ones).

7. **Claim:** The palette must not be the *only* home for scope-changing or destructive operations. PI WEB's own scope rules (`AGENTS.md`: "Data must carry the scope it belongs to"; "Absence is not negation") imply that any operation whose effect crosses a machine/project/workspace boundary must render its target in the confirmation, not just in the action title.
   **Sources:** `AGENTS.md` (repo); existing precedent in `docs/plugins.md` — provider removal requires `removal: { actionLabel, confirmation }` display text plus `prepareRemove()`, and the host runs it in a *visible* terminal.
   **Support:** direct evidence (repo).
   **Confidence:** high.

8. **Claim:** Settings should hold *durable machine-scoped configuration only*; anything a user changes more than once per session belongs on a contextual surface. PI WEB already carries the harder half of this — Settings tabs label which machine they target, and gateway-only settings (host, port, allowed hosts, tokens, shortcuts) are separated from machine-targeted ones.
   **Sources:** `README.md` ("Machines and fleets", "Configuration"); `docs/plugins.md` (Settings → PI WEB plugins targets the selected machine).
   **Support:** direct evidence.
   **Confidence:** high.

### C. Speed of operation: patterns, wins, and accessibility costs

9. **Claim:** Keyboard-first design has a specific accessibility trap: single-character shortcuts. WCAG 2.1 SC **2.1.4 Character Key Shortcuts** requires that a shortcut using only letter/number/punctuation keys can be turned off, remapped, or is active only on focus.
   **Sources:** https://www.w3.org/TR/WCAG21/#character-key-shortcuts
   **Support:** recalled normative text; **UNVERIFIED-BY-FETCH** (high confidence in existence and substance, verify exact conformance wording before citing in docs).
   **Confidence:** high on substance.
   **Maps onto this codebase:** PI WEB is already compliant by construction — `docs/plugins.md` states plain-letter shortcuts are *intentionally ignored* and plugins must use modified shortcuts such as `mod+shift+p`. **Keep that rule; it is a compliance asset, not just taste.** Gap: the same doc says there is no user-facing shortcut override or conflict resolver yet, while `src/client/src/shortcutPreferences.ts` and `applyActiveShortcutPreferences` exist in the client — see Contradictions.

10. **Claim:** Command palettes carry a discoverability and screen-reader cost that must be paid explicitly: the widget needs the ARIA combobox/listbox pattern (roles, `aria-activedescendant` or managed focus, announced result counts), or it becomes a fast surface for sighted keyboard users and a dead end for everyone else.
    **Sources:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
    **Support:** recalled APG pattern. **UNVERIFIED-BY-FETCH.**
    **Confidence:** high on substance.
    **Maps onto this codebase:** `src/client/src/components/ActionPalette.ts` and `QuickSwitcher.ts` are the two places to audit; `PluginAction.disabledReason` (documented in `docs/plugins.md`) is already the right primitive — *keep a disabled action visible with a reason instead of hiding it*, which is exactly the "honest absence" rule and also the accessibility-friendly choice.

11. **Claim:** Gesture budgets are constrained by WCAG 2.5.x: **2.5.1 Pointer Gestures** (any path-based or multipoint gesture needs a single-pointer alternative), **2.5.2 Pointer Cancellation** (act on up-event / allow abort), **2.5.8 Target Size (Minimum)** at 24×24 CSS px for AA in WCAG 2.2, with 44×44 as the AAA-level enhanced target in 2.5.5.
    **Sources:** https://www.w3.org/TR/WCAG22/#pointer-gestures ; https://www.w3.org/TR/WCAG22/#target-size-minimum ; Apple HIG's separate 44×44 pt recommendation: https://developer.apple.com/design/human-interface-guidelines/accessibility
    **Support:** recalled normative content. **UNVERIFIED-BY-FETCH**; the 24 vs 44 split is the single most misquoted number in this space — verify before writing it into project docs.
    **Confidence:** medium-high on substance, medium on exact numbering.
    **Maps onto this codebase:** PI WEB already encodes the stricter floor as a token — `--pi-control-height-touch: 44px` with the comment "Touch floor first: a control is 44px on a finger, 32px under a mouse" (`src/client/index.html`), and `--pi-panel-header-control-height: 44px`. The token exists; **nothing mechanically proves every control reads it** (see finding 16).

12. **Claim:** Motion budgets need a reduced-motion escape, and PI WEB's token architecture makes this a two-line fix rather than a component sweep — custom properties inherit through shadow roots (the repo relies on exactly this: "Custom properties inherit through shadow roots, which is what lets every component read them", `src/client/index.html`), so zeroing `--pi-motion-fast/base/slow` inside `@media (prefers-reduced-motion: reduce)` at `:root` reaches every component that used the tokens.
    **Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion ; WCAG 2.3.3 Animation from Interactions (https://www.w3.org/TR/WCAG22/#animation-from-interactions).
    **Support:** external mechanism **UNVERIFIED-BY-FETCH**; the repo half is direct evidence.
    **Confidence:** high.
    **Trade-off:** zeroing durations globally also kills motion that carries meaning (a drawer that teleports can read as a state bug). Mitigation: reduce to ~1 ms rather than 0, keep opacity cross-fades, and drop only transforms — but that requires components to *not* hardcode `ms`, which is the lint rule in finding 16.
    **Failure mode prevented:** vestibular harm plus the "why did the screen jump" class of perceived bugs; also the sweep-missed-a-component failure the repo already recorded for tap-highlight ("The per-component sweep missed real buttons twice; the root rule cannot miss", `src/client/index.html`).

13. **Claim:** Single-tap phone flows: the honest measured wins in public literature are latency thresholds, not tap counts. The commonly cited numbers are the Doherty threshold (~400 ms) and Google's RAIL guidance (~100 ms for input response, 16 ms frame budget).
    **Sources:** https://web.dev/articles/rail
    **Support:** **UNVERIFIED-BY-FETCH**, and RAIL is old guidance now partly superseded by Core Web Vitals / INP (https://web.dev/articles/inp). Freshness flag: if you want a defensible latency target in 2026, use **INP ≤ 200 ms** rather than RAIL.
    **Confidence:** medium.
    **Maps onto this codebase:** the phone-relevant work is already scoped in `AGENTS.md` (coarse pointer 393×850 probes) and `package.json` (`e2e:mobile` Playwright project), and the gutter compression at `@media (max-width: 640px) { --pi-chat-gutter: 6px }` shows the density decision is already tokenized.

### D. Detail-polish checklist (what "finished" is made of)

14. **Claim:** The polish items that repeatedly separate finished from nearly-finished, with the PI WEB status of each (repo evidence in brackets):

    | Item | Rule | PI WEB status |
    |---|---|---|
    | Spacing scale | one scale, no ad-hoc px | **Present**: `--pi-space-1..9`, 2px-based [`src/client/index.html`] |
    | Type scale | compact, role-named | **Present**: `--pi-text-2xs..xl`, `--pi-leading-*`, `--pi-weight-*` |
    | Radius scale | stepped by element size | **Present**: `--pi-radius-xs..xl`, `--pi-radius-pill` |
    | **Concentric radii** | inner radius = outer − border/padding, or corners show slivers | **Documented in prose only**: the comment beside `--pi-radius-xl` states the 1px-tighter rule; no token or helper enforces it |
    | Control heights | one scale, touch floor separate | **Present**: `--pi-control-height: 32px`, `--pi-control-height-touch: 44px`, `--pi-panel-header-height: 36px` |
    | Elevation | shadows composed from theme colors, never invented locally | **Present**: `--pi-elevation-1..3` composed from `--pi-shadow*` |
    | Surface ladder | canvas < panel < card < raised, derived not hand-picked | **Present**: `--pi-surface-canvas/panel/card/raised/active` with `color-mix` fallbacks |
    | Focus states | visible ring, consistent width/offset, `:focus-visible` | **Tokens present** (`--pi-focus-ring-width/offset`); no verified mechanical guarantee every control uses them |
    | Motion budget | 2–3 durations, one easing, reduced-motion honored | **Durations/easing present** (`--pi-motion-fast/base/slow`, `--pi-ease`); **no reduced-motion rule found** |
    | Coarse-pointer targets | 44px minimum on touch | **Token present**; enforcement unverified |
    | Layer order | named z-index ladder | **Present**: `--pi-layer-raised/sticky/popover/overlay/dialog/blocking` |
    | Optical vs geometric centering | glyphs with visual mass (play, send, chevrons) need optical nudges; icon sets need a fixed grid + live area | **Not found** — no icon-grid contract located; plugin icons are free-form `svg` templates with only a `currentColor` convention [`docs/plugins.md`] |
    | Font strategy | no downloaded webfont for offline/LAN use | **Present and reasoned**: `--pi-font-ui/display/mono` with an explicit PWA-offline rationale |

    **Support:** direct evidence for every "Present" row (all tokens read from `src/client/index.html`); "not found" means *I did not find it in the files I read*, not that it is absent — I could not list directories with the tools available.
    **Confidence:** high for present items, **medium** for absences (limited file coverage).

15. **Claim:** The two polish items with the highest ratio of noticeability to cost here are (a) an **icon contract** (fixed viewBox, stroke width, live-area padding, `currentColor` only) and (b) a **concentric-radius helper**. Both are cheap, both are exactly the kind of thing the owner has already had to report once ("The boxes are different sizes" — `AGENTS.md`).
    **Support:** researcher inference on top of direct repo evidence.
    **Confidence:** medium-high.
    **Trade-off:** an icon contract constrains plugin authors' expressiveness and adds a validation surface; the alternative is a tab bar where a third-party icon is visibly heavier than the built-ins. `docs/plugins.md` already asks for `viewBox="0 0 24 24"`, `stroke-width="2"`, `currentColor` in its example — promote that from example to stated contract, and it costs nothing new.

### E. Keeping consistency mechanically, not by review vigilance

16. **Claim (recommendation, highest leverage):** Add a **token contract test** rather than a style guide. PI WEB's styles live in Lit `css` template literals inside `.ts` files (`import { css, LitElement ... } from "lit"`, `src/client/src/components/PiWebApp.ts`), so Stylelint's usual `declaration-property-value-allowed-list` route is awkward; the native fit is a Vitest test that scans `src/client/src/**/*.ts` for raw hex colors, raw `px` in spacing/radius/height positions, and raw `ms` durations inside `css` blocks, with an explicit allowlist file where each exception carries a reason.
    **Sources (repo):** `package.json` (`verify` = typecheck + lint + knip + test; Vitest configured; no Stylelint dependency); `src/client/src/theme.ts`; `.agents/skills/testing-guide/SKILL.md` is the house location for such rules per `AGENTS.md`.
    **Support:** direct evidence for the toolchain; the rule design is researcher inference.
    **Confidence:** high on fit, medium on effort (regex-scanning template literals has false positives; budget an allowlist).
    **Failure mode prevented:** a hardcoded `#161b22` that looks right in the default dark theme and wrong in every light theme — the exact failure `THEME_TOKENS` was built to prevent at the theme layer but which nothing prevents at the component layer.
    **Trade-off:** a scanner that is too strict becomes an allowlist landfill; scope it to color + spacing + radius + duration, not all CSS.

17. **Claim:** The repo already demonstrates the strongest available consistency mechanism — a **compile-time exhaustiveness guard**. `src/client/src/theme.ts` defines `THEME_TOKENS` plus `type UnlistedThemeToken = Exclude<ThemeToken, (typeof THEME_TOKENS)[number]>` and asserts it is `never`, with the docstring "every ThemeToken the union knows must appear in this list, or applyPiWebTheme silently never sets or removes the straggler."
    **Support:** direct evidence.
    **Confidence:** high.
    **Recommendation:** replicate this shape for (a) the placement classifier in finding 6, (b) contributed panel chrome classes, and (c) any new scale that themes may override. **Trade-off:** type-level guards catch *declaration* drift, never *usage* drift — a component can still ignore a token. That is why 16 (scan) and 18/19 (screenshot) are complements, not alternatives.

18. **Claim:** For usage drift, the mechanical answer is **visual regression on a component gallery**, and PI WEB already has the harness: Playwright with a dedicated `mobile` project (`package.json`: `"e2e": "playwright test"`, `"e2e:mobile": "playwright test --project=mobile"`). Playwright's `toHaveScreenshot()` is the assertion.
    **Sources:** https://playwright.dev/docs/test-snapshots (**UNVERIFIED-BY-FETCH**); repo evidence for the harness is direct.
    **Confidence:** high on the harness, medium on the snapshot API details.
    **Trade-off:** screenshot tests are the classic flaky-CI generator (font rendering, animation timing, scrollbars). Mitigations that make it survivable: render a *static gallery route* rather than live sessions; freeze motion via the reduced-motion token switch from finding 12; mask time-dependent regions; and pin the browser version. If the team will not accept snapshot flake, the cheaper 80% substitute is a **geometry contract test**: iterate visible interactive elements in the touched flows and assert `boundingBox().height >= 44` under the mobile project — no image diffing, no flake, and it catches the coarse-pointer regression that actually matters here.

19. **Claim:** A gallery route is also the only cheap way to enforce cross-plugin visual coherence, because it is the one place where a built-in panel and a contributed panel can be rendered side by side and compared.
    **Support:** researcher inference.
    **Confidence:** medium.
    **Trade-off:** a gallery is production surface area that users can reach unless it is dev-only; gating it behind the dev server (`vite.config.ts` already special-cases dev-only middleware with `devDocsPlugin()`, `apply: "serve"`) is the precedent to copy.

### F. Plugin-extensible products: how five hosts constrain plugin visuals

20. **Claim:** The five surveyed hosts sit on a spectrum from *host renders everything* to *plugin renders anything*, and each position buys consistency at a known cost:

    | Host | Constraint mechanism | Consistency | What it gives up |
    |---|---|---|---|
    | **Slack** | Block Kit: apps send JSON blocks; Slack renders. No CSS, no custom components. | Highest | Expressiveness; every new UI idea needs a Slack-side block type |
    | **Raycast** | Declarative React components only (`List`, `Detail`, `Form`, `Grid`, `ActionPanel`); no CSS, no arbitrary DOM | Very high | Custom layout entirely; extension authors wait on API surface |
    | **VS Code** | Two tiers: host-rendered contribution points (tree views, status bar, menus) with *no* styling control, plus sandboxed `Webview` iframes with full HTML/CSS, where the host exposes `--vscode-*` theme variables and expects them to be used | High for tier 1, convention-only for tier 2 | Webview UI is isolated (perf cost, focus/keyboard seams, theme drift when authors ignore the variables) |
    | **Figma** | Plugin UI is an iframe (`figma.showUI`), document access via a sandboxed API; no official in-product design system enforced on plugin UI | Low visually | Coherence — plugin dialogs visibly differ from Figma and from each other |
    | **Obsidian** | Plugins run in the app's own document with full DOM and CSS access; the host publishes CSS variables and style guidance, but enforcement is review/convention | Lowest technically, high in practice for good citizens | Safety: a plugin can restyle or break core UI; host redesigns break plugins |

    **Sources:** https://api.slack.com/block-kit ; https://developers.raycast.com/api-reference/user-interface ; https://code.visualstudio.com/api/extension-guides/webview and https://code.visualstudio.com/api/references/theme-color ; https://www.figma.com/plugin-docs/ ; https://docs.obsidian.md/Plugins/Getting+started
    **Support:** recalled architecture of each platform. **UNVERIFIED-BY-FETCH.** Directionally I am confident; specific API names (`figma.showUI`, `--vscode-*`) should be re-checked before publication.
    **Confidence:** medium-high on the spectrum and the trade-offs, medium on API-name precision.

21. **Claim (where PI WEB sits, and the recommendation):** PI WEB has **already implemented the best-in-class hybrid** and should double down rather than redesign. Direct evidence from `src/client/src/plugins/types.ts`:
    - Host-owned chrome handed to plugins: `PluginHostUi.surfaceStyles`, `.listStyles`, `.workspacePanelStyles` ("so a contributed panel body matches the built-in panel instead of inventing its own chrome"), `.textStyles`, `.breakpoints`, `.renderMarkdownHtml`.
    - Host-owned modality: `registerModal(...)` and `showDialog(...)` where "the host owns the shared surface, focus, Escape, backdrop, and the back gesture; the plugin owns only the content".
    - Host-owned routing/URL boundary: `fetchJson`, `callOperation`, and `query.read/write` — "a plugin never spells out a URL".
    - Host-owned theming: plugins contribute `themes`/`themePairs` constrained to the `THEME_TOKENS` allowlist (`src/client/src/theme.ts`).
    - **Declarative-first with an escape hatch**, already shipped for one contribution type: `workspaceLabels` items are `{ type: "text" | "link" | "render" }` (`docs/plugins.md`), i.e. Block-Kit semantics for the cheap 80% and a raw `render` for the 20%.

    **Recommendation:** extend the `text | link | render` pattern from labels to **panels and drawer sections** (a declarative `sections`/`rows` vocabulary that the host renders, with `render` retained as the escape hatch), rather than adding more free-form `render`-only contribution types.
    **Trade-off:** every declarative item type is API surface the host must maintain forever and cannot easily change; free-form `render` costs nothing today and costs coherence at plugin #6. The break-even is roughly "when more than one third-party plugin renders a panel a user sees daily".
    **Failure mode prevented:** the Figma/Obsidian outcome — a workspace tab bar and panel body where every plugin's spacing, icon weight, and empty state are visibly different.
    **Confidence:** high on the repo facts; medium on the timing of the break-even.

22. **Claim (unresolved risk):** I could not verify whether contributed panel content renders in the host's shadow root, in the plugin's own element shadow root, or in light DOM. The comment on `workspacePanelStyles` ("Adopt per element instance in createRenderRoot: static styles freeze at module load, before the host is remembered") implies plugin custom elements adopt host stylesheets into *their own* roots — which is the safe design — but a plugin returning bare `html` fragments would render into whatever root the host mounts them in.
    **Support:** interpretation of one docstring; **not verified** against the render path.
    **Confidence:** low.
    **Why it matters:** it decides whether a plugin's stray `button { }` rule can bleed into core chrome. Verify in `src/client/src/components/WorkspacePanel.ts` and `src/client/src/plugins/registry.ts` before writing any plugin-styling guidance.

### G. Modularity risk specific to this codebase

23. **Claim:** `src/client/src/components/PiWebApp.ts` is ~3,900+ lines and imports 60+ modules including every controller, dialog, and picker. It is the shell god-file; the controllers (`src/client/src/controllers/*`, `src/client/src/appShell/*`) are the existing, working extraction pattern.
    **Support:** direct evidence (read the file's header and line count indicator).
    **Confidence:** high.
    **Recommendation:** any new UX mechanism from this brief (placement classifier, reduced-motion switch, gallery route, geometry contract) should land as a **new module with its own tests**, per `AGENTS.md` ("Prefer small cohesive modules over growth inside an existing god file"), and specifically *not* as new branches inside `PiWebApp.ts`.
    **Trade-off:** extraction churn conflicts with in-flight work in the same file; sequence it behind whatever is currently open.

---

## Contradictions

1. **Public plugin contribution surface vs. implemented surface.** `docs/plugins.md` states the contribution arrays are `actions`, `workspacePanels`, `workspaceLabels` ("The workspace-related contribution arrays returned by `activate()` are: …"), and its "Plugins can currently:" list matches. `src/client/src/plugins/types.ts` declares `PluginContributions` with **eleven** members: `actions`, `navSections`, `machineSections`, `workspacePanels`, `workspaceLabels`, `themes`, `themePairs`, `composer`, `settingsSections`, `messageRenderers`, `drawerSections`. Both are direct evidence. Either the docs are stale or the extra members are deliberately core-only (`corePlugin` in `src/client/src/plugins/core.ts`, plus reserved ids `core`, `themes`, `machine.*` per `docs/plugins.md`). **This is a documentation/contract decision the owner should make explicitly**, because it determines whether third-party plugins may ever contribute nav/composer/settings UI — which is precisely the "coherent look under third-party UI" question. Not resolved here.

2. **Keyboard shortcut overrides.** `docs/plugins.md`: "There is no user-facing shortcut override or conflict resolver yet." Yet `src/client/src/shortcutPreferences.ts` exports `applyActiveShortcutPreferences`, `PiWebShortcutConfig` is a config API type, and `README.md` lists keyboard shortcuts among settings that "stay local to the gateway/browser". Likely stale docs; not verified against the settings UI.

3. **External minimalism claims vs. evidence standard.** Several widely repeated claims in this space (Superhuman's 100 ms, the exact Arc retrospective wording, "Linear says X") circulate mostly as secondhand summaries. I have flagged each rather than resolving it, because resolving it requires fetching, which this run could not do.

---

## Missing evidence

- **Everything external is unfetched.** No URL in this brief was retrieved or `source_check`ed in this run. Treat the Sources list as a verification queue, not as citations already made.
- **WCAG target-size numbers** (24 px AA in 2.2 vs 44 px AAA vs Apple's 44 pt) — the split is the most commonly mis-stated fact here and must be checked before it enters project docs.
- **Repo coverage is partial.** With only `Read` (no listing/glob), I read `README.md`, `package.json`, `vite.config.ts`, `src/client/index.html`, `src/client/src/main.ts`, the head of `src/client/src/components/PiWebApp.ts`, `src/client/src/theme.ts`, ~420 lines of `src/client/src/plugins/types.ts`, and most of `docs/plugins.md`. I did **not** read: any component CSS body, `ActionPalette.ts`, `WorkspacePanel.ts`, `plugins/registry.ts`, `plugins/core.ts`, the Playwright config, or `.agents/skills/*`. Absences reported in finding 14 are "not found in what I read", not proven absent.
- **Unverified specifics:** reduced-motion handling anywhere in the client; `:focus-visible` usage consistency; whether any control hardcodes heights instead of `--pi-control-height*`; plugin render-root isolation (finding 22); whether an icon grid contract exists in a skill file.
- **No measured performance data** for PI WEB's own interaction latency; the latency thresholds cited are external guidance, not measurements of this product.

---

## Sources

**Kept — repo (direct evidence, read this run)**
- `src/client/index.html` — the scale/color token block, the coarse-pointer floor, the concentric-radius rule, motion tokens, layer ladder, font rationale. The single most important artifact for this topic.
- `src/client/src/theme.ts` — `THEME_TOKENS` allowlist plus the compile-time exhaustiveness guard; the model for mechanical consistency.
- `src/client/src/plugins/types.ts` — `PluginHostUi` (host-owned styles, modal layer, breakpoints, query), lifecycle events, `PluginContributions` (eleven members), nav/machine/drawer/settings section contracts with explicit "unknown" states (`NavProjectsLoad`, `available → undefined`).
- `docs/plugins.md` — the published plugin contract: three contribution types, icon/`currentColor` convention, `text|link|render` label items, no plain-letter shortcuts, disabled-with-reason actions, trust model.
- `src/client/src/components/PiWebApp.ts` (header) — shell god-file size and the controller extraction pattern.
- `package.json`, `vite.config.ts` — toolchain reality: Vitest + ESLint + knip + Playwright (`e2e`, `e2e:mobile`), no Stylelint; dev-only Vite middleware precedent.
- `README.md`, `AGENTS.md` — product nouns (machine/project/workspace/session) and the owner's standing rules the recommendations must satisfy.

**Kept — external (canonical URLs, NOT fetched this run; verification queue)**
- https://www.w3.org/TR/WCAG22/ — target size, pointer gestures, pointer cancellation, focus appearance, animation from interactions.
- https://www.w3.org/TR/WCAG21/#character-key-shortcuts — validates PI WEB's no-plain-letter-shortcut rule.
- https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ — the pattern the action palette must implement.
- https://developer.apple.com/design/human-interface-guidelines/accessibility — the 44 pt touch recommendation.
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion — the motion-budget escape.
- https://code.visualstudio.com/api/extension-guides/webview , https://code.visualstudio.com/api/references/theme-color , https://code.visualstudio.com/api/ux-guidelines/overview — two-tier plugin visual constraint, the closest analogue to PI WEB.
- https://developers.raycast.com/api-reference/user-interface — the maximally constrained end of the spectrum.
- https://api.slack.com/block-kit — host-renders-everything model; the reference for extending `text|link|render`.
- https://www.figma.com/plugin-docs/ , https://docs.obsidian.md/Plugins/Getting+started — the two low-constraint outcomes to avoid.
- https://linear.app/method — the one first-party "philosophy" document worth quoting, once fetched.
- https://playwright.dev/docs/test-snapshots — visual regression mechanics for the existing harness.
- https://web.dev/articles/inp — use instead of RAIL for a current latency target.

**Rejected / deprioritized**
- Roundup listicles on "minimal UI design principles" — SEO-heavy, no primary evidence, would not survive `source_check`.
- Secondhand summaries of the Superhuman 100 ms rule and the Arc retrospective — quoted everywhere, sourced nowhere I could confirm without fetching; kept only as flagged, unquoted gist.
- https://web.dev/articles/rail — superseded for target-setting purposes; mentioned only to explain where the "100 ms" folklore comes from.
- Design-token vendor marketing (token-tooling SaaS) — irrelevant to a repo whose tokens are 90 lines of CSS custom properties that already work.

## Next steps

1. **Highest value, cheapest:** re-run the external half of this brief with web tools and `source_check` on four claims only — WCAG 2.5.8 vs 2.5.5 target sizes, WCAG 2.1.4 wording, the VS Code "all commands in the palette" guidance, and the Raycast component constraint. Everything else in section F is directional and does not change a decision.
2. **Repo verification pass (no web needed):** read `plugins/registry.ts`, `components/WorkspacePanel.ts`, `components/ActionPalette.ts`, and the Playwright config to close findings 10, 14 (focus/motion/icon rows), and 22.
3. **Owner decision to surface:** contradiction 1 — is the eleven-member `PluginContributions` surface public API or core-only? That answer determines whether the declarative-vocabulary recommendation (finding 21) is urgent or optional.
4. **If exactly one thing ships from this brief:** the geometry contract test from finding 18 (assert 44 px on visible interactive elements under the `mobile` Playwright project). No flake, no new API, and it mechanically enforces the one rule `AGENTS.md` already says the owner should never have to report again.
