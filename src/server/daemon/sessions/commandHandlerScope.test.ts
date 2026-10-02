import { describe, expect, it } from "vitest";
import { CommandHandlerScope } from "./commandHandlerScope.js";

describe("CommandHandlerScope", () => {
  it("is outside a handler by default", () => {
    expect(new CommandHandlerScope().inHandler).toBe(false);
  });

  it("is inside the handler, across its awaits", async () => {
    const scope = new CommandHandlerScope();
    const seen: boolean[] = [];

    await scope.run(async () => {
      seen.push(scope.inHandler);
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(scope.inHandler);
    });

    expect(seen).toEqual([true, true]);
    expect(scope.inHandler).toBe(false);
  });

  it("does not reach work that runs beside the handler", async () => {
    const scope = new CommandHandlerScope();
    let release = (): void => undefined;
    const handler = scope.run(() => new Promise<void>((resolve) => { release = resolve; }));

    const beside = await Promise.resolve().then(() => scope.inHandler);
    release();
    await handler;

    expect(beside).toBe(false);
  });

  it("ends for work the handler started once the handler has returned", async () => {
    const scope = new CommandHandlerScope();
    let startedRun: Promise<boolean> | undefined;

    await scope.run(() => {
      startedRun = new Promise((resolve) => setTimeout(resolve, 5)).then(() => scope.inHandler);
      return Promise.resolve();
    });

    await expect(startedRun).resolves.toBe(false);
  });
});
