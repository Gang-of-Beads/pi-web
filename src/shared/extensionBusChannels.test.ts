import { describe, expect, it } from "vitest";
import { busChannelOwner, parseBusDeclarations } from "./extensionBusChannels";

describe("the bus channels a package declares", () => {
  it("are named as the extension already emits them, own by default", () => {
    expect(parseBusDeclarations({ "subagent:async-complete": { kind: "event" }, "background:runs": { kind: "state", access: "public" }, "piweb:states:background": { kind: "state" } })).toEqual([
      { channel: "subagent:async-complete", kind: "event", access: "own" },
      { channel: "background:runs", kind: "state", access: "public" },
      { channel: "piweb:states:background", kind: "state", access: "own" },
    ]);
    expect([parseBusDeclarations(undefined), busChannelOwner("subagent:slash:request")]).toEqual([[], "subagent"]);
  });

  it("are refused with the reason: a bare name, a reserved owner, an unknown kind or access", () => {
    const reason = (value: unknown): string => { try { parseBusDeclarations(value); return "accepted"; } catch (error) { return error instanceof Error ? error.message : String(error); } };
    expect(["piweb:states:core", "piweb:states:plugins", "piweb:other"].map((channel) => reason({ [channel]: { kind: "state" } }))).toEqual([
      'piWeb.bus channel "piweb:states:core" is under a reserved owner',
      'piWeb.bus channel "piweb:states:plugins" is under a reserved owner',
      'piWeb.bus channel "piweb:other" is under a reserved owner',
    ]);
    expect([reason({ error: { kind: "event" } }), reason({ "pi:x": { kind: "event" } }), reason({ "a:b": { kind: "stream" } }), reason({ "a:b": { kind: "state", access: "all" } }), reason([])]).toEqual([
      'piWeb.bus channel "error" is not <owner>:<name> in lower case',
      'piWeb.bus channel "pi:x" is under a reserved owner',
      'piWeb.bus channel "a:b" needs kind: state, event or request',
      'piWeb.bus channel "a:b" has an access that is neither own nor public',
      "piWeb.bus must be an object of channel names",
    ]);
  });
});
