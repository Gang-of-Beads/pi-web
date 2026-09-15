// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HtmlTemplateTag, PluginDialog, PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";
import { html } from "lit";
import { openWorktreeDialog } from "./worktreeDialog.js";

/**
 * The dialog hands the host its element, submits through the provider, keeps
 * git's refusal in place for correction, and closes on success or cancel.
 */
function fakeHost(): { ui: Pick<PluginHostUi, "showDialog">; shown: PluginDialog[]; closes: number[] } {
  const shown: PluginDialog[] = [];
  const closes: number[] = [];
  const showDialog: PluginHostUi["showDialog"] = (dialog) => {
    shown.push(dialog);
    document.body.append(elementOf(dialog));
    return { close: () => { closes.push(shown.length); dialog.onClose?.(); } };
  };
  return { ui: { showDialog }, shown, closes };
}

function elementOf(dialog: PluginDialog): HTMLElement {
  const values: unknown = Reflect.get(dialog.content, "values");
  const first: unknown = Array.isArray(values) ? values[0] : undefined;
  if (!(first instanceof HTMLElement)) throw new Error("dialog content did not carry the element");
  return first;
}

function shownElement(host: { shown: PluginDialog[] }): HTMLElement {
  const dialog = host.shown[0];
  if (dialog === undefined) throw new Error("no dialog shown");
  return elementOf(dialog);
}

function field(element: HTMLElement, name: string): HTMLInputElement {
  const input = element.shadowRoot?.querySelector<HTMLInputElement>(`input[name=${name}]`);
  if (!input) throw new Error(`no ${name} input`);
  return input;
}

const tag: HtmlTemplateTag = html;

afterEach(() => { document.body.replaceChildren(); });

describe("the new-worktree dialog", () => {
  it("suggests a directory beside the repository, submits through the provider and closes", async () => {
    const host = fakeHost();
    const submit = vi.fn(() => Promise.resolve());
    openWorktreeDialog(host.ui, tag, { repositoryPath: "/srv/dev/pi-web", submit, cancel: () => undefined });
    const element = shownElement(host);

    field(element, "branch").value = "feature/x";
    field(element, "branch").dispatchEvent(new Event("input"));
    expect(field(element, "path").value).toBe("/srv/dev/pi-web-feature-x");
    element.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => { expect(submit).toHaveBeenCalledWith({ branch: "feature/x", path: "/srv/dev/pi-web-feature-x", createBranch: true }); });

    await vi.waitFor(() => { expect(host.closes).toEqual([1]); });
  });

  it("keeps git's refusal in the dialog and stays open, then cancels", async () => {
    const host = fakeHost();
    const submit = vi.fn(() => Promise.reject(new Error("fatal: a branch named 'main' already exists")));
    const cancel = vi.fn();
    openWorktreeDialog(host.ui, tag, { repositoryPath: "/srv/dev/pi-web", submit, cancel });
    const element = shownElement(host);

    field(element, "branch").value = "main";
    field(element, "branch").dispatchEvent(new Event("input"));
    element.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => { expect(element.shadowRoot?.querySelector(".error")?.textContent).toContain("already exists"); });
    expect(host.closes).toEqual([]);

    element.shadowRoot?.querySelector<HTMLButtonElement>("button.cancel")?.click();
    expect(host.closes).toEqual([1]);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("disables the submit until branch and an absolute directory are given", () => {
    const host = fakeHost();
    openWorktreeDialog(host.ui, tag, { repositoryPath: "/srv/dev/pi-web", submit: () => Promise.resolve(), cancel: () => undefined });
    const element = shownElement(host);
    const submitButton = () => element.shadowRoot?.querySelector<HTMLButtonElement>("button[type=submit]");

    expect(submitButton()?.disabled).toBe(true);
    field(element, "branch").value = "b";
    field(element, "branch").dispatchEvent(new Event("input"));
    expect(submitButton()?.disabled).toBe(false);
    field(element, "path").value = "relative";
    field(element, "path").dispatchEvent(new Event("input"));
    expect(submitButton()?.disabled).toBe(true);
  });
});
