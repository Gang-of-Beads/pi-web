import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { ServerPluginStageMaking } from "../../../server-plugin-api.js";

/**
 * Derived file stages (thumbnails, covers, small JSON facts) cached on the machine that has the file.
 *
 * A stage is keyed by the plugin that makes it, the file's path, size and modification time, and the
 * stage's name, so a file that changes gets new stages and the old ones are simply never asked for
 * again. One request makes a missing stage while concurrent requests for it wait for that result;
 * at most `concurrency` stages are made at a time, each aborted after `produceTimeoutMs`. The cache
 * keeps at most `capBytes`: past it, the stages used longest ago go first, down to nine tenths, so
 * one more stage does not evict again. A stage's last use is its file's modification time, which a
 * cache hit moves on.
 */

export interface StageKey {
  readonly pluginId: string;
  readonly path: string;
  readonly size: number;
  readonly modifiedMs: number;
  readonly stage: string;
}

export type StageOutcome =
  | { readonly kind: "cached"; readonly path: string; readonly etag: string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

export interface StageCacheOptions {
  readonly directory: string;
  readonly capBytes: number;
  readonly concurrency: number;
  readonly produceTimeoutMs: number;
}

interface CachedStage {
  bytes: number;
  usedAt: number;
}

const EVICT_DOWN_TO = 0.9;

export class StageCache {
  private index: Promise<Map<string, CachedStage>> | undefined;
  private readonly making = new Map<string, Promise<StageOutcome>>();
  private running = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly options: StageCacheOptions) {}

  async obtain(key: StageKey, produce: (output: string, signal: AbortSignal) => Promise<ServerPluginStageMaking>): Promise<StageOutcome> {
    const name = stageFileName(key);
    const index = await this.loadIndex();
    const cached = index.get(name);
    if (cached !== undefined && await this.touch(name, cached)) return { kind: "cached", path: this.pathOf(name), etag: `"${name}"` };
    index.delete(name);
    const pending = this.making.get(name);
    if (pending !== undefined) return pending;
    const made = this.make(name, produce).finally(() => { this.making.delete(name); });
    this.making.set(name, made);
    return made;
  }

  private async make(name: string, produce: (output: string, signal: AbortSignal) => Promise<ServerPluginStageMaking>): Promise<StageOutcome> {
    await this.slot();
    const output = join(this.options.directory, `.${name}.${randomUUID()}.tmp`);
    const signal = AbortSignal.timeout(this.options.produceTimeoutMs);
    try {
      await mkdir(this.options.directory, { recursive: true });
      const making = await produce(output, signal);
      if ("unavailable" in making) return { kind: "unavailable", reason: making.unavailable };
      const { size } = await stat(output);
      await rename(output, this.pathOf(name));
      (await this.loadIndex()).set(name, { bytes: size, usedAt: Date.now() });
      await this.evict();
      return { kind: "cached", path: this.pathOf(name), etag: `"${name}"` };
    } catch (error) {
      return { kind: "failed", reason: signal.aborted ? `took longer than ${String(this.options.produceTimeoutMs / 1000)} s` : errorText(error) };
    } finally {
      await rm(output, { force: true }).catch(() => undefined);
      this.release();
    }
  }

  private async touch(name: string, cached: CachedStage): Promise<boolean> {
    const now = new Date();
    try {
      await utimes(this.pathOf(name), now, now);
      cached.usedAt = now.getTime();
      return true;
    } catch {
      return false;
    }
  }

  private async evict(): Promise<void> {
    const index = await this.loadIndex();
    let total = 0;
    for (const entry of index.values()) total += entry.bytes;
    if (total <= this.options.capBytes) return;
    const oldestFirst = [...index.entries()].sort(([, a], [, b]) => a.usedAt - b.usedAt);
    for (const [name, entry] of oldestFirst) {
      if (total <= this.options.capBytes * EVICT_DOWN_TO) break;
      index.delete(name);
      total -= entry.bytes;
      await rm(this.pathOf(name), { force: true }).catch(() => undefined);
    }
  }

  private loadIndex(): Promise<Map<string, CachedStage>> {
    this.index ??= this.readIndex();
    return this.index;
  }

  /** What an earlier run left: cached stages as found, and staged files a crash abandoned removed. */
  private async readIndex(): Promise<Map<string, CachedStage>> {
    const index = new Map<string, CachedStage>();
    let names: string[];
    try {
      names = await readdir(this.options.directory);
    } catch {
      return index;
    }
    for (const name of names) {
      const path = this.pathOf(name);
      if (name.endsWith(".tmp")) {
        await rm(path, { force: true }).catch(() => undefined);
        continue;
      }
      try {
        const found = await stat(path);
        if (found.isFile()) index.set(name, { bytes: found.size, usedAt: found.mtimeMs });
      } catch {
        continue;
      }
    }
    return index;
  }

  private pathOf(name: string): string {
    return join(this.options.directory, name);
  }

  private async slot(): Promise<void> {
    if (this.running < this.options.concurrency) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve) => { this.queue.push(resolve); });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next === undefined) this.running -= 1;
    else next();
  }
}

export function stageFileName(key: StageKey): string {
  return createHash("sha256").update(JSON.stringify([key.pluginId, key.path, key.size, key.modifiedMs, key.stage])).digest("hex");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
