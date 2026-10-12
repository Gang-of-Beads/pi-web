import { afterEach, describe, expect, it } from "vitest";
import { CARD_TYPED_TEXT_MAX_LENGTH, type CardField } from "../../shared/interactiveCard";
import { clearCardDraft, filledCount, loadCardDraft, saveCardDraft, toCardSubmission, unfilledFields, type CardDraft } from "./cardDrafts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error("storage blocked");
  }

  override setItem(): void {
    throw new Error("storage blocked");
  }

  override removeItem(): void {
    throw new Error("storage blocked");
  }
}

const singleSelect: CardField = {
  type: "choice",
  id: "q1",
  label: "Which database?",
  options: [{ value: "pg", label: "Postgres" }, { value: "sqlite", label: "SQLite" }],
  other: "choice",
};

const multiSelect: CardField = {
  type: "choice",
  id: "q2",
  label: "Which extras?",
  options: [{ value: "metrics", label: "Metrics" }, { value: "tracing", label: "Tracing" }],
  multiple: true,
  other: "field",
};

const freeText: CardField = {
  type: "input",
  id: "q3",
  label: "Anything else?",
};

const intro: CardField = { type: "text", id: "intro", text: "Three fields." };

const questions = [intro, singleSelect, multiSelect, freeText];

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
});

describe("card draft storage", () => {
  it("round-trips a draft under a session- and ask-scoped key", () => {
    const storage = new MemoryStorage();
    const answers: CardDraft = { q1: { selected: ["pg"] }, q2: { selected: ["metrics"], other: "audit log" } };

    saveCardDraft("local:s1", "ask-1", answers, storage);

    expect(storage.getItem("pi-web:card-draft:local:s1:ask-1")).not.toBeNull();
    expect(loadCardDraft("local:s1", "ask-1", storage)).toEqual(answers);
    // Another card of the same session, and the same card of another session, are
    // separate drafts.
    expect(loadCardDraft("local:s1", "ask-2", storage)).toEqual({});
    expect(loadCardDraft("local:s2", "ask-1", storage)).toEqual({});
  });

  it("removes the entry rather than storing a draft that says nothing", () => {
    const storage = new MemoryStorage();
    saveCardDraft("local:s1", "ask-1", { q1: { selected: ["pg"] } }, storage);

    saveCardDraft("local:s1", "ask-1", { q1: { selected: [], other: "" } }, storage);

    expect(storage.getItem("pi-web:card-draft:local:s1:ask-1")).toBeNull();
    expect(loadCardDraft("local:s1", "ask-1", storage)).toEqual({});
  });

  it("clears a draft once its card is closed", () => {
    const storage = new MemoryStorage();
    saveCardDraft("local:s1", "ask-1", { q1: { selected: ["pg"] } }, storage);

    clearCardDraft("local:s1", "ask-1", storage);

    expect(loadCardDraft("local:s1", "ask-1", storage)).toEqual({});
  });

  it("treats unreadable and malformed drafts as empty instead of failing", () => {
    const storage = new MemoryStorage();
    storage.setItem("pi-web:card-draft:local:s1:ask-1", "{not json");
    expect(loadCardDraft("local:s1", "ask-1", storage)).toEqual({});

    storage.setItem("pi-web:card-draft:local:s1:ask-1", JSON.stringify({ q1: { selected: "pg" }, q2: { selected: ["metrics"] }, q3: 7 }));
    expect(loadCardDraft("local:s1", "ask-1", storage)).toEqual({ q2: { selected: ["metrics"] } });

    const throwing = new ThrowingStorage();
    expect(loadCardDraft("local:s1", "ask-1", throwing)).toEqual({});
    expect(() => { saveCardDraft("local:s1", "ask-1", { q1: { selected: ["pg"] } }, throwing); }).not.toThrow();
    expect(() => { clearCardDraft("local:s1", "ask-1", throwing); }).not.toThrow();
  });

  it("does nothing when the browser has no storage at all", () => {
    expect(loadCardDraft("local:s1", "ask-1", undefined)).toEqual({});
    expect(() => { saveCardDraft("local:s1", "ask-1", { q1: { selected: ["pg"] } }, undefined); }).not.toThrow();
    expect(() => { clearCardDraft("local:s1", "ask-1", undefined); }).not.toThrow();
  });
});

describe("card value state", () => {
  it("counts and names filled fields exactly as the submission reports them", () => {
    const draft: CardDraft = { q1: { selected: ["pg"] }, q3: { text: "  ship it  " } };

    expect(filledCount(questions, draft)).toBe(2);
    expect(unfilledFields(questions, draft).map((field) => field.id)).toEqual(["q2"]);
    expect(toCardSubmission(questions, draft)).toEqual({ values: { q1: { selected: ["pg"] }, q3: { text: "  ship it  " } } });
  });

  it("treats untouched, empty, and whitespace-only values as unfilled", () => {
    const draft: CardDraft = { q1: { selected: [] }, q3: { text: "   " } };

    expect(filledCount(questions, draft)).toBe(0);
    expect(unfilledFields(questions, draft).map((field) => field.id)).toEqual(["q1", "q2", "q3"]);
    expect(toCardSubmission(questions, draft)).toEqual({ values: {} });
  });

  it("keeps several values and typed text together for a multi-answer choice", () => {
    const draft: CardDraft = { q2: { selected: ["metrics", "tracing"], other: "profiling" } };

    expect(toCardSubmission(questions, draft)).toEqual({ values: { q2: { selected: ["metrics", "tracing"], other: "profiling" } } });
  });

  it("drops draft entries the field would refuse rather than losing the whole submission", () => {
    // Drafts are browser-local and survive another tab or an older app version, so an entry that
    // no longer fits its field is narrowed instead of poisoning every other value.
    const draft: CardDraft = {
      q1: { selected: ["mysql", "pg", "pg"], other: "custom" },
      q2: { selected: ["metrics", "mongo"] },
      q3: { selected: ["nope"] },
    };

    expect(toCardSubmission(questions, draft)).toEqual({ values: { q1: { selected: ["pg"] }, q2: { selected: ["metrics"] } } });
  });

  it("keeps typed text for a single-answer choice when no option is picked", () => {
    expect(toCardSubmission([singleSelect], { q1: { selected: [], other: "neither" } })).toEqual({ values: { q1: { selected: [], other: "neither" } } });
  });

  it("bounds typed text at the shared limit", () => {
    const draft: CardDraft = { q3: { text: "a".repeat(CARD_TYPED_TEXT_MAX_LENGTH + 10) } };

    const value = toCardSubmission(questions, draft).values["q3"];
    expect(value !== undefined && "text" in value ? value.text : "").toHaveLength(CARD_TYPED_TEXT_MAX_LENGTH);
  });
});
