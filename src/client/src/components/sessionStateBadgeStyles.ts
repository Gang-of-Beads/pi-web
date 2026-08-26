import { css } from "lit";

/**
 * Shared four-state session badge (working/idle/asking/error).
 *
 * One style block for every surface (list rows, chat dock, quick switcher,
 * context bar) so the same state never reads differently in two places:
 *
 *   working -> three bouncing dots (AI generating or tooling right now)
 *   idle    -> static gray dot when read, green when unread (done; the color
 *              also says whether you have seen the finished turn)
 *   asking  -> amber dot (ask_user waiting on the user)
 *   error   -> red dot (activity errored, e.g. a model error)
 *
 * Works both as an inline dot (slot in flow) and inside absolute-positioned
 * row flags; the dots are sized for a 9px track so rows do not jump when the
 * single dot becomes three.
 */
export const sessionStateBadgeStyles = css`
  .session-state { box-sizing: border-box; display: inline-grid; place-items: center; width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; vertical-align: 1px; }
  .session-state.idle { background: var(--pi-dim); animation: none; }
  .session-state.idle.unread { background: var(--pi-success); }
  .session-state.asking { background: var(--pi-warning); animation: none; }
  /* Hollow rather than filled: the run did not fail, it stopped short. A
     filled dot would read as another finished state. */
  .session-state.stalled { background: transparent; border: 1.5px solid var(--pi-warning); animation: none; }
  .session-state.error { background: var(--pi-danger); animation: none; }
  .session-state.unread { background: var(--pi-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-accent) 22%, transparent); }
  .state-dots { display: inline-flex; align-items: center; gap: 2px; }
  .state-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--pi-accent, var(--pi-success)); animation: session-state-bounce 1.1s ease-in-out infinite; }
  @keyframes session-state-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-2px); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .state-dot { animation: none; }
  }
`;