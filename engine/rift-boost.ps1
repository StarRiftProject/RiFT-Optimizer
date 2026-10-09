param(
    [ValidateSet('status', 'watch', 'bench', 'preview', 'lite', 'max', 'ultra', 'windows', 'custom', 'restore')]
    [string]$Action = '',
[string]$Modules = '',
    [switch]$Json,
    [switch]$Restore,
    [switch]$Hags,
    [int]$BenchSeconds = 8
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

$script:me = 'RiFT, AL'
$script:ver = '3.0'
$script:I   = 70

$script:Json = [bool]$Json
$script:ok   = 0
$script:wn   = 0
$script:er   = 0

$script:h    = [char]0x2500
$script:hl   = [char]0x2501
$script:vt   = [char]0x2502
$script:tl   = [char]0x250C
$script:tm   = [char]0x252C
$script:bl   = [char]0x2514
$script:dbl  = [char]0x2550
$script:dvt  = [char]0x2551
$script:dot  = [char]0x25CF
$script:tick = [char]0x2713
$script:full = [char]0x2588
$script:lite = [char]0x2591

$script:appRoot = if ($PSScriptRoot) { Split-Path $PSScriptRoot -Parent } else { (Get-Location).Path }
if (-not $script:appRoot) { $script:appRoot = (Get-Location).Path }

$script:data = Join-Path $script:appRoot 'data'
$script:logs = Join-Path $script:data 'logs'
$script:bak  = Join-Path $script:data 'backups'
$script:tmp  = Join-Path $script:data 'tmp'
$script:pt   = Join-Path $script:appRoot 'platform-tools'

foreach ($d in @($script:data, $script:logs, $script:bak, $script:tmp)) {
    if (-not (Test-Path $d)) { New-Item $d -ItemType Directory -Force | Out-Null }
}

$script:stamp   = Get-Date -Format 'yyyyMMdd_HHmmss'
$script:logFile = Join-Path $script:logs "run_$($script:stamp).log"
$script:bakFile = Join-Path $script:bak  "settings_$($script:stamp).json"

$script:fmin  = 240
$script:fmax  = 240
$script:fpeak = 240

$script:adb   = $null
$script:dev   = $null
$script:brand = ''
$script:model = ''
$script:andro = ''
$script:root  = $false
$script:uid0  = $false
$script:rootMethod  = ''
$script:rootManager = ''
$script:rootProbe   = ''
$script:selinux     = ''
$script:kernelSnap  = [ordered]@{}
$script:loop  = $false
$script:bu    = @()

$script:pubg = @(
    'com.tencent.ig'
    'com.tencent.iglite'
    'com.pubg.krmobile'
    'com.vng.pubgmobile'
    'com.rekoo.pubgm'
    'com.tencent.pubgmhd'
)

$script:engineBase = $null
$script:resProfile = '720x1280'

$script:emu = @(
    'AndroidEmulator', 'AndroidEmulatorEn', 'AndroidEmulatorEx', 'HD-Player', 'Bluestacks'
    'GameLoop', 'aow_exe', 'cef_frame_render', 'TxGameAssistant', 'AppMarket'
    'LdPlayerMain', 'dnplayer', 'dnplayer2', 'Nox', 'NoxVM', 'emulator64-', 'bgd64'
    'EngineProcess', 'AndroidProcess'
)

$script:engineExe = @('aow_exe', 'AndroidEmulatorEn', 'AndroidEmulator', 'cef_frame_render', 'TxGameAssistant', 'AppMarket')

function isElevated {
    try {
        return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    catch { return $false }
}

function findGameLoop {
    $pf86 = ${env:ProgramFiles(x86)}
    $roots = @(
        "$env:ProgramFiles\TxGameAssistant"
        "$pf86\TxGameAssistant"
        'C:\Program Files\TxGameAssistant'
        'D:\Program Files\TxGameAssistant'
        'C:\TxGameAssistant'
        'D:\TxGameAssistant'
    ) | Where-Object { Test-Path $_ }

    foreach ($r in $roots) {
        $ini = Join-Path $r 'ui\Config.ini'
        if (Test-Path $ini) {
            return [ordered]@{ root = $r; ini = $ini; exes = @(Get-ChildItem $r -Recurse -File -Filter *.exe -EA 0 | Select-Object -ExpandProperty FullName) }
        }
    }
    return $null
}

function decodeTextFile {
    param([byte[]]$Bytes)

    if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) {
        return @{ encoding = 'utf-16le'; text = [System.Text.Encoding]::Unicode.GetString($Bytes, 2, $Bytes.Length - 2) }
    }
    if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFE -and $Bytes[1] -eq 0xFF) {
        return @{ encoding = 'utf-16be'; text = [System.Text.Encoding]::BigEndianUnicode.GetString($Bytes, 2, $Bytes.Length - 2) }
    }

    $sample = [Math]::Min($Bytes.Length, 512)
    $oddZero = 0
    $evenZero = 0
    $pairs = [int]($sample / 2)

    for ($i = 0; $i -lt $pairs; $i += 1) {
        if ($Bytes[$i * 2 + 1] -eq 0) { $oddZero += 1 }
        if ($Bytes[$i * 2] -eq 0) { $evenZero += 1 }
    }

    if ($pairs -gt 0) {
        if (($oddZero / $pairs) -gt 0.3) {
            return @{ encoding = 'utf-16le'; text = [System.Text.Encoding]::Unicode.GetString($Bytes) }
        }
        if (($evenZero / $pairs) -gt 0.3) {
            return @{ encoding = 'utf-16be'; text = [System.Text.Encoding]::BigEndianUnicode.GetString($Bytes) }
        }
    }

    $utf8 = $true
    try { [void](New-Object System.Text.UTF8Encoding($false, $true)).GetString($Bytes) } catch { $utf8 = $false }

    if ($utf8) { return @{ encoding = 'utf-8'; text = [System.Text.Encoding]::UTF8.GetString($Bytes) } }
    return @{ encoding = 'ansi'; text = [System.Text.Encoding]::Default.GetString($Bytes) }
}

function readEngineConfig {
    param([string]$Ini)
    if (-not (Test-Path $Ini)) { return $null }

    $decoded = $null
    try { $decoded = decodeTextFile ([System.IO.File]::ReadAllBytes($Ini)) } catch { return $null }
    $raw = $decoded.text

    $profiles = @()
    $current = $null
    $section = ''

    foreach ($line in ($raw -split "`r?`n")) {
        $t = $line.Trim()
        if (-not $t) { continue }

        if ($t -match '^\[(.+)\]$') {
            $section = $Matches[1]
            if ($section -match '^Engine_') {
                $current = [ordered]@{ section = $section; keys = [ordered]@{} }
                $profiles += $current
            }
            elseif ($section -eq 'Engine') {
                $current = $null
                if (-not $script:engineBase) { $script:engineBase = [ordered]@{ keys = [ordered]@{} } }
            }
            continue
        }

        if ($t.StartsWith(';') -or $t.StartsWith('#')) { continue }
        if ($section -match '^Engine' -and $t -match '^([^=]+)=(.*)$') {
            $key = $Matches[1].Trim()
            $val = $Matches[2].Trim()
            if ($current) { $current.keys[$key] = $val }
            elseif ($script:engineBase) { $script:engineBase.keys[$key] = $val }
        }
    }

    return [ordered]@{
        encoding = $decoded.encoding
        base     = $script:engineBase
        profiles = $profiles
    }
}

function doGameLoopEngine {
    emit @{ e = 'stage'; m = 'gameloop engine config' }
    rule 'gameloop engine config'

    $gl = findGameLoop
    if (-not $gl) {
        log 'GameLoop install not found, skipping engine config' 'WARN'
        return
    }
    log ("found GameLoop at {0}" -f $gl.root) 'OK'

    $cfg = readEngineConfig $gl.ini
    if (-not $cfg) {
        log 'could not parse the engine config' 'WARN'
        return
    }

    $target = $script:resProfile
    if (-not $cfg.profiles.Count) {
        log 'no [Engine_*] profile sections found' 'WARN'
        return
    }

    $touched = 0
    foreach ($profile in $cfg.profiles) {
        $w = $profile.keys['VMWidth']
        $h = $profile.keys['VMHeight']
        $dpi = $profile.keys['VMDPI']
        $rend = $profile.keys['Renderer']
        log ("{0}: {1}x{2} dpi {3} renderer {4}" -f $profile.section, $w, $h, $dpi, $rend) 'DBG'
        $touched++
    }

    emit @{
        e      = 'engine'
        root   = $gl.root
        ini    = $gl.ini
        encoding = $cfg.encoding
        profiles = @($cfg.profiles | ForEach-Object {
            [ordered]@{
                section   = $_.section
                width     = $_.keys['VMWidth']
                height    = $_.keys['VMHeight']
                dpi       = $_.keys['VMDPI']
                renderer  = $_.keys['Renderer']
                decoding  = $_.keys['EnableHardwareDecoding']
            }
        })
        exes = $gl.exes.Count
    }

    log ("{0} engine profiles inspected, renderer left untouched (mapping is build-specific)" -f $touched) 'OK'
    log 'resolution, DPI, FPS cap and core count are edited in GameLoop itself while it is closed' 'INFO'
}

function doSysMultimedia {
    emit @{ e = 'stage'; m = 'scheduler profile' }
    rule 'scheduler profile'

    $k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile'
    if (-not (Test-Path $k)) { New-Item $k -Force | Out-Null }

    try {
        Set-ItemProperty -LiteralPath $k -Name 'NetworkThrottlingIndex' -Value 'ffffffff' -Type DWord -Force
        Set-ItemProperty -LiteralPath $k -Name 'SystemResponsiveness' -Value 0 -Type DWord -Force
        log 'multimedia throttling disabled, scheduler responsiveness raised' 'OK'
    }
    catch { log ("multimedia keys failed: {0}" -f $_.Exception.Message) 'WARN' }

    $games = Join-Path $k 'Tasks\Games'
    try {
        if (-not (Test-Path $games)) { New-Item $games -Force | Out-Null }
        Set-ItemProperty -LiteralPath $games -Name 'GPU Priority' -Value 8 -Type DWord -Force
        Set-ItemProperty -LiteralPath $games -Name 'Priority' -Value 6 -Type DWord -Force
        Set-ItemProperty -LiteralPath $games -Name 'Scheduling Category' -Value 'High' -Force
        Set-ItemProperty -LiteralPath $games -Name 'SFIO Priority' -Value 'High' -Force
        log 'games task scheduled High with top GPU priority' 'OK'
    }
    catch { log ("games task keys failed: {0}" -f $_.Exception.Message) 'WARN' }

    $proc = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Processes'
    try {
        if (-not (Test-Path $proc)) { New-Item $proc -Force | Out-Null }
        Set-ItemProperty -LiteralPath $proc -Name 'GPU Priority' -Value 8 -Type DWord -Force
        Set-ItemProperty -LiteralPath $proc -Name 'Priority' -Value 6 -Type DWord -Force
        Set-ItemProperty -LiteralPath $proc -Name 'Scheduling Category' -Value 'High' -Force
        Set-ItemProperty -LiteralPath $proc -Name 'SFIO Priority' -Value 'High' -Force
        log 'process scheduling raised for foreground work' 'OK'
    }
    catch { log ("process keys failed: {0}" -f $_.Exception.Message) 'WARN' }
}

function doSysTcp {
    emit @{ e = 'stage'; m = 'tcp latency' }
    rule 'tcp latency'

    $k = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters'
    try {
        Set-ItemProperty -LiteralPath $k -Name 'TcpAckFrequency' -Value 1 -Type DWord -Force
        Set-ItemProperty -LiteralPath $k -Name 'TCPNoDelay' -Value 1 -Type DWord -Force
        log 'nagle coalescing off, ack frequency lowered (needs a network restart)' 'OK'
    }
    catch { log ("tcp keys failed: {0}" -f $_.Exception.Message) 'WARN' }
}

function doSysFullscreen {
    emit @{ e = 'stage'; m = 'fullscreen optimisations off' }
    rule 'fullscreen optimisations off'

    if (-not (isElevated)) {
        log 'needs admin, skipped' 'WARN'
        return
    }

    $gl = findGameLoop
    if (-not $gl) {
        log 'GameLoop install not found, skipped' 'WARN'
        return
    }

    $base = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options'
    $n = 0
    foreach ($exe in $gl.exes) {
        $leaf = Split-Path $exe -Leaf
        if ($leaf -notmatch '^(aow_exe|AndroidEmulator\w*|cef_frame_render|TxGameAssistant|AppMarket|HD-Player)') { continue }
        $k = Join-Path $base $leaf
        try {
            if (-not (Test-Path $k)) { New-Item $k -Force | Out-Null }
            Set-ItemProperty -LiteralPath $k -Name 'DISABLEDXMAXIMIZEDWINDOWEDMODE' -Value 1 -Type DWord -Force
            Set-ItemProperty -LiteralPath $k -Name 'DISABLEDXFULLSCREENOPTIMIZATIONS' -Value 1 -Type DWord -Force
            $n++
        }
        catch {}
    }

    if ($n) { log ("fullscreen optimisations disabled on {0} emulator binaries" -f $n) 'OK' }
    else { log 'no matching emulator binaries to configure' 'WARN' }
}

function doSysThrottle {
    emit @{ e = 'stage'; m = 'power and graphics scheduling' }
    rule 'power and graphics scheduling'

    $throttle = 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\PowerThrottling'
    try {
        if (-not (Test-Path $throttle)) { New-Item $throttle -Force | Out-Null }
        Set-ItemProperty -LiteralPath $throttle -Name 'PowerThrottlingOff' -Value 1 -Type DWord -Force
        log 'cpu power throttling disabled for foreground work' 'OK'
    }
    catch { log ("power throttling key failed: {0}" -f $_.Exception.Message) 'WARN' }

# hags is opt-in: forcing it on causes stutter or driver resets on some
    # gpus, so windows keeps its own setting unless -Hags is passed
    $gfx = 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers'
    if ($Hags) {
        try {
            Set-ItemProperty -LiteralPath $gfx -Name 'HwSchMode' -Value 2 -Type DWord -Force
            log 'hardware d3d scheduling forced on (requested)' 'OK'
        }
        catch { log ("graphics scheduler key failed: {0}" -f $_.Exception.Message) 'WARN' }
    }
    else {
        $cur = Get-ItemProperty -LiteralPath $gfx -Name 'HwSchMode' -EA 0
        if ($null -ne $cur) { log ("hardware scheduling left as windows had it ({0})" -f $cur.HwSchMode) 'DBG' }
        else { log 'hardware scheduling left to windows (pass -Hags to force)' 'DBG' }
    }

    try {
        netsh interface tcp set global rss=enabled | Out-Null
        netsh interface tcp set global chimney=enabled | Out-Null
        log 'receive side scaling and chimney enabled' 'OK'
    }
    catch { log 'netsh tcp tuning skipped' 'WARN' }

    $desktop = 'HKCU:\Control Panel\Desktop'
    try {
        Set-ItemProperty -LiteralPath $desktop -Name 'MenuShowDelay' -Value '0' -Force
        Set-ItemProperty -LiteralPath $desktop -Name 'ForegroundFlashCount' -Value 0 -Force
        log 'menu delay removed' 'OK'
    }
    catch {}

    $personal = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
    try {
        Set-ItemProperty -LiteralPath $personal -Name 'EnableTransparency' -Value 0 -Type DWord -Force
        log 'transparency off' 'OK'
    }
    catch {}

    $visual = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects'
    try {
        Set-ItemProperty -LiteralPath $visual -Name 'VisualFXSetting' -Value 2 -Force
        log 'visual effects set to best performance' 'OK'
    }
    catch {}
}

function doAppOps {
    emit @{ e = 'stage'; m = 'background access and compile' }
    rule 'background access and compile'

    if (-not $script:dev) { log 'no device, skipped app ops' 'WARN'; return }

    $pkgs = @($script:pubg) + @('com.activision.callofduty.shooter', 'com.dts.freefireth', 'com.tencent.tmgp.pubgmhd')
    $n = 0
    foreach ($p in $pkgs) {
        if ((([string](sh "pm path $p" -q)).Trim()) -eq '') { continue }
        sh "cmd appops set $p RUN_ANY_IN_BACKGROUND allow" -q | Out-Null
        sh "cmd package bg-dexopt-job --reset $p" -q | Out-Null
        sh "cmd package compile -m speed -f $p" -q | Out-Null
        log ("background access allowed and speed profile compiled: {0}" -f $p) 'OK'
        $n++
    }

    if (-not $n) { log 'no supported game packages found on this device' 'WARN' }
}

function doWinPrio {
    emit @{ e = 'stage'; m = 'process priority' }
    rule 'emulator process priority'
    # same helper as doSysPrio so the two paths cannot drift apart again
    if (-not (raiseEmulatorPriority)) { log 'no emulator process running yet' 'WARN' }
}

$script:ports = 5554,5555
# the only serials we are willing to drive. picking anything else is what makes
# adb grab the wrong device and every command start failing, so a device that
# is not on this list is ignored instead of being used as a fallback.
# if your emulator shows a different port, change $script:ports and add its
# serial here - 5554 only would not find this machine's 127.0.0.1:5555
$script:accepted = @('emulator-5554', '127.0.0.1:5554', '127.0.0.1:5555')

# â”€â”€ emit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function emit {
    param([hashtable]$Data)
    if (-not $script:Json) { return }
    try {
        [Console]::Out.WriteLine(($Data | ConvertTo-Json -Compress -Depth 6))
    } catch {}
}

function log {
    param([string]$m, [string]$l = 'INFO')

    # the watcher probes on a timer and would otherwise repeat the same line
    # every few seconds, so it stays quiet unless something actually changed
    if ($script:quiet) { return }

    $s = Get-Date -Format 'HH:mm:ss'
    try { Add-Content $script:logFile "[$s][$l] $m" -Encoding UTF8 } catch {}

    $tag = switch ($l) {
        'OK'   { $script:ok++; 'ok' }
        'WARN' { $script:wn++; 'warn' }
        'ERR'  { $script:er++; 'err' }
        'DBG'  { 'dbg' }
        'STEP' { 'stage' }
        default { 'info' }
    }

    if ($script:Json) {
        emit @{ e = 'log'; l = $tag; m = $m; t = $s }
        return
    }

    $mk = '-'
    $c = 'Gray'
    switch ($l) {
        'OK'   { $mk = '+'; $c = 'Green' }
        'ERR'  { $mk = 'x'; $c = 'Red' }
        'WARN' { $mk = '!'; $c = 'DarkYellow' }
        'DBG'  { $mk = '.'; $c = 'DarkGray' }
        'STEP' { $mk = '>'; $c = 'Cyan' }
    }

    Write-Host '    ' -NoNewline
    Write-Host $mk -NoNewline -ForegroundColor $c
    Write-Host (' ' + $m) -ForegroundColor $c
}

function fatal {
    param([string]$m)
    if ($script:Json) { emit @{ e = 'fatal'; m = $m } }
    else { log $m 'ERR' }
    if (-not $script:Json) { pause }
    exit 1
}

# â”€â”€ drawing (interactive only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function top {
    param([string]$t, [string]$c = 'DarkCyan')
    if ($script:Json) { return }
    $p = $script:I - $t.Length - 4
    Write-Host ($script:tl + $script:h + ' ' + $t + ' ' + ($script:h * $p) + [char]0x2510) -ForegroundColor $c
}

function bottom {
    param([string]$c = 'DarkCyan')
    if ($script:Json) { return }
    Write-Host ($script:bl + ($script:h * $script:I) + [char]0x2518) -ForegroundColor $c
}

function split {
    param([string]$c = 'DarkGray')
    if ($script:Json) { return }
    Write-Host ($script:tm + ($script:h * $script:I) + [char]0x2524) -ForegroundColor $c
}

function kv {
    param([string]$k, [string]$v, [string]$c = 'Gray', [int]$w = 12)
    if ($script:Json) { return }
    if ($v.Length -gt $script:I - 2 - $w) { $v = $v.Substring(0, $script:I - 2 - $w) }
    Write-Host ($script:vt + ' ') -NoNewline
    Write-Host $k.PadRight($w) -NoNewline -ForegroundColor DarkGray
    Write-Host $v.PadRight($script:I - 2 - $w) -NoNewline -ForegroundColor $c
    Write-Host (' ' + $script:vt)
}

function row {
    param([string]$t = '', [string]$c = 'Gray')
    if ($script:Json) { return }
    if ($t.Length -gt $script:I - 2) { $t = $t.Substring(0, $script:I - 2) }
    Write-Host ($script:vt + ' ' + $t.PadRight($script:I - 2) + ' ' + $script:vt) -ForegroundColor $c
}

function group {
    param([string]$t, [string]$c = 'Yellow')
    if ($script:Json) { return }
    Write-Host ($script:vt + ' ') -NoNewline
    Write-Host ('  ' + $t.PadRight($script:I - 4)) -NoNewline -ForegroundColor $c
    Write-Host (' ' + $script:vt)
}

function pick {
    param([string]$k, [string]$t, [string]$d)
    if ($script:Json) { return }
    Write-Host ($script:vt + ' ') -NoNewline
    Write-Host ('     ' + $k.PadRight(4)) -NoNewline -ForegroundColor White
    Write-Host $t.PadRight(23) -NoNewline -ForegroundColor Gray
    Write-Host $d.PadRight($script:I - 34) -NoNewline -ForegroundColor DarkGray
    Write-Host (' ' + $script:vt)
}

function rule {
    param([string]$t, [string]$c = 'Cyan')
    if ($script:Json) { return }
    if ($t) {
        $p = $script:I - $t.Length - 5
        Write-Host ''
        Write-Host ($script:hl * 2 + ' ' + $t + ' ' + ($script:h * $p)) -ForegroundColor $c
    }
}

function meter {
    param([string]$label, [int]$cur, [int]$max, [string]$c = 'Green', [int]$w = 18)
    if ($script:Json) { return }
    $f = 0
    if ($max -gt 0) { $f = [math]::Round($cur / $max * $w) }
    if ($f -gt $w) { $f = $w }
    Write-Host '  ' -NoNewline
    Write-Host $label.PadRight(11) -NoNewline -ForegroundColor DarkGray
    Write-Host ($script:full.ToString() * $f) -NoNewline -ForegroundColor $c
    Write-Host ($script:lite.ToString() * ($w - $f)) -NoNewline -ForegroundColor DarkGray
    Write-Host ('  {0}/{1}' -f $cur, $max) -ForegroundColor Gray
}

function prog {
    param([int]$i, [int]$n, [string]$label)
    if ($script:Json) { return }
    $w = 20
    $f = 0
    if ($n -gt 0) { $f = [int]($i / $n * $w) }
    if ($f -gt $w) { $f = $w }
    Write-Host '      ' -NoNewline
    Write-Host ('[' + ($script:full.ToString() * $f) + ($script:lite.ToString() * ($w - $f)) + ']') -NoNewline -ForegroundColor Cyan
    Write-Host ('  ' + ("{0}/{1}" -f $i, $n).PadLeft(5) + '  ') -NoNewline -ForegroundColor DarkGray
    Write-Host $label -ForegroundColor Gray
}

function banner {
    if ($script:Json) { return }
    Clear-Host

    $word  = 'RiFT, AL'
    $cols  = 'Red', 'DarkYellow', 'Green', 'Cyan', 'Gray', 'Magenta'
    $clock = Get-Date -Format 'HH:mm'

    $st = 'no device, adb only'
    $sc = 'Red'
    if ($script:dev) {
        if (alive) { $st = 'device online'; $sc = 'Green' }
        else { $st = 'device not answering'; $sc = 'DarkYellow' }
    }

    Write-Host ''
    Write-Host ([char]0x2554 + ($script:dbl * $script:I) + [char]0x2557) -ForegroundColor DarkCyan
    Write-Host ($script:dvt + '  ') -NoNewline -ForegroundColor Cyan
    for ($i = 0; $i -lt $word.Length; $i++) {
        Write-Host $word[$i] -NoNewline -ForegroundColor $cols[$i % $cols.Count]
    }
    Write-Host (' ' * ($script:I - 18)) -NoNewline
    Write-Host $clock -NoNewline -ForegroundColor DarkGray
    Write-Host (' ' + $script:dvt) -ForegroundColor Cyan

    Write-Host ($script:dvt + '  android booster') -NoNewline -ForegroundColor DarkGray
    Write-Host (' ' * ($script:I - 25)) -NoNewline
    Write-Host ('v' + $script:ver) -NoNewline -ForegroundColor DarkCyan
    Write-Host ('  ' + $script:dvt) -ForegroundColor Cyan

    Write-Host ([char]0x2560 + ($script:dbl * $script:I) + [char]0x2563) -ForegroundColor DarkCyan
    Write-Host ($script:dvt + ' ') -NoNewline
    Write-Host $script:dot -NoNewline -ForegroundColor $sc
    Write-Host (' ' + $st.PadRight($script:I - 4)) -NoNewline -ForegroundColor DarkGray
    Write-Host (' ' + $script:dvt) -ForegroundColor Cyan

    if ($script:root) {
        Write-Host ($script:dvt + ' ') -NoNewline
        Write-Host $script:dot -NoNewline -ForegroundColor Blue
        Write-Host (' root available'.PadRight($script:I - 3)) -NoNewline -ForegroundColor DarkGray
        Write-Host (' ' + $script:dvt) -ForegroundColor Cyan
    }

    Write-Host ([char]0x255A + ($script:dbl * $script:I) + [char]0x255D) -ForegroundColor DarkCyan
}

function done {
    param([string]$t)
    if ($script:Json) { return }
    Write-Host ''
    Write-Host ('  ' + ($script:h * $script:I)) -ForegroundColor DarkCyan
    Write-Host ''
    Write-Host '    ' -NoNewline
    Write-Host ($script:tick + ' done. ') -NoNewline -ForegroundColor Green
    Write-Host $t -ForegroundColor DarkYellow
    meter 'applied' $script:ok ($script:ok + $script:wn + $script:er)
    Write-Host ''
    meter 'skipped' $script:wn ($script:ok + $script:wn + $script:er) 'DarkYellow'
    meter 'failed' $script:er ($script:ok + $script:wn + $script:er) 'Red'
    Write-Host ''
    Write-Host ('  ' + ($script:h * $script:I)) -ForegroundColor DarkCyan
}

function pause {
    if ($script:Json) { return }
    Write-Host ''
    Read-Host '   press enter to go back' | Out-Null
}

# â”€â”€ adb â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function findAdb {
    $local = Join-Path $script:pt 'adb.exe'
    if (Test-Path $local) { return $local }

    $c = Get-Command adb.exe
    if ($c -and $c.Source) { return $c.Source }

    $pf86 = ${env:ProgramFiles(x86)}
    $list = @(
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
        "$env:ProgramFiles\Android\platform-tools\adb.exe"
        "$pf86\Android\platform-tools\adb.exe"
        'C:\Android\platform-tools\adb.exe'
        'D:\Android\platform-tools\adb.exe'
        'C:\platform-tools\adb.exe'
        'D:\platform-tools\adb.exe'
        'C:\Program Files\TxGameAssistant\ui\adb.exe'
        'D:\Program Files\TxGameAssistant\ui\adb.exe'
        'C:\TxGameAssistant\ui\adb.exe'
        'D:\TxGameAssistant\ui\adb.exe'
        'C:\Program Files\BlueStacks_nxt\adb.exe'
        'C:\Program Files\BlueStacks\adb.exe'
        "$pf86\BlueStacks\adb.exe"
        'C:\Program Files\Netease\MuMu Player 12\shell\adb.exe'
        'C:\Program Files\Netease\MuMuPlayer-12.0\shell\adb.exe'
        'C:\LDPlayer\ldplayer\adb.exe'
        'D:\LDPlayer\ldplayer\adb.exe'
        'C:\Program Files\Nox\bin\adb.exe'
        "$pf86\Nox\bin\adb.exe"
    )

    foreach ($p in $list) {
        if (Test-Path $p) {
            try {
                $v = & $p version 2>&1
                if (($v -join ' ') -match 'Android Debug Bridge') { return $p }
            } catch {}
        }
    }
    return $null
}

function grabAdb {
    $zip = Join-Path $script:tmp 'pt.zip'
    $url = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
    log 'pulling platform-tools from google' 'WARN'
    try {
        Invoke-WebRequest $url -OutFile $zip -UseBasicParsing -TimeoutSec 120
        Expand-Archive $zip $script:tmp -Force
        $src = Join-Path $script:tmp 'platform-tools'
        if (Test-Path $src) {
            Copy-Item "$src\*" $script:pt -Recurse -Force
            log 'platform-tools is in place' 'OK'
            return $true
        }
    } catch {
        log ("download failed: {0}" -f $_.Exception.Message) 'WARN'
    }
    return $false
}

function sh {
    param([string]$c, [switch]$q)
    if (-not $script:adb -or -not $script:dev) { return $null }
    try {
        $o = & $script:adb -s $script:dev shell $c 2>&1
        if (-not $q) { log $c 'DBG' }
        if ($null -eq $o) { return $null }
        return [string]::Join("`n", @($o))
    } catch {
        if (-not $q) { log ("shell failed: {0}" -f $_.Exception.Message) 'ERR' }
        return $null
    }
}

function shQuote {
    # POSIX-safe: close the quote, emit an escaped quote, reopen it
    param([string]$c)
    return ($c -replace "'", "'\''")
}

function wrapCmd {
    param([string]$wrap, [string]$c)
    if (-not $wrap) { return $c }
    return ($wrap -replace '\{0\}', (shQuote $c))
}

function rsh {
    param([string]$c, [switch]$q)
    if (-not $script:root) { return $null }
    $w = rootWrap $script:rootMethod
    if (-not $w) { return sh $c -q:$q }
    return sh (wrapCmd $w $c) -q:$q
}

function alive {
    if (-not $script:adb -or -not $script:dev) { return $false }
    return (([string](sh 'echo ok' -q)).Trim() -eq 'ok')
}

function devices {
    $o = @(& $script:adb devices 2>&1)
    $d = foreach ($x in $o) {
        $x = ([string]$x).Trim()
        if ($x -match '^(\S+)\s+device$') { $Matches[1] }
    }
    # the comma stops powershell unrolling the array, which would turn a single
    # device into a bare string and make $d[0] return its first character
    return , @($d | Sort-Object -Unique)
}

function selectTarget {
    # returns the one serial we are willing to drive, or null. it never falls
    # back to another device because a wrong pick is worse than no pick.
    & $script:adb start-server 2>&1 | Out-Null
    $d = devices
    foreach ($a in $script:accepted) { if ($d -contains $a) { return $a } }

    foreach ($p in $script:ports) { & $script:adb connect "127.0.0.1:$p" 2>&1 | Out-Null }
    $d = devices
    foreach ($a in $script:accepted) { if ($d -contains $a) { return $a } }
    return $null
}

function pickDev {
    $script:dev = selectTarget

    if ($script:dev) {
        log ("using {0}" -f $script:dev) 'OK'
        return
    }

    # more than one emu on the accepted list means picking would be a coin flip
    $seen = @((devices) | Where-Object { $script:accepted -contains $_ })
    if ($seen.Count -gt 1) {
        log ("{0} emulators are online ({1}). not guessing - close the one you do not want" -f $seen.Count, ($seen -join ', ')) 'ERR'
        $script:dev = $null
        return
    }

    log ("no {0} found. open the emulator and turn on adb debugging" -f ($script:accepted -join ' / ')) 'WARN'
    $script:dev = $null
}

function proveRoot {
    param([string]$wrap)
    if (-not $wrap) { return ([string](sh 'id -u' -q)).Trim() }
    return ([string](sh (wrapCmd $wrap 'id -u') -q)).Trim()
}

function runRoot {
    param([string]$wrap, [string]$c)
    if (-not $wrap) { return [string](sh $c -q) }
    return [string](sh (wrapCmd $wrap $c) -q)
}

function rootWrap {
    param([string]$method)
    switch ($method) {
        'uid0'          { return '' }
        'su -c'         { return "su -c '{0}'" }
        'su 0'          { return "su 0 -c '{0}'" }
        'ksud'          { return "ksud -c '{0}'" }
        'apd'           { return "apd -c '{0}'" }
        'magisk su'     { return "magisk su -c '{0}'" }
        'sudo -n'       { return "sudo -n sh -c '{0}'" }
        'debug ramdisk' { return "sh -c '{0}'" }
        'run-as debug'  { return "run-as com.android.shell sh -c '{0}'" }
        default         { return "su -c '{0}'" }
    }
}

function checkRoot {
    $script:root = $false
    $script:uid0 = $false
    $script:rootMethod = ''
    $script:rootManager = ''
    $script:rootProbe = ''

    if (-not $script:dev) { log 'no device attached, root unknown' 'WARN'; return }

    $sel = ([string](sh 'getenforce' -q)).Trim()
    if ($sel) { $script:selinux = $sel }

    foreach ($d in @('/data/adb/magisk', '/data/adb/ksu', '/data/adb/apatch')) {
        if ((([string](sh "[ -d '$d' ] && echo 1 || echo 0" -q)).Trim()) -eq '1') {
            if ($d -match 'magisk') { $script:rootManager = 'Magisk' }
            elseif ($d -match 'ksu') { $script:rootManager = 'KernelSU' }
            else { $script:rootManager = 'APatch' }
        }
    }
    if (-not $script:rootManager -and ([string](sh 'magisk -v' -q)).Trim()) { $script:rootManager = 'Magisk' }

    $methods = @('uid0', 'su -c', 'su 0', 'ksud', 'apd', 'magisk su', 'sudo -n', 'debug ramdisk')
    $denied = $false

    foreach ($m in $methods) {
        $r = proveRoot (rootWrap $m)
        $clean = (([string]$r) -replace '\s+', ' ').Trim()
        $first = ''
        if ($clean) { $first = ($clean -split ' ')[0] }

        $isRoot = ($first -eq '0') -or ($clean -match '^uid=0\(') -or ($clean -match '^uid=0\s')
        if ($isRoot) {
            $script:root = $true
            $script:rootMethod = $m
            $script:rootProbe = $r.Trim()
            if ($m -eq 'uid0') { $script:uid0 = $true }
            log ("root granted via {0} (id -u returned '{1}')" -f $m, $r.Trim()) 'OK'
            break
        }
        if ($m -match '^su|^magisk' -and $r) { $denied = $true }
    }

    if ($script:root) {
        $conf = runRoot (rootWrap $script:rootMethod) 'id'
        if ($conf) { $script:rootProbe = $conf.Trim() }
        log ("root method {0}, selinux {1}, manager {2}" -f $script:rootMethod, ($script:selinux -replace '^$', 'unknown'), ($script:rootManager -replace '^$', 'unknown')) 'DBG'
        return
    }

    $bins = @()
    foreach ($b in @('/system/xbin/su', '/system/bin/su', '/sbin/su', '/sbin/.magisk', '/vendor/bin/su', '/debug_ramdisk/su', '/debug_ramdisk/.magisk')) {
        if ((([string](sh "[ -e '$b' ] && echo 1 || echo 0" -q)).Trim()) -eq '1') { $bins += $b }
    }

    $dbg = ([string](sh 'getprop ro.debuggable' -q)).Trim()
    $build = ([string](sh 'getprop ro.build.type' -q)).Trim()

    if ($denied) {
        log ('root binary present but every su call was refused: ' + ($bins -join ', ')) 'WARN'
        log 'open your root manager and grant this app, then run again' 'WARN'
    }
    elseif ($bins.Count) {
        log ('su binaries found but none executed as root: ' + ($bins -join ', ')) 'WARN'
    }
    else {
        log ('no root. ro.debuggable={0} ro.build.type={1} selinux={2}' -f $dbg, $build, $sel) 'DBG'
    }

    if ($script:rootManager) { log ("{0} is installed but this app has not been granted root yet" -f $script:rootManager) 'WARN' }
    log 'no root, skipping kernel and privileged tuning' 'WARN'
}

function checkLoop {
    $script:loop = $false
    foreach ($n in $script:emu) {
        if (Get-Process -Name $n -ErrorAction SilentlyContinue) { $script:loop = $true }
    }
    if ($script:dev) {
        $s = @(
            (sh 'getprop ro.product.brand' -q)
            (sh 'getprop ro.product.manufacturer' -q)
            (sh 'getprop ro.product.model' -q)
        ) -join ' '
        if ($s -match 'tencent|gameloop|txgame|gamehub') { $script:loop = $true }
    }
}

function readDevice {
    $script:brand = ([string](sh 'getprop ro.product.brand' -q)).Trim()
    $script:model = ([string](sh 'getprop ro.product.model' -q)).Trim()
    $script:andro = ([string](sh 'getprop ro.build.version.release' -q)).Trim()
}

function pushStatus {
    $online = $false
    if ($script:dev) { $online = alive }
    emit @{
        e      = 'status'
        device = if ($script:dev) { $script:dev } else { $null }
        brand  = $script:brand
        model  = $script:model
        android = $script:andro
root   = [bool]$script:root
        rootMethod  = $script:rootMethod
        rootManager = $script:rootManager
        selinux     = $script:selinux
        congestion  = $(if ($script:dev -and $script:root) { kget '/proc/sys/net/ipv4/tcp_congestion_control' } else { $null })
        loop   = [bool]$script:loop
        online = [bool]$online
        adb    = $(if ($script:adb) { Split-Path $script:adb -Leaf } else { $null })
        fpsMin = $script:fmin
        fpsMax = $script:fmax
        fpsPeak = $script:fpeak
        version = $script:ver
    }
}

# â”€â”€ settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function keep {
    param([string]$scope, [string]$k)
    if ($script:bu | Where-Object { $_.s -eq $scope -and $_.k -eq $k }) { return }
    $v = [string](sh "settings get $scope $k" -q)
    if ($null -eq $v) { return }
    $script:bu += @{ s = $scope; k = $k; v = $v.Trim() }
}

function put {
    param([string]$scope, [string]$k, [string]$v)
    keep $scope $k
    if (-not $script:dev) {
        log ("no device, skipped {0} {1}" -f $scope, $k) 'WARN'
        return
    }
    sh "settings put $scope $k $v" -q | Out-Null
    $now = ([string](sh "settings get $scope $k" -q)).Trim()
    if ($now -eq $v.Trim()) { log ("{0} {1} = {2}" -f $scope, $k, $v) 'OK' }
    else { log ("{0} {1} stayed at {2}" -f $scope, $k, $now) 'WARN' }
}

function putAll {
    param([string]$k, [string]$v)
    if (-not $script:dev) { log ("no device, skipped {0}" -f $k) 'WARN'; return }
    keep 'global' $k
    keep 'system' $k
    keep 'secure' $k
    sh "settings put global $k $v" -q | Out-Null
    sh "settings put system $k $v" -q | Out-Null
    sh "settings put secure $k $v" -q | Out-Null
    log ("everywhere {0} = {1}" -f $k, $v) 'OK'
}

function saveBk {
    if (-not $script:bu.Count) { return }
    $script:bu | ConvertTo-Json -Depth 4 | Out-File $script:bakFile -Encoding UTF8
    log ("settings saved, {0} entries" -f $script:bu.Count) 'OK'
}

function windowsKeys {
    @(
        @{ name = 'GameBar';          path = 'HKCU:\Software\Microsoft\GameBar' }
        @{ name = 'GameConfigStore';  path = 'HKCU:\System\GameConfigStore' }
        @{ name = 'UserGpuPrefs';     path = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences' }
        @{ name = 'SystemRestore';    path = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore' }
        @{ name = 'PowerThrottling'; path = 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\PowerThrottling' }
        @{ name = 'GraphicsDrivers'; path = 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' }
        @{ name = 'Multimedia';      path = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile' }
        @{ name = 'Tcpip';           path = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' }
        @{ name = 'Ifeo';            path = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options' }
@{ name = 'Desktop';         path = 'HKCU:\Control Panel\Desktop' }
        @{ name = 'VisualEffects';   path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' }
        @{ name = 'Dwm';             path = 'HKLM:\SOFTWARE\Microsoft\Windows\Dwm' }
        @{ name = 'ExplorerAdvanced'; path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' }
        @{ name = 'ExplorerSerialize'; path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize' }
        @{ name = 'Mouse';           path = 'HKCU:\Control Panel\Mouse' }
        @{ name = 'Keyboard';        path = 'HKCU:\Control Panel\Keyboard' }
        @{ name = 'StickyKeys';      path = 'HKCU:\Control Panel\Accessibility\StickyKeys' }
        @{ name = 'Personalize';     path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' }
        @{ name = 'WindowMetrics';   path = 'HKCU:\Control Panel\Desktop\WindowMetrics' }
        @{ name = 'GameDVR';         path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' }
        @{ name = 'GameDVRPolicy';   path = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' }
        @{ name = 'MemoryMgmt';      path = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management' }
        @{ name = 'PriorityControl'; path = 'HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl' }
        @{ name = 'UsbSvc';          path = 'HKLM:\SYSTEM\CurrentControlSet\Services\USB' }
        @{ name = 'MouClass';        path = 'HKLM:\SYSTEM\CurrentControlSet\Services\mouclass\Parameters' }
        @{ name = 'KbdClass';        path = 'HKLM:\SYSTEM\CurrentControlSet\Services\kbdclass\Parameters' }
        @{ name = 'DnsCache';        path = 'HKLM:\SYSTEM\CurrentControlSet\Services\Dnscache\Parameters' }
        @{ name = 'Psched';          path = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Psched' }
        @{ name = 'DataCollection';  path = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection' }
        @{ name = 'SessionManager';  path = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' }
        @{ name = 'PowerControl';    path = 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' }
    )
}

function snapshotRegistry {
    $out = @{}

    foreach ($key in (windowsKeys)) {
        $entry = @{ exists = $false; present = $false; values = @{} }
        try {
            if (Test-Path $key.path) {
                $entry.exists = $true
                $props = Get-ItemProperty -LiteralPath $key.path -ErrorAction SilentlyContinue
                if ($props) {
                    foreach ($p in $props.PSObject.Properties) {
                        if ($p.Name -like 'PS*') { continue }
                        $entry.values[$p.Name] = [string]$p.Value
                        $entry.present = $true
                    }
                }
            }
        } catch {}
$out[$key.name] = $entry
    }

    $ifeo = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options'
    if (Test-Path $ifeo) {
        $subs = @()
        foreach ($s in @(Get-ChildItem -LiteralPath $ifeo -ErrorAction SilentlyContinue)) {
            $entry = @{ values = @{} }
            $p = Get-ItemProperty -LiteralPath $s.PSPath -ErrorAction SilentlyContinue
            if ($p) {
                foreach ($prop in $p.PSObject.Properties) {
                    if ($prop.Name -like 'PS*') { continue }
                    $entry.values[$prop.Name] = [string]$prop.Value
                }
            }
            $subs += ,([ordered]@{ name = $s.PSChildName; values = $entry.values })
        }
        $out['IfeoSubkeys'] = [ordered]@{ exists = $true; subkeys = $subs }
    }
    else {
        $out['IfeoSubkeys'] = [ordered]@{ exists = $false; subkeys = @() }
    }

    $mmBase = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks'
    $mmSubs = @()
    foreach ($tname in @('Games', 'Audio', 'DisplayPostProcessing')) {
        $tpath = Join-Path $mmBase $tname
        if (-not (Test-Path $tpath)) {
            $mmSubs += ,([ordered]@{ name = $tname; exists = $false; values = @{} })
            continue
        }
        $entry = @{}
        $p = Get-ItemProperty -LiteralPath $tpath -ErrorAction SilentlyContinue
        if ($p) {
            foreach ($prop in $p.PSObject.Properties) {
                if ($prop.Name -like 'PS*') { continue }
                $entry[$prop.Name] = [string]$prop.Value
            }
        }
        $mmSubs += ,([ordered]@{ name = $tname; exists = $true; values = $entry })
    }
    $out['MmcssTasks'] = [ordered]@{ exists = $true; subkeys = $mmSubs }

    return $out
}

function snapshotPower {
    $plans = @()
    try {
        $raw = powercfg /list
        foreach ($line in @($raw)) {
            $text = [string]$line
            if ($text -notmatch '([0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})') { continue }
            $active = $text -match '\*'
            $plans += [ordered]@{
                guid    = $Matches[1]
                name    = (($text -replace '^[^)]*\)', '') -replace '\s+', ' ').Trim()
                active  = $active
            }
        }
    } catch {}
    return $plans
}

function snapshotBcd {
    $out = [ordered]@{}
    $exe = Get-Command bcdedit.exe -EA 0
    if (-not $exe) { return $out }
    foreach ($n in @('disabledynamictick', 'useplatformclock', 'useplatformtimer', 'disabledynamictick')) {
        try {
            $raw = & bcdedit.exe /enum '{current}' 2>&1
            $hit = @($raw | Select-String ([regex]::Escape($n)))
            if ($hit.Count) {
                $line = [string]$hit[0]
                $val = ($line -replace "^\s*$n\s+", '').Trim()
                $out[$n] = if ($val) { $val } else { 'present' }
            }
        }
        catch {}
    }
    return $out
}

function snapshotFsutil {
    $out = [ordered]@{}
    foreach ($b in @('disablelastaccess', 'disable8dot3')) {
        try {
            $raw = fsutil behavior query $b 2>&1
            $m = @($raw | Select-String '\d+')
            if ($m.Count) { $out[$b] = ([regex]::Match([string]$m[0], '\d+')).Value }
        }
        catch {}
    }
    return $out
}

function snapshotPowerValues {
    # powercfg prints a subgroup header, then each setting guid, then the AC and
    # DC indices underneath it, so this has to walk the output rather than match
    # a single line
    $out = New-Object System.Collections.ArrayList

    foreach ($g in @('SUB_PROCESSOR', 'SUB_DISK', 'SUB_SLEEP', 'SUB_VIDEO')) {
        $lines = @(powercfg /query SCHEME_CURRENT $g 2>&1 | ForEach-Object { [string]$_ })
        $sub = $g
        $setGuid = $null
        $setName = $null
        $ac = $null
        $dc = $null

        foreach ($t in $lines) {
            if ($t -match 'GUID Alias:\s*(SUB_[A-Za-z]+)') { $sub = $Matches[1]; continue }
            if ($t -match 'Power Setting GUID:\s*([0-9a-fA-F-]{36})\s*\(([^)]*)\)') {
                if ($setGuid -and ($ac -or $dc)) {
                    [void]$out.Add([ordered]@{ group = $sub; guid = $setGuid; name = $setName; ac = $ac; dc = $dc })
                }
                $setGuid = $Matches[1]
                $setName = $Matches[2]
                $ac = $null
                $dc = $null
                continue
            }
            if ($t -match 'Current AC Power Setting Index:\s*(0x[0-9a-fA-F]+)') { $ac = $Matches[1]; continue }
            if ($t -match 'Current DC Power Setting Index:\s*(0x[0-9a-fA-F]+)') { $dc = $Matches[1]; continue }
        }

        if ($setGuid -and ($ac -or $dc)) {
            [void]$out.Add([ordered]@{ group = $sub; guid = $setGuid; name = $setName; ac = $ac; dc = $dc })
        }
    }

    return @($out)
}

function snapshotAndroid {
    $keys = @(
        'window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'
        'min_refresh_rate', 'peak_refresh_rate', 'fps_max'
        'sustained_performance_mode', 'low_power', 'dynamic_power_savings_enabled'
        'always_finish_activities', 'fstrim_enable', 'thermal_engine_enable'
        'performance_mode', 'hwui_disable_vsync', 'force_gpu_rendering'
        'game_driver_all_apps', 'game_driver_all_apps_non_system', 'game_dynamic_boost'
        'tcp_default_init_rwnd', 'wifi_scan_always_enabled', 'ble_scan_always_enabled'
        'private_dns_mode', 'private_dns_specifier', 'captive_portal_mode'
        'pointer_speed', 'touch_boost', 'input_boost_duration', 'stay_on_while_plugged_in'
        'restrict_background_data', 'heads_up_notifications_enabled'
    )

    $snap = @{ settings = @(); props = @() }

    if ($script:dev) {
        foreach ($k in $keys) {
            foreach ($scope in @('global', 'system', 'secure')) {
                $v = [string](sh "settings get $scope $k" -q)
                if ($null -eq $v) { continue }
                $snap.settings += [ordered]@{ scope = $scope; key = $k; value = $v.Trim() }
            }
        }

        $props = @(
            'debug.hwui.disable_vsync', 'debug.hwui.render_dirty_regions', 'debug.hwui.profile'
            'debug.gr.swapinterval', 'debug.composition.type', 'debug.sf.hw', 'debug.egl.hw'
            'debug.sf.latch_unsignaled', 'windowsmgr.max_events_per_sec', 'view.touch_slop'
            'view.scroll_friction', 'dalvik.vm.dex2oat-filter', 'dalvik.vm.image-dex2oat-filter'
            'dalvik.vm.heapstartsize', 'dalvik.vm.heapgrowthlimit', 'dalvik.vm.heapsize'
'dalvik.vm.heaptargetutilization', 'dalvik.vm.heapminfree', 'dalvik.vm.heapmaxfree'
            'qemu.mouse.smooth', 'qemu.mouse.acceleration'
            'qemu.touch.smoothing', 'qemu.touch.sampling_rate'
            'qemu.input.raw_mouse', 'qemu.input.raw_keyboard'
            'qemu.keyboard.repeat.delay', 'qemu.keyboard.repeat.interval'
            'debug.sf.disable_vsync', 'debug.hwui.fps_divisor', 'windowsmgr.force_fps'
        )
        foreach ($p in $props) {
            $v = [string](sh "getprop $p" -q)
            if ($null -eq $v) { continue }
            $snap.props += [ordered]@{ name = $p; value = $v.Trim() }
        }
    }

    return $snap
}

function newRestorePoint {
    $name = "RIFT $(Get-Date -Format 'yyyy-MM-dd HH:mm')"

    try { Enable-ComputerRestore -Drive 'C:\' -ErrorAction SilentlyContinue } catch {}

    $reported = $false
    $verified = $false
    $blocked = $null
    $seq = $null

    try {
        $before = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue)

        try {
            Checkpoint-Computer -Description $name -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop
            $reported = $true
        }
        catch {
            $blocked = $_.Exception.Message
        }

        Start-Sleep -Milliseconds 400
        $after = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue)

        $mine = @($after | Where-Object { $_.Description -like 'RIFT*' } | Sort-Object SequenceNumber -Descending)
        if ($mine.Count -gt (@($before | Where-Object { $_.Description -like 'RIFT*' }).Count)) {
            $verified = $true
            $seq = $mine[0].SequenceNumber
        }
    }
    catch {}

    return [ordered]@{
        description = $name
        reported    = $reported
        verified    = $verified
        sequence    = $seq
        blocked     = $blocked
    }
}

function newSafetySnapshot {
    emit @{ e = 'stage'; m = 'safety snapshot' }
    rule 'safety snapshot'

    $dir = Join-Path $script:data 'snapshots'
    if (-not (Test-Path $dir)) { New-Item $dir -ItemType Directory -Force | Out-Null }

    $bundle = [ordered]@{
        createdAt = (Get-Date -Format 'o')
        machine   = [ordered]@{
            name  = $env:COMPUTERNAME
            user  = $env:USERNAME
        }
        elevated  = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        device    = $script:dev
        root      = [bool]$script:root
registry  = (snapshotRegistry)
        power     = (snapshotPower)
        powerVals = (snapshotPowerValues)
        bcd       = (snapshotBcd)
        fsutil    = (snapshotFsutil)
        android   = (snapshotAndroid)
        restore   = $null
    }

    if ($bundle.elevated) {
        log 'elevated: attempting a system restore point' 'DBG'
        $bundle.restore = newRestorePoint
    }
    else {
        log 'not elevated, skipping the system restore point' 'WARN'
        $bundle.restore = [ordered]@{ description = ''; reported = $false; verified = $false; blocked = 'not elevated' }
    }

    if ($bundle.restore.verified) {
        log ("system restore point #{0} verified: {1}" -f $bundle.restore.sequence, $bundle.restore.description) 'OK'
    }
    elseif ($bundle.restore.reported) {
        log 'restore point command reported success but no new point exists' 'WARN'
    }
    elseif ($bundle.restore.blocked -match '1440|already been created') {
        log 'windows throttled the restore point (one per 24h). your snapshot below is the real rollback.' 'WARN'
    }
    elseif ($bundle.restore.blocked) {
        log ("restore point blocked: {0}" -f $bundle.restore.blocked) 'WARN'
    }

$file = Join-Path $dir ("snapshot_{0}.json" -f $script:stamp)
    try {
        ($bundle | ConvertTo-Json -Depth 8) | Out-File -LiteralPath $file -Encoding UTF8

        $regCount = @($bundle.registry.PSObject.Properties | ForEach-Object { $_.Value.values.PSObject.Properties }).Count
        $andCount = @($bundle.android.settings).Count + @($bundle.android.props).Count
        log ("snapshot captured: {0} registry values, {1} power plans, {2} device values" -f $regCount, @($bundle.power).Count, $andCount) 'OK'
        log (Split-Path $file -Leaf) 'DBG'

        $baseline = Join-Path $script:data 'baseline.json'
        if (-not (Test-Path $baseline)) {
            ($bundle | ConvertTo-Json -Depth 8) | Out-File -LiteralPath $baseline -Encoding UTF8
            log 'first run: pristine baseline recorded for full rollback' 'OK'
        }
    }
catch {
        log ("snapshot write failed: {0}" -f $_.Exception.Message) 'ERR'
        throw 'safety snapshot could not be written, refusing to change anything'
    }

    emit @{ e = 'snapshot'; file = $file; restoreVerified = [bool]$bundle.restore.verified; elevated = [bool]$bundle.elevated }
    return $file
}

function undoWindows {
    $dir = Join-Path $script:data 'snapshots'
    $baseline = Join-Path $script:data 'baseline.json'

    $source = $null
    if (Test-Path $baseline) { $source = $baseline }
    else {
        $files = @(Get-ChildItem $dir -Filter 'snapshot_*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
        if (-not $files.Count) { log 'no baseline or snapshot on disk to roll back' 'WARN'; return }
        $source = $files[0].FullName
    }

    $snap = Get-Content -Raw $source | ConvertFrom-Json
    if ($source -eq $baseline) { log 'rolling back to the pristine first-run baseline' 'OK' }
    else { log 'no baseline found, rolling back to the most recent snapshot' 'WARN' }
    $restored = 0

foreach ($key in (windowsKeys)) {
        $saved = $snap.registry.$($key.name)
        if (-not $saved) { continue }

        try {
            $now = $null
            if (Test-Path $key.path) {
                $now = Get-ItemProperty -LiteralPath $key.path -ErrorAction SilentlyContinue
            }

            if ($saved.present) {
                if (-not (Test-Path $key.path)) { New-Item $key.path -Force | Out-Null }
                foreach ($p in $saved.values.PSObject.Properties) {
                    $current = $null
                    if ($now -and $now.PSObject.Properties.Name -contains $p.Name) { $current = $now.$($p.Name) }
                    if ("$current" -ne "$($p.Value)") {
                        Set-ItemProperty -LiteralPath $key.path -Name $p.Name -Value $p.Value -Force
                        $restored++
                    }
                }
                log ("registry restored: {0}" -f $key.path) 'OK'
            }

            if ($now) {
                $expected = @()
                if ($saved.present -and $saved.values) { $expected = @($saved.values.PSObject.Properties.Name) }

                foreach ($p in $now.PSObject.Properties) {
                    if ($p.Name -like 'PS*') { continue }
                    if ($expected -notcontains $p.Name) {
                        Remove-ItemProperty -LiteralPath $key.path -Name $p.Name -Force -ErrorAction SilentlyContinue
                        log ("removed value we had added: {0}\{1}" -f $key.name, $p.Name) 'OK'
                        $restored++
                    }
                }
            }
        }
        catch {
            log ("could not restore {0}: {1}" -f $key.path, $_.Exception.Message) 'WARN'
        }
    }

$active = @($snap.power | Where-Object { $_.active }) | Select-Object -First 1
    if ($active) {
        powercfg /setactive $active.guid | Out-Null
        log ("power plan restored: {0}" -f $active.name) 'OK'
    }

    if ($snap.powerVals) {
        foreach ($v in @($snap.powerVals)) {
            try {
                if ($v.ac) { powercfg /setacvalueindex SCHEME_CURRENT $v.group $v.guid $v.ac 2>&1 | Out-Null }
                if ($v.dc) { powercfg /setdcvalueindex SCHEME_CURRENT $v.group $v.guid $v.dc 2>&1 | Out-Null }
                $restored++
            }
            catch { }
        }
        try { powercfg /setactive SCHEME_CURRENT 2>&1 | Out-Null } catch {}
        log ("power values restored ({0})" -f @($snap.powerVals).Count) 'OK'
    }

    if ($snap.bcd -and $snap.bcd.PSObject.Properties.Count) {
        foreach ($p in $snap.bcd.PSObject.Properties) {
            try {
                if ($p.Value -eq 'present' -or [string]::IsNullOrWhiteSpace([string]$p.Value)) {
                    & bcdedit.exe /deletevalue '{current}' $p.Name 2>&1 | Out-Null
                    log ("bcd value removed: {0}" -f $p.Name) 'OK'
                }
                else {
                    & bcdedit.exe /set '{current}' $p.Name ([string]$p.Value) 2>&1 | Out-Null
                    log ("bcd value restored: {0}={1}" -f $p.Name, $p.Value) 'OK'
                }
                $restored++
            }
            catch { log ("could not restore bcd {0}" -f $p.Name) 'WARN' }
        }
    }

    if ($snap.fsutil -and $snap.fsutil.PSObject.Properties.Count) {
        foreach ($p in $snap.fsutil.PSObject.Properties) {
            try {
                fsutil behavior set $p.Name ([string]$p.Value) 2>&1 | Out-Null
                log ("fsutil restored: {0}={1}" -f $p.Name, $p.Value) 'OK'
                $restored++
            }
            catch { log ("could not restore fsutil {0}" -f $p.Name) 'WARN' }
        }
    }

    $ifeoBase = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options'
    $savedSubs = @()
    if ($snap.registry.PSObject.Properties.Name -contains 'IfeoSubkeys') {
        $savedSubs = @($snap.registry.IfeoSubkeys.subkeys | ForEach-Object { $_.name })
    }

    if (Test-Path $ifeoBase) {
        foreach ($s in @(Get-ChildItem -LiteralPath $ifeoBase -ErrorAction SilentlyContinue)) {
            if ($savedSubs -contains $s.PSChildName) { continue }
            try {
                Remove-Item -LiteralPath $s.PSPath -Recurse -Force -ErrorAction Stop
                log ("removed ifeo subkey we had added: {0}" -f $s.PSChildName) 'OK'
                $restored++
            }
            catch {
                log ("could not remove ifeo subkey {0}: {1}" -f $s.PSChildName, $_.Exception.Message) 'WARN'
            }
        }
    }

    $mmBase = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks'
    $mmSaved = @()
    if ($snap.registry.PSObject.Properties.Name -contains 'MmcssTasks') {
        foreach ($t in @($snap.registry.MmcssTasks.subkeys)) {
            if ($t.exists) {
                $mmSaved += $t.name
                $tpath = Join-Path $mmBase $t.name
                try {
                    if (-not (Test-Path $tpath)) { New-Item $tpath -Force -Out-Null | Out-Null }
                    foreach ($n in $t.values.PSObject.Properties.Name) {
                        $cur = $null
                        if (Test-Path $tpath) {
                            $now = Get-ItemProperty -LiteralPath $tpath -Name $n -ErrorAction SilentlyContinue
                            if ($now) { $cur = $now.$n }
                        }
                        if ("$cur" -ne "$($t.values.$n)") {
                            Set-ItemProperty -LiteralPath $tpath -Name $n -Value $t.values.$n -Force
                            log ("mmcss {0}: {1} restored" -f $t.name, $n) 'OK'
                            $restored++
                        }
                    }
                }
                catch { log ("could not restore mmcss task {0}: {1}" -f $t.name, $_.Exception.Message) 'WARN' }
            }
        }
    }
    if (Test-Path $mmBase) {
        foreach ($tname in @('Games', 'Audio', 'DisplayPostProcessing')) {
            if ($mmSaved -contains $tname) { continue }
            $tpath = Join-Path $mmBase $tname
            if (-not (Test-Path $tpath)) { continue }
            try {
                Remove-Item -LiteralPath $tpath -Recurse -Force -ErrorAction Stop
                log ("removed mmcss task we had created: {0}" -f $tname) 'OK'
                $restored++
            }
            catch { log ("could not remove mmcss task {0}: {1}" -f $tname, $_.Exception.Message) 'WARN' }
        }
    }

    if ($snap.device -and $snap.device -ne $script:dev) {
        log ("snapshot came from {0}, current device is {1}" -f $snap.device, $script:dev) 'WARN'
    }

    if ($snap.android -and $snap.android.settings -and $script:dev) {
        foreach ($s in $snap.android.settings) {
            if ([string]::IsNullOrEmpty($s.value) -or $s.value -eq 'null') {
                sh "settings delete $($s.scope) $($s.key)" -q | Out-Null
            }
            else {
                sh "settings put $($s.scope) $($s.key) $($s.value)" -q | Out-Null
            }
            $restored++
        }
log ('android settings restored: {0}' -f @($snap.android.settings).Count) 'OK'
    }

    if ($snap.android -and $snap.android.props -and $snap.android.props.Count -and $script:dev) {
        foreach ($p in $snap.android.props) {
            if ([string]::IsNullOrEmpty($p.value) -or $p.value -eq 'null') {
                sh "setprop $($p.name) ''" -q | Out-Null
            }
            else {
                sh "setprop $($p.name) $($p.value)" -q | Out-Null
            }
            $restored++
        }
        log ('android properties restored: {0}' -f @($snap.android.props).Count) 'OK'
    }
    elseif ($snap.android -and -not $script:dev) {
        log 'android values left alone, no device attached' 'WARN'
    }

    if ($script:kernelSnap -and $script:kernelSnap.Count) {
        undoKernel
    }
    else {
        log 'kernel: nothing recorded in this session to restore' 'DBG'
    }

    log ("rollback complete, {0} values restored from {1}" -f $restored, (Split-Path $source -Leaf)) 'OK'
    verifyRestored $snap
}

function undo {
    $f = @(Get-ChildItem $script:bak -Filter 'settings_*.json' | Sort-Object LastWriteTime -Descending)
    if (-not $f.Count) { log 'no backup to roll back' 'WARN'; return }

    $j = Get-Content $f[0].FullName -Raw | ConvertFrom-Json
    $n = 0
    foreach ($e in $j) {
        if ([string]::IsNullOrEmpty($e.v) -or $e.v -eq 'null') {
            sh "settings delete $($e.s) $($e.k)" -q | Out-Null
        }
        else {
            sh "settings put $($e.s) $($e.k) $($e.v)" -q | Out-Null
        }
        $n++
    }
    log ("rolled back {0} settings from {1}" -f $n, $f[0].Name) 'OK'
}

# â”€â”€ android modules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function doAnim {
    rule 'animations'
    emit @{ e = 'stage'; m = 'animations' }
    put global window_animation_scale 0
    put global transition_animation_scale 0
    put global animator_duration_scale 0
}

function guestRefreshHz {
    # ask the guest what its display actually is, instead of assuming a number.
    # a floor above the real rate makes the compositor hunt between targets and
    # that reads to the player as unsmoothness.
    if ((capGet 'refreshHz')) { return [int](capGet 'refreshHz') }

    $hz = 0
    $disp = [string](sh "dumpsys display 2>/dev/null" -q)
    if ($disp -match 'fps\s*=\s*([0-9]+\.?[0-9]*)') { $hz = [int][math]::Floor([double]$Matches[1]) }

    if (-not $hz) {
        $sf = [string](sh "dumpsys SurfaceFlinger 2>/dev/null" -q)
        if ($sf -match 'refresh-rate\s*:\s*([0-9]+\.?[0-9]*)') { $hz = [int][math]::Floor([double]$Matches[1]) }
    }

    if ($hz -gt 0) { capSet 'refreshHz' $hz }
    return $hz
}

function doFps {
    rule 'refresh rate'
    emit @{ e = 'stage'; m = 'refresh rate' }

    $hz = guestRefreshHz
    if ($hz -gt 0) {
        # pin the guest to its own mode so the compositor stops switching
        putAll 'min_refresh_rate'  "$hz"
        putAll 'peak_refresh_rate' "$hz"
        putAll 'fps_max'           "$hz"
        sh "setprop windowsmgr.force_fps $hz" -q | Out-Null
        log ("guest display is {0}Hz, pinned floor and peak to match" -f $hz) 'OK'
    }
    else {
        log 'could not read the guest display rate, leaving refresh settings alone' 'WARN'
    }
}

function doLatency {
    rule 'render and input latency'
    emit @{ e = 'stage'; m = 'render and input latency' }

    # every one of these was verified to be accepted on a rooted gameloop guest
    $props = [ordered]@{
        'debug.sf.latch_unsignaled' = '1'
        'debug.sf.disable_vsync'    = '1'
        'debug.hwui.disable_vsync'  = '1'
        'debug.hwui.fps_divisor'    = '1'
        'debug.composition.type'    = 'gpu'
    }
    foreach ($k in $props.Keys) {
        $cur = ([string](sh "getprop $k" -q)).Trim()
        if ($cur -eq $props[$k]) { log ("{0} already {1}" -f $k, $cur) 'DBG'; continue }
        sh "setprop $k $($props[$k])" -q | Out-Null
        $after = ([string](sh "getprop $k" -q)).Trim()
        if ($after -eq $props[$k]) { log ("{0} = {1}" -f $k, $props[$k]) 'OK' }
        else { log ("{0} refused, stayed at '{1}'" -f $k, $after) 'WARN' }
    }

    # a deeper input queue drain window removes tap latency on the way down
    put system windowsmgr.max_events_per_sec 500
    put system input_boost_duration 300
}

function doGfx {
    rule 'graphics'
    emit @{ e = 'stage'; m = 'graphics' }
    put global hwui_disable_vsync 1
    put global force_gpu_rendering 1
    put global debug.sf.hw 1
    put global debug.egl.hw 1
    put global game_driver_all_apps 1
    put global game_driver_all_apps_non_system 1
    put global game_dynamic_boost 1
}

function ksnap {
    param([string]$path, [string]$label, [string]$before)
    if ($script:kernelSnap.Contains($path)) { return }
    $script:kernelSnap[$path] = [ordered]@{ label = $label; before = $before }
    $f = Join-Path $script:data 'kernel-baseline.json'
    try { ($script:kernelSnap | ConvertTo-Json -Depth 5) | Out-File -LiteralPath $f -Encoding UTF8 }
    catch { log ("could not persist kernel baseline: {0}" -f $_.Exception.Message) 'ERR' }
}

function loadKernelBaseline {
    $f = Join-Path $script:data 'kernel-baseline.json'
    if (-not (Test-Path $f)) { return }
    try {
        $j = Get-Content -Raw $f | ConvertFrom-Json
        $script:kernelSnap = [ordered]@{}
        foreach ($p in $j.PSObject.Properties) {
            $script:kernelSnap[$p.Name] = [ordered]@{ label = $p.Value.label; before = $p.Value.before }
        }
    }
    catch { log ("could not read kernel baseline: {0}" -f $_.Exception.Message) 'WARN' }
}

function kget {
    param([string]$path)
    if (-not $script:root) { return $null }
    $v = rsh "cat '$path' 2>/dev/null" -q
    if ($null -eq $v) { return $null }
    return ([string]$v).Trim()
}

function kset {
    param([string]$path, [string]$value, [string]$label)
    if (-not $script:root) { return $false }

    $cur = kget $path
    if ($null -eq $cur) {
        log ("{0}: {1} - {2}" -f $label, $path, (whyUnavailable $path)) 'WARN'
        return $false
    }
    if ($cur -eq $value) {
        log ("{0}: already {1}" -f $label, $value) 'DBG'
        return $true
    }
    ksnap $path $label $cur

    rsh "echo '$value' > '$path'" -q | Out-Null
    $after = kget $path
    if ($after -eq $value) {
        log ("{0}: {1} -> {2}" -f $label, $cur, $value) 'OK'
        return $true
    }
    log ("{0}: write rejected, kernel kept {1}" -f $label, $after) 'WARN'
    return $false
}

function doKernelNet {
    emit @{ e = 'stage'; m = 'kernel network and bbr' }
    rule 'kernel network and bbr'

    if (-not $script:root) { log 'no root, skipping kernel network tuning' 'WARN'; return }

    $avail = kget '/proc/sys/net/ipv4/tcp_available_congestion_control'
    $cur = kget '/proc/sys/net/ipv4/tcp_congestion_control'

    if (-not $avail) {
        $hw = (capGet 'virtualized')
    if (-not $hw) { $hw = ([string](sh 'getprop ro.hardware' -q)).Trim() }
    log ("this kernel lists no congestion control algorithms ({0}), skipping bbr" -f $hw) 'WARN'
        return
    }

    emit @{ e = 'bbr'; available = $avail; current = $cur }

    $picked = ''
    foreach ($alg in @('bbr', 'bbr2', 'reno', 'cubic')) {
        if ($avail -match "\b$alg\b") { $picked = $alg; break }
    }

    if (-not $picked) { log ("no known algorithm in '{0}'" -f $avail) 'WARN'; return }
    if ($picked -eq $cur) { log ("congestion control already {0}" -f $cur) 'DBG' }
    else { kset '/proc/sys/net/ipv4/tcp_congestion_control' $picked "congestion control" | Out-Null }

    if ($picked -eq 'bbr' -or $picked -eq 'bbr2') {
        kset '/proc/sys/net/core/default_qdisc' 'fq' 'qdisc for bbr' | Out-Null
    }

    kset '/proc/sys/net/ipv4/tcp_rmem' '4096 87380 67108864' 'tcp receive buffer' | Out-Null
    kset '/proc/sys/net/ipv4/tcp_wmem' '4096 65536 67108864' 'tcp send buffer' | Out-Null
    kset '/proc/sys/net/core/rmem_max' '16777216' 'core receive buffer max' | Out-Null
    kset '/proc/sys/net/core/wmem_max' '16777216' 'core send buffer max' | Out-Null
    kset '/proc/sys/net/ipv4/tcp_fastopen' '3' 'tcp fastopen' | Out-Null
    kset '/proc/sys/net/ipv4/tcp_slow_start_after_idle' '0' 'disable slow start after idle' | Out-Null
    kset '/proc/sys/net/ipv4/tcp_mtu_probing' '1' 'mtu probing' | Out-Null
    kset '/proc/sys/net/core/somaxconn' '8192' 'listen backlog' | Out-Null
    kset '/proc/sys/net/core/netdev_max_backlog' '16384' 'netdev backlog' | Out-Null
    kset '/proc/sys/net/ipv4/tcp_no_metrics_save' '1' 'skip stale route metrics' | Out-Null

    $after = kget '/proc/sys/net/ipv4/tcp_congestion_control'
    emit @{ e = 'bbr'; result = $after; kernel = (kget '/proc/sys/kernel/osrelease') }
}

function doKernelVm {
    emit @{ e = 'stage'; m = 'kernel memory and vm' }
    rule 'kernel memory and vm'

    if (-not $script:root) { log 'no root, skipping vm tuning' 'WARN'; return }

    $mem = 0
    try {
        $m = ([string](sh "grep MemTotal /proc/meminfo" -q)).Trim()
        if ($m -match '(\d+)') { $mem = [int64]$Matches[1] }
    } catch {}
    if ($mem -le 0) { $mem = 4096 }

    $minFree = [int64]([math]::Max(32768, [math]::Floor($mem * 0.015)))
    $dirtyPct = 15
    $writePct = 5

    kset '/proc/sys/vm/swappiness' '40' 'swappiness' | Out-Null
    kset '/proc/sys/vm/min_free_kbytes' "$minFree" 'min_free_kbytes' | Out-Null
    kset '/proc/sys/vm/dirty_ratio' "$dirtyPct" 'dirty ratio' | Out-Null
    kset '/proc/sys/vm/dirty_background_ratio' "$writePct" 'dirty background ratio' | Out-Null
    kset '/proc/sys/vm/dirty_expire_centisecs' '3000' 'dirty expire' | Out-Null
    kset '/proc/sys/vm/overcommit_memory' '0' 'overcommit policy' | Out-Null
    kset '/proc/sys/vm/page-cluster' '0' 'page cluster' | Out-Null
    kset '/proc/sys/vm/vfs_cache_pressure' '50' 'cache pressure' | Out-Null
    kset '/proc/sys/vm/compaction_proactiveness' '10' 'compaction' | Out-Null

    log ("vm tuned against {0} MB of ram" -f [int64]($mem / 1024)) 'DBG'
}

function doKernelCpu {
    emit @{ e = 'stage'; m = 'kernel cpu scheduling' }
    rule 'kernel cpu scheduling'

    if (-not $script:root) { log 'no root, skipping cpu scheduling' 'WARN'; return }

    kset '/proc/sys/kernel/sched_latency_ns' '6000000' 'sched latency' | Out-Null
    kset '/proc/sys/kernel/sched_min_granularity_ns' '300000' 'sched granularity' | Out-Null
    kset '/proc/sys/kernel/sched_wakeup_granularity_ns' '4000000' 'wakeup granularity' | Out-Null
    kset '/proc/sys/kernel/sched_rt_runtime_us' '950000' 'realtime budget' | Out-Null

    $govs = @()
    $found = rsh "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null" -q
    if ($found) { $govs = @(([string]$found).Trim()) }

    if ($govs.Count -and $govs[0]) {
        log ("cpu governor is {0}" -f $govs[0]) 'DBG'
        foreach ($cpu in @(rsh 'ls -d /sys/devices/system/cpu/cpu[0-9]*' -q)) {
            $p = $cpu.Trim() + '/cpufreq/scaling_governor'
            $cur = kget $p
            if (-not $cur) { continue }
            if ($cur -eq 'schedutil' -or $cur -eq 'powersave' -or $cur -eq 'ondemand') {
                ksnap $p ("governor on {0}" -f $cpu.Trim()) $cur
                rsh "echo performance > '$p'" -q | Out-Null
                if ((kget $p) -eq 'performance') {
                    log ("{0}: {1} -> performance" -f $cpu.Trim(), $cur) 'OK'
                }
            }
        }
    }
    else {
        log 'no cpufreq governor node on this kernel, skipped' 'DBG'
    }
}

function doKernelIo {
    emit @{ e = 'stage'; m = 'kernel io scheduler' }
    rule 'kernel io scheduler'

    if (-not $script:root) { log 'no root, skipping io scheduler' 'WARN'; return }

    $blocks = rsh 'ls /sys/block' -q
    if (-not $blocks) { log 'no /sys/block, skipped' 'DBG'; return }

    foreach ($b in @(([string]$blocks) -split "`n")) {
        $leaf = $b.Trim()
        if (-not $leaf) { continue }
        if ($leaf -match '^(loop|ram|dm-|zram)') { continue }

        $sched = "$leaf/scheduler"
        $have = rsh "cat '/sys/block/$sched' 2>/dev/null" -q
        if (-not $have) { continue }

        $opts = @(([string]$have) -split '\[|\]')
        $pick = ''
        foreach ($o in @('deadline', 'bfq', 'kyber', 'fq')) {
            if ($have -match "\b$o\b") { $pick = $o; break }
        }
        if (-not $pick) { continue }

        $cur = ([string](rsh "cat '/sys/block/$sched' 2>/dev/null" -q)).Trim()
        $active = ''
        if ($cur -match '\[(.+?)\]') { $active = $Matches[1] }
        if (-not $active) { $active = $pick }
        if ($active -eq $pick) { continue }

        $p = "/sys/block/$leaf/queue/scheduler"
        ksnap $p ("scheduler on {0}" -f $leaf) $active
        rsh "echo '$pick' > '$p'" -q | Out-Null
        $now = ([string](rsh "cat '$p' 2>/dev/null" -q)).Trim()
        if ($now -match "\[$([regex]::Escape($pick))\]") {
            log ("{0}: {1} -> {2}" -f $leaf, $active, $pick) 'OK'
        }
        else {
            log ("{0}: scheduler write rejected, kept {1}" -f $leaf, $now) 'WARN'
        }

        $ra = "/sys/block/$leaf/queue/read_ahead_kb"
        $curRa = kget $ra
        if ($curRa -ne $null -and $curRa -ne '') {
            if ([int64]$curRa -gt 256) {
                ksnap $ra ("read_ahead_kb on {0}" -f $leaf) $curRa
                rsh "echo 256 > '$ra'" -q | Out-Null
                if ((kget $ra) -eq '256') { log ("{0}: read_ahead_kb {1} -> 256" -f $leaf, $curRa) 'OK' }
            }
        }

        $nr = "/sys/block/$leaf/queue/nr_requests"
        $curNr = kget $nr
        if ($curNr -ne $null -and $curNr -ne '') {
            if ([int64]$curNr -lt 256) {
                ksnap $nr ("nr_requests on {0}" -f $leaf) $curNr
                rsh "echo 256 > '$nr'" -q | Out-Null
                if ((kget $nr) -eq '256') { log ("{0}: nr_requests {1} -> 256" -f $leaf, $curNr) 'OK' }
            }
        }
    }
}

function doKernelGpu {
    emit @{ e = 'stage'; m = 'gpu frequency and thermal' }
    rule 'gpu frequency and thermal'

    if (-not $script:root) { log 'no root, skipping gpu tuning' 'WARN'; return }

    $base = rsh 'ls -d /sys/class/devfreq/* 2>/dev/null' -q
    if (-not $base) { log 'no devfreq nodes exposed, skipped' 'DBG'; return }

    foreach ($node in @(([string]$base) -split "`n")) {
        $n = $node.Trim()
        if (-not $n) { continue }
        if ($n -notmatch '(gpu|kgsl|mali|mali)') { continue }

        $minP = "$n/min_freq"
        $maxP = "$n/max_freq"
        $curMin = kget $minP
        $curMax = kget $maxP
        if (-not $curMin -or -not $curMax) { continue }

        $floor = [int64]$curMax * 0.75
        if ([int64]$curMin -lt $floor) {
            kset $minP ([string][int64]$floor) ("gpu min freq on {0}" -f (Split-Path $n -Leaf)) | Out-Null
        }
        else {
            log ("gpu min freq already at {0} of {1} max" -f $curMin, $curMax) 'DBG'
        }
    }

    foreach ($t in @('/sys/module/msm_thermal/parameters/enabled')) {
        $cur = kget $t
        if ($null -eq $cur) { continue }
        log ("thermal control node {0} is {1}, left alone" -f $t, $cur) 'DBG'
    }

    log 'gpu node scan finished' 'DBG'
}

function doKernel {
    emit @{ e = 'stage'; m = 'kernel tuning' }
    rule 'kernel tuning'
    if (-not $script:root) {
        log ("kernel tuning needs root (method: {0})" -f ($script:rootMethod -replace '^$', 'none')) 'WARN'
        return
    }
    emit @{ e = 'root'; available = $true; method = $script:rootMethod; manager = $script:rootManager; selinux = $script:selinux; probe = $script:rootProbe }
    benchmarkCaps
    doKernelNet
    doKernelVm
    doKernelCpu
    doKernelIo
    doKernelGpu
    saveCaps
    log ("kernel tuning finished via {0}" -f $script:rootMethod) 'OK'
}

function undoKernel {
    loadKernelBaseline
    if (-not $script:kernelSnap -or -not $script:kernelSnap.Count) {
        log 'no kernel baseline on disk, nothing to restore' 'DBG'
        return
    }

    $n = 0
    foreach ($path in @($script:kernelSnap.Keys)) {
        $e = $script:kernelSnap[$path]
        try {
            rsh "echo '$($e.before)' > '$path'" -q | Out-Null
            $now = kget $path
            if ($now -eq $e.before) {
                log ("kernel restored: {0} -> {1}" -f $e.label, $e.before) 'OK'
                $n++
            }
            else {
                log ("could not restore {0}: kernel kept {1}" -f $path, $now) 'WARN'
            }
        }
        catch {
            log ("could not restore {0}: {1}" -f $path, $_.Exception.Message) 'WARN'
        }
    }
    log ("kernel rollback complete, {0} values restored" -f $n) 'OK'
}

function doNet {
    rule 'network'
    emit @{ e = 'stage'; m = 'network' }
    if (-not $script:dev) { log 'no device, skipped network' 'WARN'; return }

    put global tcp_default_init_rwnd 60
    put global wifi_scan_always_enabled 0
    put global ble_scan_always_enabled 0
    put global captive_portal_mode 0
    put global private_dns_mode hostname
    put global private_dns_specifier '1dot1dot1dot1.cloudflare-dns.com'
    sh 'ndc resolver flushdefaultif' -q | Out-Null

    if ($script:root) {
        $a = [string](rsh 'sysctl -n net.ipv4.tcp_available_congestion_control' -q)
        if ($a -match 'bbr') {
            rsh 'sysctl -w net.ipv4.tcp_congestion_control=bbr' -q | Out-Null
            log 'tcp moved onto bbr' 'OK'
        }
        else { log 'bbr is not in this kernel, skipping' 'WARN' }
    }
}

function doMem {
    rule 'memory and storage'
    emit @{ e = 'stage'; m = 'memory' }
    if (-not $script:dev) { log 'no device, skipped memory' 'WARN'; return }
    put global sustained_performance_mode 1
    put global low_power 0
    put global dynamic_power_savings_enabled 0
    put global always_finish_activities 1
    put global fstrim_enable 1
}

function doInput {
    rule 'touch'
    emit @{ e = 'stage'; m = 'input' }
    if (-not $script:dev) { log 'no device, skipped input' 'WARN'; return }
    put system pointer_speed 7
    put global touch_boost 1
    put global input_boost_duration 300

    $boosted = 0
    foreach ($pkg in @($script:pubg) + @('com.tencent.ig')) {
        $pids = ([string](sh "pidof $pkg" -q)).Trim()
        if (-not $pids) { continue }
        foreach ($one in @($pids -split '\s+')) {
            if (-not $one) { continue }

            # some emulators answer pidof with the same pid whatever you ask,
            # so confirm the process really is this package before touching it
            $cmd = ([string](sh "cat /proc/$one/cmdline 2>/dev/null | tr '\0' ' '" -q)).Trim()
            if ($cmd -notmatch [regex]::Escape($pkg)) {
                log ("{0}: pid {1} is '{2}', not this package, skipped" -f $pkg, $one, $cmd) 'WARN'
                continue
            }

            $cur = ([string](sh "cat /proc/$one/stat 2>/dev/null | cut -d' ' -f 19" -q)).Trim()
            if ($script:root) { rsh "renice -n -5 -p $one" -q | Out-Null }
            else { sh "renice -n -5 -p $one" -q | Out-Null }
            log ("{0} pid {1} raised to nice -5 (was {2})" -f $pkg, $one, $(if ($cur) { $cur } else { 'unknown' })) 'OK'
            $boosted++
        }
    }
    if ($boosted) { log ("{0} game process(es) prioritised" -f $boosted) 'OK' }
    else { log 'game not running yet, priority will apply on the next launch' 'DBG' }
}

function doPrivacy {
    rule 'telemetry'
    emit @{ e = 'stage'; m = 'telemetry' }
    if (-not $script:dev) { log 'no device, skipped telemetry' 'WARN'; return }
    foreach ($p in @('com.tencent.gcloud', 'com.tencent.mid', 'com.tencent.qqpimsecure', 'com.tencent.android.kinguser')) {
        sh "pm disable-user --user 0 $p" -q | Out-Null
    }
    log 'anything that was not installed just got ignored' 'OK'
}

function doRam {
    rule 'ram'
    emit @{ e = 'stage'; m = 'memory purge' }
    if (-not $script:dev) { log 'no device, skipped ram purge' 'WARN'; return }
    sh 'am kill-all' -q | Out-Null
    sh 'pm trim-caches 999999999K' -q | Out-Null
    sh 'cmd package bg-dexopt-job' -q | Out-Null
    if ($script:root) { rsh 'sync; echo 3 > /proc/sys/vm/drop_caches' -q | Out-Null }
    log 'background apps dropped, caches trimmed' 'OK'
}

function doQemu {
    emit @{ e = 'stage'; m = 'emulator input pipeline' }
    rule 'emulator input pipeline'
    if (-not $script:dev) { log 'no device, skipping emulator input tuning' 'WARN'; return }

    $props = [ordered]@{
        'qemu.mouse.smooth'           = 'false'
        'qemu.mouse.acceleration'     = '0'
        'qemu.touch.smoothing'        = 'false'
        'qemu.touch.sampling_rate'    = '120'
        'qemu.input.raw_mouse'        = 'true'
        'qemu.input.raw_keyboard'     = 'true'
        'qemu.keyboard.repeat.delay'  = '0'
        'qemu.keyboard.repeat.interval' = '0'
    }

    $applied = 0
    $already = 0
    $rejected = 0
    $known = $false

    foreach ($k in $props.Keys) {
        $cur = ([string](sh "getprop $k" -q)).Trim()

        if ($cur -eq $props[$k]) {
            $known = $true
            $already++
            log ("{0} already {1}" -f $k, $cur) 'DBG'
            continue
        }

        if ($cur -eq '') {
            sh "setprop $k $($props[$k])" -q | Out-Null
            $after = ([string](sh "getprop $k" -q)).Trim()
            if ($after -eq $props[$k]) { $applied++ }
            else { log ("{0} not accepted on this build" -f $k) 'DBG'; $rejected++ }
            continue
        }

        $known = $true
        sh "setprop $k $($props[$k])" -q | Out-Null
        $after = ([string](sh "getprop $k" -q)).Trim()
        if ($after -eq $props[$k]) {
            log ("{0}: {1} -> {2}" -f $k, $cur, $props[$k]) 'OK'
            $applied++
        }
        else {
            log ("{0} write rejected, stayed at {1}" -f $k, $after) 'WARN'
            $rejected++
        }
    }

    # "already correct" is not the same as "applied this run", and conflating
    # them made a working configuration look like it had done nothing
    $parts = @()
    if ($applied) { $parts += "$applied changed" }
    if ($already) { $parts += "$already already set" }
    if ($rejected) { $parts += "$rejected refused by the build" }

    if ($parts.Count) {
        log ("emulator input properties: {0}" -f ($parts -join ', ')) 'OK'
    }
    else {
        log 'this build does not expose qemu input properties (real device or patched emulator)' 'DBG'
    }

    if ($applied) {
        emit @{ e = 'qemu'; applied = $applied; already = $already; rejected = $rejected }
        log 'restart the emulator for the input changes to take effect' 'DBG'
    }
}

$script:caps = $null
$script:capsDirty = $false

function snapshotPathFor {
    param([string]$name)
    foreach ($k in windowsKeys) { if ($k.name -eq $name) { return $k.path } }
    return $null
}

# works out what a restore would actually do, without touching anything
function previewRestore {
    $f = Join-Path $script:data 'baseline.json'
    if (-not (Test-Path $f)) { return [ordered]@{ ok = $false; message = 'no baseline recorded yet, so there is nothing to roll back to' } }
    try { $snap = Get-Content $f -Raw | ConvertFrom-Json }
    catch { return [ordered]@{ ok = $false; message = 'baseline.json could not be read' } }

    $change = 0; $same = 0; $absent = 0
    $rows = New-Object System.Collections.ArrayList

    foreach ($kp in $snap.registry.PSObject.Properties) {
        if ($kp.Name -in @('MmcssTasks', 'IfeoSubkeys')) { continue }
        $path = snapshotPathFor $kp.Name
        if (-not $path) { continue }
        $keyExists = Test-Path $path
        foreach ($vp in $kp.Value.values.PSObject.Properties) {
            if (-not $keyExists) { $absent++; continue }
            $cur = (Get-ItemProperty -LiteralPath $path -Name $vp.Name -EA 0).($vp.Name)
            if ($null -eq $cur) { $absent++; continue }
            if ([string]$cur -eq [string]$vp.Value) { $same++ }
            else {
                $change++
                if (@($rows).Count -lt 40) { [void]$rows.Add(("    {0}\{1} : '{2}' -> '{3}'" -f $kp.Name, $vp.Name, $cur, $vp.Value)) }
            }
        }
    }

    $ifeoCount = @($snap.registry.IfeoSubkeys.subkeys).Count
    $ifeoExtra = 0
    $ifeoBase = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options'
    if ($ifeoCount -and (Test-Path $ifeoBase)) {
        $known = @($snap.registry.IfeoSubkeys.subkeys | ForEach-Object { $_.name })
        $ifeoExtra = @(Get-ChildItem $ifeoBase -EA 0 | Where-Object { $known -notcontains $_.PSChildName }).Count
    }

    return [ordered]@{
        ok        = $true
        wouldChange = $change
        already   = $same
        absent    = $absent
        ifeoExtra = $ifeoExtra
        powerVals = @($snap.powerVals).Count
        bcd       = @($snap.bcd.PSObject.Properties).Count
        fsutil    = @($snap.fsutil.PSObject.Properties).Count
        android   = @($snap.android.settings).Count + @($snap.android.props).Count
        rows      = @($rows)
    }
}

# re-reads the machine afterwards so a restore that silently failed is visible
function verifyRestored {
    param($snap)
    $ok = 0
    $bad = New-Object System.Collections.ArrayList

    foreach ($kp in $snap.registry.PSObject.Properties) {
        if ($kp.Name -in @('MmcssTasks', 'IfeoSubkeys')) { continue }
        $path = snapshotPathFor $kp.Name
        if (-not $path) { continue }
        $keyExists = Test-Path $path
        foreach ($vp in $kp.Value.values.PSObject.Properties) {
            if (-not $keyExists) { [void]$bad.Add("$($kp.Name)\$($vp.Name) (key gone)"); continue }
            $cur = (Get-ItemProperty -LiteralPath $path -Name $vp.Name -EA 0).($vp.Name)
            if ($null -eq $cur) { [void]$bad.Add("$($kp.Name)\$($vp.Name) (gone)"); continue }
            if ([string]$cur -eq [string]$vp.Value) { $ok++ }
            else { [void]$bad.Add("$($kp.Name)\$($vp.Name) = '$cur' expected '$($vp.Value)'") }
        }
    }

    if ($ok -and -not $bad.Count) { log ("verified: {0} values match the baseline" -f $ok) 'OK' }
    elseif ($bad.Count) {
        log ("verified: {0} match, {1} did not" -f $ok, $bad.Count) 'WARN'
        @($bad) | Select-Object -First 12 | ForEach-Object { log ("    still different: {0}" -f $_) 'WARN' }
    }
    else { log ("verified: {0} values match the baseline" -f $ok) 'OK' }

    emit @{ e = 'verify'; ok = $ok; bad = @($bad).Count; sample = @($bad | Select-Object -First 12) }
}

function loadCaps {
    if ($null -ne $script:caps) { return $script:caps }
    $f = Join-Path $script:data 'capabilities.json'
    if (Test-Path $f) {
        try {
            $j = Get-Content $f -Raw | ConvertFrom-Json
            if ($j.device -eq $script:dev) {
                $h = @{}
                foreach ($p in $j.facts.PSObject.Properties) { $h[$p.Name] = $p.Value }
                $script:caps = $h
                return $script:caps
            }
        }
        catch {}
    }
    $script:caps = @{}
    return $script:caps
}

function capGet {
    param([string]$k)
    $c = loadCaps
    if ($c.ContainsKey($k)) { return $c[$k] }
    return $null
}

function capSet {
    param([string]$k, $v)
    $c = loadCaps
    $c[$k] = $v
    $script:capsDirty = $true
}

function saveCaps {
    if (-not $script:capsDirty -or -not $script:dev) { return }
    $facts = [ordered]@{}
    foreach ($k in ($script:caps.Keys | Sort-Object)) { $facts[$k] = $script:caps[$k] }
    $out = [ordered]@{ device = $script:dev; android = $script:andro; at = (Get-Date).ToString('s'); facts = $facts }
    try {
        $out | ConvertTo-Json -Depth 6 | Out-File (Join-Path $script:data 'capabilities.json') -Encoding UTF8
        log ("remembered {0} facts about this device for next time" -f $facts.Count) 'DBG'
    }
    catch {}
}

# turns "not readable" into an actual answer, and only pays for the probe once
function whyUnavailable {
    param([string]$path)
    $key = "skip::$path"
    $cached = capGet $key
    if ($cached) { return $cached }

    $reason = $null
    if (-not $script:root) { $reason = 'adb is not root here' }
    else {
        $exists = ([string](sh "[ -e '$path' ] && echo y || echo n" -q)).Trim()
        if ($exists -ne 'y') { $reason = 'this kernel does not expose it' }
        else { $reason = 'the guest kernel refuses to read it even as root' }
    }
    capSet $key $reason
    return $reason
}

function benchmarkCaps {
    # one pass over the things a run would otherwise rediscover every time
    $algos = (klines (kget '/proc/sys/net/ipv4/tcp_available_congestion_control'))
    capSet 'congestion' ($algos -join ' ')
    capSet 'bbr' ([bool]($algos -contains 'bbr'))
    capSet 'cpufreq' ([bool](klines (rsh "ls /sys/devices/system/cpu/cpu0/cpufreq/ 2>/dev/null" -q)).Count)
    capSet 'kgsl' ([bool](klines (rsh "ls -d /sys/class/kgsl/kgsl-3d*/devfreq 2>/dev/null" -q)).Count)
    capSet 'virtualized' ([string](sh 'getprop ro.hardware' -q)).Trim()
    log ("this device: bbr={0} cpufreq={1} kgsl={2} hardware={3}" -f (capGet 'bbr'), (capGet 'cpufreq'), (capGet 'kgsl'), (capGet 'virtualized')) 'OK'
}

function klines {
    param([string]$out)
    if (-not $out) { return @() }
    return @(([string]$out) -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function doCpu {
    emit @{ e = 'stage'; m = 'cpu governor' }
    if (-not $script:root) { log 'cpu governor needs root, skipping' 'WARN'; return }
    rule 'cpu governor'

    $found = klines (rsh "ls /sys/devices/system/cpu/ 2>/dev/null | grep -E '^cpu[0-9]+$'" -q)
    if (-not $found.Count) { log 'no cpufreq nodes here, skipping' 'WARN'; return }

    $pinned = 0
    foreach ($c in $found) {
        $g = "/sys/devices/system/cpu/$c/cpufreq/scaling_governor"
        $cur = kget $g
        if (-not $cur) { continue }
        if ($cur -ne 'performance') {
            if (kset $g 'performance' "$c governor") { $pinned++ }
        }
        $max = kget "/sys/devices/system/cpu/$c/cpufreq/scaling_max_freq"
        $curMin = kget "/sys/devices/system/cpu/$c/cpufreq/scaling_min_freq"
        if ($curMin -and $max) {
            $floor = [int64]([math]::Floor([int64]$max * 0.7))
            if ([int64]$curMin -lt $floor) { kset "/sys/devices/system/cpu/$c/cpufreq/scaling_min_freq" "$floor" "$c min freq" | Out-Null }
        }
    }
    if ($pinned) { log ("pinned {0} of {1} core(s) to performance" -f $pinned, $found.Count) 'OK' }
    else { log ("cpus already on performance ({0} core(s))" -f $found.Count) 'DBG' }
}

function doGpu {
    emit @{ e = 'stage'; m = 'gpu clocks' }
    if (-not $script:root) { log 'gpu lock needs root, skipping' 'WARN'; return }
    rule 'gpu clocks'

    $dirs = klines (rsh "ls -d /sys/class/kgsl/kgsl-3d*/devfreq 2>/dev/null" -q)
    if (-not $dirs.Count) { log 'no kgsl devfreq here, skipping' 'WARN'; return }

    $hit = 0
    foreach ($d in $dirs) {
        $m = kget "$d/max_freq"
        if (-not $m) { continue }
        if ((kget "$d/min_freq") -ne $m) {
            if (kset "$d/min_freq" $m 'gpu min freq') { $hit++ }
        }
    }
    if ($hit) { log ("gpu floored on {0} node(s)" -f $hit) 'OK' }
    else { log 'gpu already floored or unwritable' 'DBG' }
}

function doCommon {
    emit @{ e = 'stage'; m = 'core boost' }
    rule 'core boost'
    if (-not $script:dev) { log 'no device, skipped core boost' 'WARN'; return }

    put global development_settings_enabled 1
    put global window_animation_scale 0
    put global transition_animation_scale 0
    put global animator_duration_scale 0
    put global sustained_performance_mode 1
    put global restrict_background_data 0
    put global heads_up_notifications_enabled 0
    put global stay_on_while_plugged_in 3
    sh 'cmd deviceidle disable' -q | Out-Null
    sh 'am kill-all' -q | Out-Null
    sh 'cmd activity idle-maintenance' -q | Out-Null
    sh 'cmd package bg-dexopt-job' -q | Out-Null
}

function doJit {
    emit @{ e = 'stage'; m = 'jit and vm' }
    rule 'jit and vm'
    if (-not $script:dev) { log 'no device, skipped jit pack' 'WARN'; return }

    foreach ($kv in @(
        @('dalvik.vm.dex2oat-filter', 'speed')
        @('dalvik.vm.image-dex2oat-filter', 'speed')
        @('dalvik.vm.heapstartsize', '16m')
        @('dalvik.vm.heapgrowthlimit', '256m')
        @('dalvik.vm.heapsize', '512m')
        @('dalvik.vm.heaptargetutilization', '0.75')
        @('dalvik.vm.heapminfree', '2m')
        @('dalvik.vm.heapmaxfree', '8m')
    )) {
        sh ("setprop {0} {1}" -f $kv[0], $kv[1]) -q | Out-Null
    }
    log 'jit filters and vm heap pinned' 'OK'
}

function doLatch {
    emit @{ e = 'stage'; m = 'latch and input' }
    rule 'latch and input'
    if (-not $script:dev) { log 'no device, skipped latch pack' 'WARN'; return }

    foreach ($kv in @(
        @('debug.sf.latch_unsignaled', '1')
        @('windowsmgr.max_events_per_sec', '240')
        @('view.touch_slop', '0')
        @('view.scroll_friction', '0')
    )) {
        sh ("setprop {0} {1}" -f $kv[0], $kv[1]) -q | Out-Null
    }
    log 'surfaceflinger latch on, input friction zeroed' 'OK'
}

function doProps {
    emit @{ e = 'stage'; m = 'graphics props' }
    rule 'graphics props'
    if (-not $script:dev) { log 'no device, skipped graphics props' 'WARN'; return }

    foreach ($kv in @(
        @('debug.hwui.disable_vsync', 'true')
        @('debug.hwui.render_dirty_regions', 'false')
        @('debug.hwui.profile', 'false')
        @('debug.gr.swapinterval', '0')
        @('debug.composition.type', 'gpu')
        @('debug.sf.hw', '1')
        @('debug.egl.hw', '1')
    )) {
        sh ("setprop {0} {1}" -f $kv[0], $kv[1]) -q | Out-Null
    }
    log 'vsync off, dirty regions on, gpu composition' 'OK'
}

function doTcpTune {
    if (-not $script:root) { log 'tcp buffers need root, skipping' 'WARN'; return }
    rsh 'sysctl -w net.ipv4.tcp_rmem="4096 87380 67108864"' -q | Out-Null
    rsh 'sysctl -w net.ipv4.tcp_wmem="4096 16384 33554432"' -q | Out-Null
    log 'tcp socket buffers widened' 'OK'
}

function doIo {
    emit @{ e = 'stage'; m = 'io scheduler' }
if (-not $script:root) { log 'io scheduler needs root, skipping' 'WARN'; return }
    rule 'io scheduler'
    foreach ($b in @('mmcblk0', 'sda', 'sdb', 'sdf', 'dm-0')) {
        $s = "/sys/block/$b/queue/scheduler"
        if (-not (kget $s)) { continue }
        kset $s 'noop' "$b scheduler" | Out-Null
        kset "/sys/block/$b/queue/read_ahead_kb" '512' "$b read ahead" | Out-Null
        kset "/sys/block/$b/queue/nr_requests" '128' "$b nr requests" | Out-Null
        log ("$b on noop, 512kb read ahead, 128 requests") 'OK'
    }
}

function iniFix {
    param([string[]]$Lines, [int]$Fps)

    $want = [ordered]@{
        'MobileFPS'                    = "$Fps"
        'TargetFrameRate'              = "$Fps"
        'FrameRateLimit'               = "$Fps"
        'MinDesiredFrameRate'          = "$Fps"
        'bUseVSync'                    = 'False'
        'bSmoothFrameRate'             = 'False'
        'MaterialQualityLevel'         = '3'
        'SyncQuality'                  = '0'
        'EngineMode'                   = '1'
        'StreamingBoost'               = '1'
        'r.Mobile.DisableVertexFog'    = '1'
        'r.SimpleForwardShading'       = '1'
        'r.MobileContentScaleFactor'   = '1'
        'r.TextureStreaming'           = '1'
        'r.Streaming.PoolSize'         = '1024'
        'bAllowMultiThreadedRendering' = '1'
    }

    $o = New-Object System.Collections.Generic.List[string]
    $hit = @{}

    foreach ($l in $Lines) {
        $m = [regex]::Match($l, '^\s*([A-Za-z0-9_.]+)\s*=\s*(.*)$')
        if ($m.Success -and $want.Contains($m.Groups[1].Value)) {
            $k = $m.Groups[1].Value
            $o.Add("$k=$($want[$k])")
            $hit[$k] = 1
        }
        else { $o.Add($l) }
    }

    foreach ($k in $want.Keys) {
        if (-not $hit.ContainsKey($k)) { $o.Add("$k=$($want[$k])") }
    }

    return ,$o.ToArray()
}

function doPubg {
    param([int]$Fps)

    emit @{ e = 'stage'; m = ('pubg engine {0} fps' -f $Fps) }
    if (-not (alive)) { log 'device is not answering, open the emulator first' 'ERR'; return }
    rule ("pubg config  ({0} fps)" -f $Fps)

    $tpl = @(
        '/sdcard/Android/data/{0}/files/UE4Game/ShadowTrackerExtra/ShadowTrackerExtra/Saved/Config/Android'
        '/storage/emulated/0/Android/data/{0}/files/UE4Game/ShadowTrackerExtra/ShadowTrackerExtra/Saved/Config/Android'
        '/sdcard/Android/data/{0}/files/UE4Game/ShadowTrackerExtra/Saved/Config/Android'
    )

    $ok = $false
    $pkg = ''
    foreach ($p in $script:pubg) {
        if ((([string](sh "pm path $p" -q)).Trim()) -ne '') { $pkg = $p; break }
    }

    if (-not $pkg) { log 'no pubg build on this device' 'WARN'; return }
    log ("found {0}" -f $pkg) 'OK'

    $dir = $null
    foreach ($t in $tpl) {
        $cand = $t -f $pkg
        if ((([string](sh "[ -e '$cand/UserSettings.ini' ] && echo 1 || echo 0" -q)).Trim()) -eq '1') {
            $dir = $cand
            break
        }
    }

    if (-not $dir) {
        $dir = "/sdcard/Android/data/$pkg/files/UE4Game/ShadowTrackerExtra/ShadowTrackerExtra/Saved/Config/Android"
        log 'no config there yet, making the folder' 'WARN'
        sh "mkdir -p '$dir'" -q | Out-Null
    }

    $files = @('UserSettings.ini', 'GameUserSettings.ini')
    $i = 0
    foreach ($f in $files) {
        $i++
        prog $i $files.Count $f

        $remote = "$dir/$f"
        $local = Join-Path $script:tmp $f
        & $script:adb -s $script:dev pull $remote $local 2>&1 | Out-Null

        $txt = ''
        if (Test-Path $local) { $txt = [string](Get-Content $local -Raw) }

        $new = iniFix ($txt -split "`n") $Fps
        ($new -join "`n") | Out-File $local -Encoding ASCII -Force

        & $script:adb -s $script:dev push $local $remote 2>&1 | Out-Null
        Remove-Item $local -Force -ErrorAction SilentlyContinue

        $check = Join-Path $script:tmp "chk_$f"
        & $script:adb -s $script:dev pull $remote $check 2>&1 | Out-Null
        if (Test-Path $check) {
            $v = [string](Get-Content $check -Raw)
            Remove-Item $check -Force -ErrorAction SilentlyContinue
            if ($v -match "FrameRateLimit=$Fps" -or $v -match "MobileFPS=$Fps" -or $v -match "TargetFrameRate=$Fps") {
                log ("{0} patched and verified" -f $f) 'OK'
                $ok = $true
            }
            else { log ("{0} wrote fine but the check did not match" -f $f) 'WARN' }
        }
        emit @{ e = 'progress'; p = [int](60 + 40 * $i / $files.Count) }
    }

    if ($ok) { log 'close the game and open it again' 'OK' }
}

# â”€â”€ windows modules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function winExeScan {
    $pf86 = ${env:ProgramFiles(x86)}
    $r = @(
        "$env:ProgramFiles\TxGameAssistant"
        "$pf86\TxGameAssistant"
        "$env:ProgramFiles\Tencent"
        "$pf86\Tencent"
        "$env:LOCALAPPDATA\TxGameAssistant"
        'C:\TxGameAssistant'
        'D:\TxGameAssistant'
    ) | Where-Object { Test-Path $_ }

    $s = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($x in $r) {
        Get-ChildItem $x -Filter *.exe -File -Recurse | ForEach-Object { $s.Add($_.FullName) | Out-Null }
    }
    return $s
}

function doWinHz {
    emit @{ e = 'stage'; m = 'display refresh rate' }
    rule 'display refresh rate'

    if (-not $script:hzType) {
        $cs = @'
using System;
using System.Runtime.InteropServices;
public class RiftHz {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion;
    public short dmDriverVersion;
    public short dmSize;
    public short dmDriverExtra;
    public int dmFields;
    public int dmPositionX;
    public int dmPositionY;
    public int dmDisplayOrientation;
    public int dmDisplayFixedOutput;
    public short dmColor;
    public short dmDuplex;
    public short dmYResolution;
    public short dmTTOption;
    public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel;
    public int dmPelsWidth;
    public int dmPelsHeight;
    public int dmDisplayFlags;
    public int dmDisplayFrequency;
    public int dmICMMethod;
    public int dmICMIntent;
    public int dmMediaType;
    public int dmDitherType;
    public int dmReserved1;
    public int dmReserved2;
    public int dmPanningWidth;
    public int dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
  [DllImport("user32.dll")]
  public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);
}
'@
        try { Add-Type -TypeDefinition $cs -ErrorAction Stop; $script:hzType = 'RiftHz' }
        catch { log ("could not load the display helper: {0}" -f $_.Exception.Message) 'WARN'; return }
    }

    $cur = New-Object RiftHz+DEVMODE
    $cur.dmSize = [int16][System.Runtime.InteropServices.Marshal]::SizeOf($cur)
    if (-not [RiftHz]::EnumDisplaySettings($null, -1, [ref]$cur)) {
        log 'this session exposes no display mode to the engine' 'WARN'
        return
    }
    if ($cur.dmPelsWidth -le 0 -or $cur.dmPelsHeight -le 0) {
        log 'display mode reported no resolution, skipped' 'DBG'
        return
    }

    $curHz = [int]$cur.dmDisplayFrequency
    log ("display is {0}x{1} @ {2}Hz" -f $cur.dmPelsWidth, $cur.dmPelsHeight, $curHz) 'DBG'

    $best = $null
    $bestHz = $curHz
    $i = 0
    while ($true) {
        $t = New-Object RiftHz+DEVMODE
        $t.dmSize = [int16][System.Runtime.InteropServices.Marshal]::SizeOf($t)
        if (-not [RiftHz]::EnumDisplaySettings($null, $i, [ref]$t)) { break }
        if ($t.dmPelsWidth -eq $cur.dmPelsWidth -and $t.dmPelsHeight -eq $cur.dmPelsHeight -and
            $t.dmBitsPerPel -eq $cur.dmBitsPerPel -and [int]$t.dmDisplayFrequency -gt $bestHz) {
            $best = $t
            $bestHz = [int]$t.dmDisplayFrequency
        }
        $i++
    }

    if (-not $best) {
        log ("already at the highest refresh this display offers at {0}x{1}" -f $cur.dmPelsWidth, $cur.dmPelsHeight) 'OK'
        return
    }

    $best.dmFields = 0x00080000 -bor 0x00100000 -bor 0x00400000
    $r = [RiftHz]::ChangeDisplaySettings([ref]$best, 0x00000001)
    if ($r -eq 0 -or $r -eq 1) {
        log ("display unlocked: {0}Hz -> {1}Hz" -f $curHz, $bestHz) 'OK'
        emit @{ e = 'hz'; from = $curHz; to = $bestHz }
    }
    else {
        log ("windows refused the refresh change (code {0}), left at {1}Hz" -f $r, $curHz) 'WARN'
    }
}

function setd {
    param([string]$path, [string]$name, $value, [string]$label)
    try {
        if (-not (Test-Path $path)) { New-Item -Path $path -Force -ErrorAction Stop | Out-Null }
        Set-ItemProperty -Path $path -Name $name -Value $value -Force -ErrorAction Stop
        log ("{0} -> {1}" -f $label, $value) 'OK'
        return $true
    }
    catch {
        log ("{0}: {1}" -f $label, $_.Exception.Message) 'WARN'
        return $false
    }
}

function doWinPolish {
    emit @{ e = 'stage'; m = 'latency and input polish' }
    rule 'latency and input polish'

    $n = 0

    $dwm = 'HKLM:\SOFTWARE\Microsoft\Windows\Dwm'
    if (setd $dwm 'OverlayTestMode' 5 'multi-plane overlay off (mp0 stutter fix)') { $n++ }

    $mou = 'HKLM:\SYSTEM\CurrentControlSet\Services\mouclass\Parameters'
    if (setd $mou 'MouseDataQueueSize' 20 'mouse queue depth') { $n++ }
    $kbd = 'HKLM:\SYSTEM\CurrentControlSet\Services\kbdclass\Parameters'
    if (setd $kbd 'KeyboardDataQueueSize' 20 'keyboard queue depth') { $n++ }

    $mm = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management'
    if (setd $mm 'LargeSystemCache' 0 'large system cache off') { $n++ }
    $ram = 0
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($os -and $os.TotalVisibleMemorySize) { $ram = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1) }
    } catch {}
    if ($ram -ge 8) {
        if (setd $mm 'DisablePagingExecutive' 1 'keep kernel drivers in ram') { $n++ }
    }
    else { log ("skipping DisablePagingExecutive, only {0} GB of ram" -f $ram) 'DBG' }

    $pc = 'HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl'
    if (setd $pc 'Win32PrioritySeparation' 38 'short quantum, variable boost') { $n++ }

    $usb = 'HKLM:\SYSTEM\CurrentControlSet\Services\USB'
    if (setd $usb 'DisableSelectiveSuspend' 1 'usb selective suspend off') { $n++ }

    $dns = 'HKLM:\SYSTEM\CurrentControlSet\Services\Dnscache\Parameters'
    if (setd $dns 'MaxNegativeCacheTtl' 0 'no negative dns caching') { $n++ }
    if (setd $dns 'MaxCacheTtl' 86400 'longer positive dns cache') { $n++ }

    $ps = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Psched'
    if (setd $ps 'NonBestEffortLimit' 0 'no qos bandwidth reservation') { $n++ }

    $dc = 'HKCU:\Control Panel\Desktop'
    if (setd $dc 'ForegroundLockTimeout' 0 'instant window focus') { $n++ }
    if (setd $dc 'AutoEndTasks' '1' 'auto close hung apps') { $n++ }
    if (setd $dc 'HungAppTimeout' '1000' 'shorter hung app timeout') { $n++ }
    if (setd $dc 'WaitToKillAppTimeout' '2000' 'shorter app kill wait') { $n++ }
    if (setd $dc 'MenuShowDelay' '0' 'instant menus') { $n++ }

    $sm = 'HKLM:\SYSTEM\CurrentControlSet\Control'
    if (setd $sm 'WaitToKillServiceTimeout' '2000' 'shorter service stop wait') { $n++ }

    $ea = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
    if (setd $ea 'ExtendedUIHoverTime' 50 'instant taskbar hover') { $n++ }
    if (setd $ea 'TaskbarAnimations' 0 'taskbar animations off') { $n++ }
    if (setd $ea 'SnapAssist' 0 'snap assist off') { $n++ }

    $ser = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize'
    if (setd $ser 'StartupDelayInMSec' 0 'no taskbar start delay') { $n++ }
    if (setd $ser 'WaitForIdleState' 0 'no idle wait at login') { $n++ }

    $wm = 'HKCU:\Control Panel\Desktop\WindowMetrics'
    if (setd $wm 'MinAnimate' '0' 'no window minimise animation') { $n++ }

    $ms = 'HKCU:\Control Panel\Mouse'
    if (setd $ms 'MouseSpeed' '0' 'mouse acceleration off') { $n++ }
    if (setd $ms 'MouseThreshold1' '0' 'mouse acceleration off') { $n++ }
    if (setd $ms 'MouseThreshold2' '0' 'mouse acceleration off') { $n++ }

    $kb = 'HKCU:\Control Panel\Keyboard'
    if (setd $kb 'KeyboardDelay' '0' 'fast key repeat') { $n++ }
    if (setd $kb 'KeyboardSpeed' '31' 'fast key repeat') { $n++ }

    $sk = 'HKCU:\Control Panel\Accessibility\StickyKeys'
    if (setd $sk 'Flags' '506' 'sticky keys popup off') { $n++ }

    $pd = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
    if (setd $pd 'EnableTransparency' 0 'transparency off') { $n++ }

    $gdr = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR'
    if (setd $gdr 'AppCaptureEnabled' 0 'game capture off') { $n++ }
    $gp = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR'
    if (setd $gp 'AllowGameDVR' 0 'dvr blocked by policy') { $n++ }

    $tel = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection'
    if (setd $tel 'AllowTelemetry' 0 'diagnostic telemetry off') { $n++ }

    try {
        $a = (fsutil behavior query disablelastaccess 2>$null | Select-String '\d+$')
        if ($a -and $a.Matches[0].Value -ne '1') {
            fsutil behavior set disablelastaccess 1 2>$null | Out-Null
            log 'ntfs last-access updates disabled' 'OK'
            $n++
        }
    } catch {}
    try {
        $b = (fsutil behavior query disable8dot3 2>$null | Select-String '\d+$')
        if ($b -and $b.Matches[0].Value -ne '1') {
            fsutil behavior set disable8dot3 1 2>$null | Out-Null
            log '8.3 short-name creation disabled' 'OK'
            $n++
        }
    } catch {}

    $mmBase = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks'
    foreach ($t in @(
        @{ name = 'Games'; pri = 6; gpu = 8; cat = 'High'; sfio = 'High' },
        @{ name = 'Audio'; pri = 6; gpu = 8; cat = 'High'; sfio = 'High' }
    )) {
        $tp = Join-Path $mmBase $t.name
        try {
            if (-not (Test-Path $tp)) { New-Item $tp -Force | Out-Null }
            Set-ItemProperty -LiteralPath $tp -Name 'Priority' -Value $t.pri -Force
            Set-ItemProperty -LiteralPath $tp -Name 'GPU Priority' -Value $t.gpu -Force
            Set-ItemProperty -LiteralPath $tp -Name 'Scheduling Category' -Value $t.cat -Force
            Set-ItemProperty -LiteralPath $tp -Name 'SFIO Priority' -Value $t.sfio -Force
            Set-ItemProperty -LiteralPath $tp -Name 'Affinity' -Value 0 -Force
            Set-ItemProperty -LiteralPath $tp -Name 'Clock Rate' -Value 10000 -Force
            Set-ItemProperty -LiteralPath $tp -Name 'Background Only' -Value 'False' -Force
            Set-ItemProperty -LiteralPath $tp -Name 'Latency Sensitive' -Value 'True' -Force
            log ("mmcss {0} profile set (priority {1}, gpu {2}, {3})" -f $t.name, $t.pri, $t.gpu, $t.cat) 'OK'
            $n++
        }
        catch { log ("mmcss {0}: {1}" -f $t.name, $_.Exception.Message) 'WARN' }
    }

    try {
        $svc = Get-Service -Name MMCSS -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -ne 'Running') { Start-Service -Name MMCSS -ErrorAction SilentlyContinue }
        if ($svc) { Set-Service -Name MMCSS -StartupType Automatic -ErrorAction SilentlyContinue }
        if ($svc) { log 'mmcss scheduler service is running so the games profile applies' 'OK' }
    } catch {}

    log ("latency polish finished, {0} values applied" -f $n) 'OK'
    emit @{ e = 'polish'; applied = $n }
}

function doWinTimer {
    emit @{ e = 'stage'; m = 'boot timer resolution' }
    rule 'boot timer resolution'

    $bcd = Get-Command bcdedit.exe -ErrorAction SilentlyContinue
    if (-not $bcd) { log 'bcdedit not available, skipping timer tweak' 'WARN'; return }

    $elev = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $elev) { log 'needs administrator to change the boot timer, skipped' 'WARN'; return }

    try {
        $null = Start-Process -FilePath 'bcdedit.exe' -ArgumentList @('/deletevalue', 'useplatformclock') -WindowStyle Hidden -Wait -PassThru -ErrorAction SilentlyContinue
        log 'useplatformclock removed (windows no longer forces the platform tick)' 'OK'
    } catch { log ("could not clear useplatformclock: {0}" -f $_.Exception.Message) 'WARN' }

    try {
        $p = Start-Process -FilePath 'bcdedit.exe' -ArgumentList @('/set', 'disabledynamictick', 'Yes') -WindowStyle Hidden -Wait -PassThru -ErrorAction SilentlyContinue
        if ($p -and $p.ExitCode -eq 0) { log 'dynamic tick disabled, steadier frame pacing after reboot' 'OK' }
        else { log ("bcdedit rejected disabledynamictick (exit {0})" -f $(if ($p) { $p.ExitCode } else { 'n/a' })) 'WARN' }
    } catch { log ("could not set disabledynamictick: {0}" -f $_.Exception.Message) 'WARN' }

    log 'reboot once for the boot timer change to take effect' 'DBG'
}

function doSysGpu {
    emit @{ e = 'stage'; m = 'gpu preference' }
    rule 'windows gpu preference'
    $k = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
    if (-not (Test-Path $k)) { New-Item $k -Force | Out-Null }

    $s = winExeScan
    $i = 0
    foreach ($e in $s) {
        $i++
        New-ItemProperty $k -Name $e -PropertyType String -Value 'GpuPreference=2;' -Force | Out-Null
        emit @{ e = 'progress'; p = [int]($i / $s.Count * 100) }
    }

    if ($i) { log ("$i executables pinned to the fast gpu") 'OK' }
    else { log 'no emulator executables found on disk' 'WARN' }
}

function raiseEmulatorPriority {
    # one process per executable only. aow_exe alone spawns close to thirty
    # workers and lifting every one of them makes the emulator stutter, so the
    # biggest instance per name is the only one we touch.
    $n = 0
    foreach ($name in $script:emu) {
        $p = Get-Process -Name $name -ErrorAction SilentlyContinue |
                Sort-Object -Property WorkingSet64 -Descending |
                Select-Object -First 1
        if (-not $p) { continue }
        try {
            $p.PriorityClass = 'High'
            log ("high priority, {0} pid {1}" -f $p.ProcessName, $p.Id) 'OK'
            $n++
        }
        catch {
            log ("could not raise {0}: {1}" -f $p.ProcessName, $_.Exception.Message) 'WARN'
        }
    }
    foreach ($p in (Get-Process -Name adb -ErrorAction SilentlyContinue)) {
        try { $p.PriorityClass = 'High' } catch {}
    }
    return $n
}

function doSysPrio {
    emit @{ e = 'stage'; m = 'process priority' }
    rule 'emulator process priority'
    if (-not (raiseEmulatorPriority)) { log 'no emulator process running yet' 'WARN' }
}

function doSysGameBar {
    emit @{ e = 'stage'; m = 'game mode' }
    rule 'game mode and game bar'

    $bar = 'HKCU:\Software\Microsoft\GameBar'
    if (-not (Test-Path $bar)) { New-Item $bar -Force | Out-Null }
    Set-ItemProperty $bar 'AutoGameModeEnabled' 1 -Type DWord -Force
    Set-ItemProperty $bar 'AllowAutoGameMode' 1 -Type DWord -Force
    Set-ItemProperty $bar 'ShowStartupPanel' 0 -Type DWord -Force
    log 'game mode on, startup panel off' 'OK'

    $cap = 'HKCU:\System\GameConfigStore'
    if (-not (Test-Path $cap)) { New-Item $cap -Force | Out-Null }
    Set-ItemProperty $cap 'GameDVR_Enabled' 0 -Type DWord -Force
    Set-ItemProperty $cap 'GameDVR_FSEBehaviorMode' 2 -Type DWord -Force
    Set-ItemProperty $cap 'GameDVR_HonorUserFSEBehaviorMode' 1 -Type DWord -Force
    Set-ItemProperty $cap 'GameDVR_DXGIHonorFSEWindowsCompatible' 1 -Type DWord -Force
    log 'background recording off' 'OK'
}

function doSysPower {
    emit @{ e = 'stage'; m = 'power plan' }
    rule 'power plan'

    $hi  = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
    $usb = '4d5f3eae-e4c3-4889-8746-8bbd924263fb'

    if ((powercfg /list) -match $hi) { log 'high performance plan is already on this machine' 'OK' }
    else {
        powercfg -duplicatescheme $hi | Out-Null
        log 'high performance plan made' 'OK'
    }

    powercfg /setacvalueindex $hi $usb 0 | Out-Null
    powercfg /setdcvalueindex $hi $usb 0 | Out-Null
    powercfg /setactive $hi | Out-Null
    log 'plan activated, usb sleep off on ac and battery' 'OK'
}

function doSysCache {
    emit @{ e = 'stage'; m = 'cache cleanup' }
    rule 'emulator temp cleanup'
    $t = @(
        "$env:LOCALAPPDATA\Temp\TxGameDownload"
        "$env:LOCALAPPDATA\Temp\TxGameAssistant"
        "$env:TEMP\TxGameDownload"
        "$env:LOCALAPPDATA\TxGameAssistant\ui\cache"
    )

    $n = 0
    foreach ($p in $t) {
        if (-not (Test-Path $p)) { continue }
        try {
            Get-ChildItem $p -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
            log ("emptied {0}" -f $p) 'OK'
            $n++
        } catch {}
    }
    if (-not $n) { log 'nothing cached to clean' 'WARN' }
}

function doSysSrv {
    emit @{ e = 'stage'; m = 'services' }
    rule 'emulator services'
    $n = 0
    foreach ($s in @('TxGameAssistantSrv', 'TencentUpdateSrv')) {
        if (Get-Service $s -ErrorAction SilentlyContinue) {
            try {
                Stop-Service $s -Force -ErrorAction SilentlyContinue
                Set-Service $s -StartupType Manual -ErrorAction SilentlyContinue
                log ("$s stopped, startup set to manual") 'OK'
                $n++
            } catch { log ("$s would not stop, probably wants admin") 'WARN' }
        }
    }
    if (-not $n) { log 'none of those services exist here' 'WARN' }
}

# â”€â”€ runs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function runLite {
    banner
    rule 'boost lite'
    emit @{ e = 'stage'; m = 'boost lite' }
    doCommon
    doProps
    doRam
    doSysPrio
    saveBk
    done 'close the game and open it again'
}

function runMax {
    banner
    rule 'boost max'
    emit @{ e = 'stage'; m = 'boost max' }
    doCommon
    doJit
    doProps
    doLatch
    doNet
    doMem
doInput
    doFps
doLatency
    doGfx
    doQemu
    doRam
    doPrivacy
    doAppOps
    doKernelNet
    doSysPrio
    saveBk
    done 'close the game and open it again'
}

function runUltra {
    banner
    rule 'boost ultra'
    emit @{ e = 'stage'; m = 'boost ultra' }
    doCommon
    doJit
    doProps
    doLatch
    doNet
    doTcpTune
    doMem
    doInput
    doFps
doLatency
    doGfx
doCpu
    doGpu
    doIo
    doQemu
    doPubg $script:fpeak
    doRam
    doPrivacy
    doAppOps
    doKernel
    doSysPrio
    saveBk
    done 'reboot the emulator so the clock and bbr changes stick'
}

function runWindows {
    banner
    rule 'windows optimizations'
    emit @{ e = 'stage'; m = 'windows optimizations' }
    doGameLoopEngine
    doWinGpu
    doWinPrio
    doWinGameBar
    doSysMultimedia
    doSysThrottle
    doSysTcp
    doSysFullscreen
doWinPower
    doWinCache
    doWinSrv
    doWinPolish
    doWinHz
    doWinTimer
    done 'reboot windows so the scheduler, fullscreen and boot-timer changes fully apply'
}

function runCustom {
    $want = @()
    foreach ($m in ($Modules -split '[,;\s]+')) {
        $m = $m.Trim().ToLower()
        if ($m) { $want += $m }
    }

    if (-not $want.Count) { log 'no modules selected' 'WARN'; return }

    banner
    rule ('custom: {0} modules' -f $want.Count)
    emit @{ e = 'stage'; m = ('custom run, {0} modules' -f $want.Count) }

    $plan = @(
        @{ id = 'system';  run = { doSysGpu; doSysPrio; doSysGameBar; doSysPower; doSysCache; doSysSrv } }
        @{ id = 'pubg';    run = { doPubg $script:fpeak } }
        @{ id = 'network'; run = { doNet } }
        @{ id = 'memory';  run = { doMem; doRam } }
        @{ id = 'input';   run = { doInput } }
@{ id = 'privacy'; run = { doPrivacy } }
        @{ id = 'kernel';  run = { doKernel } }
        @{ id = 'bbr';     run = { doKernelNet } }
        @{ id = 'qemu';    run = { doQemu } }
    )

    $n = $want.Count
    $i = 0
    foreach ($step in $plan) {
        if ($want -notcontains $step.id) { continue }
        $i++
        emit @{ e = 'progress'; p = [int](($i - 1) / $n * 95) }
        & $step.run
    }

    saveBk
    done 'reboot the emulator and the game to pick everything up'
}

function menu {
    while ($true) {
        banner

        $name = 'none'
        if ($script:dev) { $name = $script:dev }

        $st = 'not connected'
        $sc = 'Red'
        if ($script:dev) {
            if (alive) { $st = 'connected'; $sc = 'Green' }
            else { $st = 'not answering'; $sc = 'Yellow' }
        }

        $adbs = 'missing'
        if ($script:adb) { $adbs = Split-Path $script:adb -Leaf }

$rt = 'not available'
        if ($script:root) { $rt = "available via {0}" -f $script:rootMethod }

        $cc = ''
        $se = ''
        if ($script:dev -and $script:root) {
            $cc = kget '/proc/sys/net/ipv4/tcp_congestion_control'
            $se = $script:selinux
        }

        top 'status'
        kv 'device' ("{0}   [{1}]" -f $name, $st) $sc
        kv 'adb' $adbs 'DarkGray'
        kv 'root' $rt 'DarkGray'
        if ($cc) { kv 'congestion' $cc 'Cyan' }
        if ($script:rootManager) { kv 'root manager' $script:rootManager 'DarkGray' }
        if ($se) { kv 'selinux' $se 'DarkGray' }
        kv 'fps' ("min {0} / max {1} / peak {2}" -f $script:fmin, $script:fmax, $script:fpeak) 'Cyan'
        split

        group 'BOOST'
        pick '1' 'boost lite' 'animations, ram, priority'
        pick '2' 'boost max' 'fps, gfx, net, touch, heat'
        pick '3' 'boost ultra' 'adds root and pubg ini'
        row
        group 'WINDOWS'
        pick '4' 'optimizations' 'gpu, game mode, power, cache'
        row
        group 'EXIT'
        pick '0' 'quit' ''
        bottom

        Write-Host ''
        $c = Read-Host '   pick'

        switch ($c) {
            '1' { runLite; pause }
            '2' { runMax; pause }
            '3' { runUltra; pause }
            '4' { runWindows; pause }
            'r' { undo; pause }
            '0' { return }
            default {
                Write-Host '   that is not on the list' -ForegroundColor Red
                Start-Sleep -Seconds 1
            }
        }
    }
}

function watchDevice {
    # keeps looking for the accepted emulator until this process is killed.
    # quiet mode stops the probe helpers from repeating the same lines forever
    $script:quiet = $true
    $lastKey = ''

    emit @{ e = 'watch'; state = 'searching'; target = ($script:accepted -join ' / ') }

    while ($true) {
        # a tuning run owns the device while it works, so stand down until it
        # is finished instead of racing it and flooding the activity log
        while (Get-Process -Name powershell, pwsh -EA 0 | Where-Object {
                $_.Id -ne $PID -and
                (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -EA 0).CommandLine -match 'rift-boost\.ps1.+-Action\s+(lite|max|ultra|windows|custom|restore)'
            }) { Start-Sleep -Seconds 2 }

        $script:dev = $null
        $script:brand = ''
        $script:model = ''
        $script:andro = ''
        $script:loop = $false
        $script:root = $false
        $script:rootMethod = ''

        $script:dev = selectTarget

        if ($script:dev) {
            readDevice
            checkRoot
            checkLoop
            if (-not (alive)) { $script:dev = $null }
        }

        $key = if ($script:dev) {
            "$($script:dev)|$($script:brand)|$($script:model)|$([bool]$script:root)|$($script:rootMethod)|$([bool]$script:loop)|$($script:selinux)"
        }
        else { 'none' }

        if ($key -ne $lastKey) {
            $lastKey = $key
            pushStatus
            if ($script:dev) {
                emit @{ e = 'log'; l = 'ok'; t = (Get-Date -Format 'HH:mm:ss'); m = ("device connected: {0} {1} {2} (root {3})" -f $script:dev, $script:brand, $script:model, $(if ($script:root) { 'yes' } else { 'no' })) }
            }
            else {
                emit @{ e = 'log'; l = 'warn'; t = (Get-Date -Format 'HH:mm:ss'); m = ("no {0} yet, still looking" -f ($script:accepted -join ' / ')) }
            }
        }

        Start-Sleep -Seconds 3
    }
}

function benchPackage {
    # the package that actually owns a window is the one worth measuring,
    # otherwise fall back to whichever pubg build is installed
    $focused = ([string](sh "dumpsys window windows 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp'" -q)).Trim()
    if ($focused -match '([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)') {
        $pkg = $Matches[1]
        if ($pkg -match '^(com\.|net\.|org\.)' -and $pkg -ne 'android') {
            $running = ([string](sh "pidof $pkg" -q)).Trim()
            if ($running) { return $pkg }
        }
    }
    foreach ($p in $script:pubg) {
        if (([string](sh "pidof $p" -q)).Trim()) { return $p }
    }
    return $null
}

function readFrameStats {
    param([string]$pkg)
    $raw = [string](sh "dumpsys gfxinfo $pkg 2>/dev/null" -q)
    if (-not $raw) { return $null }
    $frames = $null
    $jank = $null
    $pct = $null
    if ($raw -match 'Total frames rendered:\s*(\d+)') { $frames = [int64]$Matches[1] }
    if ($raw -match 'Janky frames:\s*(\d+)') { $jank = [int64]$Matches[1] }
    if ($raw -match 'Janky frames:\s*\d+\s*\(([\d.]+)%\)') { $pct = [double]$Matches[1] }
    if ($null -eq $frames) { return $null }
    return [ordered]@{ frames = $frames; jank = $jank; pct = $pct }
}

function measureFps {
    param([int]$Seconds = 8)
    $pkg = benchPackage
    if (-not $pkg) {
        return [ordered]@{ ok = $false; reason = 'no-game'; message = 'no pubg build is running, start the game first' }
    }

    $first = readFrameStats $pkg
    if (-not $first) {
        return [ordered]@{ ok = $false; reason = 'no-stats'; package = $pkg; message = "gfxinfo gave nothing for $pkg, this build blocks it" }
    }

    $sw = [Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Seconds $Seconds
    $sw.Stop()

    $second = readFrameStats $pkg
    if (-not $second) {
        return [ordered]@{ ok = $false; reason = 'lost'; package = $pkg; message = 'gfxinfo stopped answering mid sample' }
    }

    $dFrames = $second.frames - $first.frames
    if ($dFrames -le 0) {
        $hw = [string](sh 'getprop ro.hardware' -q)
    if ($hw -match 'vbox|goldfish|ranchu') {
        return [ordered]@{
            ok      = $false
            reason  = 'virtualized'
            package = $pkg
            message = "$hw has no real gpu frame path, so android cannot count game frames here. read the fps counter in the game itself"
        }
    }

    return [ordered]@{ ok = $false; reason = 'idle'; package = $pkg; message = "no frames were drawn in $([int]$sw.Elapsed.TotalSeconds)s, the game is not rendering" }
    }

    $fps = [math]::Round($dFrames / $sw.Elapsed.TotalSeconds, 2)
    $dJank = if ($null -ne $first.jank -and $null -ne $second.jank) { $second.jank - $first.jank } else { $null }
    $jankPct = if ($null -ne $dJank) { [math]::Round(($dJank / $dFrames) * 100, 2) } else { $null }

    return [ordered]@{
        ok        = $true
        package   = $pkg
        fps       = $fps
        frames    = $dFrames
        seconds   = [math]::Round($sw.Elapsed.TotalSeconds, 2)
        jank      = $dJank
        jankPct   = $jankPct
        firstPct  = $first.pct
        secondPct = $second.pct
    }
}

function initPresentProbe {
    if ($script:presentReady) { return $true }
    try {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class RiftPresent {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [StructLayout(LayoutKind.Sequential)]
    public struct Timing {
        public ulong qpcCompose, qpcVBlank, qpcFlipStart, qpcFlipComplete, qpcCommit;
        public uint dwFrameNumber, dwInputEmitted;
        public ushort rateNum, rateDen;
        public ulong pad1, pad2, pad3, pad4, pad5, pad6;
    }
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetCompositionTimingInfo(IntPtr h, out Timing t);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public static IntPtr Find(int[] pids) {
        IntPtr best = IntPtr.Zero; long bestArea = 0; int bestLen = 0;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint p; GetWindowThreadProcessId(h, out p);
            bool match = false;
            foreach (int t in pids) { if ((int)p == t) { match = true; break; } }
            if (!match) return true;
            if (!IsWindowVisible(h)) return true;
            int len = GetWindowTextLength(h);
            if (len <= 0) return true;
            RECT r; if (!GetWindowRect(h, out r)) return true;
            long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
            if (area > bestArea) { bestArea = area; best = h; bestLen = len; }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    public static uint FrameNumber(IntPtr h, out double hz, out int hr) {
        Timing t;
        hz = 0;
        hr = DwmGetCompositionTimingInfo(h, out t);
        if (hr != 0) return 0;
        if (t.rateDen != 0) hz = (double)t.rateNum / (double)t.rateDen;
        return t.dwFrameNumber;
    }
}
'@ -EA SilentlyContinue | Out-Null
        $script:presentReady = $true
    }
    catch {
        $script:presentReady = $false
    }
    return [bool]$script:presentReady
}

function measureHostPresentRate {
    param([int]$Seconds = 8, [string[]]$ProcessNames = @())

    if (-not (initPresentProbe)) {
        return [ordered]@{ ok = $false; reason = 'no-api'; message = 'could not reach the desktop window manager' }
    }

    if (-not $ProcessNames -or -not $ProcessNames.Count) {
        $ProcessNames = @('AndroidEmulatorEn', 'AndroidEmulator', 'AndroidEmulatorEx', 'aow_exe', 'TxGameAssistant', 'AppMarket')
    }

    $pids = @()
    foreach ($n in $ProcessNames) {
        $pids += @(Get-Process -Name $n -EA 0 | Select-Object -ExpandProperty Id)
    }
    if (-not $pids.Count) {
        return [ordered]@{ ok = $false; reason = 'no-emulator'; message = 'the emulator is not running, so there is no window to measure' }
    }

    $hwnd = [RiftPresent]::Find([int[]]$pids)
    if ($hwnd -eq [IntPtr]::Zero) {
        return [ordered]@{ ok = $false; reason = 'no-window'; message = 'the emulator process has no visible window' }
    }

    $hz = 0.0
    $hr = 0
    $first = [RiftPresent]::FrameNumber($hwnd, [ref]$hz, [ref]$hr)
    if ($first -eq 0) {
        return [ordered]@{
            ok      = $false
            reason  = 'no-timing'
            message = ("windows would not report window timing for the emulator (dwm error 0x{0:X8})" -f $hr)
        }
    }

    $sw = [Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Seconds $Seconds
    $sw.Stop()

    $hz2 = 0.0
    $hr2 = 0
    $second = [RiftPresent]::FrameNumber($hwnd, [ref]$hz2, [ref]$hr2)
    if ($hz2 -eq 0 -or $second -le $first) {
        return [ordered]@{ ok = $false; reason = 'no-frames'; message = 'the emulator window presented nothing during the sample' }
    }

    $frames = $second - $first
    $rate = [math]::Round($frames / $sw.Elapsed.TotalSeconds, 2)
    $monitor = if ($hz2 -gt 0) { [math]::Round($hz2, 2) } else { $null }

    return [ordered]@{
        ok      = $true
        source  = 'host'
        window  = $true
        frames  = $frames
        seconds = [math]::Round($sw.Elapsed.TotalSeconds, 2)
        rate    = $rate
        monitor = $monitor
        keepingUp = if ($monitor) { $rate -ge ($monitor * 0.9) } else { $null }
    }
}

function runBench {
    emit @{ e = 'stage'; m = 'measuring frame rate' }
    rule 'measure frame rate'

    $r = measureFps -Seconds $BenchSeconds

    if ($r.ok) {
        log ("{0}: {1} fps over {2}s ({3} frames)" -f $r.package, $r.fps, $r.seconds, $r.frames) 'OK'
        if ($null -ne $r.jankPct) { log ("jank during sample: {0}%" -f $r.jankPct) 'OK' }
        emit @{ e = 'bench'; ok = $true; source = 'device'; package = $r.package; fps = $r.fps; frames = $r.frames; seconds = $r.seconds; jank = $r.jank; jankPct = $r.jankPct }
        return
    }

    log ("android cannot count frames here: {0}" -f $r.message) 'WARN'

    # fall back to asking the desktop window manager how fast the emulator
    # window is presenting. this is the window's present rate, not the game's
    # own frame rate.
    $h = measureHostPresentRate -Seconds $BenchSeconds
    if ($h.ok) {
        log ("emulator window presented {0} frames in {1}s = {2} present/s (monitor {3}Hz)" -f $h.frames, $h.seconds, $h.rate, $h.monitor) 'OK'
        if ($null -ne $h.keepingUp) {
            log ("keeping up with the display: {0}" -f $(if ($h.keepingUp) { 'yes' } else { 'no, the host is behind' })) 'OK'
        }
        emit @{ e = 'bench'; ok = $true; source = 'host'; rate = $h.rate; frames = $h.frames; seconds = $h.seconds; monitor = $h.monitor; keepingUp = $h.keepingUp; deviceReason = $r.reason }
        return
    }

    log ("host measurement unavailable: {0}" -f $h.message) 'WARN'
    emit @{
        e        = 'bench'
        ok       = $false
        reason   = $r.reason
        device   = $r.message
        host     = $h.message
        message  = "$($r.message) / $($h.message). read the fps counter in the game for a true reading"
    }
}

function runPreview {
    emit @{ e = 'stage'; m = 'checking what restore would do' }
    rule 'rollback preview'
    $r = previewRestore
    if (-not $r.ok) { log $r.message 'WARN'; emit @{ e = 'preview'; ok = $false; message = $r.message }; return }

    log ("rollback preview: {0} value(s) would change, {1} already match, {2} no longer present" -f $r.wouldChange, $r.already, $r.absent) 'OK'
    if ($r.ifeoExtra) { log ("{0} extra ifeo subkey/subkeys would be removed" -f $r.ifeoExtra) 'OK' }
    log ("also covered: {0} power values, {1} bcd value(s), {2} fsutil setting(s), {3} android value(s)" -f $r.powerVals, $r.bcd, $r.fsutil, $r.android) 'OK'
    foreach ($row in $r.rows) { log $row 'DBG' }
    emit @{ e = 'preview'; ok = $true; wouldChange = $r.wouldChange; already = $r.already; absent = $r.absent; ifeoExtra = $r.ifeoExtra }
}

function boot {
    if ($Restore) { $Action = 'restore' }
    if (-not $script:Json) {
        Write-Host ''
        Write-Host ("  {0} v{1}" -f $script:me, $script:ver) -ForegroundColor Cyan
    }

    $script:adb = findAdb
    if (-not $script:adb) {
        if (grabAdb) { $script:adb = findAdb }
    }
    if (-not $script:adb) { fatal 'no adb anywhere, drop platform-tools next to the engine' }

log ("adb found at {0}" -f (Split-Path $script:adb -Leaf)) 'OK'

    if ($Action -eq 'watch') { watchDevice; return }

    pickDev
    readDevice
checkRoot
    checkLoop
    loadKernelBaseline
    pushStatus

if ($Action -eq 'status') { return }
    if ($Action -eq 'preview') { runPreview; return }
    if ($Action -eq 'bench') { runBench; return }
    if ($Action -eq 'restore') { undoWindows; return }

    if ($Action) {
        newSafetySnapshot | Out-Null
        switch ($Action) {
            'lite'    { runLite }
            'max'     { runMax }
            'ultra'   { runUltra }
            'windows' { runWindows }
            'custom'  { runCustom }
        }
        emit @{ e = 'done'; ok = $script:ok; warn = $script:wn; err = $script:er; action = $Action; log = $script:logFile }
        return
    }

    if ($script:Json) { return }
    menu
}

boot
