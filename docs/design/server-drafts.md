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

## Shape (to be designed in full when it is scheduled)

- The draft lives on the daemon of the machine that owns the session (data carries its scope: machine + session). Attachment bytes under `$PI_WEB_DATA_DIR/drafts/<sessionId>/`, the record beside them; an extension input's draft rides the open dialog's record and dies with the dialog.
- Writes are debounced from the composer and the dialog card; reads happen on session open and after a reload. A change is announced on the session's socket so other devices update.
- Sending clears the draft atomically with the prompt's acceptance, so a sent message never comes back as a draft; closing a dialog clears its input draft.
- A session's draft is deleted with the session; an orphaned draft is removed after 30 days, matching the message ledger's retention in `message-states.md`.
- Offline, the device keeps its own copy and writes it when the link returns; the local copy is not authoritative once the server has a newer write.
- Open questions for the full design: conflict rule per field (text vs attachment list), the size cap per draft, and how the outbox's queued sends relate to a draft that was sent from another device.
