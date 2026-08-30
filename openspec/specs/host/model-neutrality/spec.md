# host/model-neutrality Specification

## Purpose
Fixes what a browser host may and may not do to the agent it runs, so that the
agent behaves in pi-web exactly as it does in the native terminal host, and so
that a host requirement is met by code or documentation rather than by spending
the model's attention.

## Requirements

### Requirement: The host does not alter what reaches the model

For the same session inputs, the system prompt, the tool set, and the sequence
of messages handed to the model SHALL be identical under this host and under
the native terminal host. Identical means equal, not equivalent in intent.

The host SHALL NOT append, prepend, or rewrite any part of the system prompt;
SHALL NOT add, remove, rename or re-describe any tool; and SHALL NOT rewrite,
summarise or truncate a tool result differently from the native host.

#### Scenario: The same session under both hosts

- **WHEN** a session is started with the same working directory, model and
  configuration under this host and under the native terminal host
- **THEN** the system prompt handed to the model SHALL be byte-for-byte equal,
  and the tool set SHALL contain the same tools with the same names and
  descriptions

#### Scenario: A difference is introduced

- **WHEN** any change causes this host to hand the model something the native
  host would not
- **THEN** the automated suite SHALL fail, naming the differing content

#### Scenario: The host needs the agent to know something

- **WHEN** this host requires a behaviour from the agent that the native host
  does not - for example that restarting the session daemon would kill the
  session it is serving
- **THEN** that requirement SHALL be enforced in code or documented for the
  human, and SHALL NOT be added to what the model receives

### Requirement: Host-originated turns are declared, not disguised

Content this host injects into a conversation that did not come from the user
or the model - continuations, notifications, and reports from work the user
started - SHALL be enumerated, SHALL be distinguishable from a user message,
and SHALL be justified individually. Anything not on that list SHALL NOT be
injected.

#### Scenario: An injected turn arrives

- **WHEN** the host injects a turn the user did not send
- **THEN** it SHALL be one of the declared kinds, and it SHALL be presented so
  that neither the reader nor the model can mistake it for the user speaking

#### Scenario: An undeclared injection is attempted

- **WHEN** code attempts to inject a turn of a kind that is not declared
- **THEN** the automated suite SHALL fail

### Requirement: The removal is complete before it is claimed

The host SHALL carry an enumeration of every point at which it shapes what
reaches the model, and that enumeration SHALL be derived from the code rather
than maintained by hand. A deviation that exists but is not listed SHALL fail
the suite.

#### Scenario: A new deviation is added later

- **WHEN** a future change introduces a new place where the host shapes the
  model's prompt, tools, or context
- **THEN** the suite SHALL fail until that place is either removed or added to
  the declared list with its justification

#### Scenario: A safeguard is withdrawn

- **WHEN** a protection that existed only as prompt text is removed
- **THEN** the behaviour it protected SHALL already be enforced in code, and a
  test SHALL demonstrate that enforcement without relying on the model
