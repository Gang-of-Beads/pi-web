#!/usr/bin/env node
import { effectivePiWebConfig, maxUploadBytes } from "../config.js";
import { buildApp } from "./web/app.js";

const { config } = effectivePiWebConfig();
const app = await buildApp({ bodyLimit: maxUploadBytes(process.env, config) });
await app.listen({ port: config.port ?? 8504, host: config.host ?? "127.0.0.1" });
