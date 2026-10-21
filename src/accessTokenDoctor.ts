import { statSync } from "node:fs";
import { effectivePiWebConfig, piWebTlsConfig } from "./config.js";
import { accessTokenConfig, describeAccessTokenSource, isLoopbackHost, type AccessTokenConfig } from "./accessTokenConfig.js";
import { errorMessage } from "./shared/unknownValues.js";

/**
 * `pi-web doctor`'s access token section: whether the web/API's gate is on and from where, never a
 * token. A source the web/API cannot use is an error, because the web/API does not start with it;
 * everything else is a warning about how far the gate reaches.
 */

const ACCESS_TOKEN_DOCS = "docs/install.md#require-an-access-token";
const GROUP_OR_OTHER_READABLE = 0o044;

interface ListenerFacts {
  readonly host: string;
  readonly https: boolean;
  readonly sessiondPort: string | undefined;
}

/** A config doctor cannot read is reported by its own checks; this section then assumes the defaults. */
function readOrDefault<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function listenerFacts(env: NodeJS.ProcessEnv): ListenerFacts {
  const sessiondPort = env["PI_WEB_SESSIOND_PORT"];
  return {
    host: readOrDefault(() => effectivePiWebConfig({ env }).config.host ?? "127.0.0.1", "127.0.0.1"),
    https: readOrDefault(() => piWebTlsConfig({ env }) !== undefined, false),
    sessiondPort: sessiondPort === undefined || sessiondPort === "" ? undefined : sessiondPort,
  };
}

function tokenFileWarnings(access: AccessTokenConfig): string[] {
  if (access.source.kind !== "file" || process.platform === "win32") return [];
  try {
    const mode = statSync(access.source.path).mode;
    return (mode & GROUP_OR_OTHER_READABLE) === 0 ? [] : [`! ${access.source.path} is readable by other users; run \`chmod 600 ${access.source.path}\`.`];
  } catch {
    return [];
  }
}

function gateOnWarnings(listener: ListenerFacts): string[] {
  return [
    ...(isLoopbackHost(listener.host) || listener.https ? [] : [`! The web/API listens on ${listener.host} over plain HTTP: the token and the sign-in cookie travel unencrypted unless the network encrypts them.`]),
    ...(listener.sessiondPort === undefined ? [] : [`! The session daemon listens on TCP port ${listener.sessiondPort}, which the access token does not cover.`]),
  ];
}

function gateOffLines(listener: ListenerFacts): string[] {
  if (isLoopbackHost(listener.host)) return ["- off; the web/API listens on this machine only"];
  return [
    `! off, and the web/API listens on ${listener.host}: anyone who reaches the port uses PI WEB with no sign-in.`,
    `  Keep it on a private network or behind an authenticating proxy, or require an access token (${ACCESS_TOKEN_DOCS}).`,
  ];
}

/** Prints the section; false when the web/API would refuse to start. */
export function printAccessTokenCheck(configEnv: NodeJS.ProcessEnv | undefined): boolean {
  const env = configEnv ?? process.env;
  console.log("\nAccess token:");
  let access: AccessTokenConfig | undefined;
  try {
    access = accessTokenConfig({ env });
  } catch (error) {
    console.log(`✗ ${errorMessage(error)}`);
    console.log("  The web/API does not start until the access token source is fixed.");
    return false;
  }
  const listener = listenerFacts(env);
  if (access === undefined) {
    for (const line of gateOffLines(listener)) console.log(line);
    return true;
  }
  const count = access.tokens.length;
  console.log(`✓ on (${String(count)} ${count === 1 ? "token" : "tokens"} from ${describeAccessTokenSource(access.source)})`);
  for (const line of [...tokenFileWarnings(access), ...gateOnWarnings(listener)]) console.log(line);
  return true;
}
