---
"@gang-of-beads/pi-web": patch
---

Tool schemas stop carrying the bounds Anthropic refuses.

A 400 reading "tools.44.custom: For 'integer' type, properties maximum,
minimum are not supported" killed every turn of a session, because one
bounded integer property anywhere in the tool list fails the whole request.
The bounds are now stripped at the boundary that sends schemas, in place, so
extension tools and MCP servers are covered as well as our own.
