/**
 * Run `read` over `items` with at most `lanes` reads in flight, answering in
 * the order asked (object model §4.5).
 *
 * The browser speaks HTTP/1.1 to PI WEB, which is six connections per host.
 * The session board asked for every workspace's listing at once; on a cold
 * daemon each takes about a second, so seven of them held every connection,
 * and the plugin modules the route restore waits for queued behind them for
 * 1.1 s (measured on 8505, P3). A fan-out through a few lanes leaves the rest
 * of the page its connections.
 *
 * The first read that fails rejects the whole, and no lane starts another
 * read after it: the answers would be thrown away.
 */
export async function mapWithLanes<T, R>(items: readonly T[], lanes: number, read: (item: T) => Promise<R>): Promise<R[]> {
  const waiting = items.map((item, index) => ({ item, index }));
  const answers: { index: number; answer: R }[] = [];
  let failed = false;
  const nextJob = () => (failed ? undefined : waiting.shift());
  const lane = async (): Promise<void> => {
    for (let job = nextJob(); job !== undefined; job = nextJob()) {
      try {
        answers.push({ index: job.index, answer: await read(job.item) });
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, lanes), items.length) }, lane));
  return answers.sort((left, right) => left.index - right.index).map(({ answer }) => answer);
}
