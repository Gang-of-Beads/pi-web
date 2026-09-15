import type { HtmlTemplateTag, PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";
import { defaultWorktreePath, worktreeFormVerdict } from "./worktreeForm.js";

/**
 * The "New worktree" dialog: branch, directory, new-or-existing branch. It
 * is a plain element with its own shadow root so the git plugin stays free
 * of a rendering library; the host's dialog seam owns the modal surface,
 * focus, Escape and the backdrop, and the element owns only its form.
 *
 * The verdict of a submit is the reader's: git's own refusal is shown where
 * the submit happened and the dialog stays open, so a taken branch name or
 * an existing directory is corrected in place, not retyped from scratch.
 */
export interface WorktreeDialogInput {
  branch: string;
  path: string;
  createBranch: boolean;
}

export interface WorktreeDialogOptions {
  repositoryPath: string;
  submit: (input: WorktreeDialogInput) => Promise<void>;
  cancel: () => void;
}

const WORKTREE_DIALOG_TAG = "pi-web-git-worktree-dialog";

const dialogStyles = `
  :host { display: block; color: var(--pi-text); }
  form { display: flex; flex-direction: column; min-height: 0; max-height: 100%; }
  header, footer { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
  footer { border-top: 1px solid var(--pi-border); border-bottom: 0; justify-content: end; }
  .body { flex: 1 1 auto; display: grid; gap: var(--pi-space-6); padding: var(--pi-space-6); min-height: 0; overflow-y: auto; }
  label { display: grid; gap: var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-sm); }
  input[type="text"] { box-sizing: border-box; min-height: var(--pi-control-height); width: 100%; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-4); font: var(--pi-text-sm) var(--pi-font-mono); }
  input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
  .check { display: flex; align-items: center; gap: var(--pi-space-3); color: var(--pi-text); }
  .check input { width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); margin: 0; accent-color: var(--pi-accent); }
  .hint { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  .error { margin: 0; padding: 0 var(--pi-space-6) var(--pi-space-4); color: var(--pi-danger); font-size: var(--pi-text-sm); white-space: pre-wrap; }
  button { box-sizing: border-box; min-height: var(--pi-control-height); padding: var(--pi-space-3) var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); cursor: pointer; }
  button.primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); }
  button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
  button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
  .close { display: inline-grid; place-items: center; width: var(--pi-control-height); padding: 0; }
  @media (pointer: coarse) { button, input[type="text"] { min-height: var(--pi-control-height-comfort); } }
`;

interface WorktreeDialogHost extends HTMLElement {
  configure(options: WorktreeDialogOptions): void;
}

function isWorktreeDialogHost(element: HTMLElement): element is WorktreeDialogHost {
  return typeof Reflect.get(element, "configure") === "function";
}

/** Defined on first use: the class body needs a DOM, and the module is also loaded where there is none. */
function defineWorktreeDialogElement(): void {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined" || customElements.get(WORKTREE_DIALOG_TAG) !== undefined) return;
  class WorktreeDialogElement extends HTMLElement {
    private options: WorktreeDialogOptions | undefined;
    private pathTouched = false;
    private submitting = false;
    private error: string | undefined;
    private readonly root = this.attachShadow({ mode: "open" });
  
    configure(options: WorktreeDialogOptions): void {
      this.options = options;
      this.pathTouched = false;
      this.submitting = false;
      this.error = undefined;
      this.draw();
    }
  
    connectedCallback(): void {
      this.draw();
      this.root.querySelector<HTMLInputElement>("input[name=branch]")?.focus();
    }
  
    private draw(): void {
      if (this.options === undefined) return;
      const branch = this.branchValue();
      const path = this.pathTouched ? this.pathValue() : defaultWorktreePath(this.options.repositoryPath, branch);
      const createBranch = this.root.querySelector<HTMLInputElement>("input[name=createBranch]")?.checked ?? true;
      const verdict = worktreeFormVerdict({ branch, path });
      this.root.innerHTML = "";
      const style = document.createElement("style");
      style.textContent = dialogStyles;
      const form = document.createElement("form");
      form.setAttribute("aria-label", "New worktree");
      form.innerHTML = `
        <header><strong>New worktree</strong><button type="button" class="close" aria-label="Close">\u00d7</button></header>
        <div class="body">
          <label>Branch<input type="text" name="branch" autocomplete="off" spellcheck="false" placeholder="feature/name"></label>
          <label class="check"><input type="checkbox" name="createBranch"> Create this branch</label>
          <label>Directory<input type="text" name="path" autocomplete="off" spellcheck="false"></label>
          <p class="hint">Runs git worktree add on this machine. The new checkout appears in the workspace list after a refresh; nothing switches to it.</p>
        </div>
        <p class="error" role="alert" hidden></p>
        <footer><button type="button" class="cancel">Cancel</button><button type="submit" class="primary">Add worktree</button></footer>
      `;
      this.root.append(style, form);
      const branchInput = this.input(form, "branch");
      const pathInput = this.input(form, "path");
      const createInput = this.input(form, "createBranch");
      branchInput.value = branch;
      pathInput.value = path;
      createInput.checked = createBranch;
      const errorLine = form.querySelector<HTMLElement>(".error");
      if (errorLine !== null && this.error !== undefined) { errorLine.hidden = false; errorLine.textContent = this.error; }
      const submitButton = form.querySelector<HTMLButtonElement>("button[type=submit]");
      if (submitButton !== null) {
        submitButton.disabled = this.submitting || verdict.kind !== "ready";
        submitButton.textContent = this.submitting ? "Adding\u2026" : "Add worktree";
      }
      branchInput.addEventListener("input", () => {
        if (!this.pathTouched) pathInput.value = defaultWorktreePath(this.options?.repositoryPath ?? "", branchInput.value);
        this.refreshSubmit(form);
      });
      pathInput.addEventListener("input", () => { this.pathTouched = true; this.refreshSubmit(form); });
      form.querySelector(".close")?.addEventListener("click", () => { this.options?.cancel(); });
      form.querySelector(".cancel")?.addEventListener("click", () => { this.options?.cancel(); });
      form.addEventListener("submit", (event) => { event.preventDefault(); void this.submit(); });
    }
  
    private refreshSubmit(form: HTMLFormElement): void {
      const verdict = worktreeFormVerdict({ branch: this.input(form, "branch").value, path: this.input(form, "path").value });
      const submitButton = form.querySelector<HTMLButtonElement>("button[type=submit]");
      if (submitButton !== null) submitButton.disabled = this.submitting || verdict.kind !== "ready";
    }
  
    private async submit(): Promise<void> {
      if (this.options === undefined || this.submitting) return;
      const input = { branch: this.branchValue().trim(), path: this.pathValue().trim(), createBranch: this.root.querySelector<HTMLInputElement>("input[name=createBranch]")?.checked ?? true };
      if (worktreeFormVerdict(input).kind !== "ready") return;
      this.submitting = true;
      this.error = undefined;
      this.draw();
      try {
        await this.options.submit(input);
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.submitting = false;
        this.draw();
      }
    }
  
    private branchValue(): string {
      return this.root.querySelector<HTMLInputElement>("input[name=branch]")?.value ?? "";
    }
  
    private pathValue(): string {
      return this.root.querySelector<HTMLInputElement>("input[name=path]")?.value ?? "";
    }
  
    private input(form: HTMLFormElement, name: string): HTMLInputElement {
      const element = form.querySelector<HTMLInputElement>(`input[name=${name}]`);
      if (element === null) throw new Error(`worktree dialog lost its ${name} input`);
      return element;
    }
  }
  customElements.define(WORKTREE_DIALOG_TAG, WorktreeDialogElement);
}

let activeDialog: { close(): void } | undefined;

/** One dialog at a time; the host closes it and the plugin forgets it. */
export function openWorktreeDialog(ui: Pick<PluginHostUi, "showDialog">, html: HtmlTemplateTag, options: WorktreeDialogOptions): void {
  if (activeDialog !== undefined) return;
  defineWorktreeDialogElement();
  const element = document.createElement(WORKTREE_DIALOG_TAG);
  if (!isWorktreeDialogHost(element)) throw new Error("worktree dialog element did not register");
  element.configure({
    repositoryPath: options.repositoryPath,
    submit: async (input) => {
      await options.submit(input);
      activeDialog?.close();
    },
    cancel: () => { activeDialog?.close(); },
  });
  activeDialog = ui.showDialog({
    label: "New worktree",
    content: html`${element}`,
    onClose: () => { activeDialog = undefined; options.cancel(); },
  });
}
