import { BUILTIN_COMMANDS } from "../../../shared/builtinSlashCommands.js";
import type { ClientCommand } from "../../shared/types.js";

/** The built-ins the `/` menu offers: every one PI WEB handles, in the page or here, with pi's description and argument hint. */
export const BUILTIN_MENU_COMMANDS: readonly ClientCommand[] = Object.entries(BUILTIN_COMMANDS)
  .filter(([, command]) => command.handling !== "unavailable")
  .map(([name, command]): ClientCommand => ({
    name,
    description: command.description,
    ...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
    source: "builtin",
  }));
