# Drafts: where unsent input is kept

Status: decided (owner, 2026-10-10): every draft stays in the browser that typed it, and the daemon keeps none. This replaces the decision of 2026-10-05 to share one draft per session between devices. Slices 1 and 3 of that design were built on 2026-10-10 and removed the same day, before any release.

## Where each draft lives

| Unsent thing | Kept in | After a reload | On another device |
|---|---|---|---|
| Composer text | local storage per machine + session (`promptDraftStorage.ts`) | kept | not shown |
| Composer attachments | IndexedDB per machine + session (`composerAttachmentStore.ts`, behind `composerAttachmentHold.ts`) | kept | not shown |
| An extension input or editor dialog's typed answer | local storage per machine + session + dialog (`dialogAnswerDrafts.ts`) | kept | not shown |
| A questions screen's half answers | local storage per machine + session + ask (`askDrafts.ts`) | kept | not shown |

- A send empties the composer's text and attachments in this browser; a failed send puts them back.
- A dialog's typed answer goes when this page sees the dialog close: answered, cancelled or timed out, here or elsewhere. One left behind, its dialog having closed while this page showed another session or while no page was open, is removed by the first dialog-answer read of a page once it is 30 days old.
- A session that was still starting takes its text and attachments to its real id.
- Two tabs of one browser on one session share these copies; the later write wins.
- The attachments: a page writes a session's record only after it has read it, so a fresh page never writes over attachments it has not seen yet, and what it reads is shown before anything attached meanwhile. A record it cannot read is never written. A browser without IndexedDB, or one that refuses it, keeps attachments in memory, so a reload loses them, as before.

## How the decision went

- **2026-10-04/05.** Closing Settings after a plugin change reloaded the page, which lost the composer's attachments (held in memory) and an extension dialog's half answer (component state); review 1005 found it. The owner chose one draft per session, shared by every device, the later write winning.
- **2026-10-09.** A full design: a draft store on the session's daemon, a sync classifier in the page, a send that empties the draft it was made from, and four slices.
- **2026-10-10.** Slices 1 (text) and 3 (dialog answers) were built on the daemon and verified on 8505. D1 (another device sent while this one was typing) was answered: silent.
- **D2, attachments edited on two devices at once.** Owner: an attachment belongs with its message, so the lists are not merged: "if it really does not work, several drafts with random ids, or simply keep the draft cached in the front end" (asks 2299ce94, b7e1a02f). The front-end cache was built (`b05e3acc`).
- **D3, back online after editing offline while another device changed the draft.** Owner: keep all drafts in the front-end cache, and the problem is gone (ask 233d8c0d). Asked again with the cost, that a draft started on the phone no longer continues on the desktop, he chose it. The daemon's draft store, its routes and frames, the claim a send carried and the page's sync were removed, and dialog answers moved to local storage. Slice 4 (offline) is not needed.
