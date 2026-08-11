import { describe, expect, it } from "vitest";
import {
  HttpSafeTunnelControlPlane,
  SafeTunnelControlPlaneError,
  safeTunnelClientVersion,
  type SafeTunnelControlPlaneTimeoutScheduler,
  type SafeTunnelFetch,
} from "./safeTunnelControlPlane.js";

interface ObservedRequest {
  readonly input: string;
  readonly init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sequencedFetch(responses: readonly Response[]): {
  readonly fetch: SafeTunnelFetch;
  readonly requests: readonly ObservedRequest[];
} {
  const requests: ObservedRequest[] = [];
  let index = 0;
  return {
    requests,
    fetch(input, init) {
      requests.push({ input, init });
      const response = responses[index];
      index += 1;
      return response === undefined
        ? Promise.reject(new Error("Unexpected HTTP request"))
        : Promise.resolve(response);
    },
  };
}

function manualTimeoutScheduler(): {
  readonly fire: (index?: number) => void;
  readonly schedule: SafeTunnelControlPlaneTimeoutScheduler;
  readonly tasks: readonly { readonly delayMs: number; active: boolean }[];
} {
  const tasks: { callback: () => void; delayMs: number; active: boolean }[] = [];
  return {
    tasks,
    fire(index = 0) {
      const task = tasks[index];
      if (task?.active !== true) throw new Error("No active timeout to fire");
      task.active = false;
      task.callback();
    },
    schedule(callback, delayMs) {
      const task = { callback, delayMs, active: true };
      tasks.push(task);
      return { cancel: () => { task.active = false; } };
    },
  };
}

function startedAuthorization(): Record<string, unknown> {
  return {
    deviceCode: "piwt_dcode_v1_device",
    userCode: "ABCD-EFGH",
    verificationUri: "https://control.example.test/device",
    verificationUriComplete: "https://control.example.test/device?user_code=ABCD-EFGH",
    expiresAt: "2026-07-29T12:10:00.000Z",
    intervalSeconds: 5,
  };
}

function approvedAuthorization(): Record<string, unknown> {
  return {
    accessToken: "piwt_cat_v1_access",
    tokenType: "Bearer",
    expiresAt: "2026-07-29T12:15:00.000Z",
    account: { id: "account_123", publicNamespace: "ns-abc123" },
  };
}

function heartbeatResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accepted: true,
    machine: {
      id: "machine_123",
      lastSeenAt: "2026-07-29T12:05:00.000Z",
    },
    nextHeartbeatSeconds: 30,
    ...overrides,
  };
}

function registeredMachine(): Record<string, unknown> {
  return {
    machine: {
      id: "machine_123",
      accountId: "account_123",
      name: "Dev Box",
      slug: "dev-box",
    },
    publicHostname: "dev-box.ns-abc123.tunnels.pi-web.dev",
    publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev",
    machineToken: "piwt_mtok_v1_machine",
    tunnelConfigUrl: "/v1/machines/machine_123/tunnel-config",
  };
}

describe("HttpSafeTunnelControlPlane", () => {
  it("owns the device authorization and machine registration HTTP contract", async () => {
    const transport = sequencedFetch([
      jsonResponse(202, startedAuthorization()),
      jsonResponse(409, { error: { code: "authorization_pending", message: "wait" } }),
      jsonResponse(200, approvedAuthorization()),
      jsonResponse(201, registeredMachine()),
    ]);
    const timeouts = manualTimeoutScheduler();
    const controlPlane = new HttpSafeTunnelControlPlane({
      fetch: transport.fetch,
      scheduleTimeout: timeouts.schedule,
    });
    const controller = new AbortController();

    await expect(controlPlane.startDeviceAuthorization({
      controlApiBaseUrl: "https://control.example.test/",
      clientVersion: safeTunnelClientVersion,
    }, { signal: controller.signal })).resolves.toMatchObject({ userCode: "ABCD-EFGH", intervalSeconds: 5 });
    await expect(controlPlane.completeDeviceAuthorization({
      controlApiBaseUrl: "https://control.example.test",
      deviceCode: "piwt_dcode_v1_device",
    }, { signal: controller.signal })).resolves.toEqual({ kind: "pending" });
    await expect(controlPlane.completeDeviceAuthorization({
      controlApiBaseUrl: "https://control.example.test",
      deviceCode: "piwt_dcode_v1_device",
    })).resolves.toMatchObject({
      kind: "approved",
      authorization: { account: { publicNamespace: "ns-abc123" } },
    });
    await expect(controlPlane.registerMachine({
      controlApiBaseUrl: "https://control.example.test",
      connectorAccessToken: "piwt_cat_v1_access",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      clientVersion: safeTunnelClientVersion,
    })).resolves.toMatchObject({
      machine: { id: "machine_123", slug: "dev-box" },
      machineToken: "piwt_mtok_v1_machine",
    });

    expect(transport.requests.map(({ input }) => input)).toEqual([
      "https://control.example.test/v1/device/start",
      "https://control.example.test/v1/device/complete",
      "https://control.example.test/v1/device/complete",
      "https://control.example.test/v1/machines",
    ]);
    expect(transport.requests[0]?.init).toMatchObject({
      method: "POST",
      redirect: "error",
      body: JSON.stringify({ connectorVersion: safeTunnelClientVersion }),
    });
    expect(transport.requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(transport.requests[0]?.init.signal).not.toBe(controller.signal);
    expect(transport.requests[1]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(transport.requests[1]?.init.signal).not.toBe(controller.signal);
    expect(transport.requests[3]?.init).toMatchObject({
      headers: { authorization: "Bearer piwt_cat_v1_access" },
      body: JSON.stringify({
        name: "Dev Box",
        slug: "dev-box",
        localPiWebUrl: "http://127.0.0.1:8504",
        connectorVersion: safeTunnelClientVersion,
      }),
    });
    expect(timeouts.tasks).toHaveLength(4);
    expect(timeouts.tasks.every(({ active }) => !active)).toBe(true);
  });

  it("aborts stalled registration at the injected whole-response timeout", async () => {
    const timeouts = manualTimeoutScheduler();
    let requestSignal: AbortSignal | undefined;
    const controlPlane = new HttpSafeTunnelControlPlane({
      fetch: (_input, init) => {
        requestSignal = init.signal ?? undefined;
        return new Promise(() => undefined);
      },
      requestTimeoutMs: 25,
      scheduleTimeout: timeouts.schedule,
    });

    const registration = controlPlane.registerMachine({
      controlApiBaseUrl: "https://control.example.test",
      connectorAccessToken: "piwt_cat_v1_access",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      clientVersion: safeTunnelClientVersion,
    });
    await Promise.resolve();

    expect(timeouts.tasks).toHaveLength(1);
    expect(timeouts.tasks[0]).toMatchObject({ delayMs: 25, active: true });
    expect(requestSignal?.aborted).toBe(false);
    timeouts.fire();

    await expect(registration).rejects.toMatchObject({
      code: "transport_failed",
      operation: "register_machine",
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(timeouts.tasks[0]?.active).toBe(false);
  });

  it("keeps the timeout active while a success response body is stalled", async () => {
    const timeouts = manualTimeoutScheduler();
    const controlPlane = new HttpSafeTunnelControlPlane({
      fetch: () => Promise.resolve(new Response(new ReadableStream<Uint8Array>(), {
        status: 202,
      })),
      requestTimeoutMs: 40,
      scheduleTimeout: timeouts.schedule,
    });

    const request = controlPlane.startDeviceAuthorization({
      controlApiBaseUrl: "https://control.example.test",
      clientVersion: safeTunnelClientVersion,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(timeouts.tasks[0]).toMatchObject({ delayMs: 40, active: true });

    timeouts.fire();

    await expect(request).rejects.toMatchObject({
      code: "transport_failed",
      operation: "start_device_authorization",
    });
    expect(timeouts.tasks[0]?.active).toBe(false);
  });

  it("propagates caller cancellation through an internal request signal and clears its timeout", async () => {
    const timeouts = manualTimeoutScheduler();
    const caller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const controlPlane = new HttpSafeTunnelControlPlane({
      fetch: (_input, init) => {
        requestSignal = init.signal ?? undefined;
        return new Promise(() => undefined);
      },
      scheduleTimeout: timeouts.schedule,
    });

    const request = controlPlane.getMachineTunnelConfig({
      controlApiBaseUrl: "https://control.example.test",
      machineId: "machine_123",
      machineToken: "piwt_mtok_v1_private",
    }, { signal: caller.signal });
    await Promise.resolve();
    expect(requestSignal).not.toBe(caller.signal);

    caller.abort();

    await expect(request).rejects.toMatchObject({
      code: "transport_failed",
      operation: "get_tunnel_config",
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(timeouts.tasks[0]?.active).toBe(false);
  });

  it("rejects non-loopback plaintext endpoints before sending bearer credentials", async () => {
    let fetchCalls = 0;
    const controlPlane = new HttpSafeTunnelControlPlane({
      fetch: () => {
        fetchCalls += 1;
        return Promise.resolve(jsonResponse(201, registeredMachine()));
      },
    });

    await expect(controlPlane.registerMachine({
      controlApiBaseUrl: "http://control.example.test",
      connectorAccessToken: "piwt_cat_v1_access",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      clientVersion: safeTunnelClientVersion,
    })).rejects.toThrow("must use https");
    await expect(controlPlane.getMachineTunnelConfig({
      controlApiBaseUrl: "http://localhost:8787",
      machineId: "machine_123",
      machineToken: "piwt_mtok_v1_private",
    })).rejects.toThrow("must use https");
    expect(fetchCalls).toBe(0);
  });

  it("bounds success bodies and rejects insecure approval links", async () => {
    const oversized = new HttpSafeTunnelControlPlane({
      fetch: () => Promise.resolve(new Response("x", {
        status: 202,
        headers: { "content-length": (128 * 1_024 + 1).toString() },
      })),
    });
    await expect(oversized.startDeviceAuthorization({
      controlApiBaseUrl: "https://control.example.test",
      clientVersion: safeTunnelClientVersion,
    })).rejects.toMatchObject({ code: "invalid_response" });

    const insecureApproval = new HttpSafeTunnelControlPlane({
      fetch: () => Promise.resolve(jsonResponse(202, {
        ...startedAuthorization(),
        verificationUriComplete: "http://approval.example.test/device?secret=code",
      })),
    });
    await expect(insecureApproval.startDeviceAuthorization({
      controlApiBaseUrl: "https://control.example.test",
      clientVersion: safeTunnelClientVersion,
    })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("fetches and strictly parses tunnel config with private machine credentials", async () => {
    const transport = sequencedFetch([jsonResponse(200, {
      machine: { id: "machine_123" },
      publicHostname: "dev-box.ns-abc123.tunnels.pi-web.dev",
      publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev",
      localPiWebUrl: "http://127.0.0.1:8504",
      frp: {
        proxyName: "account-machine",
        configFormat: "toml",
        frpcConfigToml: "[[proxies]]\n",
      },
    })]);
    const controlPlane = new HttpSafeTunnelControlPlane({ fetch: transport.fetch });
    const controller = new AbortController();

    await expect(controlPlane.getMachineTunnelConfig({
      controlApiBaseUrl: "https://control.example.test",
      machineId: "machine_123",
      machineToken: "piwt_mtok_v1_private",
    }, { signal: controller.signal })).resolves.toEqual({
      machineId: "machine_123",
      publicHostname: "dev-box.ns-abc123.tunnels.pi-web.dev",
      publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev",
      localPiWebUrl: "http://127.0.0.1:8504",
      proxyName: "account-machine",
      frpcConfigToml: "[[proxies]]\n",
    });
    expect(transport.requests[0]).toMatchObject({
      input: "https://control.example.test/v1/machines/machine_123/tunnel-config",
      init: {
        method: "GET",
        redirect: "error",
        headers: { authorization: "Bearer piwt_mtok_v1_private" },
      },
    });
    expect(transport.requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(transport.requests[0]?.init.signal).not.toBe(controller.signal);
  });

  it("records and strictly parses normalized machine heartbeats", async () => {
    const transport = sequencedFetch([jsonResponse(202, heartbeatResponse())]);
    const controlPlane = new HttpSafeTunnelControlPlane({ fetch: transport.fetch });
    const controller = new AbortController();

    await expect(controlPlane.recordMachineHeartbeat({
      controlApiBaseUrl: "https://control.example.test",
      machineId: "machine_123",
      machineToken: "piwt_mtok_v1_private",
    }, {
      clientVersion: safeTunnelClientVersion,
      tunnelStatus: "error",
      errorMessage: "PI WEB Safe Tunnel runtime is recovering.",
    }, { signal: controller.signal })).resolves.toEqual({
      machineId: "machine_123",
      lastSeenAt: "2026-07-29T12:05:00.000Z",
      nextHeartbeatSeconds: 30,
    });
    expect(transport.requests[0]).toMatchObject({
      input: "https://control.example.test/v1/machines/machine_123/heartbeat",
      init: {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: "Bearer piwt_mtok_v1_private",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          connectorVersion: safeTunnelClientVersion,
          tunnelStatus: "error",
          errorMessage: "PI WEB Safe Tunnel runtime is recovering.",
        }),
      },
    });
    expect(transport.requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(transport.requests[0]?.init.signal).not.toBe(controller.signal);
  });

  it("rejects malformed heartbeat success and maps rejected credentials", async () => {
    const malformed = new HttpSafeTunnelControlPlane({
      fetch: () => Promise.resolve(jsonResponse(202, heartbeatResponse({
        nextHeartbeatSeconds: 0,
      }))),
    });
    await expect(malformed.recordMachineHeartbeat({
      controlApiBaseUrl: "https://control.example.test",
      machineId: "machine_123",
      machineToken: "piwt_mtok_v1_private",
    }, {
      clientVersion: safeTunnelClientVersion,
      tunnelStatus: "running",
    })).rejects.toMatchObject({
      code: "invalid_response",
      operation: "record_heartbeat",
    });

    const revoked = new HttpSafeTunnelControlPlane({
      fetch: () => Promise.resolve(jsonResponse(401, {
        error: { code: "invalid_machine_token", message: "private provider detail" },
      })),
    });
    await expect(revoked.recordMachineHeartbeat({
      controlApiBaseUrl: "https://control.example.test",
      machineId: "machine_123",
      machineToken: "piwt_mtok_v1_private",
    }, {
      clientVersion: safeTunnelClientVersion,
      tunnelStatus: "running",
    })).rejects.toMatchObject({
      code: "authentication_failed",
      operation: "record_heartbeat",
    });
  });

  it("maps denial, authentication, rate-limit, and service failures to stable errors", async () => {
    const cases = [
      {
        response: jsonResponse(403, { error: { code: "authorization_denied" } }),
        operation: "complete" as const,
        code: "authorization_denied",
      },
      { response: jsonResponse(401, { error: { message: "bad token" } }), operation: "start" as const, code: "authentication_failed" },
      { response: jsonResponse(429, { error: { message: "slow down" } }), operation: "start" as const, code: "rate_limited" },
      { response: jsonResponse(503, { error: { message: "outage" } }), operation: "start" as const, code: "service_unavailable" },
    ];

    for (const testCase of cases) {
      const controlPlane = new HttpSafeTunnelControlPlane({
        fetch: () => Promise.resolve(testCase.response),
      });
      const request = testCase.operation === "complete"
        ? controlPlane.completeDeviceAuthorization({
          controlApiBaseUrl: "https://control.example.test",
          deviceCode: "device",
        })
        : controlPlane.startDeviceAuthorization({
          controlApiBaseUrl: "https://control.example.test",
          clientVersion: safeTunnelClientVersion,
        });
      await expect(request).rejects.toMatchObject({ code: testCase.code });
    }
  });

  it("preserves valid token68 bearer credentials exactly across response and header boundaries", async () => {
    const accessToken = "Access-._~+/==";
    const machineToken = "Machine-._~+/=";
    const transport = sequencedFetch([
      jsonResponse(200, { ...approvedAuthorization(), accessToken }),
      jsonResponse(201, { ...registeredMachine(), machineToken }),
    ]);
    const controlPlane = new HttpSafeTunnelControlPlane({ fetch: transport.fetch });

    await expect(controlPlane.completeDeviceAuthorization({
      controlApiBaseUrl: "https://control.example.test",
      deviceCode: "device",
    })).resolves.toMatchObject({
      kind: "approved",
      authorization: { accessToken },
    });
    await expect(controlPlane.registerMachine({
      controlApiBaseUrl: "https://control.example.test",
      connectorAccessToken: accessToken,
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      clientVersion: safeTunnelClientVersion,
    })).resolves.toMatchObject({ machineToken });
    expect(transport.requests[1]?.init.headers).toMatchObject({
      authorization: `Bearer ${accessToken}`,
    });
  });

  it("rejects unsafe provider bearer credentials as invalid responses", async () => {
    const unsafeResponses = [
      {
        operation: "complete_device_authorization",
        response: jsonResponse(200, {
          ...approvedAuthorization(),
          accessToken: " access-token",
        }),
        request: (controlPlane: HttpSafeTunnelControlPlane) => (
          controlPlane.completeDeviceAuthorization({
            controlApiBaseUrl: "https://control.example.test",
            deviceCode: "device",
          })
        ),
      },
      {
        operation: "register_machine",
        response: jsonResponse(201, {
          ...registeredMachine(),
          machineToken: "machine-token\nheader",
        }),
        request: (controlPlane: HttpSafeTunnelControlPlane) => controlPlane.registerMachine({
          controlApiBaseUrl: "https://control.example.test",
          connectorAccessToken: "safe-access-token",
          machineName: "Dev Box",
          machineSlug: "dev-box",
          localPiWebUrl: "http://127.0.0.1:8504",
          clientVersion: safeTunnelClientVersion,
        }),
      },
    ] as const;

    for (const testCase of unsafeResponses) {
      const controlPlane = new HttpSafeTunnelControlPlane({
        fetch: () => Promise.resolve(testCase.response),
      });
      await expect(testCase.request(controlPlane)).rejects.toMatchObject({
        code: "invalid_response",
        operation: testCase.operation,
      });
    }
  });

  it("rejects unsafe bearer credentials before constructing an HTTP request", async () => {
    let fetchCalls = 0;
    const controlPlane = new HttpSafeTunnelControlPlane({
      fetch: () => {
        fetchCalls += 1;
        return Promise.resolve(jsonResponse(500, {}));
      },
    });

    await expect(controlPlane.registerMachine({
      controlApiBaseUrl: "https://control.example.test",
      connectorAccessToken: "access token",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      clientVersion: safeTunnelClientVersion,
    })).rejects.toThrow("HTTP-header-safe bearer credential");
    await expect(controlPlane.getMachineTunnelConfig({
      controlApiBaseUrl: "https://control.example.test",
      machineId: "machine_123",
      machineToken: "machine-token\r\nInjected: value",
    })).rejects.toThrow("HTTP-header-safe bearer credential");
    await expect(controlPlane.recordMachineHeartbeat({
      controlApiBaseUrl: "https://control.example.test",
      machineId: "machine_123",
      machineToken: "tóken",
    }, {
      clientVersion: safeTunnelClientVersion,
      tunnelStatus: "running",
    })).rejects.toThrow("HTTP-header-safe bearer credential");
    expect(fetchCalls).toBe(0);
  });

  it("rejects malformed success payloads as operation-specific application errors", async () => {
    const controlPlane = new HttpSafeTunnelControlPlane({
      fetch: () => Promise.resolve(jsonResponse(201, {
        ...registeredMachine(),
        machineToken: "",
      })),
    });

    await expect(controlPlane.registerMachine({
      controlApiBaseUrl: "https://control.example.test",
      connectorAccessToken: "access",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      clientVersion: safeTunnelClientVersion,
    })).rejects.toMatchObject({
      code: "invalid_response",
      operation: "register_machine",
    });
  });

  it("drops raw transport/provider details and all credential material from errors", async () => {
    const secrets = [
      "piwt_mtok_v1_private",
      "piwt_cat_v1_access",
      "provider says account owner@example.test is blocked",
    ];
    const transportFailure = new HttpSafeTunnelControlPlane({
      fetch: () => Promise.reject(new Error(secrets.join(" "))),
    });

    let observed: unknown;
    try {
      await transportFailure.getMachineTunnelConfig({
        controlApiBaseUrl: "https://secret-control.example.test",
        machineId: "machine_123",
        machineToken: secrets[0] ?? "",
      });
    } catch (error: unknown) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(SafeTunnelControlPlaneError);
    const serialized = JSON.stringify(observed) + String(observed);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("secret-control.example.test");

    const providerFailure = new HttpSafeTunnelControlPlane({
      fetch: () => Promise.resolve(jsonResponse(401, {
        error: { code: "invalid_token", message: secrets.join(" ") },
      })),
    });
    let providerError: unknown;
    try {
      await providerFailure.registerMachine({
        controlApiBaseUrl: "https://control.example.test",
        connectorAccessToken: secrets[1] ?? "",
        machineName: "Dev Box",
        machineSlug: "dev-box",
        localPiWebUrl: "http://127.0.0.1:8504",
        clientVersion: safeTunnelClientVersion,
      });
    } catch (error: unknown) {
      providerError = error;
    }
    const serializedProviderError = JSON.stringify(providerError) + String(providerError);
    for (const secret of secrets) expect(serializedProviderError).not.toContain(secret);
  });
});
