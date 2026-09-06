// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { css, render, type LitElement, type TemplateResult } from "lit";
import { openAddProjectDialog } from "./addProjectDialog";
import { createPluginRuntimeContext } from "../../../src/client/src/plugins/pluginRuntimeContextTestSupport";
import { rememberWorkspacesHost } from "./hostUi";
import { pressKey, requiredElement } from "../../../src/client/src/components/modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  rememberWorkspacesHost(undefined);
  for (const close of openHostDialogs.splice(0)) close();
});

const openHostDialogs: (() => void)[] = [];

/**
 * The dialog lives on the host's shared modal surface, so the plugin owns the
 * close-on-success discipline: a create that resolves without a failure
 * reason is a finished transaction and closes the dialog, while a failure
 * reason keeps it open with the error shown. Regression: the moved wiring
 * dropped the close half, leaving a created project stranded behind the form
 * with the button ready to silently re-submit.
 */
describe("add-project dialog close discipline", () => {
  it("closes the host dialog when createProject resolves without a reason", async () => {
    const host = hostWithDialog();
    rememberWorkspacesHost(host.ui);
    const { context } = createPluginRuntimeContext();
    context.createProject = vi.fn(() => Promise.resolve(undefined));

    openAddProjectDialog(context);
    await submitPath(await host.projectDialogReady(), "/work/new-project");

    await vi.waitFor(() => { expect(host.closed).toBe(true); });
  });

  it("keeps the dialog open when createProject reports a failure reason", async () => {
    const host = hostWithDialog();
    rememberWorkspacesHost(host.ui);
    const { context } = createPluginRuntimeContext();
    context.createProject = vi.fn(() => Promise.resolve("Path is not a directory"));

    openAddProjectDialog(context);
    await submitPath(await host.projectDialogReady(), "/work/broken");

    await vi.waitFor(() => { expect(context.createProject).toHaveBeenCalled(); });
    expect(host.closed).toBe(false);
  });

  it("re-opens after a closed dialog instead of swallowing the request", async () => {
    const host = hostWithDialog();
    rememberWorkspacesHost(host.ui);
    const { context } = createPluginRuntimeContext();
    context.createProject = vi.fn(() => Promise.resolve(undefined));

    openAddProjectDialog(context);
    await submitPath(await host.projectDialogReady(), "/work/first");
    await vi.waitFor(() => { expect(host.closed).toBe(true); });

    openAddProjectDialog(context);
    await vi.waitFor(() => { expect(host.projectDialog().isConnected).toBe(true); });
  });

  it("ignores a second open while the dialog is up, instead of stacking two", async () => {
    const host = hostWithDialog();
    rememberWorkspacesHost(host.ui);
    const { context } = createPluginRuntimeContext();
    context.createProject = vi.fn(() => Promise.resolve(undefined));

    openAddProjectDialog(context);
    await host.projectDialogReady();
    openAddProjectDialog(context);

    expect(host.dialogCount).toBe(1);
  });

  async function submitPath(dialog: LitElement, path: string): Promise<void> {
    const input = requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("label input"), "project-dialog path input");
    input.value = path;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await dialog.updateComplete;
    await vi.waitFor(() => { expect(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[type='checkbox']")?.disabled).toBe(false); });
    await dialog.updateComplete;
    pressKey(input, "Enter");
  }
});

interface HostHarness {
  ui: Parameters<typeof rememberWorkspacesHost>[0];
  projectDialog: () => LitElement;
  projectDialogReady: () => Promise<LitElement>;
  closed: boolean;
  dialogCount: number;
}

function hostWithDialog(): HostHarness {
  const container = document.createElement("div");
  document.body.append(container);
  const harness: HostHarness = {
    ui: { surfaceStyles: css``, listStyles: css``, showDialog: () => ({ close: () => undefined }) },
    projectDialog: () => { throw new Error("dialog not opened"); },
    projectDialogReady: () => Promise.reject(new Error("dialog not opened")),
    closed: false,
    dialogCount: 0,
  };
  harness.ui = {
    surfaceStyles: css``,
    listStyles: css``,
    showDialog: (dialog: { label: string; content: TemplateResult; onClose?: () => void }) => {
      harness.dialogCount += 1;
      render(dialog.content, container);
      const element = requiredElement(container.querySelector<LitElement>("project-dialog"), "project-dialog element");
      harness.projectDialog = () => element;
      harness.projectDialogReady = () => element.updateComplete.then(() => element);
      const close = () => {
        harness.closed = true;
        dialog.onClose?.();
      };
      openHostDialogs.push(close);
      return { close };
    },
  };
  return harness;
}
