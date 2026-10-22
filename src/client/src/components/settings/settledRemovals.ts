/**
 * The rows of a Settings list that an instant removal shows gone (`instantActions.ts`). A row stays
 * hidden past its action until the list is read again: the action leaves once the machine settled
 * it, and the list read before the press still names the row, so dropping the mark at once would
 * show a removed package or page for a moment. A removal that was undone or refused comes back
 * with the same read.
 *
 * Rows are known by machine and id together: the same package id on another machine is another
 * row, and a list switched to that machine never inherits this one's hidden rows.
 */
export class SettledRemovals {
  private hidden: ReadonlySet<string> = new Set();
  private readonly settling = new Set<string>();

  /** Take the ids the actions show gone on a machine now; ids that left stay hidden until `reread` answers. */
  update(machineId: string, hiddenIds: ReadonlySet<string>, reread: () => Promise<void>, changed: () => void): void {
    const hidden = new Set([...hiddenIds].map((id) => rowKey(machineId, id)));
    const left = [...this.hidden].filter((key) => !hidden.has(key));
    this.hidden = hidden;
    if (left.length === 0) return;
    for (const key of left) this.settling.add(key);
    void reread().finally(() => {
      for (const key of left) this.settling.delete(key);
      changed();
    });
  }

  shows(machineId: string, id: string): boolean {
    const key = rowKey(machineId, id);
    return !this.hidden.has(key) && !this.settling.has(key);
  }
}

function rowKey(machineId: string, id: string): string {
  return JSON.stringify([machineId, id]);
}
