param([int]$Seconds = 8, [string]$Provider = 'Microsoft-Windows-DXGI')

$ErrorActionPreference = 'Stop'

$sessName = 'RiftPresentProbe'
$logFile = Join-Path $env:TEMP 'rift-present.etl'

# clean slate
try { & logman.exe stop $sessName -ets 2>&1 | Out-Null } catch {}
Remove-Item $logFile -Force -EA 0

# logman takes a single -p, so one provider per session
$providers = @($Provider)

Write-Host "starting ETW session '$sessName' on: $($providers -join ', ')"

# logman is used to create the session because the .NET wrapper's settable
# properties are not reachable by name from powershell 5.1
$createArgs = @('create', 'trace', $sessName, '-o', $logFile, '-ets')
foreach ($p in $providers) { $createArgs += @('-p', $p, '0xffffffff', '0x5') }
$created = & logman.exe @createArgs 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: logman could not create the session"
    $created | ForEach-Object { Write-Host "  $_" }
    exit 1
}
Write-Host "session created via logman, sampling for $Seconds seconds..."

$sw = [Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Seconds
$sw.Stop()

& logman.exe stop $sessName -ets 2>&1 | Out-Null

if (-not (Test-Path $logFile)) { Write-Host "FAIL: no etl file was written"; exit 1 }
$size = (Get-Item $logFile).Length
Write-Host ("captured {0:N1} MB in {1:N1}s" -f ($size / 1MB), $sw.Elapsed.TotalSeconds)

Write-Host ""
Write-Host "reading events..."
$q = New-Object System.Diagnostics.Eventing.Reader.EventLogQuery($logFile, [System.Diagnostics.Eventing.Reader.PathType]::FileName, $false)
$q.ReverseDirection = $true
$reader = New-Object System.Diagnostics.Eventing.Reader.EventLogReader($q)

$byProvider = @{}
$byEvent = @{}
$total = 0
$presentish = New-Object System.Collections.ArrayList

while ($reader.ReadEvent()) {
    $e = $reader.CurrentEvent
    if ($null -eq $e) { break }
    $total++
    $pn = $e.ProviderName
    if (-not $byProvider.ContainsKey($pn)) { $byProvider[$pn] = 0 }
    $byProvider[$pn]++
    $k = "$pn / $($e.Id)"
    if (-not $byEvent.ContainsKey($k)) { $byEvent[$k] = 0 }
    $byEvent[$k]++

    # keep a sample of anything that looks frame related
    $nm = $e.EventName
    if ($nm -match 'present|flip|draw|frame|blt' -or $e.Id -in 27, 28, 187, 192, 193, 194, 205, 206) {
        if (@($presentish).Count -lt 12) {
            $vals = @()
            try { $vals = @($e.Properties | ForEach-Object { $_.Value }) } catch {}
            [void]$presentish.Add([pscustomobject]@{
                Provider = $pn
                Id       = $e.Id
                Name     = $nm
                Pid      = $e.ProcessId
                Props    = ($vals | Select-Object -First 8) -join ' | '
            })
        }
    }
}
$reader.Dispose()

Write-Host "total events read: $total"
Write-Host ""
Write-Host "=== events per provider ==="
$byProvider.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { Write-Host ("  {0,-40} {1}" -f $_.Key, $_.Value) }

Write-Host ""
Write-Host "=== top event ids ==="
$byEvent.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15 | ForEach-Object { Write-Host ("  {0,-58} {1}" -f $_.Key, $_.Value) }

Write-Host ""
Write-Host "=== frame-related samples ==="
if (@($presentish).Count -eq 0) { Write-Host "  none matched the present/flip/draw/frame/blt filter" }
else { $presentish | ForEach-Object { Write-Host ("  [{0}] id={1} '{2}' pid={3}`n      {4}" -f $_.Provider, $_.Id, $_.Name, $_.Pid, $_.Props) } }

Write-Host ""
Write-Host "=== per-pid counts for the largest providers ==="
$q2 = New-Object System.Diagnostics.Eventing.Reader.EventLogQuery($logFile, [System.Diagnostics.Eventing.Reader.PathType]::FileName, $false)
$q2.ReverseDirection = $true
$r2 = New-Object System.Diagnostics.Eventing.Reader.EventLogReader($q2)
$perPid = @{}
while ($r2.ReadEvent()) {
    $e = $r2.CurrentEvent
    if ($null -eq $e) { break }
    if ($e.ProviderName -notlike '*DXGI*' -and $e.ProviderName -notlike '*DxgKrnl*') { continue }
    $pid = $e.ProcessId
    if (-not $perPid.ContainsKey($pid)) { $perPid[$pid] = 0 }
    $perPid[$pid]++
}
$r2.Dispose()
$perPid.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 8 | ForEach-Object {
    $proc = try { (Get-Process -Id $_.Key -EA 0).ProcessName } catch { 'gone' }
    Write-Host ("  pid {0,-8} {1,-16} {2} events" -f $_.Key, $proc, $_.Value)
}