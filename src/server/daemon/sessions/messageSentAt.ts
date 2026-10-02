/**
 * The one time a message is shown with (B5).
 *
 * pi stamps a user message when the daemon hands it over, and that stamp
 * replaced the time the sender saw: three messages sent at 12:23:49, :50 and
 * :51 all became 12:24:04 when a turn took them (audit `5d672be6` P2-3). The
 * sender's own send time is the time the message keeps, on every device and
 * after every reload. It is trusted only up to the daemon's acceptance: a
 * phone clock running fast must not put a message after the reply to it, and
 * a time that does not parse is no time at all.
 */
export function messageSentAt(claimed: unknown, acceptedAt: string): string {
  if (typeof claimed !== "string") return acceptedAt;
  const claimedMs = Date.parse(claimed);
  if (!Number.isFinite(claimedMs) || claimedMs > Date.parse(acceptedAt)) return acceptedAt;
  return new Date(claimedMs).toISOString();
}
