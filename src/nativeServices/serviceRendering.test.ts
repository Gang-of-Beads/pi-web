import { describe, expect, it } from "vitest";
import {
  createDevelopmentNativeServicePlan,
  type NativeServicePlan,
  type NativeServicePlanService,
} from "./servicePlan.js";
import { renderLaunchdPlist, renderSystemdUnit } from "./serviceRendering.js";

function developmentPlan(kind: "systemd" | "launchd"): NativeServicePlan {
  return createDevelopmentNativeServicePlan({
    backend: { kind, label: kind },
    shell: {
      name: "zsh",
      executable: "/bin/zsh",
      source: "detected",
      detectedExecutable: "/bin/zsh",
    },
    environment: { PI_WEB_CONFIG: "/home/user/config with \"quote\".json" },
    workingDirectory: "/checkout with space",
    packageJsonPath: "/checkout with space/package.json",
  });
}

function planService(plan: NativeServicePlan, index: number): NativeServicePlanService {
  const service = plan.services[index];
  if (service === undefined) throw new Error(`Missing service at index ${String(index)}`);
  return service;
}

describe("native service rendering", () => {
  it("renders systemd entirely from the canonical plan", () => {
    const plan = developmentPlan("systemd");
    const unit = renderSystemdUnit(plan, planService(plan, 1));

    expect(unit).toContain("Description=PI WEB UI dev server");
    expect(unit).toContain("After=pi-web-sessiond.service\nWants=pi-web-sessiond.service");
    expect(unit).toContain("WorkingDirectory=/checkout\\x20with\\x20space");
    expect(unit).toContain('Environment="PI_WEB_CONFIG=/home/user/config with \\"quote\\".json"');
    expect(unit).toContain('ExecStart=/usr/bin/env "/bin/zsh" -lc "exec /usr/bin/env bash -c \'trap \\"kill 0\\" EXIT;');
    expect(unit).toContain("Restart=no");
  });

  it("escapes systemd specifiers and line controls without changing directives", () => {
    const plan = createDevelopmentNativeServicePlan({
      backend: { kind: "systemd", label: "systemd" },
      shell: {
        name: "bash",
        executable: "/shell $HOME/%h/bash",
        source: "detected",
        detectedExecutable: "/shell $HOME/%h/bash",
      },
      environment: { PI_WEB_CONFIG: "/config/%h\nEnvironment=INJECTED=yes" },
      workingDirectory: "/checkout %h\nwith newline",
      packageJsonPath: "/checkout/package.json",
    });
    const unit = renderSystemdUnit(plan, planService(plan, 0));

    expect(unit).toContain("WorkingDirectory=/checkout\\x20%%h\\nwith\\x20newline");
    expect(unit).toContain('Environment="PI_WEB_CONFIG=/config/%%h\\nEnvironment=INJECTED=yes"');
    expect(unit).toContain('ExecStart=/usr/bin/env "/shell $$HOME/%%h/bash"');
    expect(unit.match(/^Environment=/gmu)).toHaveLength(1);
  });

  it("renders launchd entirely from the canonical plan", () => {
    const plan = developmentPlan("launchd");
    const plist = renderLaunchdPlist(plan, planService(plan, 0), "/logs");

    expect(plist).toContain("<string>com.pi-web.sessiond</string>");
    expect(plist).toContain("<string>/bin/zsh</string>");
    expect(plist).toContain("<string>exec npm run start:sessiond</string>");
    expect(plist).toContain("<key>WorkingDirectory</key>\n  <string>/checkout with space</string>");
    expect(plist).toContain("<key>PI_WEB_CONFIG</key>\n    <string>/home/user/config with &quot;quote&quot;.json</string>");
    expect(plist.match(/<string>\/logs\/sessiond\.log<\/string>/gu)).toHaveLength(2);
    expect(plist).not.toContain("<string>\\logs\\sessiond.log</string>");
    expect(plist).not.toContain("<key>KeepAlive</key>");
  });

  it("rejects a service from a different plan", () => {
    const first = developmentPlan("systemd");
    const second = developmentPlan("systemd");
    expect(() => renderSystemdUnit(first, planService(second, 0))).toThrow("not a member");
  });
});

describe("systemd drain protection", () => {
  // Under systemd's default KillMode=control-group a `systemctl restart` sends
  // SIGTERM to every process in the unit's cgroup at the same instant, so the
  // agent subprocesses the drain exists to protect die before it can even look.
  // Observed as "shutting down" and "Stopped" in the same second, no drain line.
  it("lets the sessiond drain run by signalling only the main process", () => {
    const plan = developmentPlan("systemd");
    const sessiond = plan.services.find((service) => service.id === "sessiond");
    if (sessiond === undefined) throw new Error("plan has no sessiond");
    const unit = renderSystemdUnit(plan, sessiond);

    expect(unit).toContain("KillMode=mixed");
    // systemd's default stop timeout (90s) is shorter than the daemon's
    // Promise.allSettled drain can need once it actually gets to wait, so the
    // unit must make room for it before SIGKILL.
    expect(unit).toContain("TimeoutStopSec=180");
  });

  it("does not claim drain protection for a stateless service", () => {
    const plan = developmentPlan("systemd");
    const uiDev = plan.services.find((service) => service.id === "uiDev");
    if (uiDev === undefined) throw new Error("plan has no uiDev");
    const unit = renderSystemdUnit(plan, uiDev);
    expect(unit).not.toContain("KillMode=mixed");
  });
});
