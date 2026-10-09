param([switch]$ShowMatching)

$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path $PSScriptRoot -Parent
$enginePath = Join-Path $root 'engine\rift-boost.ps1'

# the engine's top level clobbers variables in the caller's scope, so ask a
# child process for the name -> path map instead of dot sourcing it here
$probe = @"
`$src = Get-Content -LiteralPath '$enginePath' -Raw
`$src = `$src -replace '(?ms)^boot[\s\S]*`$', ''
`$t = [IO.Path]::GetTempFileName() + '.ps1'
`$src | Set-Content -LiteralPath `$t -Encoding UTF8
. `$t
Remove-Item `$t -Force
function log { param([string]`$m, [string]`$l) }
function emit { param(`$o) }
`$map = [ordered]@{}
foreach (`$k in windowsKeys) { `$map[`$k.name] = `$k.path }
`$map | ConvertTo-Json -Compress
"@
$probeFile = Join-Path $env:TEMP ('rift_map_' + [guid]::NewGuid().ToString('N') + '.ps1')
$probe | Set-Content -LiteralPath $probeFile -Encoding UTF8
$mapJson = & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $probeFile
Remove-Item $probeFile -Force

$pathOf = @{}
if ($mapJson) {
    $parsed = $mapJson | ConvertFrom-Json
    foreach ($p in $parsed.PSObject.Properties) { $pathOf[$p.Name] = $p.Value }
}

$b = Get-Content (Join-Path $root 'data\baseline.json') -Raw | ConvertFrom-Json

Write-Host "baseline: $($b.createdAt)"
Write-Host "keys in baseline: $(@($b.registry.PSObject.Properties).Count)"
Write-Host ""

$same = 0; $diff = 0; $gone = 0; $unmapped = 0
$diffRows = New-Object System.Collections.ArrayList

foreach ($kp in $b.registry.PSObject.Properties) {
    $name = $kp.Name
    if (-not $pathOf.ContainsKey($name)) {
        $unmapped++
        [void]$diffRows.Add(("  [UNMAPPED] {0}" -f $name))
        continue
    }
    $path = $pathOf[$name]
    $keyExists = Test-Path $path

    foreach ($vp in $kp.Value.values.PSObject.Properties) {
        if (-not $keyExists) {
            $gone++
            [void]$diffRows.Add(("  {0,-20} {1,-34} key absent, baseline='{2}'" -f $name, $vp.Name, $vp.Value))
            continue
        }
        $cur = (Get-ItemProperty -LiteralPath $path -Name $vp.Name -EA 0).($vp.Name)
        if ($null -eq $cur) {
            $gone++
            [void]$diffRows.Add(("  {0,-20} {1,-34} value absent, baseline='{2}'" -f $name, $vp.Name, $vp.Value))
            continue
        }
        if ([string]$cur -eq [string]$vp.Value) { $same++; if ($ShowMatching) { [void]$diffRows.Add(("  [same] {0}/{1} = '{2}'" -f $name, $vp.Name, $cur)) } }
        else {
            $diff++
            [void]$diffRows.Add(("  {0,-20} {1,-34} now='{2}' baseline='{3}'" -f $name, $vp.Name, $cur, $vp.Value))
        }
    }
}

Write-Host "identical to baseline : $same"
Write-Host "DIFFERENT from baseline: $diff"
Write-Host "gone now               : $gone"
Write-Host "keys not in windowsKeys: $unmapped"
Write-Host ""
Write-Host "=== differences and gaps ==="
$diffRows | Where-Object { $_ -notmatch '^\s+\[same\]' } | ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "=== power state ==="
Write-Host ("  active now : {0}" -f ((powercfg /getactivescheme 2>&1) -join ' ').Trim())
$bp = @($b.power)
Write-Host ("  baseline entries: {0}" -f $bp.Count)
foreach ($p in $bp) { Write-Host ("    {0}  name='{1}'  active={2}" -f $p.guid, $p.name, $p.active) }