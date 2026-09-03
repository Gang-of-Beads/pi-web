import { describe, expect, it } from "vitest";
import { promptDeliveryBehavior } from "./promptDelivery";

describe("how a prompt is handed to the runtime", () => {
  it("keeps a follow-up queued while the runtime is still busy", () => {
    expect(promptDeliveryBehavior({ requestedBehavior: "followUp", busyAtSubmit: true })).toBe("followUp");
  });

  it("keeps a steer queued while the runtime is still busy", () => {
    expect(promptDeliveryBehavior({ requestedBehavior: "steer", busyAtSubmit: true })).toBe("steer");
  });

  it("sends outright when the turn ended before the prompt was submitted", () => {
    expect(promptDeliveryBehavior({ requestedBehavior: "followUp", busyAtSubmit: false })).toBeUndefined();
    expect(promptDeliveryBehavior({ requestedBehavior: "steer", busyAtSubmit: false })).toBeUndefined();
  });

  it("leaves a direct send direct whatever the runtime is doing", () => {
    expect(promptDeliveryBehavior({ requestedBehavior: undefined, busyAtSubmit: true })).toBeUndefined();
    expect(promptDeliveryBehavior({ requestedBehavior: undefined, busyAtSubmit: false })).toBeUndefined();
  });
});
