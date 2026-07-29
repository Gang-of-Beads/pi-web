#!/usr/bin/env node
import { effectivePiWebConfig, maxUploadBytes } from "../config.js";
import { buildApp } from "./app.js";

const { config } = effectivePiWebConfig();
const app = await buildApp({ bodyLimit: maxUploadBytes(process.env, config) });
let shuttingDown = false;

const removeSignalHandlers = (): void => {
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
};
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down PI WEB web server");
  try {
    await app.close();
  } catch (error: unknown) {
    process.exitCode = 1;
    app.log.error({ err: error }, "PI WEB web server shutdown failed");
  } finally {
    removeSignalHandlers();
  }
};
function onSigint(): void {
  void shutdown("SIGINT");
}
function onSigterm(): void {
  void shutdown("SIGTERM");
}

process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);
app.addHook("onClose", () => { removeSignalHandlers(); });

try {
  await app.listen({ port: config.port ?? 8504, host: config.host ?? "127.0.0.1" });
} catch (error: unknown) {
  removeSignalHandlers();
  throw error;
}
