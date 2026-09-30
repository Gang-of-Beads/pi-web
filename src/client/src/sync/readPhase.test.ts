import { describe, expect, it } from "vitest";
import { HttpError } from "../api/http";
import { classifyReadError, retryDelayMs } from "./readPhase";

describe("classifyReadError", () => {
  /**
   * B48 and owner Q9: a refusal the server stated is a fact; every other
   * failure is a miss that is retried, and the miss says why, so the row can
   * name a machine that is not answering, and show a server error in its own
   * words instead of "Reconnecting…".
   */
  it("names every failure once: a fact for a stated refusal, and otherwise why the read went unanswered", () => {
    const table = {
      "dropped connection": classifyReadError(new TypeError("Failed to fetch")),
      "reader deadline": classifyReadError(new Error("The server did not answer within 30s.")),
      "a thrown string": classifyReadError("a thrown string"),
      "local 502": classifyReadError(new HttpError("Bad gateway", 502, "local")),
      "503 with no machine": classifyReadError(new HttpError("Service unavailable", 503)),
      "remote 504": classifyReadError(new HttpError("Remote machine timeout", 504, "ubuntu", "gateway")),
      "remote 502": classifyReadError(new HttpError("Remote machine unavailable (connect ECONNREFUSED)", 502, "ubuntu", "gateway")),
      "a proxy 502 on a remote URL": classifyReadError(new HttpError("Bad Gateway", 502, "ubuntu")),
      "transport failure as status 0": classifyReadError(new HttpError("Failed to fetch", 0, "ubuntu")),
      "500 with an empty reason": classifyReadError(new HttpError("", 500, "local")),
      "local 500": classifyReadError(new HttpError("Project store is locked", 500, "local")),
      "500 with no machine": classifyReadError(new HttpError("Internal Server Error", 500)),
      "remote protocol 404": classifyReadError(new HttpError("Not Found", 404, "ubuntu")),
      "401": classifyReadError(new HttpError("Unauthorized", 401, "local")),
      "403": classifyReadError(new HttpError("Forbidden", 403, "ubuntu")),
    };
    const linkDown = { kind: "miss", miss: { kind: "link-down" } };
    expect(table).toEqual({
      "dropped connection": linkDown,
      "reader deadline": linkDown,
      "a thrown string": linkDown,
      "local 502": linkDown,
      "503 with no machine": linkDown,
      "remote 504": { kind: "miss", miss: { kind: "machine-unanswering", machineId: "ubuntu" } },
      "remote 502": { kind: "miss", miss: { kind: "machine-unanswering", machineId: "ubuntu" } },
      "a proxy 502 on a remote URL": linkDown,
      "transport failure as status 0": linkDown,
      "500 with an empty reason": { kind: "miss", miss: { kind: "server-error", machineId: "local", reason: "HTTP 500" } },
      "local 500": { kind: "miss", miss: { kind: "server-error", machineId: "local", reason: "Project store is locked" } },
      "500 with no machine": { kind: "miss", miss: { kind: "server-error", machineId: "local", reason: "Internal Server Error" } },
      "remote protocol 404": { kind: "miss", miss: { kind: "server-error", machineId: "ubuntu", reason: "Not Found" } },
      "401": { kind: "fact", fact: { kind: "signed-out" } },
      "403": { kind: "fact", fact: { kind: "forbidden" } },
    });
  });
});

describe("retryDelayMs", () => {
  it("backs off 1, 2, 4, 8 s and stops growing at the quiet window", () => {
    expect([0, 1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, 15_000))).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
  });
});
