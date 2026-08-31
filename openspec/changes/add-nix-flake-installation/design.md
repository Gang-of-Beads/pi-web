## Context

See [proposal.md](proposal.md) for motivation and [the Nix installation capability](specs/nix-installation/spec.md) for the externally observable contract. PI WEB builds a TypeScript server/client application, plugin artifacts, and the `node-pty` native dependency. At runtime it has two process owners: `pi-web-sessiond` owns durable session state and must outlive independently reloadable/restartable web/UI processes.

Nix's package output is immutable, while PI WEB's data directory, credentials, project registry, session archive, sockets, and optionally its configuration file are user-owned mutable state. The existing host install model uses user services, which aligns with Home Manager rather than a root-owned NixOS service.

## Goals / Non-Goals

**Goals:**

- Make the Node/npm/native build reproducible on Linux and Darwin through one flake.
- Offer a single per-user configuration API that works when Home Manager is evaluated under NixOS or nix-darwin.
- Preserve the existing split process lifecycle and ensure state never enters the Nix store.
- Make declarative versus writable configuration ownership unambiguous.

**Non-Goals:**

- Define a system-wide multi-user PI WEB deployment model.
- Use Vite or another bundler to package server code; the existing TypeScript output and CLI contract remain the package payload.
- Guarantee that every third-party Pi plugin builds in the Nix derivation.

## Decisions

### 1. Provide a flake package, development shell, and Home Manager module

The flake will export `packages.<system>.pi-web` (and `default`), `devShells.<system>.default`, and `homeManagerModules.default`. The system matrix is `x86_64-linux`, `aarch64-linux`, `x86_64-darwin`, and `aarch64-darwin`.

A Home Manager module is the primary configuration surface because PI WEB has per-user agent credentials, config, plugin locations, state, and user services. Home Manager is usable from both NixOS and nix-darwin, avoiding two independently designed option schemas. A future NixOS module can wrap or compose this user-level module once there is a defined multi-user/server ownership model.

**Alternative considered:** a NixOS module only. It would require choosing a system user, UID/group directory ownership, and policy for access to each user's Pi agent state. Those choices are not required for workstation installation and would change the product's ownership model.

### 2. Use Nixpkgs' Node packaging path and pin all build inputs in flake.lock

The package derivation will use Nixpkgs' npm packaging support, the committed npm lockfile, and an explicit npm dependency hash. It will run the existing production build and wrap/export the established commands. Native build prerequisites needed by `node-pty` will be declared for supported platforms instead of relying on host compilers.

The flake lockfile is the source of reproducibility for Nixpkgs and Home Manager. A `checks` output will at least build the package for the local evaluation system; CI can subsequently evaluate/build the declared Linux systems.

**Alternative considered:** calling `npm install -g` from an activation script. It leaves the installed dependency graph mutable and host-toolchain dependent, so it does not meet the reproducibility goal.

### 3. Keep mutable PI WEB state in the configured user directory

The module will provide `dataDir` and `configPath` options and pass them as `PI_WEB_DATA_DIR` and `PI_WEB_CONFIG` to both services. Defaults will resolve under the enabling user's home directory. It will create needed state-parent directories with user ownership through Home Manager activation as required, but will never place runtime writes under the Nix store.

### 4. Model two services per platform and preserve daemon-first ownership

On Linux, the module will generate Home Manager `systemd.user.services` for `pi-web-sessiond` and `pi-web`. On Darwin, it will generate separate Home Manager launchd agents with analogous program arguments and environment.

The session daemon starts before the web process and has independent supervision. The web service depends on/requires the daemon only according to existing connection/retry behavior, not by becoming its owner. The module documentation will make clear that a web-only restart does not update daemon code, and a daemon restart is necessary after changes that only it loads.

**Alternative considered:** a single service which starts both commands. This defeats independent restartability and recreates the browser/API restart risk the process split was created to avoid.

### 5. Offer declarative JSON settings as an opt-in configuration owner

`settings` will be optional. When absent, the module only supplies the config path and leaves the file writable and user-managed, retaining PI WEB's configuration API behavior. When present, Home Manager writes a generated JSON file at `configPath`; documentation and option descriptions will state that the file is declaratively owned and web UI/API configuration writes are not durable (and can fail against the managed symlink).

**Alternative considered:** always generate configuration from module defaults. This would silently take ownership of an existing interactive configuration surface and make UI edits misleading.

## Risks / Trade-offs

- [Npm lockfile/native dependency hashing changes frequently] → Pin the dependency hash, document the update workflow, and make a Nix build check fail when it is stale.
- [`node-pty` support differs across platforms/architectures] → Evaluate all declared systems and limit the support declaration to systems with a successful package build; platform-specific inputs remain explicit.
- [launchd and systemd have different readiness/dependency semantics] → Keep runtime coupling minimal, use independent supervision, and test generated definitions rather than pretending Linux unit semantics apply on Darwin.
- [Declarative config conflicts with UI edits] → Make `settings` opt-in and document the ownership boundary beside the option and install instructions.
- [Home Manager is unavailable in a user's existing NixOS configuration] → Keep the package independently installable with `nix profile install`; the module is an optional declarative integration.

## Migration Plan

1. Add the flake without altering npm, Docker, or existing systemd installation paths.
2. Validate package builds and module evaluation on declared platforms.
3. Publish NixOS/nix-darwin Home Manager examples alongside the existing installation documentation.
4. Existing installations remain unchanged. Users opt in by adding the flake input and enabling the module.
5. Rollback consists of disabling the Home Manager module and restoring the prior user services; state is retained because it is outside the store and in the configured data directory.
