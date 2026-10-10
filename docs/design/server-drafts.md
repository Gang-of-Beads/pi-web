# Server-side drafts

Status: decided, scheduled after the current queue (extension UI counterpart, PI WEB updates plugin, message states). Owner answers, 2026-10-05.

## Why

Closing Settings after a plugin change reloads the page (owner, 2026-10-04). Text drafts, form answers and the outbox survive a reload in local storage; two things do not:

- images and files attached in the composer and not yet sent (`composerAttachmentHold.ts`: memory only, megabytes do not fit local storage);
- a half-typed answer in an extension's input dialog (`ExtensionDialogCard` component state).

Review 1005 found the loss; the owner asked whether caching on the server would be better, then chose the scope below.

## Decisions (owner, 2026-10-05)

- **Scope: one draft per session, shared by every device.** A draft started on the phone continues on the desktop. When two devices edit at once the later write wins and the other device sees the update live.
- **Coverage: everything** - the text draft, composer attachments, and an open extension input dialog's typed answer.
- **Order: after** the extension UI counterpart, the PI WEB updates plugin and message states.

## Shape (summary, 2026-10-05)

- The draft lives on the daemon of the machine that owns the session (data carries its scope: machine + session). Attachment bytes under `$PI_WEB_DATA_DIR/drafts/<sessionId>/`, the record beside them; an extension input's draft rides the open dialog's record and dies with the dialog.
- Writes are debounced from the composer and the dialog card; reads happen on session open and after a reload. A change is announced on the session's socket so other devices update.
- Sending clears the draft atomically with the prompt's acceptance, so a sent message never comes back as a draft; closing a dialog clears its input draft.
- A session's draft is deleted with the session; an orphaned draft is removed after 30 days, matching the message ledger's retention in `message-states.md`.
- Offline, the device keeps its own copy and writes it when the link returns; the local copy is not authoritative once the server has a newer write.
- Open questions for the full design: conflict rule per field (text vs attachment list), the size cap per draft, and how the outbox's queued sends relate to a draft that was sent from another device. Answered or proposed in the design below.

## Design (2026-10-09, for the owner to correct before code)

### What it fixes, measured against today

| Unsent thing | Today | After |
|---|---|---|
| Composer text | `localStorage` per machine + session (`promptDraftStorage.ts`); survives a reload on that browser only | on the session's daemon; every device shows it and follows edits live |
| Composer attachments | memory only (`composerAttachmentHold.ts`); a reload, a Settings close or another device loses them | on the session's daemon as files; a reload gets them back |
| An extension input dialog's typed answer | component state (`ExtensionDialogCard.inputValue`); a reload loses it | on the open dialog's daemon record; dies with the dialog |

Out of scope unless the owner adds it: ask-card answers (`askDrafts.ts`, already survive a reload in local storage, one device), prompt history, the outbox (those are sends, not drafts).

### Module boundary

- **Daemon `src/server/daemon/sessions/drafts/`** (new, sessiond only). `SessionDraftStore` owns `$PI_WEB_DATA_DIR/drafts/<sessionId>/draft.json` and its attachment files, the revision counter, the size cap and retention. It exposes `read`, `write`, `putAttachment`, `readAttachment`, `clearOnAccept`, `forget`. Nothing else touches the directory.
- **Daemon routes** (beside the session routes; the web proxies `/sessions/*` already, so the web process changes nothing):
  - `GET /sessions/:id/draft` → `{ revision, text, attachments: [{ id, kind, name, mimeType, size }], updatedAt, deviceId }`, or `{ revision: 0 }` for none;
  - `PUT /sessions/:id/draft` `{ baseRevision, deviceId, text, attachmentIds }` → `{ revision }`; a stale `baseRevision` still writes (later write wins, owner) and answers `{ revision, overwrote: <previous revision> }` so the writer knows it replaced another device's edit;
  - `PUT /sessions/:id/draft/attachments/:attachmentId` `{ kind, name, mimeType, data }` (base64, as a send carries it today) → `{ id, size }`; the id is minted by the page as a UUID and checked to be one, so it is a safe file name;
  - `GET /sessions/:id/draft/attachments/:attachmentId` → the bytes, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`.
- **Wire frame** `draft.changed { sessionId, revision, deviceId, cause: "edited" | "sent" | "cleared" }` on the session socket. It carries no text: a device that did not write it reads the draft once.
- **Page `src/client/src/sessionDraftSync.ts`** (new). Owns one session's sync state and the debounced writes; `PromptEditor` asks it for the draft on open and hands it edits, and keeps owning the editor. `promptDraftStorage.ts` stays as the offline copy.
- **Extension input**: the dialog record in `pendingExtensionDialogStore.ts` gains `draft?: { text, revision }`; `PUT /sessions/:id/extension-dialogs/:dialogId/draft`; the dialog card reads it on render. Closing or answering the dialog drops it with the record.

### The page's sync states (one classifier, `draftSyncStep(state, event)`)

| State | Meaning |
|---|---|
| `unsupported` | the daemon answers 404 `route-missing` (older machine): today's local-only behaviour, said nowhere because nothing changed for the reader |
| `loading` | first read in flight; the local copy shows meanwhile, marked as not yet checked |
| `synced(revision)` | what is shown is the server's revision |
| `dirty(base)` | the reader typed; a write goes out 500 ms after the last keystroke |
| `writing(base)` | a write is in flight; further typing returns to `dirty` |
| `offline-dirty(base)` | the write could not reach the daemon; kept locally, written when the link returns |
| `replaced(base, theirs)` | on return, the server had moved past `base` while this device was offline |

Events: `typed`, `write-answered`, `write-failed`, `draft-changed(foreign)`, `link-up`, `sent-here`, `sent-elsewhere`. A `draft-changed` from this device's own `deviceId` is ignored; a foreign one in `synced` reads and shows the new revision; in `dirty`/`writing` it is ignored, because this device's write lands later and wins (owner: later write wins).

### Sending

- The send carries `draftRevision` (the revision the composer showed). When the daemon accepts the prompt (the acceptance ledger records its `clientMessageId`), it clears the draft in the same step if the draft's revision is still `draftRevision`, and publishes `draft.changed { cause: "sent" }`. A draft another device edited after that revision is kept: it is not what was sent.
- A failed send restores the composer as today (`deliverAndRestoreOnFailure`), and the restore is written back as the draft.
- The attachments of a sent draft are deleted after acceptance; their bytes already travelled with the prompt.

### Limits, retention, safety

- Text up to 1 MB; attachments up to `maxUploadBytes` in total (64 MB by default, the same cap a send has). An attachment over the cap stays in this browser only, and its chip says "Not saved on <machine>: too large", so nobody believes it is shared.
- Deleting a session deletes its draft directory; archiving keeps it. A draft untouched for 30 days is removed (the ledger's retention, `message-states.md`). A draft directory whose session no longer exists is removed at daemon start.
- Writes are atomic (temp file + rename). A draft read that fails says so in the composer ("Could not read the saved draft") and keeps the local copy; it never shows an empty composer as if there were no draft.

### Slices

1. Text: store, routes, frame, `sessionDraftSync`, send clears. Daemon restart.
2. Attachments: files, chips that show "saving" and "saved", the size rule.
3. Extension input dialog drafts.
4. Offline: `offline-dirty`, `replaced`, link-up writes.

Each slice: state-diagram entries in the same commit (rule 6), bob review, 8505 with two browser contexts (desktop + phone 393x850): type on one, see it on the other; reload keeps an image; send on one clears the other; a dialog's half answer survives a reload.

### Slice 1 as built (2026-10-10)

The text draft, shared through the session's daemon. Where this differs from the design above, this is what runs, and why.

- **A send names the writes it covers.** A draft write and a send are two requests and can reach the daemon in either order: a write that left 500 ms after the last keystroke can still be on its way when Enter sends. Each page names itself with a fresh id (`deviceId`, a new one per page load) and numbers its writes (`seq`). A send carries `draft: { deviceId, seq, revision? }`: the number of the page's last write and the last revision the page knew. On acceptance the daemon empties the draft when it is still that revision, or when its latest write is that page's own with a number no higher (the page's write overtook its send); a draft another device wrote later is kept. Either way the daemon remembers the send, and refuses a later-arriving write from that page numbered no higher (`{ revision, superseded: true }`): that write was made before the send, and taking it would bring the sent text back. With no draft at all, the send still leaves an empty one carrying that memory, for the same reason.
- **The daemon always says where a send left the draft.** Every accepted send that carried `draft` publishes `draft.changed { revision, cause: "sent", deviceId }`, emptied or kept, so the sending page learns which, and a page that was showing the sent text reads the empty draft.
- **No `baseRevision` and no `overwrote`.** They existed so a writer could say "you replaced another device's edit"; D1 says nothing, so nothing would read them. A write is `PUT /sessions/:id/draft { cwd, deviceId, seq, text }` answered `{ revision }`; a read is `GET /sessions/:id/draft` answered `{ revision, text?, updatedAt? }` (`revision` 0 alone: no draft). Both routes are federated for a remote machine. The frame carries no `sessionId`: it rides the session's own socket.
- **This page's copy remembers how it relates to the daemon's.** Beside the text (`promptDraftStorage`), `pi-web:prompt-draft-sync:<machine>/<session>` holds `{ revision, state }`, `state` being `synced`, `dirty` (typed, not yet written) or `sent`. After a reload, typing that never reached the daemon wins and is written; a synced copy yields to the daemon's; a sent one keeps the composer empty until the daemon says what the send left, so neither a reload nor a slow send brings the sent text back. Text stored by a build before drafts, with no record beside it, counts as this browser's unsent typing.
- **A failed write keeps the text here and is retried at the next keystroke.** Writing again when the link returns is slice 4.
- **A session still starting** (the browser's pending row) keeps its draft in this browser; the draft goes to the daemon once the session exists there. Attachments stay in this browser until slice 2.
- Retention as designed: deleting a session deletes its draft; a draft untouched for 30 days, or unreadable, is removed at daemon start.

The page's states and transitions are in [the state diagram](state-diagram.md#d10-a-composer-draft-server-drafts-slice-1).

### Slice 3 as built (2026-10-10): an open dialog's typed answer

- **The typed answer of an open `input` or `editor` dialog** is kept on the daemon beside the dialog's own record (`PendingExtensionDialogStore`, in memory like the dialog), and goes when the dialog closes, answered, cancelled or timed out. Before any write it is the dialog's opening text at revision 0 (an editor's `prefill`, an input's empty text). Other kinds keep none: a choice is one tap, and a declared questions screen keeps its half answer in this browser (`askDrafts`, as before).
- **Wire:** `GET /sessions/:id/dialogs/draft?cwd&dialogId` → `{ revision, text }`; `PUT /sessions/:id/dialogs/draft { cwd, dialogId, deviceId, seq, text }` → `{ revision }`; both answer 404 `dialog-not-open` for a dialog that is not open, and never open the session. A write publishes `dialog.draft.changed { dialogId, revision, deviceId }`; it is a frame of its own so a page from slice 1 cannot mistake a dialog's revision for the composer's. Both routes are federated.
- **The page** runs the composer's classifier (`draftSyncStep`) against the dialog's routes, keyed by machine, session and dialog, and keeps nothing in this browser. The card's opening text counts as the daemon's, not as typing, so a card drawn anew takes what another device typed. Answering or cancelling stops a write that is waiting; a write still on its way finds the dialog closed. Once the dialog closes, wherever it was answered, the page writes nothing more for it. A session still starting keeps the answer on the card only.
- **Coming back to a draft** (both kinds of draft): typing this page has not written yet is put back on screen; otherwise what the screen shows now is what the read is compared with.

### Open questions (asked one at a time when the slice needs them)

- **D1 (slice 1). Another device sent while this one was typing.** This device keeps its text (its write recreates the draft). Should it also say "The draft was sent from another device", so the reader does not send the same thing twice? Proposed: yes, a one-line note under the composer until the next keystroke. **Answered (owner, 2026-10-10, ask 28a64627): silent.** No note: the device keeps its text, says nothing, and its next write puts the draft back.
- **D2 (slice 2). Attachments edited on two devices at once.** Text follows "later write wins". For attachments the later write's list wins too, so an image added on the phone while the desktop removed another can vanish. Proposed: attachment adds and removes are applied one by one, so both survive; text stays later-write-wins.
- **D3 (slice 4). Back online after editing offline, and the server moved meanwhile.** Proposed: show the server's draft and keep this device's offline text one tap away ("Your offline edit · Use it"), rather than either silently winning.
