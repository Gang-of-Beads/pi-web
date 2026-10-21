import { describe, expect, it } from "vitest";
import {
  checkNodePtyNativeModule,
  formatNodePtyNativeModuleCheck,
  NODE_PTY_GLOBAL_REINSTALL_COMMAND,
} from "./nodePtyNativeModule.js";

describe("node-pty native module diagnostics", () => {
  it("passes when node-pty loads", () => {
    const check = checkNodePtyNativeModule({ load: () => ({ spawn: () => undefined }) });

    expect(check).toEqual({ status: "ok" });
    expect(formatNodePtyNativeModuleCheck(check, "warning", "linux")).toEqual({
      ok: true,
      lines: ["✓ node-pty native module loadable"],
    });
  });

  it("warns in doctor, fails the install, and reports the build tools and the scoped global reinstall command when node-pty cannot load", () => {
    const check = checkNodePtyNativeModule({
      load: () => { throw new Error("Failed to load native module: pty.node\nchecked build/Release"); },
    });

    expect(check).toEqual({
      status: "load-failed",
      message: "Failed to load native module: pty.node checked build/Release",
    });
    const formatted = formatNodePtyNativeModuleCheck(check, "warning", "linux");
    expect(formatted.ok).toBe(false);
    expect(formatted.lines[0]).toBe("! node-pty native module loadable");
    expect(formatNodePtyNativeModuleCheck(check, "failure", "linux").lines[0]).toBe("✗ node-pty native module loadable");
    const elsewhere = formatNodePtyNativeModuleCheck(check, "warning", "other").lines;
    expect(elsewhere.join("\n")).not.toContain("python3");
    expect(elsewhere).toContain(`    ${NODE_PTY_GLOBAL_REINSTALL_COMMAND}`);
    expect(elsewhere).toContain("  Terminals are unavailable until it loads; sessions keep working.");
    expect(formatted.lines).toContain(`    ${NODE_PTY_GLOBAL_REINSTALL_COMMAND}`);
    expect(formatted.lines).toContain("  Then run `pi-web doctor` again.");
    expect(formatted.lines).toContain("  Terminals are unavailable until it loads; sessions keep working.");
    expect(formatted.lines.join("\n")).toContain("python3, make and a C++ compiler");
    expect(formatted.lines.join("\n")).not.toContain("dangerously-allow-all-scripts");
  });
});
