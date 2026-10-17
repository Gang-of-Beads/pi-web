import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { PluginProjectFolderReply, PluginProjectFolders, ProjectFolderListing, ProjectFolderListingRequest } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The folder browser's one current folder (r67): what the list shows, which listing request is
 * the current one, and the quiet retry of a listing nobody answered.
 *
 * Every listing is a request with its own identity. Only the latest request's reply, from the
 * machine the dialog was opened for, may change what is shown; an older reply never paints
 * another folder, and while a request is open nothing offers to add a folder (the view is
 * `loading`, not the previous listing with live actions on it).
 */
export type FolderView =
  | { readonly kind: "loading"; readonly label: string }
  | { readonly kind: "listed"; readonly listing: ProjectFolderListing }
  | { readonly kind: "unanswered"; readonly label: string; readonly reason: string }
  | { readonly kind: "refused"; readonly label: string; readonly reason: string }
  | { readonly kind: "unsupported" };

type ListFolder = PluginProjectFolders["listFolder"];

/** One listing request: what was asked, what the reader saw while it ran, and where a refused new name returns to. */
interface PendingListing {
  readonly id: number;
  readonly request: ProjectFolderListingRequest;
  readonly label: string;
  readonly from: ProjectFolderListing | undefined;
}

/** What the browser shows next, and what it does, for each way a listing came back. */
interface ReplyOutcome {
  readonly view: FolderView;
  readonly nameRefusal: string | undefined;
  readonly retry: boolean;
}

type ReplyByKind = { readonly [R in PluginProjectFolderReply as R["kind"]]: R };

const REPLY_OUTCOMES: { readonly [K in keyof ReplyByKind]: (reply: ReplyByKind[K], pending: PendingListing) => ReplyOutcome } = {
  listed: (reply) => ({ view: { kind: "listed", listing: reply.listing }, nameRefusal: undefined, retry: false }),
  "name-refused": (reply, pending) => pending.from === undefined
    ? { view: { kind: "refused", label: pending.label, reason: reply.reason }, nameRefusal: undefined, retry: false }
    : { view: { kind: "listed", listing: pending.from }, nameRefusal: reply.reason, retry: false },
  unsupported: () => ({ view: { kind: "unsupported" }, nameRefusal: undefined, retry: false }),
  unanswered: (reply, pending) => ({ view: { kind: "unanswered", label: pending.label, reason: reply.reason }, nameRefusal: undefined, retry: true }),
};

/** The view and next step a reply leads to; a reply from a machine the dialog was not opened for is not an answer. */
function folderReplyOutcome(reply: PluginProjectFolderReply, pending: PendingListing, machineId: string): ReplyOutcome {
  if (reply.machineId !== machineId) return { view: { kind: "unanswered", label: pending.label, reason: "Another machine answered" }, nameRefusal: undefined, retry: true };
  return outcomeOf(reply.kind, reply, pending);
}

function outcomeOf<K extends keyof ReplyByKind>(kind: K, reply: ReplyByKind[K], pending: PendingListing): ReplyOutcome {
  return REPLY_OUTCOMES[kind](reply, pending);
}

const RETRY_FIRST_MS = 1_000;
const RETRY_LONGEST_MS = 15_000;

export class ProjectFolderNavigator implements ReactiveController {
  view: FolderView = { kind: "loading", label: "" };
  /** Why the last new folder name was refused, until the next listing. */
  nameRefusal: string | undefined = undefined;
  private latest = 0;
  private abort: AbortController | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly source: () => { readonly machineId: string; readonly listFolder: ListFolder } | undefined,
    private readonly onListed: () => void,
  ) {
    host.addController(this);
  }

  hostDisconnected(): void {
    this.stop();
  }

  /** The folder an Add would add now: the listed one, and only while no newer listing is open. */
  get currentFolder(): ProjectFolderListing | undefined {
    return this.view.kind === "listed" ? this.view.listing : undefined;
  }

  forgetNameRefusal(): void {
    this.nameRefusal = undefined;
    this.host.requestUpdate();
  }

  open(request: ProjectFolderListingRequest, label: string): void {
    this.retryAttempt = 0;
    this.send(request, label, this.currentFolder, true);
  }

  private send(request: ProjectFolderListingRequest, label: string, from: ProjectFolderListing | undefined, showLoading: boolean): void {
    this.stop();
    const source = this.source();
    if (source === undefined) {
      this.show({ view: { kind: "unsupported" }, nameRefusal: undefined, retry: false });
      return;
    }
    const pending: PendingListing = { id: ++this.latest, request, label, from };
    const abort = new AbortController();
    this.abort = abort;
    if (showLoading) this.show({ view: { kind: "loading", label }, nameRefusal: this.nameRefusal, retry: false });
    source.listFolder(request, abort.signal).then(
      (reply) => { this.settle(pending, folderReplyOutcome(reply, pending, source.machineId)); },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        this.settle(pending, { view: { kind: "unanswered", label, reason: error instanceof Error ? error.message : String(error) }, nameRefusal: undefined, retry: true });
      },
    );
  }

  private settle(pending: PendingListing, outcome: ReplyOutcome): void {
    if (pending.id !== this.latest) return;
    this.abort = undefined;
    this.show(outcome);
    if (outcome.view.kind === "listed" && outcome.nameRefusal === undefined) {
      this.retryAttempt = 0;
      this.onListed();
    }
    if (outcome.retry) this.scheduleRetry(pending);
  }

  private scheduleRetry(pending: PendingListing): void {
    const delay = Math.min(RETRY_FIRST_MS * 2 ** this.retryAttempt, RETRY_LONGEST_MS);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.send(pending.request, pending.label, pending.from, false);
    }, delay);
  }

  private show(outcome: ReplyOutcome): void {
    this.view = outcome.view;
    this.nameRefusal = outcome.nameRefusal;
    this.host.requestUpdate();
  }

  private stop(): void {
    this.abort?.abort();
    this.abort = undefined;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }
}
