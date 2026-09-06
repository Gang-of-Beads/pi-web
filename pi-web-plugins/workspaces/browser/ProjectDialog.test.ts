// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { ProjectDialog, type ProjectTrustChoice } from "./ProjectDialog";
import { deepActiveElement, pressKey, requiredElement } from "../../../src/client/src/components/modalSurfaceTestSupport";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

/**
 * The add-project form as plugin dialog content: the shell owns the modal
 * surface (focus, escape, backdrop), so these tests cover the form's own
 * contract - the debounced folder suggestions, the server-resolved trust
 * prefills, and the submit answer shape the host's createProject action
 * consumes.
 */
describe("project-dialog form", () => {
  it("focuses the project path input when opened", async () => {
    const { dialog } = await mountDialog();

    expect(deepActiveElement()).toBe(pathInput(dialog));
  });

  it("submits the typed path on Enter in the path input", async () => {
    const onSubmit = vi.fn<(path: string, create: boolean, trust: ProjectTrustChoice | undefined) => void>();
    const { dialog } = await mountDialog({ onSubmit });
    const input = pathInput(dialog);
    input.value = "/work/new-project";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settleDialog(dialog);
    await waitForTrustRead(dialog);

    pressKey(input, "Enter");

    expect(onSubmit).toHaveBeenCalledWith("/work/new-project", true, { trusted: false, changed: false });
  });

  it("disables the trust choice until a path is entered", async () => {
    const { dialog } = await mountDialog();

    expect(trustCheckbox(dialog).disabled).toBe(true);
  });

  it("prefills the trust choice with the existing decision for the entered path", async () => {
    const { dialog, projectTrust } = await mountDialog();
    projectTrust.mockResolvedValue({ path: "/work/proj", decision: true, trusted: true });
    const input = pathInput(dialog);
    input.value = "/work/proj";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await waitForTrustRead(dialog);

    expect(trustCheckbox(dialog).checked).toBe(true);
  });

  it("keeps an explicitly untrusted existing decision unchecked", async () => {
    const { dialog, projectTrust } = await mountDialog();
    projectTrust.mockResolvedValue({ path: "/work/proj", decision: false, trusted: false });
    const input = pathInput(dialog);
    input.value = "/work/proj";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await waitForTrustRead(dialog);

    expect(trustCheckbox(dialog).checked).toBe(false);
  });

  it("submits a flipped trust choice as a changed decision", async () => {
    const onSubmit = vi.fn<(path: string, create: boolean, trust: ProjectTrustChoice | undefined) => void>();
    const { dialog } = await mountDialog({ onSubmit });
    const input = pathInput(dialog);
    input.value = "/work/new-project";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await waitForTrustRead(dialog);
    const checkbox = trustCheckbox(dialog);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await settleDialog(dialog);

    pressKey(input, "Enter");

    expect(onSubmit).toHaveBeenCalledWith("/work/new-project", true, { trusted: true, changed: true });
  });

  // Regression: the suggestions and trust loaders used to share one staleness
  // counter, so the trust read fired on every keystroke discarded the in-flight
  // suggestions request and the loading hint never cleared.
  it("renders folder suggestions and clears the loading hint after typing a path", async () => {
    const { dialog, projectDirectories } = await mountDialog();
    projectDirectories.mockResolvedValue([{ path: "/work/proj/", kind: "other" }]);
    const input = pathInput(dialog);
    input.value = "/work/proj";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await vi.waitFor(() => {
      expect(dialog.shadowRoot?.querySelectorAll(".suggestions button").length).toBe(1);
    });
    await settleDialog(dialog);

    expect(dialog.shadowRoot?.querySelector(".suggestions button")?.textContent).toContain("/work/proj/");
    expect(dialog.shadowRoot?.textContent).not.toContain("Loading folders…");
  });

  it("keeps showing folder suggestions while a slower trust read is still in flight", async () => {
    const { dialog, projectDirectories, projectTrust } = await mountDialog();
    projectDirectories.mockResolvedValue([{ path: "/work/proj/", kind: "other" }]);
    let resolveTrust: ((value: { path: string; decision: boolean | null; trusted: boolean }) => void) | undefined;
    projectTrust.mockReturnValue(new Promise((resolve) => { resolveTrust = resolve; }));
    const input = pathInput(dialog);
    input.value = "/work/proj";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await vi.waitFor(() => {
      expect(dialog.shadowRoot?.querySelectorAll(".suggestions button").length).toBe(1);
    });
    resolveTrust?.({ path: "/work/proj", decision: null, trusted: false });
    await settleDialog(dialog);

    expect(dialog.shadowRoot?.textContent).not.toContain("Loading folders…");
  });

  it("explains what trusting a project means and links to the project-trust documentation", async () => {
    const { dialog } = await mountDialog();

    const hint = dialog.shadowRoot?.querySelector<HTMLElement>(".trust-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain(".pi settings");
    expect(hint?.textContent).toContain("extensions");
    expect(hint?.textContent).toContain("skills");
    expect(hint?.textContent).toContain("packages");
    // The explanation stays short and links to the docs instead of being verbose.
    const link = hint?.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("href")).toBe("https://pi.dev/docs/latest/security");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
    expect(link?.textContent).toBe("Learn about project trust");
  });
});

interface ProjectDialogProps {
  onSubmit?: (path: string, create: boolean, trust: ProjectTrustChoice | undefined) => unknown;
  onCancel?: () => void;
}

/**
 * The visible list must belong to the text currently in the input: rows for a
 * query the reader has already left are noise that reads as the answer.
 */
describe("folder list freshness", () => {
  it("drops a superseded query's rows the moment the path changes", async () => {
    const { dialog, projectDirectories } = await mountDialog();
    projectDirectories.mockResolvedValueOnce([{ path: "/work/one-place/", kind: "other" }]);
    const input = pathInput(dialog);
    input.value = "/work/one";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await vi.waitFor(() => {
      expect(dialog.shadowRoot?.querySelector(".suggestions button")?.textContent).toContain("/work/one-place/");
    });

    input.value = "/work/two";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settleDialog(dialog);

    expect(dialog.shadowRoot?.querySelectorAll(".suggestions button")).toHaveLength(0);
  });

  it("reads a failed search as a failure, not as no matches", async () => {
    const { dialog, projectDirectories } = await mountDialog();
    projectDirectories.mockRejectedValueOnce(new Error("scan exploded"));
    const input = pathInput(dialog);
    input.value = "/work/broken";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await vi.waitFor(() => {
      expect(dialog.shadowRoot?.textContent).toContain("Search failed");
    });

    expect(dialog.shadowRoot?.textContent).not.toContain("No matching folders found");
  });

  it("keeps the failure reading as a failure after the search is retried and fails again", async () => {
    const { dialog, projectDirectories } = await mountDialog();
    projectDirectories.mockRejectedValue(new Error("scan exploded"));
    const input = pathInput(dialog);
    input.value = "/work/broken";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await vi.waitFor(() => {
      expect(dialog.shadowRoot?.textContent).toContain("Search failed");
    });

    input.value = "/work/broken2";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.value = "/work/broken";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await vi.waitFor(() => {
      expect(dialog.shadowRoot?.textContent).toContain("Search failed");
    });

    expect(dialog.shadowRoot?.textContent).not.toContain("No matching folders found");
  });
});

/**
 * Two keystrokes, two listings in flight.
 */
describe("folder listing freshness", () => {
  it("never lets an older listing overwrite the newer query's answer", async () => {
    const { dialog, projectDirectories } = await mountDialog();
    let answerOld: ((value: { path: string; kind: "other" }[]) => void) | undefined;
    projectDirectories
      .mockImplementationOnce(() => new Promise((resolve) => { answerOld = resolve; }))
      .mockResolvedValueOnce([{ path: "/work/newer/", kind: "other" }]);
    const input = pathInput(dialog);

    input.value = "/work/old";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await vi.waitFor(() => { expect(answerOld).toBeDefined(); });

    input.value = "/work/newer";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await vi.waitFor(() => {
      expect(dialog.shadowRoot?.querySelector(".suggestions button")?.textContent).toContain("/work/newer/");
    });

    // The stale answer lands after the newer one is already on screen.
    answerOld?.([{ path: "/work/old-and-stale/", kind: "other" }]);
    await settleDialog(dialog);

    expect(dialog.shadowRoot?.querySelector(".suggestions button")?.textContent).toContain("/work/newer/");
    expect(dialog.shadowRoot?.textContent).not.toContain("old-and-stale");
  });
});

interface DialogMocks {
  dialog: ProjectDialog;
  projectDirectories: Mock<(query: string, signal: AbortSignal) => Promise<{ path: string; kind: "tracked" | "untracked" | "other" }[]>>;
  projectTrust: Mock<(path: string) => Promise<{ path: string; decision: boolean | null; trusted: boolean }>>;
}

async function mountDialog(props: ProjectDialogProps = {}): Promise<DialogMocks> {
  const projectDirectories = vi.fn<(query: string, signal: AbortSignal) => Promise<{ path: string; kind: "tracked" | "untracked" | "other" }[]>>().mockResolvedValue([]);
  const projectTrust = vi.fn<(path: string) => Promise<{ path: string; decision: boolean | null; trusted: boolean }>>().mockResolvedValue({ path: "", decision: null, trusted: false });
  const dialog = new ProjectDialog();
  dialog.projectDirectories = projectDirectories;
  dialog.projectTrust = projectTrust;
  if (props.onSubmit !== undefined) dialog.onSubmit = props.onSubmit;
  if (props.onCancel !== undefined) dialog.onCancel = props.onCancel;
  document.body.append(dialog);
  await settleDialog(dialog);
  return { dialog, projectDirectories, projectTrust };
}

/** Two host cycles so a render scheduled from within `updated()` has settled. */
async function settleDialog(dialog: ProjectDialog): Promise<void> {
  await dialog.updateComplete;
  await dialog.updateComplete;
}

/** Waits until the trust read for the current path has resolved and rendered. */
async function waitForTrustRead(dialog: ProjectDialog): Promise<void> {
  await vi.waitFor(() => { expect(trustCheckbox(dialog).disabled).toBe(false); });
  await settleDialog(dialog);
}

function pathInput(dialog: ProjectDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("label input"), "project-dialog path input");
}

function trustCheckbox(dialog: ProjectDialog): HTMLInputElement {
  const checkbox = dialog.shadowRoot?.querySelectorAll<HTMLInputElement>("input[type='checkbox']")[1];
  return requiredElement(checkbox, "project-dialog trust checkbox");
}
