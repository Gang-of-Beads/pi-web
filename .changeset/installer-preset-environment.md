---
"@gang-of-beads/pi-web": patch
---

Both installers now pick the Gang of Beads preset from `PI_WEB_PRESET=gang-of-beads` in the environment, so the Windows command stays a plain `irm … | iex`: `$env:PI_WEB_PRESET = "gang-of-beads"; irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1 | iex`. `--preset gang-of-beads` and `-Preset gang-of-beads` keep working. The README lists the Windows commands with and without the preset next to the Linux and macOS ones.
