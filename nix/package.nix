{ lib, fetchPnpmDeps, makeWrapper, nodejs, pnpm_12, pnpmConfigHook, python3, pkg-config, stdenv }:

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
    # pnpm 12's store keeps links/: package directories materialized from files/
    # and index.db, rebuilt by the next install. fetchPnpmDeps runs jq over every
    # *.json in the store and fails on the first commented tsconfig.json there
    # (outdent, openai, @anthropic-ai/sdk ...), so links/ goes before it, as the
    # fetcher already drops projects/.
    preFixup = "rm -rf $storePath/v11/links";
    hash = "sha256-+9LkBdXV+V1Bpsb96tPSPTn4ah18fx/zHTeFnXXJuFk=";
  };

  nativeBuildInputs = [ nodejs pnpm_12 pnpmConfigHook makeWrapper python3 pkg-config ]
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
