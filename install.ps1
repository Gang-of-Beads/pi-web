<#
.SYNOPSIS
Installs PI WEB on Windows and registers its per-user scheduled tasks.

.DESCRIPTION
The PowerShell twin of install.sh, for Windows PowerShell 5.1 and PowerShell 7:

  irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1 | iex
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1))) -Preset gang-of-beads

The preset is checked by hand: a validation attribute on the parameter fails under iex, which binds
no arguments. It stops at the first failure. Run as a file, it exits with that failure's exit code; run through
iex or a script block, it throws instead (an exit there would close the PowerShell window) and leaves
the code in $LASTEXITCODE. Commands are started through their .cmd or .exe shims, because the .ps1
shims npm writes do not run under the default execution policy, and are judged by their exit code
alone: when the installer's output is redirected, Windows PowerShell 5.1 turns each line a command
writes to stderr into an error, and npm writes warnings there.
#>
param(
  [string]$Preset
)

& {
  $ErrorActionPreference = 'Stop'

  function Stop-Install([int]$Code, [string[]]$Message) {
    foreach ($line in $Message + 'See https://github.com/Gang-of-Beads/pi-web/blob/main/docs/install.md#windows') {
      [Console]::Error.WriteLine($line)
    }
    $global:LASTEXITCODE = $Code
    if ($PSCommandPath) { exit $Code }
    throw "PI WEB install stopped (exit code $Code)."
  }

  function Find-Application([string]$Name) {
    $command = Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
  }

  function Invoke-Checked([string]$Path, [string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    & $Path @Arguments
    if ($LASTEXITCODE -ne 0) {
      $code = $LASTEXITCODE
      Stop-Install $code "``$([System.IO.Path]::GetFileName($Path)) $($Arguments -join ' ')`` failed with exit code $code."
    }
  }

  if ($Preset -and $Preset -ne 'gang-of-beads') {
    Stop-Install 2 @("Unknown preset '$Preset'.", 'Usage: install.ps1 [-Preset gang-of-beads]')
  }

  $node = Find-Application 'node'
  $npm = Find-Application 'npm'
  if (-not $node -or -not $npm) { Stop-Install 1 'PI WEB needs Node.js 22.19.0 or newer and npm on PATH.' }
  $nodeVersion = (Invoke-Checked $node @('-p', 'process.versions.node') | Out-String).Trim()
  if ([version]$nodeVersion -lt [version]'22.19.0') { Stop-Install 1 "PI WEB needs Node.js 22.19.0 or newer; this is v$nodeVersion." }

  $npmPrefix = (Invoke-Checked $npm @('prefix', '-g') | Out-String).Trim()
  $npmTarget = Join-Path $npmPrefix 'node_modules'
  while ($npmTarget -and -not (Test-Path -LiteralPath $npmTarget -PathType Container)) { $npmTarget = Split-Path -Parent $npmTarget }
  $writable = $false
  if ($npmTarget) {
    $probe = Join-Path $npmTarget ('.pi-web-install-' + [guid]::NewGuid().ToString('N'))
    try {
      [System.IO.File]::Create($probe).Dispose()
      Remove-Item -LiteralPath $probe -Force
      $writable = $true
    } catch {
      $writable = $false
    }
  }
  if (-not $writable) {
    Stop-Install 1 @(
      "npm installs global packages into $npmPrefix, which your user cannot write to.",
      'Use a Node.js version manager (nvm-windows, fnm, Volta), or run `npm config set prefix "$env:APPDATA\npm"`, add that folder to your user PATH, and run this installer again.'
    )
  }

  $pi = $null
  if ($Preset) {
    $pi = Find-Application 'pi'
    if (-not $pi) { Stop-Install 1 'The Gang of Beads preset requires Pi Coding Agent on PATH. Install and configure Pi first.' }
  }

  Invoke-Checked $npm @('install', '-g', '@gang-of-beads/pi-web', '--allow-scripts=node-pty')

  if ($Preset) {
    foreach ($source in @(
      'npm:@gang-of-beads/pi-ask-user',
      'npm:@gang-of-beads/pi-subagents',
      'npm:@gang-of-beads/pi-web-subagents',
      'npm:pi-background-tasks',
      'npm:@gang-of-beads/pi-web-background-runs',
      'npm:@gang-of-beads/pi-goal',
      'npm:@gang-of-beads/pi-web-goals',
      'npm:@gang-of-beads/pi-web-voice',
      'npm:@gang-of-beads/pi-web-themes',
      'npm:@gang-of-beads/pi-multi-account',
      'npm:@gang-of-beads/pi-updater'
    )) {
      Invoke-Checked $pi @('install', $source)
    }
  }

  $piWeb = Find-Application 'pi-web'
  if (-not $piWeb) { Stop-Install 1 "npm installed pi-web into $npmPrefix, which is not on PATH. Add that folder to your user PATH, open a new PowerShell window and run ``pi-web install``." }
  Invoke-Checked $piWeb @('install')
}
