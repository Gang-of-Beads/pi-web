{ lib, fetchPnpmDeps, makeWrapper, nodejs, pnpm_11, pnpmConfigHook, python3, pkg-config, stdenv }:

let
  packageJson = builtins.fromJSON (builtins.readFile ../package.json);
in
stdenv.mkDerivation (finalAttrs: {
  pname = "pi-web";
  version = packageJson.version;
  src = lib.cleanSource ../.;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_11;
    fetcherVersion = 4;
    hash = "sha256-7faUo69YEb1r1SPMzK4I07Ukus7b9jZ663iOu31SsRw=";
  };

  nativeBuildInputs = [ nodejs pnpm_11 pnpmConfigHook makeWrapper python3 pkg-config ]
    ++ lib.optionals stdenv.isLinux [ stdenv.cc ];

  buildPhase = ''
    runHook preBuild
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
