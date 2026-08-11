---
"@jmfederico/pi-web": patch
---

Add an experimental, default-off Safe Tunnel flow that operators can explicitly activate with global `safeTunnel: true` or `PI_WEB_SAFE_TUNNEL=1`, then manage through gateway-local approval, disable, diagnostics, and supervised restart recovery. Public exposure still requires an ingress that enforces appropriate authentication and access control, and managed `frpc` support is limited to Linux arm64 and x64.
