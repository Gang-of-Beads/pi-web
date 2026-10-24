import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MachineAccessRequestView } from "../../../shared/machineAccess.js";
import { isRecord } from "../../../shared/unknownValues.js";
import type { AccessDecision, AccessRequest, MachineAccessStore } from "./machineAccessStore.js";
import { originAccess, serializedOrigin, type OriginAccess } from "./originAccess.js";

/**
 * Browser access to this machine from other machines' pages (docs/design/browser-direct-machines.md).
 *
 * One hook answers for every route: an approved page gets the CORS headers that let the browser hand
 * it the answer, and an unapproved cross-site page may not write (today any page could send a
 * body-less POST and only its answer was hidden). Two endpoints answer any page, because asking is
 * how a page becomes approved: leaving a request and reading its state. Deciding is for this
 * machine's own page, on the approval page its link opens; an approved page from another machine may
 * not decide. Because an answer's CORS headers depend on the asking page, every answer says it varies
 * by Origin: a response the browser keeps for this machine's own page (a plugin module, kept for its
 * revision) must not be reused for an approved page from another machine, which would fail CORS.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const REQUESTS_PATH = "/api/machine-access/requests";
const REQUEST_STATE_PATH = /^\/api\/machine-access\/requests\/[A-Za-z0-9_-]+$/u;
const MAX_NAME_LENGTH = 80;
const PREFLIGHT_MAX_AGE_SECONDS = "600";
const DECISIONS: ReadonlySet<string> = new Set<AccessDecision>(["approve", "deny"]);

function isDecision(value: string): value is AccessDecision {
  return DECISIONS.has(value);
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requestOrigin(request: FastifyRequest): string | undefined {
  return serializedOrigin(header(request, "origin"));
}

function accessOf(request: FastifyRequest, store: MachineAccessStore): OriginAccess {
  return originAccess({ origin: requestOrigin(request), fetchSite: header(request, "sec-fetch-site") }, (origin) => store.isApproved(origin));
}

/** The two endpoints any page may call: leaving a request, and reading its state. */
function isOpenEndpoint(request: FastifyRequest): boolean {
  const path = request.url.split("?", 1)[0] ?? "";
  if (path === REQUESTS_PATH) return request.method === "POST" || request.method === "OPTIONS";
  return REQUEST_STATE_PATH.test(path) && (request.method === "GET" || request.method === "OPTIONS");
}

function allowCors(request: FastifyRequest, reply: FastifyReply, origin: string, approved: boolean): void {
  reply.header("access-control-allow-origin", origin);
  if (request.method !== "OPTIONS") return;
  reply.header("access-control-allow-methods", approved ? "GET, HEAD, POST, PUT, PATCH, DELETE" : "GET, POST");
  reply.header("access-control-allow-headers", approved ? header(request, "access-control-request-headers") ?? "content-type" : "content-type");
  reply.header("access-control-max-age", PREFLIGHT_MAX_AGE_SECONDS);
  if (header(request, "access-control-request-private-network") === "true") reply.header("access-control-allow-private-network", "true");
}

function publicRequest(request: AccessRequest): MachineAccessRequestView {
  return { id: request.id, origin: request.origin, name: request.name, code: request.code, state: request.state, expiresAt: new Date(request.expiresAt).toISOString() };
}

function requestedName(body: unknown): string | undefined {
  const name = isRecord(body) && typeof body["name"] === "string" ? body["name"].trim() : "";
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : undefined;
}

export function registerMachineAccess(app: FastifyInstance, store: MachineAccessStore): void {
  app.addHook("onRequest", async (request, reply) => {
    const origin = requestOrigin(request);
    const access = accessOf(request, store);
    const open = isOpenEndpoint(request);
    const corsAllowed = origin !== undefined && (access === "approved" || open);
    reply.header("vary", "Origin");
    if (corsAllowed) allowCors(request, reply, origin, access === "approved");
    if (request.method === "OPTIONS" && corsAllowed) return reply.code(204).send();
    if (!SAFE_METHODS.has(request.method) && access === "unapproved" && !open) {
      return reply.code(403).send({ error: "This machine has not approved the page this request came from." });
    }
    return undefined;
  });

  app.post(REQUESTS_PATH, async (request, reply) => {
    const origin = requestOrigin(request);
    if (origin === undefined || accessOf(request, store) === "own-page") {
      return reply.code(400).send({ error: "Access is requested from another machine's PI WEB page." });
    }
    const name = requestedName(request.body);
    if (name === undefined) return reply.code(400).send({ error: `Expected { name } of 1 to ${String(MAX_NAME_LENGTH)} characters.` });
    const outcome = store.request(origin, name);
    if (outcome.kind === "already-approved") return { state: "approved" };
    if (outcome.kind === "too-many") return reply.code(429).send({ error: "Too many requests for access are waiting here; try again in a few minutes." });
    return reply.code(201).send(publicRequest(outcome.request));
  });

  app.get<{ Params: { id: string } }>(`${REQUESTS_PATH}/:id`, async (request, reply) => {
    const found = store.find(request.params.id);
    if (found === undefined) return reply.code(404).send({ error: "No such request for access; it may have expired." });
    return publicRequest(found);
  });

  app.post<{ Params: { id: string; decision: string } }>(`${REQUESTS_PATH}/:id/:decision`, async (request, reply) => {
    const decision = request.params.decision;
    if (!isDecision(decision)) return reply.code(404).send({ error: "Expected approve or deny." });
    if (accessOf(request, store) === "approved") return reply.code(403).send({ error: "Only this machine's own page may decide requests for access." });
    const decided = await store.decide(request.params.id, decision);
    if (decided === undefined) return reply.code(404).send({ error: "No such request for access; it may have expired." });
    return publicRequest(decided);
  });

  app.get("/api/machine-access/approved", () => ({ approved: store.approvedOrigins() }));

  app.delete<{ Querystring: { origin?: string } }>("/api/machine-access/approved", async (request, reply) => {
    const target = serializedOrigin(request.query.origin);
    if (target === undefined) return reply.code(400).send({ error: "Expected ?origin= with an http(s) origin." });
    if (accessOf(request, store) === "approved" && requestOrigin(request) !== target) {
      return reply.code(403).send({ error: "An approved page may remove only its own access." });
    }
    return { removed: await store.forget(target) };
  });
}
