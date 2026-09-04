# Review triage: plugin contract wave

Four lanes on the contract wave (two glm max with split focus, one qwen max
full pass, one dedicated red team), all read-only. Every finding below is
adjudicated; nothing is left implied.

## Fixed

- **Unregister was incomplete** (glm-contract P1, qwen P1-1 adjacent).
  `disposePlugin` cleared listeners, disposers and settings but left the
  plugin's contributions, plugin id and qualified ids registered, so a
  disposed plugin kept offering actions and panels it could no longer answer
  for, and its id could never be reused. It now removes the plugin whole and
  frees its qualified ids; pinned by "takes its contributions off every
  surface" and "frees its ids so the same plugin can register again".
- **Registration was not atomic** (qwen P1-1, red team). `activate()` runs
  before contributions are qualified, so a rejected registration left live
  subscriptions, settings and a disposer belonging to a plugin the host
  believes it never loaded. Failure now releases those resources before
  rethrowing; pinned by "leaves no listener behind when a registration is
  refused after activation" and "runs the plugin dispose exactly once when
  refused".
- **Duplicate tag claims inside one registration passed silently** (qwen
  P1-2), contradicting the contract's own promise that a second claim is
  refused. The in-progress claims are now tracked alongside the committed
  ones.
- **Scoped storage staged filename collided under concurrent writes**
  (glm-storage P1, red team P1). Two writes to one key shared one staged path,
  so an interleaving could publish a mixture of both documents, which then
  read back as undefined - silent state loss under an invariant that promised
  the opposite. The staged name now carries a per-write uuid, and a failed
  write removes its own staged file instead of orphaning it.

## Judged not true

- **Machine scoping of the new contribution kinds** (glm-contract hunt 2):
  the three new getters filter through the same `isContributionActive`
  predicate as actions and panels; gateway/remote precedence was traced
  across three orderings with no cross-machine leak.
- **Required `storage` field breaking published apiVersion 1 plugins**
  (glm-storage hunt 4): the context is host-supplied, so a plugin that only
  consumes it keeps typechecking and activating. Only code constructing a
  full context is affected, which is in-repo test doubles, and
  `memoryPluginStorage` exists for exactly that.
- **Storage path escape** (glm-storage hunt 1, red team attack 5): the key
  pattern rejects separators in every position and `documentPath` re-checks
  containment after `resolve`; plugin ids are catalog-validated before they
  reach the directory join.
- **Qualified id forgery across plugins** (red team attack 5): plugin and
  local ids both exclude colons, so the qualified form is injective.
- **Listener, render, dispose and activation throws** (red team attack 1):
  isolated at every seam, with tests on each.

## Not fixed, with reason

- **No production producer calls `applyPluginSettings` or `emit` yet** (qwen
  P1-3). True and deliberate: this is the contract wave, and the consumer
  wave is the next task. The seam would be dead code if wired before the
  surfaces that read it, and wiring it twice is how a second producer gets
  born. It is tracked as the first item of the consumer wave.
- **The message renderer chrome promise is not yet enforceable** (qwen).
  Also true: no consumer exists, so nothing supplies chrome today. The
  promise is enforced when the transcript reads the registry, and the
  consumer wave owes a test that a plugin body cannot escape the card
  chrome.
- **Gateway tag and per-machine tag may coexist with order-dependent
  precedence** (qwen, doc-only). Left as is for v1: the same precedence rule
  already governs actions and panels, and changing it for renderers alone
  would make one kind behave unlike its siblings.
