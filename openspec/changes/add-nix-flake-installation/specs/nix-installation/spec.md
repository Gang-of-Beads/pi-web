## Purpose

Provide reproducible PI WEB installation and per-user service configuration through Nix flakes on supported NixOS and nix-darwin hosts, without changing session-runtime ownership.

## ADDED Requirements

### Requirement: The flake exposes a reproducible PI WEB package
The project SHALL expose a PI WEB package from its flake for `x86_64-linux`, `aarch64-linux`, and `aarch64-darwin`. The package SHALL provide the existing PI WEB command-line entry points and SHALL build the web client, server entry points, bundled plugins, and required native Node dependencies without relying on a pre-existing global npm installation or mutable `node_modules` directory.

#### Scenario: Install the package on a supported system
- **WHEN** a user evaluates the flake package for one of the supported systems
- **THEN** Nix produces a package whose executable commands can start PI WEB's web/API and session-daemon entry points

#### Scenario: Evaluate an unsupported system
- **WHEN** a user evaluates the flake for a system outside the declared support set
- **THEN** the flake SHALL not claim that a PI WEB package is available for that system

### Requirement: The flake supplies a reproducible development environment
The flake SHALL expose a development shell for every system for which it exposes the PI WEB package. The shell SHALL provide the Node/npm and native-build prerequisites needed to install dependencies, run checks, and build PI WEB from the checkout.

#### Scenario: Enter the development shell
- **WHEN** a contributor runs `nix develop` on a supported system
- **THEN** the shell provides the declared project toolchain without requiring global Node or npm installation

### Requirement: Home Manager declares separate PI WEB runtime owners
The flake SHALL expose a Home Manager module that can be imported by both NixOS and nix-darwin configurations. When enabled, it SHALL manage independently restartable user services for the web/API process and the session daemon. Restarting the web/API service SHALL NOT intentionally stop or restart the session daemon; session state and active Pi sessions remain owned by the daemon.

#### Scenario: Enable PI WEB for a NixOS user
- **WHEN** a Home Manager configuration on NixOS enables PI WEB
- **THEN** the resulting user configuration declares separate web/API and session-daemon services using the configured package and environment

#### Scenario: Enable PI WEB for a nix-darwin user
- **WHEN** a Home Manager configuration on nix-darwin enables PI WEB
- **THEN** the resulting user configuration declares separately supervised web/API and session-daemon agents using the configured package and environment

#### Scenario: Restart only the web/API service
- **WHEN** an operator restarts the enabled web/API service
- **THEN** the module leaves the session-daemon service running and does not change the daemon's configured state directory

### Requirement: Declarative configuration preserves state and configuration ownership
The Home Manager module SHALL allow the user to configure the PI WEB package, data directory, configuration-file location, and service environment. Persistent PI WEB state SHALL remain outside the immutable Nix store. When the module manages PI WEB JSON settings declaratively, it SHALL make that managed-file ownership explicit and SHALL NOT imply that edits through PI WEB's writable configuration API persist across Home Manager activation.

#### Scenario: Use default persistent state
- **WHEN** PI WEB is enabled without a custom data directory
- **THEN** its state is stored in the enabling user's persistent home-directory state location rather than in the Nix store

#### Scenario: Declare JSON settings
- **WHEN** a user supplies declarative PI WEB settings through the module
- **THEN** Home Manager materializes the selected configuration file from those settings and subsequent Home Manager activation restores the declared content

#### Scenario: Retain a user-managed configuration file
- **WHEN** a user enables PI WEB without declarative JSON settings
- **THEN** the module does not overwrite the configured user-managed configuration file

### Requirement: Nix installation documentation is actionable and scoped
The project documentation SHALL describe the flake package, development shell, and Home Manager setup for both NixOS and nix-darwin. It SHALL state the supported systems, service names/lifecycle, persistent-state location, configuration ownership behavior, and the requirement to restart the session daemon after daemon-only upgrades.

#### Scenario: Follow the NixOS setup guide
- **WHEN** a NixOS user follows the documented flake and Home Manager example
- **THEN** the example identifies the required inputs, module import, enablement option, and how to operate the two services

#### Scenario: Follow the nix-darwin setup guide
- **WHEN** a nix-darwin user follows the documented flake and Home Manager example
- **THEN** the example identifies the required inputs, module import, enablement option, and how to operate the two launch agents
