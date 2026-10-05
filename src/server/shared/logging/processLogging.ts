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
  let settings = settingsOr(readSettings, DEFAULT_LOGGING);
  let lastProblem = "";
  const refresh = (): void => {
    try {
      settings = readSettings();
      lastProblem = "";
    } catch (error) {
      const problem = String(error);
      if (problem !== lastProblem) app.log.warn({ error: problem }, "logging settings could not be read; keeping the last good ones");
      lastProblem = problem;
    }
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

/**
 * The config file's logging settings. A config edited into something unreadable while the process
 * runs keeps the last good settings and says so once, rather than silently reverting to the
 * defaults (review 1005).
 */
function readLoggingSettings(): Required<PiWebLoggingConfig> {
  return effectivePiWebConfig().config.logging;
}

function settingsOr(read: () => Required<PiWebLoggingConfig>, fallback: Required<PiWebLoggingConfig>): Required<PiWebLoggingConfig> {
  try {
    return read();
  } catch {
    return fallback;
  }
}
