import { randomBytes, randomInt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { piWebDataDir } from "../../../config.js";
import type { ApprovedMachineOrigin, MachineAccessRequestState } from "../../../shared/machineAccess.js";
import { isRecord } from "../../../shared/unknownValues.js";
import { isNodeErrorWithCode } from "../../shared/workspaces/pathSafety.js";

/**
 * Which other machines' pages may use this machine from the browser (docs/design/browser-direct-machines.md).
 *
 * Approved origins are PI WEB-managed state beside `machines.json`, not user config: the config
 * file can be read-only (nix-managed hosts) and approving happens in the app. A request for access
 * lives only in memory for ten minutes, as long as the link that carries it; a restart drops the
 * pending ones, which the requesting page reports as expired and can ask again.
 */

export function machineAccessStorePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "machine-access.json");
}

export interface AccessRequest {
  readonly id: string;
  readonly origin: string;
  readonly name: string;
  /** Shown on both pages so the reader approves the request they just made, not a look-alike. */
  readonly code: string;
  readonly expiresAt: number;
  readonly state: MachineAccessRequestState;
}

export type AccessRequestOutcome =
  | { readonly kind: "requested"; readonly request: AccessRequest }
  | { readonly kind: "already-approved" }
  | { readonly kind: "too-many" };

export type AccessDecision = "approve" | "deny";

export const ACCESS_REQUEST_TTL_MS = 10 * 60_000;
export const MAX_PENDING_ACCESS_REQUESTS = 20;

const DECIDED_STATE: Readonly<Record<AccessDecision, MachineAccessRequestState>> = { approve: "approved", deny: "denied" };

export class MachineAccessStore {
  private approved: readonly ApprovedMachineOrigin[] = [];
  private readonly requests = new Map<string, AccessRequest>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string = machineAccessStorePath(), private readonly now: () => number = Date.now) {}

  /** Read the approved origins once at startup; every later check is answered from memory. */
  async load(): Promise<void> {
    try {
      this.approved = parseAccessFile(JSON.parse(await readFile(this.filePath, "utf-8")));
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) throw error;
      this.approved = [];
    }
  }

  isApproved(origin: string): boolean {
    return this.approved.some((entry) => entry.origin === origin);
  }

  approvedOrigins(): readonly ApprovedMachineOrigin[] {
    return this.approved;
  }

  /** A new request replaces the same origin's earlier one, so a page that asks again is not refused for asking twice. */
  request(origin: string, name: string): AccessRequestOutcome {
    if (this.isApproved(origin)) return { kind: "already-approved" };
    this.dropExpired();
    for (const [id, existing] of this.requests) if (existing.origin === origin && existing.state === "pending") this.requests.delete(id);
    if ([...this.requests.values()].filter((existing) => existing.state === "pending").length >= MAX_PENDING_ACCESS_REQUESTS) return { kind: "too-many" };
    const request: AccessRequest = {
      id: randomBytes(18).toString("base64url"),
      origin,
      name,
      code: String(randomInt(0, 1_000_000)).padStart(6, "0"),
      expiresAt: this.now() + ACCESS_REQUEST_TTL_MS,
      state: "pending",
    };
    this.requests.set(request.id, request);
    return { kind: "requested", request };
  }

  find(id: string): AccessRequest | undefined {
    this.dropExpired();
    return this.requests.get(id);
  }

  /** Decide a pending request; one already decided or expired is left as it is and returned (or undefined). */
  async decide(id: string, decision: AccessDecision): Promise<AccessRequest | undefined> {
    const request = this.find(id);
    if (request?.state !== "pending") return request;
    const decided: AccessRequest = { ...request, state: DECIDED_STATE[decision] };
    this.requests.set(id, decided);
    if (decision === "approve") {
      const entry: ApprovedMachineOrigin = { origin: request.origin, name: request.name, approvedAt: new Date(this.now()).toISOString() };
      try {
        await this.save((current) => [...current.filter((existing) => existing.origin !== request.origin), entry]);
      } catch (error) {
        this.requests.set(id, request);
        throw error;
      }
    }
    return decided;
  }

  async forget(origin: string): Promise<boolean> {
    if (!this.isApproved(origin)) return false;
    await this.save((current) => current.filter((entry) => entry.origin !== origin));
    return true;
  }

  private dropExpired(): void {
    const now = this.now();
    for (const [id, request] of this.requests) if (request.expiresAt <= now) this.requests.delete(id);
  }

  private async save(change: (current: readonly ApprovedMachineOrigin[]) => readonly ApprovedMachineOrigin[]): Promise<void> {
    const run = this.tail.then(async () => {
      const next = change(this.approved);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${String(process.pid)}.tmp`;
      await writeFile(temp, `${JSON.stringify({ version: 1, approved: next }, null, 2)}\n`, "utf-8");
      await rename(temp, this.filePath);
      this.approved = next;
    });
    this.tail = run.catch(() => undefined);
    await run;
  }
}

function parseAccessFile(value: unknown): ApprovedMachineOrigin[] {
  if (!isRecord(value) || !Array.isArray(value["approved"])) throw new Error("Invalid machine access file: expected { approved: [] }");
  return value["approved"].map((entry: unknown, index) => {
    if (!isRecord(entry) || typeof entry["origin"] !== "string" || typeof entry["name"] !== "string" || typeof entry["approvedAt"] !== "string") {
      throw new Error(`Invalid machine access file: approved[${String(index)}]`);
    }
    return { origin: entry["origin"], name: entry["name"], approvedAt: entry["approvedAt"] };
  });
}
