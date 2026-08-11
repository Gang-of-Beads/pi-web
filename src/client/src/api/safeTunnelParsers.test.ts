import { describe, expect, it } from "vitest";
import {
  parseSafeTunnelDisableResponse,
  parseSafeTunnelEnableResponse,
  parseSafeTunnelOperationResponse,
  parseSafeTunnelStatusResponse,
} from "./safeTunnelParsers";

describe("Safe Tunnel API parsers", () => {
  it("parses status, approval progress, enable, and disable responses", () => {
    const operation = operationResponse();
    const status = statusResponse(operation);

    expect(parseSafeTunnelStatusResponse({ ...status, ignored: "not exposed" })).toEqual(status);
    expect(parseSafeTunnelEnableResponse({ accepted: true, operation, status })).toEqual({
      accepted: true,
      operation,
      status,
    });
    expect(parseSafeTunnelDisableResponse({ status })).toEqual({ status });
  });

  it("rejects malformed state, operation, and diagnostic enums", () => {
    expect(() => parseSafeTunnelStatusResponse({
      config: { path: "/tmp/config", exists: false, state: "missing" },
      desiredState: "disabled",
      runtime: { state: "stale" },
    })).toThrow("Expected Safe Tunnel runtime state field: state");
    expect(() => parseSafeTunnelStatusResponse({
      config: { path: "/tmp/config", exists: false, state: "missing" },
      desiredState: "sometimes",
      runtime: { state: "stopped" },
    })).toThrow("Expected Safe Tunnel desired state field: desiredState");
    expect(() => parseSafeTunnelOperationResponse({
      ...operationResponse(),
      phase: "future",
    })).toThrow("Expected Safe Tunnel operation phase field: phase");
    expect(() => parseSafeTunnelStatusResponse({
      config: { path: "/tmp/config", exists: true, state: "rejected" },
      desiredState: "enabled",
      runtime: { state: "stopped", diagnosticCode: "provider_secret" },
    })).toThrow("Expected Safe Tunnel runtime diagnostic field: diagnosticCode");
  });

  it("requires accepted enable responses and typed optional fields", () => {
    expect(() => parseSafeTunnelEnableResponse({ accepted: false })).toThrow("Expected Safe Tunnel enable accepted response");
    expect(() => parseSafeTunnelStatusResponse({
      config: { path: "/tmp/config", exists: false, state: "missing", frpcPathConfigured: "no" },
      desiredState: "disabled",
      runtime: { state: "stopped" },
    })).toThrow("Expected optional boolean field: frpcPathConfigured");
    expect(() => parseSafeTunnelOperationResponse({
      ...operationResponse(),
      logTailMaxCharacters: Number.POSITIVE_INFINITY,
    })).toThrow("Expected optional number field: logTailMaxCharacters");
    expect(() => parseSafeTunnelOperationResponse({
      ...operationResponse(),
      verificationUriComplete: "javascript:alert(1)",
    })).toThrow("Expected HTTP(S) URL field: verificationUriComplete");
  });
});

function operationResponse() {
  return {
    id: "op_1",
    kind: "enable",
    phase: "awaiting_approval",
    status: "running",
    startedAt: "2026-07-03T00:00:00.000Z",
    stdout: "Waiting for approval.\n",
    stderr: "",
    userCode: "ABCD-EFGH",
    verificationUriComplete: "https://control.example.test/device?user_code=ABCD-EFGH",
  };
}

function statusResponse(activeOperation = operationResponse()) {
  return {
    config: {
      path: "/home/test/.pi-web/safe-tunnel/config.json",
      exists: true,
      state: "registered",
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPathConfigured: false,
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId: "machine_1",
        machineSlug: "dev-box",
        publicHostname: "dev-box.example.test",
        publicUrl: "https://dev-box.example.test",
      },
    },
    desiredState: "enabled",
    runtime: {
      state: "stopped",
      diagnosticCode: "credentials_rejected",
      error: "Safe Tunnel access was rejected.",
      logPath: "/home/test/.pi-web/safe-tunnel/frpc.log",
      logExists: true,
      logTail: "frpc stopped\n",
      logTailMaxCharacters: 12_000,
    },
    activeOperation,
  };
}
