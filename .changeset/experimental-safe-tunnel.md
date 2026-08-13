---
"@jmfederico/pi-web": patch
---

Add an experimental, default-off Safe Tunnel flow that operators can explicitly activate with global `safeTunnel: true` or `PI_WEB_SAFE_TUNNEL=1`, then manage through trusted-Host-bound status/operation reads, Host-and-Origin-bound enable/disable requests, authenticated relay TLS, bounded PI WEB-authored status categories, and supervised restart recovery. Opt-in and trusted-host changes require a web/API restart, public exposure still requires an ingress that enforces appropriate authentication and access control, non-loopback registered ingress origins require HTTPS and remain bound to the saved scheme and effective port, and managed `frpc` support is limited to Linux arm64 and x64.
