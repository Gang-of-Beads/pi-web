# Upstream issue drafts

Maintainer-facing drafts for issues to file against the upstream pi projects.
Both technical claims were reproduced against our installed snapshot (Aug 2026);
file them with the version pin noted in each draft.

---

## Draft 1 — pi-ai: 400 `invalid_request_error` about `thinking` blocks

**Title:** Anthropic: conversation replay re-sends `thinking` blocks in a shape
the API rejects (400 invalid_request_error)

**Body:**

On some turns the request to the Anthropic API carries `thinking` blocks that
the API rejects with a 400 `invalid_request_error` saying the `thinking` blocks
cannot be modified (the exact wording varies with the shape of the replay). The
conversation contains assistant turns whose `thinking` blocks were recorded
earlier and are being re-sent on a later call.

Where it looks like it breaks: the Anthropic provider's content-array
reconstruction for the outgoing request keeps `thinking` blocks attached to
assistant messages without normalizing them to what the current request
signature allows — signature-less thinking blocks are rejected; blocks whose
signature was computed for a different context are treated as "modified".

Observed impact: the whole turn fails with a 400, the agent reports the
provider refused the request, and retrying does not clear it because the same
replay is sent again. The user sees a dead turn until the session is compacted
or the offending message is pruned.

Expected: either thinking blocks are dropped or normalized when they cannot be
re-sent validly for the current request, or the replay preserves whatever
signatures the API requires. A clear error naming the offending block would
already be a big improvement over the generic 400.

Environment: @earendil-works/pi-coding-agent, Aug 2026 snapshot, Anthropic
provider, extended-thinking models.

---

## Draft 2 — pi core: one malformed transcript entry kills every stats/status read for a session

**Title:** agent-session: `getSessionStats` reads `assistantMsg.usage`
unguarded — one malformed entry breaks status for the whole session

**Body:**

`getSessionStats` calls `addUsageToTotals(usageTotals, assistantMsg.usage)` for
every assistant message without checking that `usage` exists. The two
neighboring call sites are guarded (`branch_summary`/`compaction` entries check
`entry.usage`; `toolResult` messages check `message.usage`); the assistant
branch is not.

`addUsageToTotals` then reads `usage.input` unguarded, so any assistant entry
whose JSON line lacks `usage` — a hand-edited session file, a crashed writer, a
third-party tool appending to the jsonl — makes every subsequent
`getSessionStats()` call throw `Cannot read properties of undefined (reading
'input')`.

Downstream blast radius (observed in pi-web, which calls `getSessionStats`
during status projection): the session's whole status surface fails — commands
that touch stats return 500s and the browser cannot render the session. One
malformed line takes down the session's status until the file is repaired.

Expected: guard the assistant branch like its siblings (`if
(assistantMsg.usage)`), so a malformed entry degrades that message's token
accounting instead of killing the session's status. The guard belongs on the
reader side, because producers include humans and external tools editing the
jsonl.

Fix sketch: one-line `if (assistantMsg.usage)` before the unguarded call, or
normalize inside `addUsageToTotals`.
