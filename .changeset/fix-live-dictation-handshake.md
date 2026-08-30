---
"@vincenthanxiaodu/pi-web": patch
---

Fixed live dictation failing with "The dictation connection failed." on every attempt: the Azure Speech handshake was rejected with HTTP 400 for two stacked reasons — the Bearer scheme's space was serialized as `+` instead of `%20`, and the configured language never travelled on the streaming socket URL (Azure answers "Invalid CID or language" without it). The handshake now percent-encodes the token, carries the configured language, and joins query parameters correctly when the base URL already has one.
