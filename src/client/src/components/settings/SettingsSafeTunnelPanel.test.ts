// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  safeTunnelApi,
  type SafeTunnelOperationResponse,
  type SafeTunnelStatusResponse,
} from "../../api";
import {
  createSafeTunnelEnableRequest,
  safeTunnelAdvancedValidationMessage,
  safeTunnelPresentation,
  safeTunnelRuntimeSummary,
  SettingsSafeTunnelPanel,
} from "./SettingsSafeTunnelPanel";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Safe Tunnel enable request helpers", () => {
  it("uses an empty request for the normal inferred production flow", () => {
    const fields = emptyAdvancedFields();

    expect(safeTunnelAdvancedValidationMessage(fields)).toBeUndefined();
    expect(createSafeTunnelEnableRequest(fields)).toEqual({});
  });

  it("validates and normalizes only explicit advanced overrides", () => {
    expect(safeTunnelAdvancedValidationMessage({
      ...emptyAdvancedFields(),
      controlApiUrl: "ftp://control.example.test",
    })).toBe("Advanced Control API URL must use http:// or https://.");
    expect(safeTunnelAdvancedValidationMessage({
      ...emptyAdvancedFields(),
      machineSlug: "Dev Box",
    })).toContain("lowercase DNS label");
    expect(safeTunnelAdvancedValidationMessage({
      ...emptyAdvancedFields(),
      localPiWebUrl: "http://127.0.0.1",
    })).toContain("explicit port");

    expect(createSafeTunnelEnableRequest({
      controlApiUrl: " http://127.0.0.1:8787 ",
      machineName: " Dev Box ",
      machineSlug: " dev-box ",
      localPiWebUrl: " http://127.0.0.1:8504 ",
      frpcPath: " /opt/frpc ",
    })).toEqual({
      advanced: {
        controlApiUrl: "http://127.0.0.1:8787",
        machineName: "Dev Box",
        machineSlug: "dev-box",
        localPiWebUrl: "http://127.0.0.1:8504",
        frpcPath: "/opt/frpc",
      },
    });
  });

  it("presents enabled, recovering, disabled, and revoked states as one action", () => {
    expect(safeTunnelPresentation(safeTunnelStatus({ desiredState: "disabled", runtimeState: "stopped" }))).toMatchObject({
      action: "enable",
      label: "Disabled",
    });
    expect(safeTunnelPresentation(safeTunnelStatus({ desiredState: "enabled", runtimeState: "running" }))).toMatchObject({
      action: "disable",
      label: "Enabled",
    });
    expect(safeTunnelPresentation(safeTunnelStatus({ desiredState: "enabled", runtimeState: "unknown" }))).toMatchObject({
      action: "disable",
      label: "Recovering",
    });
    expect(safeTunnelPresentation(safeTunnelStatus({ rejected: true }))).toMatchObject({
      action: "enable",
      label: "Approval required",
    });
    expect(safeTunnelPresentation(safeTunnelStatus({
      desiredState: "disabled",
      rejected: true,
      runtimeState: "running",
    }))).toMatchObject({ action: "disable", label: "Enabled" });
    expect(safeTunnelRuntimeSummary({ state: "running", pid: 1234 })).toBe("Running (PID 1234)");
  });
});

describe("settings-safe-tunnel-panel", () => {
  it("renders one normal Enable Safe Tunnel action without manual fields", async () => {
    vi.spyOn(safeTunnelApi, "status").mockResolvedValue(safeTunnelStatus({
      desiredState: "disabled",
      registered: false,
      runtimeState: "stopped",
    }));

    const panel = await renderPanel();
    const root = requiredShadowRoot(panel);

    expect(root.textContent).toContain("Safe Tunnel is off");
    expect(buttonByText(root, "Enable Safe Tunnel")).toBeDefined();
    expect(root.textContent).toContain("Advanced development and self-hosting overrides");
    expect(root.querySelector("details.advanced-card")?.hasAttribute("open")).toBe(false);
    expect(root.textContent).not.toContain("Start tunnel");
    expect(root.textContent).not.toContain("Start login");
  });

  it("carries approval progress through automatic supervision and public URL", async () => {
    const initial = safeTunnelStatus({
      desiredState: "disabled",
      registered: false,
      runtimeState: "stopped",
    });
    const awaitingApproval = safeTunnelOperation({ phase: "awaiting_approval" });
    vi.spyOn(safeTunnelApi, "status").mockResolvedValue(initial);
    const enableSpy = vi.spyOn(safeTunnelApi, "enable").mockResolvedValue({
      accepted: true,
      operation: awaitingApproval,
      status: { ...initial, activeOperation: awaitingApproval },
    });

    const panel = await renderPanel();
    buttonByText(requiredShadowRoot(panel), "Enable Safe Tunnel").click();
    await vi.waitFor(() => { expect(enableSpy).toHaveBeenCalledWith({}); });
    await panel.updateComplete;

    const root = requiredShadowRoot(panel);
    expect(root.textContent).toContain("Waiting for your approval");
    expect(root.textContent).toContain("Approve this PI WEB");
    expect(root.textContent).toContain("ABCD-EFGH");
    expect(root.textContent).toContain("Open approval page");
    expect(root.textContent).toContain("Disable Safe Tunnel");

    const enabled = safeTunnelOperation({
      phase: "enabled",
      status: "succeeded",
      publicUrl: "https://dev-host-a1b2c3d4.ns.tunnels.pi-web.dev",
    });
    vi.spyOn(safeTunnelApi, "operation").mockResolvedValue(enabled);
    vi.spyOn(safeTunnelApi, "status").mockResolvedValue(safeTunnelStatus({
      desiredState: "enabled",
      runtimeState: "running",
    }));
    await callPanelPromise(panel, "pollOperation", enabled.id);
    await panel.updateComplete;

    expect(root.textContent).toContain("Safe Tunnel is enabled");
    expect(root.textContent).toContain("https://dev-host-a1b2c3d4.ns.tunnels.pi-web.dev");
  });

  it("sends edited values only through the advanced override envelope", async () => {
    const initial = safeTunnelStatus({ desiredState: "disabled", runtimeState: "stopped" });
    const operation = safeTunnelOperation({ phase: "starting" });
    vi.spyOn(safeTunnelApi, "status").mockResolvedValue(initial);
    const enableSpy = vi.spyOn(safeTunnelApi, "enable").mockResolvedValue({
      accepted: true,
      operation,
      status: { ...initial, activeOperation: operation },
    });
    const panel = await renderPanel();
    const root = requiredShadowRoot(panel);

    setInput(root, "Control API URL", "http://127.0.0.1:8787");
    setInput(root, "Machine name", "Dev Box");
    setInput(root, "Machine slug", "dev-box");
    setInput(root, "Local PI WEB URL", "http://127.0.0.1:9500");
    setInput(root, "frpc path", "/opt/frpc");
    buttonByText(root, "Enable Safe Tunnel").click();

    await vi.waitFor(() => {
      expect(enableSpy).toHaveBeenCalledWith({
        advanced: {
          controlApiUrl: "http://127.0.0.1:8787",
          machineName: "Dev Box",
          machineSlug: "dev-box",
          localPiWebUrl: "http://127.0.0.1:9500",
          frpcPath: "/opt/frpc",
        },
      });
    });
  });

  it("shows durable revocation diagnostics and offers re-approval", async () => {
    vi.spyOn(safeTunnelApi, "status").mockResolvedValue(safeTunnelStatus({
      desiredState: "enabled",
      rejected: true,
      runtimeState: "stopped",
    }));

    const panel = await renderPanel();
    const root = requiredShadowRoot(panel);

    expect(root.textContent).toContain("Hosted access needs your approval again");
    expect(root.textContent).toContain("Safe Tunnel approval is no longer valid");
    expect(root.textContent).toContain("rejected or revoked");
    expect(buttonByText(root, "Enable Safe Tunnel")).toBeDefined();
  });

  it("uses Disable Safe Tunnel to cancel or stop the whole flow", async () => {
    const operation = safeTunnelOperation({ phase: "awaiting_approval" });
    const enabling = safeTunnelStatus({
      activeOperation: operation,
      desiredState: "disabled",
      runtimeState: "stopped",
    });
    const disabled = safeTunnelStatus({ desiredState: "disabled", runtimeState: "stopped" });
    vi.spyOn(safeTunnelApi, "status").mockResolvedValue(enabling);
    const disableSpy = vi.spyOn(safeTunnelApi, "disable").mockResolvedValue({ status: disabled });

    const panel = await renderPanel();
    buttonByText(requiredShadowRoot(panel), "Disable Safe Tunnel").click();
    await vi.waitFor(() => { expect(disableSpy).toHaveBeenCalledOnce(); });
    await panel.updateComplete;

    expect(requiredShadowRoot(panel).textContent).toContain("Safe Tunnel is disabled");
    expect(buttonByText(requiredShadowRoot(panel), "Enable Safe Tunnel")).toBeDefined();
  });
});

function emptyAdvancedFields() {
  return {
    controlApiUrl: "",
    machineName: "",
    machineSlug: "",
    localPiWebUrl: "",
    frpcPath: "",
  };
}

interface SafeTunnelStatusOptions {
  activeOperation?: SafeTunnelOperationResponse;
  desiredState?: SafeTunnelStatusResponse["desiredState"];
  registered?: boolean;
  rejected?: boolean;
  runtimeState?: SafeTunnelStatusResponse["runtime"]["state"];
}

function safeTunnelStatus(options: SafeTunnelStatusOptions = {}): SafeTunnelStatusResponse {
  const registered = options.registered ?? true;
  const rejected = options.rejected ?? false;
  return {
    connector: {
      command: "PI WEB built-in frpc supervisor",
      state: "available",
    },
    config: {
      path: "/home/test/.pi-web/safe-tunnel/config.json",
      exists: registered,
      state: rejected ? "rejected" : registered ? "registered" : "missing",
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPathConfigured: false,
      ...(registered ? {
        machine: {
          controlApiBaseUrl: "https://api.tunnels.pi-web.dev",
          machineId: "machine_1",
          machineSlug: "dev-host-a1b2c3d4",
          publicUrl: "https://dev-host-a1b2c3d4.ns.tunnels.pi-web.dev",
        },
      } : {}),
    },
    desiredState: options.desiredState ?? (rejected ? "enabled" : "disabled"),
    runtime: {
      state: options.runtimeState ?? "stopped",
      ...(rejected ? {
        diagnosticCode: "credentials_rejected",
        error: "Safe Tunnel access for this PI WEB was rejected or revoked.",
      } : {}),
    },
    ...(options.activeOperation === undefined
      ? {}
      : { activeOperation: options.activeOperation }),
  };
}

function safeTunnelOperation(options: {
  phase: SafeTunnelOperationResponse["phase"];
  publicUrl?: string;
  status?: SafeTunnelOperationResponse["status"];
}): SafeTunnelOperationResponse {
  return {
    id: "op_1",
    kind: "enable",
    phase: options.phase,
    status: options.status ?? "running",
    startedAt: "2026-07-03T00:00:00.000Z",
    stdout: "Waiting for approval.\n",
    stderr: "",
    ...(options.phase === "awaiting_approval" ? {
      userCode: "ABCD-EFGH",
      verificationUriComplete: "https://api.tunnels.pi-web.dev/device?user_code=ABCD-EFGH",
    } : {}),
    ...(options.publicUrl === undefined ? {} : { publicUrl: options.publicUrl }),
  };
}

async function renderPanel(): Promise<SettingsSafeTunnelPanel> {
  const panel = new SettingsSafeTunnelPanel();
  document.body.append(panel);
  await vi.waitFor(() => {
    expect(Reflect.get(panel, "loading")).toBe(false);
  });
  await panel.updateComplete;
  return panel;
}

function requiredShadowRoot(panel: SettingsSafeTunnelPanel): ShadowRoot {
  if (panel.shadowRoot === null) throw new Error("Safe Tunnel panel has no shadow root");
  return panel.shadowRoot;
}

function buttonByText(root: ShadowRoot, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")]
    .find((candidate) => candidate.textContent.trim() === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`);
  return button;
}

function setInput(root: ShadowRoot, labelText: string, value: string): void {
  const label = [...root.querySelectorAll("label")]
    .find((candidate) => candidate.textContent.includes(labelText));
  const input = label?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input: ${labelText}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

async function callPanelPromise(
  panel: SettingsSafeTunnelPanel,
  methodName: string,
  ...args: readonly unknown[]
): Promise<void> {
  const method: unknown = Reflect.get(panel, methodName);
  if (typeof method !== "function") throw new Error(`Missing panel method: ${methodName}`);
  const result: unknown = Reflect.apply(method, panel, args);
  if (!(result instanceof Promise)) throw new Error(`Panel method is not async: ${methodName}`);
  await result;
}
