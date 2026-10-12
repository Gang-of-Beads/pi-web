---
"@gang-of-beads/pi-web": patch
---

Sessions load pi's built-in extensions (codemode, tool search, MCP) as the pi CLI does, so `"defaultTools": ["+codemode"]` gives a PI WEB session the `codemode` tool. The new `piBuiltInExtensions` config key turns them off; it is on by default.
