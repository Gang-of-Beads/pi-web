import { describe, expect, it } from "vitest";
import { CommittedPromptExpectations } from "./committedPromptIdentity";

/**
 * The runtime commits a prompt without the id its sender minted; these
 * expectations carry it across. Claims are strict - same text, same image
 * count, oldest first - because user messages also enter the transcript
 * without passing the prompt throat, and stamping one of those with a
 * stranger's id replaces the wrong bubble.
 */
describe("committed prompt expectations", () => {
  it("claims by exact shape, oldest first", () => {
    const expectations = new CommittedPromptExpectations();
    expectations.expect("s", { clientMessageId: "a", text: "", imageCount: 1 });
    expectations.expect("s", { clientMessageId: "b", text: "", imageCount: 1 });
    expect(expectations.claim("s", { text: "", imageCount: 1 })).toBe("a");
    expect(expectations.claim("s", { text: "", imageCount: 1 })).toBe("b");
    expect(expectations.claim("s", { text: "", imageCount: 1 })).toBeUndefined();
  });

  it("refuses a message whose shape it never promised", () => {
    const expectations = new CommittedPromptExpectations();
    expectations.expect("s", { clientMessageId: "a", text: "", imageCount: 1 });
    expect(expectations.claim("s", { text: "an injected continuation", imageCount: 0 })).toBeUndefined();
    expect(expectations.claim("s", { text: "", imageCount: 2 })).toBeUndefined();
    expect(expectations.claim("s", { text: "", imageCount: 1 })).toBe("a");
  });

  it("keeps sessions apart and forgets a closed one", () => {
    const expectations = new CommittedPromptExpectations();
    expectations.expect("s1", { clientMessageId: "a", text: "hi", imageCount: 0 });
    expect(expectations.claim("s2", { text: "hi", imageCount: 0 })).toBeUndefined();
    expectations.forgetSession("s1");
    expect(expectations.claim("s1", { text: "hi", imageCount: 0 })).toBeUndefined();
  });

  it("matches a rewritten prompt by nothing rather than by position", () => {
    const expectations = new CommittedPromptExpectations();
    expectations.expect("s", { clientMessageId: "a", text: "/skill review", imageCount: 0 });
    expect(expectations.claim("s", { text: "the expanded skill body", imageCount: 0 })).toBeUndefined();
  });
});
