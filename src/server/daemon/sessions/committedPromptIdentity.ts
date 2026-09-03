/**
 * Carry the sender's id onto the runtime's committed copy of a prompt.
 *
 * The daemon knows which clientMessageId it handed to the runtime, but the
 * runtime commits the message without it, so every client is left to guess by
 * text which committed copy is which - and a message whose payload is a photo
 * has no text to guess with. That guess is the producer behind the duplicate
 * bubble reported eleven times: the committed copy of a captionless photo can
 * never be recognised as the message already on screen.
 *
 * An expectation is recorded at the single handoff throat and claimed when a
 * user message commits. Claims are deliberately strict - same text and same
 * image count, oldest first - because user messages also enter the transcript
 * without passing the throat (injected continuations, extension prompts), and
 * stamping one of those with a stranger's id would replace the wrong bubble,
 * which is worse than the duplicate. A prompt the runtime rewrote (template
 * expansion) simply goes unclaimed and behaves as before.
 */

export interface ExpectedCommit {
  clientMessageId: string;
  text: string;
  imageCount: number;
}

const MAX_PENDING_PER_SESSION = 50;

export class CommittedPromptExpectations {
  private readonly perSession = new Map<string, ExpectedCommit[]>();

  expect(sessionId: string, commit: ExpectedCommit): void {
    const list = this.perSession.get(sessionId) ?? [];
    list.push(commit);
    if (list.length > MAX_PENDING_PER_SESSION) list.shift();
    this.perSession.set(sessionId, list);
  }

  claim(sessionId: string, committed: { text: string; imageCount: number }): string | undefined {
    const list = this.perSession.get(sessionId);
    if (list === undefined) return undefined;
    const index = list.findIndex((entry) => entry.text === committed.text && entry.imageCount === committed.imageCount);
    if (index === -1) return undefined;
    const [entry] = list.splice(index, 1);
    return entry?.clientMessageId;
  }

  forgetSession(sessionId: string): void {
    this.perSession.delete(sessionId);
  }
}
