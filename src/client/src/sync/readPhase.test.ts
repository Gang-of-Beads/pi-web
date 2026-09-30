import { describe, expect, it } from "vitest";
import { HttpError } from "../api/http";
import { classifyReadError, retryDelayMs } from "./readPhase";

describe("classifyReadError", () => {
  it("names only a refusal the server stated as a fact; everything else is no answer", () => {
    const table = [
      new TypeError("Failed to fetch"),
      new Error("The request did not answer within 30 s"),
      new HttpError("Bad gateway", 502),
      new HttpError("Service unavailable", 503),
      new HttpError("Not found", 404),
      new HttpError("Unauthorized", 401),
      new HttpError("Forbidden", 403),
      "a thrown string",
    ].map((error) => classifyReadError(error));
    expect(table).toEqual(["no-answer", "no-answer", "no-answer", "no-answer", "no-answer", { kind: "signed-out" }, { kind: "forbidden" }, "no-answer"]);
  });
});

describe("retryDelayMs", () => {
  it("backs off 1, 2, 4, 8 s and stops growing at the quiet window", () => {
    expect([0, 1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, 15_000))).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
  });
});
