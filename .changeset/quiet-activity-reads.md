---
"@vincenthanxiaodu/pi-web": patch
---

Keep the activity list current, and give the quiet states their shape back.

The subagent activity list read every transcript and every result in full to
take a few kilobytes from each — 170MB per four-second poll on a session with
129 finished runs — and the poll did not wait for the read before starting
another. The list fell far enough behind that only reloading the page appeared
to update it. Both readers now read the window they always claimed to read, and
a request arriving during a read is served once that read finishes.

The jump-to-bottom button was offset by the same gutter that draws the message's
right border, so the two edges landed on one line; it is inset from the reading
column now. The quiet activity markers hugged their words while the dock was
positioned by coordinates, and stretched into empty bars once it became a row in
the column; they hug again.

A run held up by an extension dialog was marked as waiting for an answer and
captioned "idle" in the same breath, so the one marker that could have said the
session was stuck said nothing was happening. It says what it is waiting for.

Adding a project is read-modify-write, and the web server and the session daemon
each hold their own store over one file, so two overlapping changes could drop
one of the two projects and a reader could meet a half-written list. Changes are
serialized and the file is replaced in a single step.
