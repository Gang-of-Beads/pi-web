import { spawn, type ChildProcess } from "node:child_process";
import { PI_WEB_RUN_SUPERVISOR, PI_WEB_SUPERVISOR_ENV } from "./environment.js";

/**
 * `pi-web run`: the session daemon and the web/API in the foreground of one process, for a host
 * without a service manager (a container's entrypoint, mostly).
 *
 * The two processes stay separate, as everywhere else, so a web restart does not stop sessions.
 * The supervisor's decisions live in one pure transition function over named phases and events;
 * `runForeground` only executes the actions it returns. The web is restarted in place with backoff
 * when it dies; the daemon dying ends the run, because its sessions are gone and the platform
 * restarts the container cleanly.
 */

export type ForegroundChild = "daemon" | "web";

type ForegroundRunPhase = "awaiting-daemon" | "running" | "web-restart-pending" | "stopping";

type ChildLife = "not-started" | "running" | "exited";

export interface ForegroundRunState {
  readonly phase: ForegroundRunPhase;
  readonly daemon: ChildLife;
  readonly web: ChildLife;
  /** When the web died unexpectedly, within the failure window: the give-up rule counts these. */
  readonly webFailureTimes: readonly number[];
  /** Unexpected web exits since the web last stayed up for `WEB_STABLE_UPTIME_MS`: the backoff grows with these. */
  readonly consecutiveWebFailures: number;
  /** When the current web process was started. */
  readonly webStartedAt: number | undefined;
  readonly exitCode: 0 | 1;
  /** Whether the stop was asked for by a signal, which the children then end by. */
  readonly stopRequested: boolean;
}

export interface ChildExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export type ForegroundRunEvent =
  | { readonly kind: "daemon-ready"; readonly at: number }
  | { readonly kind: "daemon-ready-timeout" }
  | { readonly kind: "child-exited"; readonly child: ForegroundChild; readonly exit: ChildExit; readonly at: number }
  | { readonly kind: "web-restart-due"; readonly at: number }
  | { readonly kind: "stop-signal" };

export type ForegroundRunAction =
  | { readonly kind: "spawn-web" }
  | { readonly kind: "schedule-web-restart"; readonly delayMs: number }
  | { readonly kind: "signal"; readonly children: readonly ForegroundChild[]; readonly signal: "SIGTERM" | "SIGKILL" }
  | { readonly kind: "log"; readonly message: string }
  | { readonly kind: "exit"; readonly code: 0 | 1 };

export interface ForegroundRunStep {
  readonly state: ForegroundRunState;
  readonly actions: readonly ForegroundRunAction[];
}

/** The web is given up on after this many unexpected exits within the window, and the run ends. */
export const WEB_FAILURE_LIMIT = 5;
export const WEB_FAILURE_WINDOW_MS = 60_000;
/**
 * The restart delay doubles with every exit in a row, from 1 s up to 30 s, and starts over once a web
 * process stayed up this long. A web that crashes slowly, too seldom to reach the give-up rule, is
 * therefore restarted for as long as it keeps crashing, at most 30 s apart.
 */
export const WEB_STABLE_UPTIME_MS = 60_000;
const WEB_RESTART_FIRST_DELAY_MS = 1000;
const WEB_RESTART_MAX_DELAY_MS = 30_000;
/** Covers the session daemon's 15 s ownership grace plus server plugin startup. */
export const DAEMON_READY_TIMEOUT_MS = 120_000;

export const initialForegroundRunState: ForegroundRunState = {
  phase: "awaiting-daemon",
  daemon: "running",
  web: "not-started",
  webFailureTimes: [],
  consecutiveWebFailures: 0,
  webStartedAt: undefined,
  exitCode: 0,
  stopRequested: false,
};

const foregroundChildren: readonly ForegroundChild[] = ["daemon", "web"];

const childLabels: Readonly<Record<ForegroundChild, string>> = { daemon: "the session daemon", web: "the web/API" };

function describeExit(exit: ChildExit): string {
  return exit.signal === null ? `exit status ${String(exit.code)}` : `signal ${exit.signal}`;
}

function runningChildren(state: ForegroundRunState): ForegroundChild[] {
  return foregroundChildren.filter((child) => state[child] === "running");
}

/** A child ends cleanly in a requested stop when it exits 0 or by the stop signal it was sent or shared. */
function stoppedCleanly(state: ForegroundRunState, exit: ChildExit): boolean {
  if (exit.code === 0) return true;
  return state.stopRequested && (exit.signal === "SIGTERM" || exit.signal === "SIGINT");
}

function webRestartDelayMs(consecutiveFailures: number): number {
  return Math.min(WEB_RESTART_MAX_DELAY_MS, WEB_RESTART_FIRST_DELAY_MS * 2 ** (consecutiveFailures - 1));
}

function stayedUp(state: ForegroundRunState, at: number): boolean {
  return state.webStartedAt !== undefined && at - state.webStartedAt >= WEB_STABLE_UPTIME_MS;
}

/** Enter `stopping`: terminate whatever runs, or exit at once when nothing does. */
function beginStop(state: ForegroundRunState, exitCode: 0 | 1, logs: readonly ForegroundRunAction[]): ForegroundRunStep {
  const stopping: ForegroundRunState = { ...state, phase: "stopping", exitCode };
  const children = runningChildren(stopping);
  return {
    state: stopping,
    actions: [...logs, children.length === 0 ? { kind: "exit", code: exitCode } : { kind: "signal", children, signal: "SIGTERM" }],
  };
}

function childExitedWhileStopping(state: ForegroundRunState, child: ForegroundChild, exit: ChildExit): ForegroundRunStep {
  const exitCode = state.exitCode === 0 && stoppedCleanly(state, exit) ? 0 : 1;
  const next: ForegroundRunState = { ...state, [child]: "exited", exitCode };
  return { state: next, actions: runningChildren(next).length === 0 ? [{ kind: "exit", code: exitCode }] : [] };
}

function daemonExited(state: ForegroundRunState, exit: ChildExit): ForegroundRunStep {
  if (state.phase === "stopping") return childExitedWhileStopping(state, "daemon", exit);
  const message = state.phase === "awaiting-daemon"
    ? `${childLabels.daemon} exited before it was ready (${describeExit(exit)}); see its output above.`
    : `${childLabels.daemon} exited (${describeExit(exit)}); its sessions are gone, so the web/API stops too.`;
  return beginStop({ ...state, daemon: "exited" }, 1, [{ kind: "log", message }]);
}

function webExited(state: ForegroundRunState, exit: ChildExit, at: number): ForegroundRunStep {
  if (state.phase === "stopping") return childExitedWhileStopping(state, "web", exit);
  const failures = [...state.webFailureTimes.filter((time) => at - time < WEB_FAILURE_WINDOW_MS), at];
  const consecutiveWebFailures = stayedUp(state, at) ? 1 : state.consecutiveWebFailures + 1;
  const exited: ForegroundRunState = { ...state, web: "exited", webFailureTimes: failures, consecutiveWebFailures, webStartedAt: undefined };
  if (failures.length >= WEB_FAILURE_LIMIT) {
    return beginStop(exited, 1, [{
      kind: "log",
      message: `${childLabels.web} exited (${describeExit(exit)}), ${String(failures.length)} times within ${String(WEB_FAILURE_WINDOW_MS / 1000)} s; giving up and stopping the session daemon.`,
    }]);
  }
  const delayMs = webRestartDelayMs(consecutiveWebFailures);
  return {
    state: { ...exited, phase: "web-restart-pending" },
    actions: [
      { kind: "log", message: `${childLabels.web} exited (${describeExit(exit)}); restarting it in ${String(delayMs / 1000)} s. Sessions keep running.` },
      { kind: "schedule-web-restart", delayMs },
    ],
  };
}

/**
 * The exit status a requested stop starts from, by the phase it arrives in. A stop during the web's
 * backoff ends a run whose web died uncleanly and was never restarted, so it cannot report success.
 */
const requestedStopExitCodes: Readonly<Record<Exclude<ForegroundRunPhase, "stopping">, 0 | 1>> = {
  "awaiting-daemon": 0,
  running: 0,
  "web-restart-pending": 1,
};

const foregroundRunTransitions: { readonly [Kind in ForegroundRunEvent["kind"]]: (state: ForegroundRunState, event: Extract<ForegroundRunEvent, { kind: Kind }>) => ForegroundRunStep } = {
  "daemon-ready": (state, event) => state.phase === "awaiting-daemon"
    ? { state: { ...state, phase: "running", web: "running", webStartedAt: event.at }, actions: [{ kind: "spawn-web" }] }
    : { state, actions: [] },
  "daemon-ready-timeout": (state) => state.phase === "awaiting-daemon"
    ? beginStop(state, 1, [{ kind: "log", message: `${childLabels.daemon} did not become ready within ${String(DAEMON_READY_TIMEOUT_MS / 1000)} s.` }])
    : { state, actions: [] },
  "child-exited": (state, event) => event.child === "daemon" ? daemonExited(state, event.exit) : webExited(state, event.exit, event.at),
  "web-restart-due": (state, event) => state.phase === "web-restart-pending"
    ? { state: { ...state, phase: "running", web: "running", webStartedAt: event.at }, actions: [{ kind: "spawn-web" }] }
    : { state, actions: [] },
  "stop-signal": (state) => {
    if (state.phase !== "stopping") return beginStop({ ...state, stopRequested: true }, requestedStopExitCodes[state.phase], []);
    const children = runningChildren(state);
    return {
      state: { ...state, stopRequested: true, exitCode: 1 },
      actions: children.length === 0 ? [] : [
        { kind: "log", message: `${state.stopRequested ? "second stop signal" : "stop signal while already stopping"}; killing ${children.map((child) => childLabels[child]).join(" and ")}.` },
        { kind: "signal", children, signal: "SIGKILL" },
      ],
    };
  },
};

/** The supervisor's whole decision table: the next state and what to do, for one event. */
export function foregroundRunTransition(state: ForegroundRunState, event: ForegroundRunEvent): ForegroundRunStep {
  switch (event.kind) {
    case "daemon-ready":
      return foregroundRunTransitions["daemon-ready"](state, event);
    case "daemon-ready-timeout":
      return foregroundRunTransitions["daemon-ready-timeout"](state, event);
    case "child-exited":
      return foregroundRunTransitions["child-exited"](state, event);
    case "web-restart-due":
      return foregroundRunTransitions["web-restart-due"](state, event);
    case "stop-signal":
      return foregroundRunTransitions["stop-signal"](state, event);
  }
}

export interface ForegroundRunEntrypoints {
  readonly daemon: string;
  readonly web: string;
}

export interface ForegroundRunDependencies {
  readonly entrypoints: ForegroundRunEntrypoints;
  readonly environment: NodeJS.ProcessEnv;
  readonly isDaemonReady: () => Promise<boolean>;
  readonly log: (message: string) => void;
  readonly now?: () => number;
  readonly readinessPollMs?: number;
}

/**
 * Run both processes until they stop, and resolve with the exit code. Children inherit stdio, so
 * their log lines reach the container log, and run on this Node from the package's own files, so
 * nothing is looked up on PATH.
 */
export function runForeground(dependencies: ForegroundRunDependencies): Promise<0 | 1> {
  const now = dependencies.now ?? Date.now;
  const children = new Map<ForegroundChild, ChildProcess>();
  let state = initialForegroundRunState;
  let webRestartTimer: NodeJS.Timeout | undefined;
  let finish: (code: 0 | 1) => void = () => undefined;
  const finished = new Promise<0 | 1>((resolve) => { finish = resolve; });

  const onSignal = (): void => { dispatch({ kind: "stop-signal" }); };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("SIGHUP", ignoreSignal);

  const executors: { readonly [Kind in ForegroundRunAction["kind"]]: (action: Extract<ForegroundRunAction, { kind: Kind }>) => void } = {
    "spawn-web": () => { start("web"); },
    "schedule-web-restart": (action) => {
      webRestartTimer = setTimeout(() => { dispatch({ kind: "web-restart-due", at: now() }); }, action.delayMs);
    },
    signal: (action) => {
      for (const child of action.children) children.get(child)?.kill(action.signal);
    },
    log: (action) => { dependencies.log(action.message); },
    exit: (action) => {
      clearTimeout(webRestartTimer);
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
      process.off("SIGHUP", ignoreSignal);
      finish(action.code);
    },
  };

  function execute(action: ForegroundRunAction): void {
    switch (action.kind) {
      case "spawn-web":
        executors["spawn-web"](action);
        return;
      case "schedule-web-restart":
        executors["schedule-web-restart"](action);
        return;
      case "signal":
        executors.signal(action);
        return;
      case "log":
        executors.log(action);
        return;
      case "exit":
        executors.exit(action);
        return;
    }
  }

  function dispatch(event: ForegroundRunEvent): void {
    const step = foregroundRunTransition(state, event);
    state = step.state;
    for (const action of step.actions) execute(action);
  }

  function start(child: ForegroundChild): void {
    const childProcess = spawn(process.execPath, [dependencies.entrypoints[child]], {
      stdio: "inherit",
      env: { ...dependencies.environment, [PI_WEB_SUPERVISOR_ENV]: PI_WEB_RUN_SUPERVISOR },
    });
    children.set(child, childProcess);
    let reported = false;
    const report = (exit: ChildExit): void => {
      if (reported) return;
      reported = true;
      dispatch({ kind: "child-exited", child, exit, at: now() });
    };
    childProcess.once("error", (error) => {
      dependencies.log(`could not start ${childLabels[child]}: ${error.message}`);
      report({ code: null, signal: null });
    });
    childProcess.once("exit", (code, signal) => { report({ code, signal }); });
  }

  async function awaitDaemonReady(): Promise<void> {
    const deadline = now() + DAEMON_READY_TIMEOUT_MS;
    while (state.phase === "awaiting-daemon") {
      if (await dependencies.isDaemonReady()) {
        dispatch({ kind: "daemon-ready", at: now() });
        return;
      }
      if (now() >= deadline) {
        dispatch({ kind: "daemon-ready-timeout" });
        return;
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, dependencies.readinessPollMs ?? 500); });
    }
  }

  start("daemon");
  void awaitDaemonReady();
  return finished;
}

/**
 * Ignoring SIGHUP keeps the supervisor from dying alone and orphaning its children; it does not
 * protect the run from a closed terminal, whose hangup also reaches the children in the same process
 * group and ends them (run it under tmux or `setsid`).
 */
function ignoreSignal(): void {
  return undefined;
}

export type ForegroundRunRefusal = "unknown-argument" | "windows";

/** Why `pi-web run` refuses before starting anything (exit status 2), or undefined. */
export function foregroundRunRefusal(args: readonly string[], platform: NodeJS.Platform): ForegroundRunRefusal | undefined {
  if (args.length > 0) return "unknown-argument";
  return platform === "win32" ? "windows" : undefined;
}

export const foregroundRunRefusalMessages: Readonly<Record<ForegroundRunRefusal, string>> = {
  "unknown-argument": "`pi-web run` takes no arguments; set PI_WEB_HOST, PI_WEB_PORT, PI_WEB_DATA_DIR, PI_WEB_SESSIOND_SOCKET or PI_WEB_CONFIG instead.",
  windows: "`pi-web run` is not available on Windows yet: a Windows process cannot be asked to stop and drain its sessions. Use `pi-web install`.",
};

/** One stderr line when this process is PID 1: Node does not reap the orphaned processes agents leave behind. */
export function pid1Warning(pid: number): string | undefined {
  return pid === 1
    ? "running as PID 1, which does not reap orphaned processes; run it under an init such as tini (`docker run --init`, or ENTRYPOINT [\"tini\", \"--\"])."
    : undefined;
}
