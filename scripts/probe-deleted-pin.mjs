/**
 * A deleted session is no longer pinned (owner, 2026-10-01: "删掉了自动就没有了啊，就是也不可能在pinned里面了"), 8505.
 *
 * The probe pins the deleted-id fixture, a session id no store on the machine holds, as a session
 * deleted by hand on the disk would leave it. It then reads the machine's board, which locates
 * every pin no listing holds.
 * Legs:
 * - precondition: the daemon answers the id with the typed not-found code, and the pin is stored;
 * - the board answers the pin as gone;
 * - after that board, the machine no longer stores the pin;
 * - control: a pinned session that exists keeps its pin through the same board.
 * The fixture pin is removed at the end whatever happened; the existing pin is left as found.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const DELETED_SESSION = "deadbeef-0000-7000-8000-000000000000";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const api = async (path, init) => {
  const response = await fetch(`${BASE}/api/machines/local${path}`, { headers: { "content-type": "application/json" }, ...init });
  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
};
const pins = async () => (await api("/session-pins")).body?.pinnedSessionIds ?? [];

const before = await pins();
try {
  const located = await api(`/sessions/${DELETED_SESSION}/locate?cwd=${encodeURIComponent("/")}`);
  await api("/session-pins", { method: "POST", body: JSON.stringify({ sessionId: DELETED_SESSION, pinned: true }) });
  const stored = await pins();
  check("precondition: the id is answered not found, and its pin is stored", located.status === 404 && located.body?.code === "session-not-found" && stored.includes(DELETED_SESSION), `${String(located.status)} ${JSON.stringify(located.body?.code)}, ${String(stored.length)} pins`);
  const existing = before.filter((id) => id !== DELETED_SESSION);
  check("precondition: an existing session is pinned as the control", existing.length > 0, JSON.stringify(existing));

  const board = await api("/session-board");
  const answer = (board.body?.pinned ?? []).find((entry) => entry.sessionId === DELETED_SESSION);
  check("the board answers the pin as gone", answer?.gone === true, JSON.stringify(answer));

  let after = await pins();
  for (let waited = 0; waited < 2_000 && after.includes(DELETED_SESSION); waited += 200) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    after = await pins();
  }
  check("after that board, the machine no longer stores the pin", !after.includes(DELETED_SESSION), JSON.stringify(after));
  check("control: the existing pins are kept", existing.every((id) => after.includes(id)), JSON.stringify({ existing, after }));
} finally {
  await api("/session-pins", { method: "POST", body: JSON.stringify({ sessionId: DELETED_SESSION, pinned: false }) }).catch(() => undefined);
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
