import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { piWebDataDir } from "../../config.js";

export interface StoredMachine {
  id: string;
  name: string;
  kind: "remote";
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface MachineFile {
  machines: StoredMachine[];
  /** User-chosen alias for the local machine, kept in the same file. */
  localAlias?: string;
}

export interface LocalAliasResult {
  alias: string | undefined;
  updatedAt: string | undefined;
}

const MACHINE_STORE_FILE_MODE = 0o600;

export function defaultMachineStorePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "machines.json");
}

export function machineStorePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_MACHINES_FILE"];
  if (configured === undefined || configured === "") return defaultMachineStorePath(env, cwd);
  return resolve(cwd, configured);
}

export class MachineStore {
  constructor(private readonly filePath = machineStorePath()) {}

  async list(): Promise<StoredMachine[]> {
    return (await this.read()).machines;
  }

  async add(input: { name: string; baseUrl: string; token?: string; headers?: Record<string, string> }): Promise<StoredMachine> {
    const data = await this.read();
    const now = new Date().toISOString();
    const machine: StoredMachine = {
      id: randomUUID(),
      name: input.name,
      kind: "remote",
      baseUrl: input.baseUrl,
      ...(input.token === undefined ? {} : { token: input.token }),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      createdAt: now,
      updatedAt: now,
    };
    data.machines.push(machine);
    await this.write(data);
    return machine;
  }

  async setLocalAlias(alias: string | undefined): Promise<{ alias: string | undefined; updatedAt: string }> {
    const data = await this.read();
    const updatedAt = new Date().toISOString();
    if (alias === undefined) delete data.localAlias;
    else data.localAlias = alias;
    await this.write(data);
    return { alias, updatedAt };
  }

  async localAlias(): Promise<LocalAliasResult> {
    const data = await this.read();
    return { alias: data.localAlias, updatedAt: undefined };
  }

  async update(id: string, patch: Partial<Pick<StoredMachine, "name" | "baseUrl" | "token" | "headers">>): Promise<StoredMachine | undefined> {
    const data = await this.read();
    const index = data.machines.findIndex((machine) => machine.id === id);
    if (index < 0) return undefined;
    const current = data.machines[index];
    if (current === undefined) return undefined;
    const next: StoredMachine = { ...current, ...patch, updatedAt: new Date().toISOString() };
    data.machines[index] = next;
    await this.write(data);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const data = await this.read();
    const machines = data.machines.filter((machine) => machine.id !== id);
    if (machines.length === data.machines.length) return false;
    await this.write({ machines });
    return true;
  }

  private async read(): Promise<MachineFile> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      const parsed = parseMachineFile(value);
      await restrictMachineStorePermissions(this.filePath);
      return parsed;
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return { machines: [] };
      throw error;
    }
  }

  private async write(data: MachineFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: MACHINE_STORE_FILE_MODE });
    await restrictMachineStorePermissions(this.filePath);
  }
}

function parseMachineFile(value: unknown): MachineFile {
  if (!isRecord(value) || !Array.isArray(value["machines"])) throw new Error("Invalid machine file");
  const localAlias = optionalString(value["localAlias"], "localAlias");
  return { machines: value["machines"].map(parseStoredMachine), ...(localAlias === undefined ? {} : { localAlias }) };
}

function parseStoredMachine(value: unknown): StoredMachine {
  if (!isRecord(value)) throw new Error("Invalid machine");
  const id = value["id"];
  const name = value["name"];
  const kind = value["kind"];
  const baseUrl = value["baseUrl"];
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];
  if (typeof id !== "string" || typeof name !== "string" || kind !== "remote" || typeof baseUrl !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string") throw new Error("Invalid machine");
  const token = optionalString(value["token"], "token");
  const headers = optionalStringRecord(value["headers"], "headers");
  return { id, name, kind, baseUrl, createdAt, updatedAt, ...(token === undefined ? {} : { token }), ...(headers === undefined ? {} : { headers }) };
}


function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Invalid machine ${key}`);
  return value;
}

function optionalStringRecord(value: unknown, key: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Invalid machine ${key}`);
  return Object.fromEntries(Object.entries(value).map(([header, headerValue]) => {
    if (typeof headerValue !== "string") throw new Error(`Invalid machine ${key}`);
    return [header, headerValue];
  }));
}

async function restrictMachineStorePermissions(path: string): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(path, MACHINE_STORE_FILE_MODE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
