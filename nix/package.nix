{ lib, buildNpmPackage, makeWrapper, nodejs, python3, pkg-config, stdenv }:

buildNpmPackage rec {
  pname = "pi-web";
  version = "1.202609.0";
  src = lib.cleanSource ../.;

  npmDepsFetcherVersion = 2;
  npmDepsHash = "sha256-/3/x2Bh6E26zpPBQNG5h3U4GyVBXIeiRivmqXwwYlM0=";

  nativeBuildInputs = [ makeWrapper python3 pkg-config ]
    ++ lib.optionals stdenv.isLinux [ stdenv.cc ];

  installPhase = ''
    runHook preInstall

    packageRoot=$out/lib/node_modules/@vincenthanxiaodu/pi-web
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
    homepage = "https://pi-web.dev/";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
    mainProgram = "pi-web";
  };
}
