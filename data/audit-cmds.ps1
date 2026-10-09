param([string]$Path = 'C:\Users\Lover\OneDrive\Desktop\ADB Root.txt')

$lines = Get-Content -LiteralPath $Path
$cmds = @{}

foreach ($raw in $lines) {
    $l = $raw.Trim()
    if (-not $l) { continue }
    if ($l.StartsWith('#')) { continue }
    if ($l -match '^(Copy|⚠|IMPORTANT|Category|Correlation|\d+\.)') { continue }
    if ($l -notmatch '^adb\b') { continue }

    # normalise: drop -s <serial>, drop shell/, drop su -c wrapper for grouping
    $c = $l
    $c = $c -replace '^adb\s+(-s\s+\S+\s+)?', ''
    $c = $c -replace '^shell\s+', ''
    $c = $c -replace '^su\s+-c\s+"', ''
    $c = $c -replace '^su\s+-c\s+''', ''
    $c = $c -replace '"$', ''
    $c = $c -replace '\s+', ' '
    $c = $c.Trim()

    if (-not $c) { continue }

    # collapse placeholder noise so variants group together
    $k = $c -replace '<[^>]*>', '<x>'
    $k = $k -replace '\s+', ' '

    if (-not $cmds.ContainsKey($k)) {
        $cmds[$k] = [ordered]@{ key = $k; sample = $c; lines = 0 }
    }
    $cmds[$k].lines++
}

$totalLines = $lines.Count
$adbLines = @($lines | Where-Object { $_ -match '^\s*adb\b' }).Count
$unique = $cmds.Count

"FILE: $Path"
"total lines          : $totalLines"
"lines starting 'adb' : $adbLines"
"UNIQUE commands      : $unique"
"duplicate factor     : $([math]::Round($adbLines / [math]::Max($unique,1), 1))x"
""

$dupes = @($cmds.Values | Where-Object { $_.lines -gt 1 } | Sort-Object lines -Descending)
"top repeated commands:"
$dupes | Select-Object -First 8 | ForEach-Object { "  {0,4}x  {1}" -f $_.lines, $_.key.Substring(0, [math]::Min(90, $_.key.Length)) }
""
$cmds.Values | Sort-Object key | ForEach-Object { "$($_.lines)`t$($_.key)" } | Out-File -LiteralPath "$env:TEMP\rift-unique-cmds.txt" -Encoding UTF8
"unique command list written to $env:TEMP\rift-unique-cmds.txt"