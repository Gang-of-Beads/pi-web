# Review triage: the owned-queue arc (2026-09-04)

Three anonymous max-thinking lanes (glm-5.3-flash x2, qwen3.8-flash-next)
reviewed the durable prompt queue arc. All three returned BLOCK. Verdicts per
finding; fixed items landed in "the review wave against the owned queue arc".

## Fixed

- Drain stall (all three lanes, P0): agent_end fires inside the SDK's running
  loop with isStreaming still true; drain gated on the flag never fired. Armed
  agent_settled + compaction_end, added a heartbeat backstop, re-arm while
  entries remain. Regression tests emit the real event ordering; the old
  fake-flipped-flag test was the proof of the fake-vs-real gap.
- Drain refusal destroyed the entry (glm-a P1, qwen P1-2): drain now hands
  "followUp" (re-decided at submit against a busy runtime) and restores the
  entry on refusal; submitPrompt reports delivered/refused.
- Restart idempotency (glm-a P1): restored entries re-seed the acceptance
  ledger; outbox retries after a restart settle as duplicates.
- Persist races (glm-a P1, qwen P2-1): per-session serialization of every
  queue operation; unique staged filenames.
- Corrupt file silently read as empty (glm-a/qwen): quarantined to .corrupt
  and logged; persist failures logged.
- Rebind duplication of id-less entries (glm-b P1): merge dedupes by content.
- hasActiveWork ignored parked entries (glm-a P2): counted now.
- clearQueue ledger forget resurrected cleared ids (glm-a P2): records kept.
- Client flush clear-and-replay (all three): per-id deletion of accepted ids,
  membership re-check before each send, single flush in flight, acceptance
  contract unified to explicit-false-refuses.
- Strip cross-session scope (glm-b P1): pendingPrompts reloads on session or
  machine change.
- Reveal timer pile-up and disconnect leak (qwen P2-5): single stored handle,
  cleared on disconnect.

## Not fixed, with reasons

- Reconnect-flush trigger (all three, P2): the doc overpromised; narrowed to
  load + browser online + manual Retry, gap recorded in message-sync.md. A
  socket-reconnect trigger needs a PromptEditor-visible reconnect signal;
  follow-up work, not silently claimed.
- Queue file location `.pi/queued-prompts/` in the workspace (qwen P2-2,
  including inlined base64 images): real concern - workspace vs data-dir
  placement is a product call for the owner (session cwd is what survives and
  travels; data dir is machine state). Owner decision pending; images-on-disk
  size risk noted.
- Two-phase take (stage-then-delete around the runtime commit, qwen P1-2
  second half): the restore-on-refusal path covers the runtime refusal; a
  daemon crash between take-persist and commit still loses that one entry.
  Bounded residual, recorded; a staged in-flight file is the follow-up shape.

## Judged not true

- glm-b "drain-into-busy is handled" (dismissal): wrong - with behavior
  undefined promptDeliveryBehavior returns undefined regardless of busy;
  adjudicated against source, glm-a's finding stood and is fixed.
- qwen "flush treats non-true as failure is latent only": current wiring
  returns booleans, but the two contracts in one file were real; unified.
