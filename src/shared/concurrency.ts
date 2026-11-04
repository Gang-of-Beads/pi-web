/**
 * Run `tasks`, at most `limit` at a time. The first failure rejects, and no task starts after it.
 * Reading every file of a large store at once can meet the open-file limit, which is 256 for a
 * macOS service.
 */
export async function runWithConcurrency(tasks: readonly (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < tasks.length) {
      const task = tasks[next];
      next += 1;
      try {
        if (task !== undefined) await task();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}
