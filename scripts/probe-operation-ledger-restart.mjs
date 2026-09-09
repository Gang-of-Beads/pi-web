import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OperationLedger } from "../dist/server/daemon/sessions/operationLedger.js";

/**
 * The restart evidence the ledger exists for.
 *
 * The ledger it replaces said in its own header that a daemon restart forgets
 * it, which turned the browser's correct retry - correct because its answer was
 * lost - into a second run of the same prompt. This probe writes rows through
 * the built artifact, drops the object, reopens from disk, and reports what the
 * new process can and cannot claim.
 */
const dataDir = mkdtempSync(join(tmpdir(), "pi-web-ledger-probe-"));
const settled = "cm-1757000000000-aaaaaaaa";
const inFlight = "cm-1757000000001-bbbbbbbb";

try {
  const before = OperationLedger.open(dataDir);
  before.begin("session-1", settled, "prompt:hello");
  before.settle("session-1", settled, "succeeded");
  before.begin("session-1", inFlight, "prompt:world");

  const rowFile = join(dataDir, "operations.jsonl");
  if (!existsSync(rowFile)) { console.error("FAIL: no rows were written to disk"); process.exit(1); }
  const lines = readFileSync(rowFile, "utf8").split("\n").filter((line) => line !== "");

  const after = OperationLedger.open(dataDir);
  const settledDecision = after.decide("session-1", settled, "prompt:hello");
  const inFlightRow = after.rowFor("session-1", inFlight);
  const conflict = after.decide("session-1", settled, "prompt:something-else");
  const open = after.openRows("session-1").map((row) => row.operationId);

  console.log(`rows on disk after the first process: ${String(lines.length)}`);
  console.log(`retry of a settled operation after restart: ${JSON.stringify(settledDecision)}`);
  console.log(`operation that was in flight when the process died: ${String(inFlightRow?.outcome)}`);
  console.log(`same id with a different payload: ${JSON.stringify(conflict)}`);
  console.log(`rows a reconnecting client must close: ${JSON.stringify(open)}`);

  const ok = settledDecision.kind === "replay"
    && settledDecision.outcome === "succeeded"
    && inFlightRow?.outcome === "unknown"
    && conflict.kind === "refuse"
    && conflict.code === "conflict"
    && open.length === 1 && open[0] === inFlight;
  if (!ok) { console.error("FAIL: the reopened ledger did not answer as specified"); process.exit(1); }
  console.log("PASS: a restart answers the retry, claims nothing about work in flight, and refuses a rewrite");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
