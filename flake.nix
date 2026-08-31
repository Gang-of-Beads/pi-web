{
  description = "PI WEB Nix package and Home Manager module";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    home-manager = {
      url = "github:nix-community/home-manager/release-26.05";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, home-manager }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in {
      packages = forAllSystems (pkgs: rec {
        pi-web = pkgs.callPackage ./nix/package.nix { };
        default = pi-web;
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [ nodejs python3 pkg-config ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ stdenv.cc ];
        };
      });

      checks = forAllSystems (pkgs:
        let
          home = home-manager.lib.homeManagerConfiguration {
            inherit pkgs;
            modules = [
              self.homeManagerModules.default
              {
                home = {
                  username = "pi-web-test";
                  homeDirectory = "/tmp/pi-web-test";
                  stateVersion = "25.05";
                };
                programs.pi-web.enable = true;
              }
            ];
          };
        in {
          pi-web = self.packages.${pkgs.stdenv.hostPlatform.system}.pi-web;
          home-manager-module = home.activationPackage;
        });

      homeManagerModules.default = import ./nix/home-manager.nix;
    };
}
