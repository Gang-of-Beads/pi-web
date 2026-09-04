import { declaredAgentFacts } from "./declaredAgentFacts.js";

/**
 * The closed set of host-injected turn kinds (match-tui-prompt task 3.3,
 * spec "Host-originated turns are declared, not disguised").
 *
 * A host-injected turn is content that enters the conversation without coming
 * from the user or the model — continuations, notifications, and reports from
 * work the user started. Each kind is declared here as data: the literal
 * marker the model sees, the producer that injects it, and the pi InputSource
 * it travels under. Anything that cannot be classified is undeclared and must
 * not be injected; the suite enforces it through `assertDeclaredInjectedTurn`.
 *
 * The set is measured from the code, not maintained by folklore. A plugin
 * declares the kinds its own feature injects - the goals plugin declares
 * `goal-continuation`, whose parser anchors the marker at the start of the
 * text - and the host knows only the kinds no plugin fronts:
 *
 * - `background-task-notification` — the pi-background-tasks package's
 *   completion turn, composed with the tag as the first line
 *   (registry.ts: `<background-task-notification>` … `</…>`), delivered as a
 *   followUp under pi's `source: "extension"`.
 *
 * Both producers are extensions injecting through pi's own session API; PI
 WEB does not compose these texts itself. The registry is therefore the
 contract PI WEB holds those producers to: a marker that stops matching (or a
 producer that injects unmarked text addressed to the model) fails here
 first.
 */

export interface InjectedTurnKind {
  readonly id: string;
  /** The literal marker the model sees at the start of the injected text. */
  readonly marker: string;
  /** The extension or feature that composes and injects the turn. */
  readonly producer: string;
  /** The pi InputSource such an injection travels under. */
  readonly inputSource: "extension";
}

/**
 * The kinds the host itself knows, because no pi-web plugin fronts their
 * producer. The goal continuation left this list when the goals plugin took
 * over declaring its own marker: a feature's marker is a fact about that
 * feature, and keeping it here meant editing the host whenever the feature
 * changed its wording.
 */
const HOST_KNOWN_KINDS: readonly InjectedTurnKind[] = [
  {
    id: "background-task-notification",
    marker: "<background-task-notification>",
    producer: "pi-background-tasks (bg_run / bg_delegate completion turns)",
    inputSource: "extension",
  },
];

export function injectedTurnKinds(): readonly InjectedTurnKind[] {
  const declared = declaredAgentFacts().injectedTurns.map((turn) => ({
    id: turn.id,
    marker: turn.marker,
    producer: turn.producer,
    inputSource: "extension" as const,
  }));
  return [...declared, ...HOST_KNOWN_KINDS];
}

/**
 * Classify a message text as a declared host-injected turn kind, or undefined
 * when it is not one — plain user text, model output, and unregistered
 * marker-shaped text all classify as undefined. The marker must be at the
 * very start of the text: both producers anchor it there, and a marker buried
 * mid-message is content, not a declaration.
 */
export function classifyInjectedTurn(text: string): InjectedTurnKind | undefined {
  const trimmed = text.trimStart();
  return injectedTurnKinds().find((kind) => trimmed.startsWith(kind.marker));
}

/**
 * The gate for host-originated turns: an injected turn that is not one of the
 * declared kinds is rejected loudly, naming the offending text. The suite
 * uses this to fail on undeclared injections; future host-side injectors must
 * route through a declared kind.
 */
export function assertDeclaredInjectedTurn(text: string, context: string): InjectedTurnKind {
  const kind = classifyInjectedTurn(text);
  if (kind === undefined) {
    throw new Error(
      `Undeclared host-injected turn (${context}): text does not carry any declared kind's marker at its start. Declared kinds: ${injectedTurnKinds().map((k) => k.id).join(", ")}. Text begins: ${JSON.stringify(text.slice(0, 120))}`,
    );
  }
  return kind;
}
