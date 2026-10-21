import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { expandHomePath, isHomePath, piWebConfigPath, readExistingConfigObject, type LoadOptions } from "./config.js";
import { errorMessage, isRecord } from "./shared/unknownValues.js";

/**
 * The tokens the web/API's access gate accepts (docs/install.md, "Require an access token").
 *
 * Three sources: `PI_WEB_ACCESS_TOKEN` (one token), `PI_WEB_ACCESS_TOKEN_FILE`, and `access.tokenFile`
 * in the global config (a path, never the value, like `tls`: it is not part of `PiWebConfig`, has no
 * Settings editor and never reaches the browser). The file variable wins over the config key; a token
 * variable beside a file is ambiguous and refused. An `access` block without `tokenFile`, or with any
 * other key (a misspelling, a token pasted inline), is refused rather than read as "no gate"; its
 * message names the keys, never their values. Every source that is configured but unusable throws,
 * so the web/API never starts without the gate its owner configured. No message carries a token.
 * The web/API reads this at startup; `pi-web doctor`, `pi-web version` and the restart readiness probe
 * read it too, so it lives beside `config.ts`.
 */

export const ACCESS_TOKEN_ENV = "PI_WEB_ACCESS_TOKEN";

/**
 * Whether an environment variable's name is the access token's. Windows reads variable names
 * case-insensitively, so `pi_web_access_token` configures the gate there and must be scrubbed the
 * same way; elsewhere only the exact name counts.
 */
export function isAccessTokenEnvKey(key: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" ? key.toUpperCase() === ACCESS_TOKEN_ENV : key === ACCESS_TOKEN_ENV;
}
export const ACCESS_TOKEN_FILE_ENV = "PI_WEB_ACCESS_TOKEN_FILE";
const ACCESS_TOKEN_FILE_KEY = "access.tokenFile";
const MIN_TOKEN_LENGTH = 32;

export type AccessTokenSource =
  | { readonly kind: "environment" }
  | { readonly kind: "file"; readonly path: string; readonly setBy: typeof ACCESS_TOKEN_FILE_ENV | typeof ACCESS_TOKEN_FILE_KEY };

export interface AccessTokenConfig {
  readonly tokens: readonly string[];
  readonly source: AccessTokenSource;
}

/** A configured token source the web/API cannot use; it does not start until this is fixed. */
export class AccessTokenConfigError extends Error {
  override name = "AccessTokenConfigError";
}

/** The configured tokens, or undefined when no source is configured and the gate is off. */
export function accessTokenConfig(options: LoadOptions = {}): AccessTokenConfig | undefined {
  const env = options.env ?? process.env;
  const environmentToken = env[ACCESS_TOKEN_ENV];
  const file = tokenFile(env, options.cwd ?? process.cwd());
  if (environmentToken !== undefined && file !== undefined) {
    throw new AccessTokenConfigError(`Set either ${ACCESS_TOKEN_ENV} or a token file (${file.setBy}), not both: which tokens PI WEB accepts would be ambiguous.`);
  }
  if (environmentToken !== undefined) return { tokens: [checkedToken(environmentToken, ACCESS_TOKEN_ENV)], source: { kind: "environment" } };
  if (file === undefined) return undefined;
  return { tokens: readTokenFile(file.path), source: file };
}

/**
 * A name or address only this machine reaches: the gate's plain-HTTP warning and doctor's bind check
 * leave it alone. `0.0.0.0` and `::` are every interface, not loopback.
 */
export function isLoopbackHost(host: string): boolean {
  const name = host.replace(/^\[(.*)\]$/u, "$1").toLowerCase();
  return name === "localhost" || name.endsWith(".localhost") || name === "::1" || /^127(?:\.\d{1,3}){3}$/u.test(name);
}

/** Where the tokens come from, for logs and `pi-web doctor`; never the value. */
export function describeAccessTokenSource(source: AccessTokenSource): string {
  return source.kind === "environment" ? ACCESS_TOKEN_ENV : `${source.path} (${source.setBy})`;
}

function tokenFile(env: NodeJS.ProcessEnv, cwd: string): Extract<AccessTokenSource, { kind: "file" }> | undefined {
  const fromEnvironment = env[ACCESS_TOKEN_FILE_ENV];
  if (fromEnvironment !== undefined) {
    return { kind: "file", path: expandHomePath(checkedPath(fromEnvironment, ACCESS_TOKEN_FILE_ENV, " (set in the environment)"), env), setBy: ACCESS_TOKEN_FILE_ENV };
  }
  const configPath = piWebConfigPath(env, cwd);
  const access = readExistingConfigObject(configPath)["access"];
  if (access === undefined) return undefined;
  if (!isRecord(access) || access["tokenFile"] === undefined) throw new AccessTokenConfigError(`PI WEB config access must be an object with tokenFile: ${configPath}`);
  const unknown = Object.keys(access).filter((key) => key !== "tokenFile");
  if (unknown.length > 0) throw new AccessTokenConfigError(`PI WEB config access accepts only tokenFile, not ${unknown.map((key) => JSON.stringify(key)).join(", ")}: ${configPath}`);
  return { kind: "file", path: expandHomePath(checkedPath(access["tokenFile"], ACCESS_TOKEN_FILE_KEY, `: ${configPath}`), env), setBy: ACCESS_TOKEN_FILE_KEY };
}

/** A service's working directory is not the reader's, so a relative path would name a file nobody chose. */
/** `where` ends the message: the config file it came from (`: <path>`), or ` (set in the environment)`. */
function checkedPath(value: unknown, key: string, where: string): string {
  if (typeof value !== "string" || value === "") throw new AccessTokenConfigError(`${key} must be a non-empty file path${where}`);
  if (!isAbsolute(value) && !isHomePath(value, "current")) throw new AccessTokenConfigError(`${key} must be an absolute or ~/ path${where}`);
  return value;
}

/** One token per line; blank lines and lines starting with `#` are skipped. */
function readTokenFile(path: string): string[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new AccessTokenConfigError(`PI WEB cannot read the access token file ${path}: ${errorMessage(error)}`);
  }
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  if (lines.length === 0) throw new AccessTokenConfigError(`The access token file ${path} holds no token.`);
  return lines.map((line, index) => checkedToken(line, `${path}, token ${String(index + 1)}`));
}

function checkedToken(token: string, where: string): string {
  if (token === "") throw new AccessTokenConfigError(`The access token in ${where} is empty.`);
  if (/\s/u.test(token)) throw new AccessTokenConfigError(`The access token in ${where} contains whitespace.`);
  if (token.length < MIN_TOKEN_LENGTH) throw new AccessTokenConfigError(`The access token in ${where} is shorter than ${String(MIN_TOKEN_LENGTH)} characters; generate one with \`openssl rand -base64 32\`.`);
  return token;
}
