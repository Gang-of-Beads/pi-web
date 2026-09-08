/**
 * How often every realtime subscriber is sent a keepalive frame.
 *
 * It lives in its own module because it is a two-process contract: the daemon
 * promises this cadence, and the browser's liveness budget is a multiple of it
 * (see src/client/src/socketRecoveryBudgets.test.ts). A client-side test that
 * imported the hub itself would drag the daemon's dependencies into a browser
 * test run.
 */
export const KEEPALIVE_INTERVAL_MS = 20_000;
