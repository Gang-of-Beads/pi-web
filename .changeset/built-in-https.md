---
"@gang-of-beads/pi-web": patch
---

PI WEB can serve HTTPS itself. Set `tls.certFile` and `tls.keyFile` in the global config (or `PI_WEB_TLS_CERT` and `PI_WEB_TLS_KEY`) to a certificate and key you provide, such as one from `tailscale cert`; WebSockets follow as `wss://`. A certificate that cannot be used keeps the web/API from starting instead of falling back to plain HTTP, a renewed certificate in the same files is picked up within 10 minutes without a restart, and `pi-web doctor` checks it.
