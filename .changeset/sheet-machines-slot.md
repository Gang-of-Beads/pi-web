"pi-web": patch
---

The phone's context sheet renders the machines group from the plugin's contributed section through the same host-fed snapshot the desktop slot uses; picking a row closes the sheet and selects through the host. The group still hides itself below two machines <!-- ERRATUM (round 31): relaxed to one machine in dd95229c - a single-machine user could not find devices at all; the panel doc comment carries the reason. -->, and with no contribution it renders nothing rather than a core fallback. The `createMachine` contract action lands as optional, so hosts without machine creation keep working unchanged.
