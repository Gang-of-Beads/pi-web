import { describe, expect, it } from "vitest";
import { FIRST_OPEN_GRACE_MS, anchoredRead, graceRemaining, type SocketPhase } from "./socketAnchoredRead";

describe("anchoredRead (P6 slice a)", () => {
  const now = 10_000;
  const cases: readonly { name: string; phase: SocketPhase; read: ReturnType<typeof anchoredRead>; remaining: number }[] = [
    { name: "no socket for the machine: read now", phase: { kind: "absent" }, read: "read", remaining: 0 },
    { name: "socket open: the read leaves after the subscription, read now", phase: { kind: "open" }, read: "read", remaining: 0 },
    { name: "socket just started connecting: leave it to the open", phase: { kind: "connecting", since: now }, read: "await-open", remaining: FIRST_OPEN_GRACE_MS },
    { name: "socket connecting for less than the grace: leave it to the open", phase: { kind: "connecting", since: now - FIRST_OPEN_GRACE_MS + 1 }, read: "await-open", remaining: 1 },
    { name: "socket connecting for the whole grace: read anyway", phase: { kind: "connecting", since: now - FIRST_OPEN_GRACE_MS }, read: "read", remaining: 0 },
    { name: "socket connecting for long: read anyway", phase: { kind: "connecting", since: now - 60_000 }, read: "read", remaining: 0 },
  ];

  it.each(cases)("$name", ({ phase, read, remaining }) => {
    expect({ read: anchoredRead(phase, now), remaining: graceRemaining(phase, now) }).toEqual({ read, remaining });
  });
});
