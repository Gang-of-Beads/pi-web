import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { DEFAULT_LOGGING, effectivePiWebConfig, piWebDataDir } from "../../../config.js";
import type { PiWebLoggingConfig } from "../../../shared/apiTypes.js";
import { startLogRetention } from "./logRetention.js";
import { installRequestLogging, loggerLevel, type LogLevelChoice } from "./requestLogPolicy.js";

/**
 * One process's log policy: the request lines it keeps, its logger level and its file retention,
 * all read from the logging settings in the PI WEB config (Settings -> General). The settings are
 * re-read at each retention check (once a minute), so a change saved in Settings reaches a running
 * web or daemon process without a restart.
 */
export interface ProcessLogging {
  level(): LogLevelChoice;
}

export function startProcessLogging(app: FastifyInstance, logName: "web.log" | "sessiond.log", readSettings: () => Required<PiWebLoggingConfig> = readLoggingSettings): ProcessLogging {
  let settings = readSettings();
  const refresh = (): void => {
    settings = readSettings();
    app.log.level = loggerLevel(settings.level);
  };
  app.log.level = loggerLevel(settings.level);
  installRequestLogging(app, () => settings.level);
  startLogRetention({
    path: join(piWebDataDir(), "logs", logName),
    settings: () => settings,
    onTick: refresh,
    onError: (error) => { app.log.warn({ error: String(error) }, "log retention failed"); },
  });
  return { level: () => settings.level };
}

/** The config file's logging settings; a config that cannot be read keeps the defaults rather than stopping the logs. */
function readLoggingSettings(): Required<PiWebLoggingConfig> {
  try {
    return effectivePiWebConfig().config.logging;
  } catch {
    return DEFAULT_LOGGING;
  }
}
