---
"@gang-of-beads/pi-web": patch
---

Dictation writes what you said, once, and hears the end of the sentence

Microphone audio was sent as a text frame. The speech service carries audio in
binary frames and discards anything else without an error, so speaking produced
nothing at all: no text, no failure, no clue. Audio now travels in the frame the
service reads, which was confirmed against the live endpoint - the same token
and the same samples answered only `turn.start` as text and the full
recognition sequence as binary.

That exposed two more faults on the path behind it. Live dictation reports
everything it has heard so far on every update, and the composer appended each
report to the last, so "hello world" arrived as "hello hello world" and grew
with every interim result; a report now replaces the span dictation owns and
leaves anything typed by hand alone. And stopping closed the connection without
the empty chunk that declares the utterance over, so stopping mid-sentence
dropped the final words.
