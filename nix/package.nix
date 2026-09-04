{ lib, buildNpmPackage, makeWrapper, nodejs, python3, pkg-config, stdenv }:

let
  packageJson = builtins.fromJSON (builtins.readFile ../package.json);
in
buildNpmPackage rec {
  pname = "pi-web";
  version = packageJson.version;
  src = lib.cleanSource ../.;

  npmDepsFetcherVersion = 2;
  # Includes package-lock's root package version as well as dependency entries.
  # Update with `nix build .#pi-web --no-link` whenever package-lock.json moves.
  npmDepsHash = "sha256-exIpUI7JeBJqG5vBr7YmIYfZt0gtIUregywxRRLrot0=";

  nativeBuildInputs = [ makeWrapper python3 pkg-config ]
    ++ lib.optionals stdenv.isLinux [ stdenv.cc ];

  installPhase = ''
    runHook preInstall

    packageRoot=$out/lib/node_modules/@gang-of-beads/pi-web
    mkdir -p "$packageRoot"
    cp -R dist package.json node_modules "$packageRoot/"

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
}
