---
"@vincenthanxiaodu/pi-web": patch
---

Convert microphone audio into what a transcription socket expects

The browser hands out float samples at whatever rate the device runs at; the
services want signed 16-bit integers at a rate they name. Getting this subtly
wrong does not fail loudly - it produces audio that transcribes as plausible
nonsense - so each hazard is pinned by a test: the ends of the float range are
scaled separately, because the usual symmetric multiply overflows a full-scale
positive sample to the most negative one and is heard as a click on the loudest
part of a phrase; overshoot is clamped rather than wrapped; and upsampling is
refused rather than approximated.
