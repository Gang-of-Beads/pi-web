/**
 * Whether an opened activity drawer should fold itself again.
 *
 * The drawer starts folded, but opening it used to be permanent: a reader who
 * opened it to watch a subagent kept it open for the rest of the chat, and on
 * a tab left open for days that means always open - holding a block of screen
 * to report "Nothing running right now."
 *
 * The reason to be open is the work, so the drawer gives the screen back when
 * the work ends. It only folds on that transition: opening it while nothing is
 * running is a deliberate request to read finished output, and folding it then
 * would take the panel away from a reader who just asked for it.
 */
export function dropsExpansionAsWorkFinishes(state: { wasWorking: boolean; working: boolean }): boolean {
  return state.wasWorking && !state.working;
}
