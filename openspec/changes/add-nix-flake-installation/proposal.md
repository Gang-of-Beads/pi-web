## Why

PI WEB currently requires imperative Node/npm installation and manually managed user services. That makes a reproducible installation, upgrades, and the required separate web and session-daemon lifecycles difficult to express on NixOS and nix-darwin.

The installation invariant is that packaging must not collapse the two runtime owners: the session daemon remains the long-lived owner of agent/session state, while web/UI restarts must not stop active sessions. Today the npm scripts, direct `tsx` development commands, and user-managed service files are the only producers of package/runtime setup; no Nix package, development shell, or declarative per-user service configuration exists.

## What Changes

- Add a top-level Nix flake that builds PI WEB as a reproducible package and provides a development shell on supported Linux and Darwin systems.
- Add a Home Manager module usable from both NixOS and nix-darwin that declares PI WEB's two independently managed user services.
- Expose declarative options for package selection, enablement, state directory, configuration-file location, HTTP listen settings/environment, and optional declaratively managed JSON settings.
- Document NixOS and nix-darwin flake inputs, package installation, Home Manager integration, service lifecycle, state ownership, and the distinction between declarative configuration and the writable web configuration API.
- Add Nix evaluation/build checks and module-level tests or evaluation fixtures for the supported service definitions.

### Non-goals

- Do not introduce a system-wide/root-owned PI WEB daemon or change the existing session daemon ownership model.
- Do not replace npm installation, existing systemd user-service installation, Docker deployment, or non-Nix development workflows.
- Do not package arbitrary third-party Pi plugins or user state into the immutable Nix store.
- Do not make UI configuration edits silently mutate a Nix-managed configuration file.

## Capabilities

### New Capabilities

- `nix-installation`: Reproducible flake packaging and declarative per-user installation/configuration of PI WEB on NixOS and nix-darwin.

### Modified Capabilities

- None.

## Impact

- Adds `flake.nix`, `flake.lock`, Nix packaging/module sources, and Nix-focused evaluation checks.
- Adds a Home Manager input dependency and Nixpkgs-pinned Node/native build toolchain inputs.
- Updates installation documentation under `docs/` and the concise README installation discovery path.
- Adds a patch Changeset because Nix installation and configuration become a supported package-consumer workflow.
