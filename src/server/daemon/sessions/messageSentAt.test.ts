import { describe, expect, it } from "vitest";
import { messageSentAt } from "./messageSentAt.js";

const acceptedAt = "2026-10-02T12:24:04.000Z";

describe("messageSentAt", () => {
  const cases: { name: string; claimed: unknown; shown: string }[] = [
    { name: "keeps the sender's time before acceptance", claimed: "2026-10-02T12:23:49.000Z", shown: "2026-10-02T12:23:49.000Z" },
    { name: "keeps a sender's time equal to acceptance", claimed: acceptedAt, shown: acceptedAt },
    { name: "normalises an offset time to UTC", claimed: "2026-10-02T14:23:50.000+02:00", shown: "2026-10-02T12:23:50.000Z" },
    { name: "never puts a message after its acceptance (a phone clock running fast)", claimed: "2026-10-02T12:26:00.000Z", shown: acceptedAt },
    { name: "takes acceptance when the sender gave no time", claimed: undefined, shown: acceptedAt },
    { name: "takes acceptance for a time that does not parse", claimed: "yesterday-ish", shown: acceptedAt },
    { name: "takes acceptance for a time that is not a string", claimed: 1790871844000, shown: acceptedAt },
  ];

  it.each(cases)("$name", ({ claimed, shown }) => {
    expect(messageSentAt(claimed, acceptedAt)).toBe(shown);
  });
});
