---
"@gang-of-beads/pi-web": patch
---

Stop drawing empty assistant bubbles between tool steps when a model answers with only blank lines before calling a tool (seen with Qwen models), both while the reply streams and when the session is reopened. The model's stored reply is unchanged.
