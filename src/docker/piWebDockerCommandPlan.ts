export type PiWebDockerMode = "runtime" | "dev";

export const PI_WEB_DOCKER_USER_COMMANDS = [
  "install",
  "start",
  "stop",
  "restart",
  "restart-web",
  "restart-sessiond",
  "update",
  "status",
  "logs",
  "shell",
  "doctor",
  "cli",
] as const;

type PiWebDockerUserCommand = (typeof PI_WEB_DOCKER_USER_COMMANDS)[number];

export function piWebDockerCommandPrefix(mode: PiWebDockerMode | undefined): string {
  return mode === "dev" ? "pi-web-docker --dev" : "pi-web-docker";
}

export function piWebDockerCommand(mode: PiWebDockerMode | undefined, command: PiWebDockerUserCommand): string {
  return `${piWebDockerCommandPrefix(mode)} ${command}`;
}
