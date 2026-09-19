/**
 * What the session list is listing, said out loud.
 *
 * The path chip at the top named the place, but the list below it never said
 * whether it was showing one project or the whole machine - the owner could
 * not tell the two apart, and a list whose reach is a guess is a list you
 * cannot trust. The line states the reach and, when it is narrowed, offers the
 * one tap that widens it.
 */

export interface NavigateScopeLine {
  label: string;
  widen: { label: string } | undefined;
}

export function navigateScopeLine(input: { machineName: string | undefined; projectName: string | undefined }): NavigateScopeLine {
  const machine = input.machineName ?? "this machine";
  if (input.projectName === undefined) return { label: `All sessions on ${machine}`, widen: undefined };
  return { label: `Sessions in ${input.projectName}`, widen: { label: `All on ${machine}` } };
}
