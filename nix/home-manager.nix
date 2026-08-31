{ config, lib, pkgs, ... }:

let
  inherit (lib) mkEnableOption mkIf mkMerge mkOption types;
  cfg = config.programs.pi-web;
  environment = cfg.environment // {
    PI_WEB_DATA_DIR = cfg.dataDir;
    PI_WEB_CONFIG = cfg.configPath;
  };
  systemdEnvironment = lib.mapAttrsToList (name: value: "${name}=${value}") environment;
  configRelativePath = lib.removePrefix "${config.home.homeDirectory}/" cfg.configPath;
in {
  options.programs.pi-web = {
    enable = mkEnableOption "PI WEB's split per-user services";
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./package.nix { };
      description = "PI WEB package used by the user services.";
    };
    dataDir = mkOption {
      type = types.str;
      default = "${config.home.homeDirectory}/.pi-web";
      description = "Persistent PI WEB state directory, outside the Nix store.";
    };
    configPath = mkOption {
      type = types.str;
      default = "${config.xdg.configHome}/pi-web/config.json";
      description = "Path supplied as PI_WEB_CONFIG to both services.";
    };
    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      description = "Additional environment shared by both services.";
    };
    settings = mkOption {
      type = types.nullOr (types.attrsOf types.anything);
      default = null;
      description = "Optional declarative JSON configuration. When set, Home Manager owns configPath and UI/API edits are not persistent.";
    };
  };

  config = mkIf cfg.enable (mkMerge [
    {
      assertions = [
        {
          assertion = !lib.hasPrefix "/nix/store/" cfg.dataDir;
          message = "programs.pi-web.dataDir must be outside /nix/store";
        }
        {
          assertion = cfg.settings == null || lib.hasPrefix "${config.home.homeDirectory}/" cfg.configPath;
          message = "programs.pi-web.configPath must be below home.homeDirectory when settings is declaratively managed";
        }
      ];
      home.packages = [ cfg.package ];
    }
    (mkIf (cfg.settings != null) {
      home.file.${configRelativePath}.text = builtins.toJSON cfg.settings;
    })
    (mkIf pkgs.stdenv.isLinux {
      systemd.user.services.pi-web-sessiond = {
        Unit.Description = "PI WEB session daemon";
        Service = {
          ExecStart = "${cfg.package}/bin/pi-web-sessiond";
          Environment = systemdEnvironment;
          Restart = "on-failure";
        };
        Install.WantedBy = [ "default.target" ];
      };
      systemd.user.services.pi-web = {
        Unit = {
          Description = "PI WEB web/API service";
          After = [ "pi-web-sessiond.service" ];
        };
        Service = {
          ExecStart = "${cfg.package}/bin/pi-web-server";
          Environment = systemdEnvironment;
          Restart = "on-failure";
        };
        Install.WantedBy = [ "default.target" ];
      };
    })
    (mkIf pkgs.stdenv.isDarwin {
      launchd.agents.pi-web-sessiond = {
        enable = true;
        config = {
          Label = "com.pi-web.sessiond";
          ProgramArguments = [ "${cfg.package}/bin/pi-web-sessiond" ];
          EnvironmentVariables = environment;
          KeepAlive = true;
          RunAtLoad = true;
          ProcessType = "Background";
        };
      };
      launchd.agents.pi-web = {
        enable = true;
        config = {
          Label = "com.pi-web.web";
          ProgramArguments = [ "${cfg.package}/bin/pi-web-server" ];
          EnvironmentVariables = environment;
          KeepAlive = true;
          RunAtLoad = true;
          ProcessType = "Background";
        };
      };
    })
  ]);
}
