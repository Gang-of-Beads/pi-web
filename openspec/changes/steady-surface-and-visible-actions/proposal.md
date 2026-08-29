## Why

The owner cannot reliably operate his own app on a phone. A question card waiting
for his answer is pushed down the screen by whatever the agent is writing, so he
cannot tap it; the region under the transcript jitters while a reply streams; and
actions he does manage to press say nothing back, so he presses them again. He
pressed Resume four times believing it was dead - it had been accepted each time
and applied after the running turn. He pressed "Update now" more than ten times
against a path that could never install anything.

Two invariants are being violated, and both were violated by many different
producers, which is why fixing them one symptom at a time has failed repeatedly:

1. **Nothing moves under the user.** A surface awaiting input keeps its position.
2. **Every action acknowledges itself.** A silent action is indistinguishable
   from a broken one, so the user retries it - sometimes destructively.

## What Changes

- A pending question (ask card or extension dialog) holds a stable position
  while it waits, regardless of what arrives in the transcript.
- The region between the transcript and the composer keeps a constant height
  while a reply streams; anything that appears or disappears there reserves its
  space instead of displacing its neighbours.
- Slash commands and shell input become visible work: they appear in the
  transcript when issued, carry an explicit state (queued -> running -> result),
  and report success or failure. Today they take a separate route and leave no
  trace anywhere, which is why goal buttons read as dead.
- Goal panel buttons acknowledge the press immediately rather than after the
  next poll, and say when the command is waiting for the running turn to end.
- A cancelled question states who cancelled it and why. **BREAKING** for
  readers who relied on the bare "Cancelled" label: the card now carries a
  reason, and voiding an unanswered question because the user typed something
  else is stated explicitly rather than implied.

## Capabilities

### New Capabilities

- `chat/pending-input-stability`: what the app guarantees about the position and
  geometry of any surface that is waiting for the user, and about the region
  below the transcript while content streams.
- `chat/action-acknowledgment`: what every user-triggered action must report at
  press time, while in flight, and on success or failure - including actions
  that are accepted but cannot run until the current turn ends.

### Modified Capabilities

None. This repository has no existing specs; these are the first two, written
for exactly the behaviour this change touches, as brownfield adoption intends.

## Impact

- `src/client/src/components/ChatView.ts` - transcript tail, pending ask and
  dialog slots, the queued strip, the streaming status row.
- `src/client/src/controllers/sessionController.ts` - `send()` routes slash and
  shell input to `runCommand`/`runShell` (line ~379), which is where commands
  become invisible; command lifecycle state must live somewhere the transcript
  can render.
- `src/client/src/components/PiWebApp.ts` - `runGoalCommand` (line ~2979) and
  the goal panel's press feedback.
- `src/server/sessions/piSessionService.ts` - the ask void path
  (`voidOpenAskForUserMessage`, line ~1709) must carry a reason to the browser.
- No daemon protocol change is expected for the geometry work; the command
  lifecycle may need one field on the command response, decided in design.md.

## Non-goals

- Routing goal control off the chat command queue onto a control channel.
  That changes when state mutates relative to a running turn, and it is a
  product-semantics decision the owner has not made yet. This change makes the
  waiting honest; it does not remove the wait.
- Rendering extension TUI surfaces (`ui.custom`) in the browser. Related, worth
  doing, and separately proposed.
- General front-end performance work (forced layout in `updated()`, polling
  cadence). Jitter here is caused by geometry, not by frame budget; performance
  is its own change.
- The subagent run page and the read-only modal question.
