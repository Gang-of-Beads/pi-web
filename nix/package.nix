{ lib, fetchPnpmDeps, makeWrapper, node-gyp, nodejs, pnpm_12, pnpmConfigHook, python3, pkg-config, stdenv }:

let
  packageJson = builtins.fromJSON (builtins.readFile ../package.json);
in
stdenv.mkDerivation (finalAttrs: {
  pname = "pi-web";
  version = packageJson.version;
  src = lib.cleanSource ../.;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_12;
    fetcherVersion = 4;
    hash = "sha256-PglIUx5es9Bz5iQVsrlXkzw1SYQQX3lNy5UBXKVuROw=";
    preFixup = ''
      rm -rf "$storePath/v11/links"
    '';
  };

  nativeBuildInputs = [ nodejs pnpm_12 pnpmConfigHook makeWrapper python3 pkg-config ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc node-gyp ];

  buildPhase = ''
    runHook preBuild
    # pnpmConfigHook installs with --ignore-scripts, and node-pty ships prebuilds only for
    # darwin and win32: on Linux nothing produced build/Release/pty.node, so the session
    # daemon died at startup with "Failed to load native module: pty.node".
    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      npm_config_nodedir=${nodejs} pnpm rebuild node-pty
      test -f node_modules/node-pty/build/Release/pty.node
    ''}
    pnpm run build
    runHook postBuild
  '';

  dontFixup = true;

  installPhase = ''
    runHook preInstall

    packageRoot=$out/lib/node_modules/@gang-of-beads/pi-web
    mkdir -p "$packageRoot"
    cp -R dist package.json node_modules extensions "$packageRoot/"
    # node-pty#850: the macOS spawn-helper prebuild ships without an execute bit, and the store
    # is read-only by the time PI WEB could repair it, so every terminal failed with posix_spawnp.
    find "$packageRoot/node_modules/node-pty/prebuilds" -name spawn-helper -exec chmod +x {} +

    makeWrapper ${nodejs}/bin/node $out/bin/pi-web \
      --add-flags "$packageRoot/dist/cli.js"
    makeWrapper ${nodejs}/bin/node $out/bin/pi-web-server \
      --add-flags "$packageRoot/dist/server/index.js"
    makeWrapper ${nodejs}/bin/node $out/bin/pi-web-sessiond \
      --add-flags "$packageRoot/dist/server/sessiond.js"

    runHook postInstall
  '';

  meta = {
    description = "Web UI for persistent Pi Coding Agent sessions";
    homepage = "https://github.com/Gang-of-Beads/pi-web";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
    mainProgram = "pi-web";
  };
})
