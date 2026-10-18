import type { MachineAddedFact, MachineReachabilityChangedFact, MachineRemovedFact, PluginMachineFacts, PluginSessionFacts, SessionCreatedFact, SessionRenamedFact, SessionReplacedFact, SessionRunEndedFact, SessionRunStartedFact } from "../../../shared/pluginApiTypes";

/** Every namespaced browser fact by its kind, with what it carries. */
export interface PluginFactPayloads {
  "session.created": SessionCreatedFact;
  "session.renamed": SessionRenamedFact;
  "session.replaced": SessionReplacedFact;
  "session.run-started": SessionRunStartedFact;
  "session.run-ended": SessionRunEndedFact;
  "machine.added": MachineAddedFact;
  "machine.removed": MachineRemovedFact;
  "machine.reachability-changed": MachineReachabilityChangedFact;
}

export type PluginFactKind = keyof PluginFactPayloads;

const PLUGIN_FACT_KINDS: readonly PluginFactKind[] = ["session.created", "session.renamed", "session.replaced", "session.run-started", "session.run-ended", "machine.added", "machine.removed", "machine.reachability-changed"];

interface FactListener<K extends PluginFactKind> {
  readonly pluginId: string;
  readonly listener: (fact: PluginFactPayloads[K]) => void;
}

type FactListeners = { [K in PluginFactKind]: FactListener<K>[] };

/** Told when a kind gains its first listener (true) or loses its last (false), for a fact whose producer runs only while heard. */
export type FactListening = Partial<Record<PluginFactKind, (listening: boolean) => void>>;

/**
 * The browser facts plugins hear (design 4.B): read-only announcements with `emit` dispatch. A fact
 * is delivered after the producer has moved on (a microtask later), so a listener never runs inside
 * the host's own state change; each listener is isolated, so one that throws is logged and the
 * others still hear it; nothing is kept for a late subscriber. Subscriptions belong to a plugin and
 * are released with it. A producer that runs only while its fact is heard is told (`FactListening`)
 * when the kind gains its first listener and loses its last.
 */
export class PluginFactBus {
  private readonly listeners: FactListeners = {
    "session.created": [],
    "session.renamed": [],
    "session.replaced": [],
    "session.run-started": [],
    "session.run-ended": [],
    "machine.added": [],
    "machine.removed": [],
    "machine.reachability-changed": [],
  };

  constructor(private readonly listening: FactListening = {}) {}

  emit<K extends PluginFactKind>(kind: K, fact: PluginFactPayloads[K]): void {
    const entries = [...this.listeners[kind]];
    if (entries.length === 0) return;
    Object.freeze(fact);
    queueMicrotask(() => {
      for (const entry of entries) {
        if (!this.listeners[kind].includes(entry)) continue;
        try {
          entry.listener(fact);
        } catch (error) {
          console.error(`Plugin ${entry.pluginId} failed handling ${kind}`, error);
        }
      }
    });
  }

  subscribe<K extends PluginFactKind>(pluginId: string, kind: K, listener: (fact: PluginFactPayloads[K]) => void): () => void {
    const entry: FactListener<K> = { pluginId, listener };
    const entries = this.listeners[kind];
    entries.push(entry);
    if (entries.length === 1) this.listening[kind]?.(true);
    return () => { this.remove(kind, (candidate) => candidate === entry); };
  }

  release(pluginId: string): void {
    for (const kind of PLUGIN_FACT_KINDS) this.remove(kind, (candidate) => candidate.pluginId === pluginId);
  }

  private remove<K extends PluginFactKind>(kind: K, matches: (entry: FactListener<K>) => boolean): void {
    const entries = this.listeners[kind];
    const before = entries.length;
    for (const entry of entries.filter(matches)) removeEntry(entries, entry);
    if (before > 0 && entries.length === 0) this.listening[kind]?.(false);
  }

  /** The `sessions` namespace one plugin is handed. */
  sessionFacts(pluginId: string): PluginSessionFacts {
    const facts: PluginSessionFacts = {
      onDidCreate: (listener) => this.subscribe(pluginId, "session.created", listener),
      onDidRename: (listener) => this.subscribe(pluginId, "session.renamed", listener),
      onDidReplace: (listener) => this.subscribe(pluginId, "session.replaced", listener),
      onDidStartRun: (listener) => this.subscribe(pluginId, "session.run-started", listener),
      onDidEndRun: (listener) => this.subscribe(pluginId, "session.run-ended", listener),
    };
    return Object.freeze(facts);
  }

  /** The `machines` namespace one plugin is handed. */
  machineFacts(pluginId: string): PluginMachineFacts {
    const facts: PluginMachineFacts = {
      onDidAdd: (listener) => this.subscribe(pluginId, "machine.added", listener),
      onDidRemove: (listener) => this.subscribe(pluginId, "machine.removed", listener),
      onDidChangeReachability: (listener) => this.subscribe(pluginId, "machine.reachability-changed", listener),
    };
    return Object.freeze(facts);
  }
}

function removeEntry<T>(entries: T[], entry: T): void {
  const index = entries.indexOf(entry);
  if (index >= 0) entries.splice(index, 1);
}
