import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type FixtureChild = ChildProcessByStdio<null, Readable, Readable>;
type FixtureScenario = "direct-close" | "listen-failure" | "signal-shutdown";

const tempRoots: string[] = [];
const children = new Set<FixtureChild>();

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  children.clear();
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("web-process lifecycle child process", () => {
  it.skipIf(process.platform === "win32")(
    "keeps a failed-listen process alive until a later signal confirms cleanup",
    async () => {
      const fixture = await spawnFixture("listen-failure");

      try {
        await fixture.output.waitFor("SHUTDOWN:2", 15_000);
        await expectStillRunning(fixture.child, fixture.output, 150);

        expect(fixture.child.kill("SIGTERM")).toBe(true);
        await fixture.output.waitFor("SHUTDOWN:3", 5_000);
        await fixture.output.waitFor("ORIGINAL_LISTEN_ERROR", 5_000);

        const exit = await waitForExit(fixture.child, fixture.output, 5_000);
        children.delete(fixture.child);
        expect(exit).toEqual({ code: 0, signal: null });
      } finally {
        fixture.output.dispose();
      }
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "keeps a signal-shutdown process alive until a later signal confirms cleanup",
    async () => {
      const fixture = await spawnFixture("signal-shutdown");

      try {
        await fixture.output.waitFor("READY", 15_000);
        expect(fixture.child.kill("SIGTERM")).toBe(true);
        await fixture.output.waitFor("SHUTDOWN:1", 5_000);
        await expectStillRunning(fixture.child, fixture.output, 150);

        expect(fixture.child.kill("SIGINT")).toBe(true);
        await fixture.output.waitFor("SHUTDOWN:2", 5_000);

        const exit = await waitForExit(fixture.child, fixture.output, 5_000);
        children.delete(fixture.child);
        expect(exit).toEqual({ code: 0, signal: null });
      } finally {
        fixture.output.dispose();
      }
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "keeps a direct-close process alive until scheduled cleanup succeeds",
    async () => {
      const fixture = await spawnFixture("direct-close");

      try {
        await fixture.output.waitFor("DIRECT_CLOSE_ERROR", 15_000);
        await expectStillRunning(fixture.child, fixture.output, 150);
        await fixture.output.waitFor("SHUTDOWN:2", 5_000);

        const exit = await waitForExit(fixture.child, fixture.output, 5_000);
        children.delete(fixture.child);
        expect(exit).toEqual({ code: 0, signal: null });
      } finally {
        fixture.output.dispose();
      }
    },
    30_000,
  );
});

async function spawnFixture(scenario: FixtureScenario): Promise<{
  child: FixtureChild;
  output: ChildOutput;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-lifecycle-child-"));
  tempRoots.push(root);
  const runnerPath = join(root, "runner.mts");
  const appUrl = pathToFileURL(resolve("src/server/app.ts")).href;
  const lifecycleUrl = pathToFileURL(resolve("src/server/webProcessLifecycle.ts")).href;
  await writeFile(runnerPath, lifecycleRunner(appUrl, lifecycleUrl), "utf8");

  const child = spawn(process.execPath, ["--import", "tsx", runnerPath, scenario], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  return { child, output: new ChildOutput(child) };
}

function lifecycleRunner(appUrl: string, lifecycleUrl: string): string {
  return `
    import { buildApp } from ${JSON.stringify(appUrl)};
    import { runWebProcess } from ${JSON.stringify(lifecycleUrl)};

    const scenario = process.argv[2];
    if (
      scenario !== "direct-close"
      && scenario !== "listen-failure"
      && scenario !== "signal-shutdown"
    ) {
      throw new Error("unknown lifecycle fixture scenario");
    }

    const failedShutdowns = scenario === "listen-failure" ? 2 : 1;
    const shutdownFailure = new Error("fixture cleanup remains incomplete");
    let shutdownCalls = 0;
    const safeTunnel = {
      async startup() {},
      async shutdown() {
        shutdownCalls += 1;
        process.stdout.write("SHUTDOWN:" + String(shutdownCalls) + "\\n");
        if (shutdownCalls <= failedShutdowns) throw shutdownFailure;
      },
      async status() { throw new Error("status must not be called"); },
      async enable() { throw new Error("enable must not be called"); },
      async disable() { throw new Error("disable must not be called"); },
      operation() { return undefined; },
    };
    const sessionDaemon = {
      async request() {
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            component: "sessiond",
            label: "Session daemon",
            available: true,
            capabilities: [],
          }),
        };
      },
      connectWebSocket() { throw new Error("WebSocket must not be called"); },
    };
    const app = await buildApp({
      clientDist: false,
      logger: false,
      safeTunnel,
      sessionDaemon,
    });
    const dependencies = {
      retryShutdown: () => safeTunnel.shutdown(),
      // A real referenced timer keeps each otherwise handle-free fixture alive.
      // Signal scenarios retry directly; direct close exercises the schedule.
      shutdownRetryIntervalMs: scenario === "direct-close" ? 1_000 : 60_000,
    };

    if (scenario === "listen-failure") {
      const listenError = new Error("fixture listen failure");
      try {
        await runWebProcess(app, { host: "127.0.0.1", port: 0 }, {
          ...dependencies,
          listen: async (readyApp) => {
            await readyApp.ready();
            process.stdout.write("READY\\n");
            throw listenError;
          },
        });
        throw new Error("listen failure unexpectedly resolved");
      } catch (error) {
        if (error !== listenError) throw error;
        process.stdout.write("ORIGINAL_LISTEN_ERROR\\n");
      }
    } else {
      await runWebProcess(app, { host: "127.0.0.1", port: 0 }, {
        ...dependencies,
        listen: async (listeningApp, options) => {
          await listeningApp.listen(options);
          process.stdout.write("READY\\n");
        },
      });
      if (scenario === "direct-close") {
        try {
          await app.close();
          throw new Error("direct close unexpectedly resolved");
        } catch (error) {
          if (error !== shutdownFailure) throw error;
          process.stdout.write("DIRECT_CLOSE_ERROR\\n");
        }
      }
    }
  `;
}

class ChildOutput {
  private value = "";
  private readonly onData = (chunk: unknown): void => {
    this.value += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  };

  constructor(private readonly child: FixtureChild) {
    child.stdout.on("data", this.onData);
    child.stderr.on("data", this.onData);
  }

  text(): string {
    return this.value;
  }

  waitFor(expected: string, timeoutMs: number): Promise<string> {
    if (this.value.includes(expected)) return Promise.resolve(this.value);
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return Promise.reject(new Error(
        `Child exited before output ${JSON.stringify(expected)}:\n${this.value}`,
      ));
    }

    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        cleanup();
        rejectPromise(new Error(
          `Timed out waiting for child output ${JSON.stringify(expected)}:\n${this.value}`,
        ));
      }, timeoutMs);
      const onData = (): void => {
        if (!this.value.includes(expected)) return;
        cleanup();
        resolvePromise(this.value);
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        cleanup();
        rejectPromise(new Error(
          `Child exited before output ${JSON.stringify(expected)} (${String(code)}, ${String(signal)}):\n${this.value}`,
        ));
      };
      const cleanup = (): void => {
        clearTimeout(timeout);
        this.child.stdout.off("data", onData);
        this.child.stderr.off("data", onData);
        this.child.off("exit", onExit);
      };
      this.child.stdout.on("data", onData);
      this.child.stderr.on("data", onData);
      this.child.once("exit", onExit);
      onData();
      if (
        !this.value.includes(expected)
        && (this.child.exitCode !== null || this.child.signalCode !== null)
      ) {
        onExit(this.child.exitCode, this.child.signalCode);
      }
    });
  }

  dispose(): void {
    this.child.stdout.off("data", this.onData);
    this.child.stderr.off("data", this.onData);
  }
}

function expectStillRunning(
  child: FixtureChild,
  output: ChildOutput,
  durationMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.reject(new Error(`Child exited instead of retaining cleanup ownership:\n${output.text()}`));
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolvePromise();
    }, durationMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      rejectPromise(new Error(
        `Child exited instead of retaining cleanup ownership (${String(code)}, ${String(signal)}):\n${output.text()}`,
      ));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode);
    }
  });
}

function waitForExit(
  child: FixtureChild,
  output: ChildOutput,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`Timed out waiting for child exit:\n${output.text()}`));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      resolvePromise({ code, signal });
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode);
    }
  });
}
