## 1. Flake package and development shell

- [x] 1.1 Add pinned flake inputs and system outputs for the declared Linux and Darwin architectures; verified `nix flake check --no-build` evaluates the local Darwin outputs and `nix flake show --all-systems` evaluates every declared output.
- [x] 1.2 Package the existing PI WEB build with the committed npm lockfile and explicit native build prerequisites; verified `nix build .#pi-web --out-link result` and the three CLI wrappers plus built client/plugin artifacts. Added missing integrity metadata for six lockfile entries, required by Nix's npm fetcher.
- [x] 1.3 Add `nix develop` with the declared Node/npm and native build toolchain; verified `nix develop -c sh -c 'node --version && npm --version && npm run typecheck && npm run build'` on Apple Silicon Darwin.

## 2. Declarative user-service integration

- [ ] 2.1 Add a Home Manager module and options for enablement, package, data directory, configuration path, service environment, and opt-in declarative JSON settings; verify Nix evaluation accepts representative NixOS and nix-darwin configurations and rejects invalid option types.
- [ ] 2.2 Generate independent Linux systemd user services for the web/API process and session daemon, with shared configured state inputs and daemon-first startup; verify the module evaluation exposes both unit definitions and a web-only restart does not alter the daemon unit definition.
- [ ] 2.3 Generate independent nix-darwin launchd agents for the web/API process and session daemon with equivalent configured package and environment; verify the module evaluation exposes both agents and their program arguments target the packaged commands.
- [ ] 2.4 Protect mutable state and configuration ownership in the module implementation; verify the default data directory/configuration path are outside the Nix store, declarative settings materialize deterministically, and absent settings leave a user-managed config file untouched.

## 3. Documentation and release integration

- [ ] 3.1 Document flake package installation, `nix develop`, Home Manager NixOS setup, and Home Manager nix-darwin setup in the canonical installation documentation; verify each documented command and module path matches the built flake outputs and the README remains a concise discovery surface.
- [ ] 3.2 Document the separate service lifecycle, persistent-state location, configuration ownership trade-off, and daemon-only restart requirement; verify the examples distinguish web-only from session-daemon restarts. No UI behavior changes, so 393x850 coarse-pointer browser verification is not applicable.
- [ ] 3.3 Add a patch Changeset for supported Nix installation/configuration; verify `npm run changelog:status` recognizes the release note.

## 4. End-to-end verification

- [ ] 4.1 Run the project verification suite plus Nix checks after the completed implementation; verify `npm run verify`, `nix flake check`, and the supported local-system package build all pass, and record any platform evaluations that require CI rather than the local host. No browser UI behavior changes, so 393x850 coarse-pointer verification is not applicable.
