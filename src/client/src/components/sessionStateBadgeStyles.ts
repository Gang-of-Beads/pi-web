import { css } from "lit";

/**
 * Shared four-state session badge (working/idle/asking/error).
 *
 * One style block for every surface (list rows, chat dock, quick switcher,
 * context bar) so the same state never reads differently in two places:
 *
 *   working/running -> three bouncing blue dots (AI generating or tooling right
 *                      now; also the "sending" mark — see sessionRowIndicator)
 *   background -> hollow purple ring (turn over, children still running)
 *   idle    -> static gray dot (done; nothing in flight)
 *   asking  -> amber dot (ask_user waiting on the user)
 *   error   -> red dot (activity errored, e.g. a model error)
 *   unread  -> purple dot (a completed turn the reader has not opened)
 *
 * Which single mark a session row shows is decided by the arbiter in
 * sessionRowIndicator.ts — the priority and color table there is the one place
 * that ranking is written down. This file only implements the colors.
 *
 * Works both as an inline dot (slot in flow) and inside absolute-positioned
 * row flags; the dots are sized for a 9px track so rows do not jump when the
 * single dot becomes three.
 */
export const sessionStateBadgeStyles = css`
  .session-state { box-sizing: border-box; display: inline-grid; place-items: center; width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; vertical-align: 1px; }
  .session-state.idle { background: var(--pi-dim); animation: none; }
  /* Hollow, so "still running" cannot be mistaken for "working": the ring is
     the same purple the chat dock uses for background work. */
  .session-state.background { background: transparent; border: 2px solid var(--pi-purple); animation: none; }
  .session-state.idle.unread { background: var(--pi-success); }
  .session-state.asking { background: var(--pi-warning); animation: none; }
  .session-state.error { background: var(--pi-danger); animation: none; }
  /* Unread is purple: the filled dot says "a turn ended and you have not seen
     it", distinct from the blue of work in progress. The same hue as the
     background ring, which is the other "turn over" mark. */
  .session-state.unread { background: var(--pi-purple); box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-purple) 22%, transparent); }
  .state-dots { display: inline-flex; align-items: center; gap: 2px; }
  .state-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--pi-accent, var(--pi-success)); animation: session-state-bounce 1.1s ease-in-out infinite; }
  @keyframes session-state-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-2px); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .state-dot { animation: none; }
  }
`;