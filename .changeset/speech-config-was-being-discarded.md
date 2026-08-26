---
"@vincenthanxiaodu/pi-web": patch
---

Stop discarding speech-to-text config on the way in

The config parser builds its result field by field, so a key it does not name
is dropped in silence. `speechToText` was never named: an install could write
the setting, restart, and find no microphone in the composer, with nothing
anywhere to say the setting had been thrown away when it was read. Dictation
could not be switched on at all.

The setting is now parsed and written back, with the streaming protocol
validated by name. An empty endpoint is rejected rather than stored: a config
that half-enables dictation produces a control that cannot work, which is worse
than no control at all.
