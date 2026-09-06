/** What a thrown failure says to a reader, matched by name so host-thrown errors describe themselves across module copies. */

const UNDESCRIBED_FAILURE = "The request failed";

function errorStatus(error: Error): unknown {
  const candidate: unknown = error;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  if (!("status" in candidate)) return undefined;
  return candidate.status;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "HttpError" && error.message === "") return `${UNDESCRIBED_FAILURE} (${String(errorStatus(error))})`;
    return error.message === "" ? UNDESCRIBED_FAILURE : error.message;
  }
  const text = String(error);
  return text === "" || text.startsWith("[object") ? UNDESCRIBED_FAILURE : text;
}
