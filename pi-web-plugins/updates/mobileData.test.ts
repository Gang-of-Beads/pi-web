import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOBILE_DATA_CHOICE,
  isMeteredConnection,
  MOBILE_DATA_STORAGE_KEY,
  readMobileDataChoice,
  updateGate,
  writeMobileDataChoice,
} from "./mobileData";

describe("the mobile-data choice", () => {
  it("defaults to asking, so nothing downloads on a metered link unannounced", () => {
    expect(DEFAULT_MOBILE_DATA_CHOICE).toBe("ask");
    expect(readMobileDataChoice(undefined)).toBe("ask");
    expect(readMobileDataChoice({ getItem: () => null, setItem: () => undefined })).toBe("ask");
    expect(readMobileDataChoice({ getItem: () => "nonsense", setItem: () => undefined })).toBe("ask");
  });

  it("round-trips through storage and survives a storage that throws", () => {
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
    writeMobileDataChoice(storage, "never");
    expect(memory.get(MOBILE_DATA_STORAGE_KEY)).toBe("never");
    expect(readMobileDataChoice(storage)).toBe("never");

    writeMobileDataChoice({ getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } }, "auto");
    expect(readMobileDataChoice({ getItem: () => { throw new Error("denied"); }, setItem: () => undefined })).toBe("ask");
  });
});

describe("recognising a metered connection", () => {
  it("is cellular only when the browser says so", () => {
    expect(isMeteredConnection({ type: "cellular" })).toBe(true);
    expect(isMeteredConnection({ type: "wifi" })).toBe(false);
    expect(isMeteredConnection({ type: "ethernet" })).toBe(false);
    expect(isMeteredConnection(undefined)).toBe(false);
  });

  it("falls back to a slow effective type where the type is missing", () => {
    expect(isMeteredConnection({ effectiveType: "3g" })).toBe(true);
    expect(isMeteredConnection({ effectiveType: "4g" })).toBe(false);
  });
});

describe("the update gate", () => {
  it("never interrupts a wired or Wi-Fi link", () => {
    for (const choice of ["ask", "auto", "never"] as const) expect(updateGate(choice, false)).toBe("direct");
  });

  it("asks by default on mobile data, downloads freely only when allowed", () => {
    expect(updateGate("ask", true)).toBe("ask");
    expect(updateGate("auto", true)).toBe("direct");
    expect(updateGate("never", true)).toBe("warn");
  });
});
