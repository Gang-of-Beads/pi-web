// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { composerPlaceholder } from "./PromptEditor";

/**
 * The trigger characters used to be appended to the sentence ("Message pi… /
 * @ #"), where they read as stray punctuation. They are a separate hint now,
 * so the prompt and the affordances can sit at opposite edges of the field.
 */
describe("composer placeholder", () => {
  it("splits the prompt from the trigger hints", () => {
    const node = composerPlaceholder();
    const label = node.querySelector(".composer-placeholder-label");
    const hints = node.querySelector(".composer-placeholder-hints");
    expect(label?.textContent).toBe("Message pi…");
    expect(hints?.textContent).toBe("/ @ #");
    // Order matters: the sentence leads, the hints trail.
    expect(node.firstElementChild).toBe(label);
    expect(node.lastElementChild).toBe(hints);
  });
});
