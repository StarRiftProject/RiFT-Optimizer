param([switch]$NoBbr)

$ErrorActionPreference = 'Stop'

$state = [ordered]@{
    '/proc/sys/net/ipv4/tcp_available_congestion_control' = $(if ($NoBbr) { 'reno cubic' } else { 'reno cubic bbr' })
    '/proc/sys/net/ipv4/tcp_congestion_control'            = 'cubic'
    '/proc/sys/net/core/default_qdisc'                     = 'pfifo_fast'
    '/proc/sys/net/ipv4/tcp_rmem'                          = '4096 131072 6291456'
    '/proc/sys/net/ipv4/tcp_wmem'                          = '4096 16384 4194304'
    '/proc/sys/net/core/rmem_max'                          = '212992'
    '/proc/sys/net/core/wmem_max'                          = '212992'
    '/proc/sys/net/ipv4/tcp_fastopen'                      = '1'
    '/proc/sys/net/ipv4/tcp_slow_start_after_idle'         = '1'
    '/proc/sys/net/ipv4/tcp_mtu_probing'                   = '0'
    '/proc/sys/net/core/somaxconn'                         = '4096'
    '/proc/sys/net/core/netdev_max_backlog'                = '1000'
    '/proc/sys/net/ipv4/tcp_no_metrics_save'               = '0'
    '/proc/sys/vm/swappiness'                              = '60'
    '/proc/sys/vm/dirty_ratio'                             = '20'
    '/proc/sys/vm/dirty_background_ratio'                  = '10'
    '/proc/sys/vm/compaction_proactiveness'                = '0'
    '/proc/sys/kernel/sched_latency_ns'                    = '6000000'
    '/proc/sys/kernel/sched_min_granularity_ns'            = '3000000'
    '/proc/sys/kernel/sched_wakeup_granularity_ns'         = '4000000'
    '/proc/sys/kernel/sched_rt_runtime_us'                 = '950000'
}

$enginePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'engine\rift-boost.ps1'
if (-not (Test-Path $enginePath)) { $enginePath = (Resolve-Path (Join-Path $PSScriptRoot '..\engine\rift-boost.ps1')).Path }

# load the engine's kernel logic without running boot()
$src = Get-Content -LiteralPath $enginePath -Raw
$src = $src -replace '(?ms)^boot[\s\S]*$', ''
$tmp = Join-Path $env:TEMP ('rift_logic_' + [guid]::NewGuid().ToString('N') + '.ps1')
$src | Out-File -LiteralPath $tmp -Encoding UTF8
. $tmp
Remove-Item $tmp -Force

# override the device layer with an in-memory filesystem
$script:dev = 'mock:5555'
$script:root = $true
$script:rootMethod = 'su -c'
$script:kernelSnap = [ordered]@{}
$script:data = Join-Path $env:TEMP 'rift_mock'
if (-not (Test-Path $script:data)) { New-Item $script:data -ItemType Directory -Force | Out-Null }

function global:Unwrap {
    # emulate what a real posix shell does with su -c '<cmd>': drop the
    # wrapper, then turn the '\'' escape back into a plain quote
    param([string]$c)
    if ($null -eq $c) { return '' }
    $s = ([string]$c).Trim()
    if ($s -match '^(?:su\s+0\s+-c|su\s+-c|ksud\s+-c|apd\s+-c|magisk\s+su\s+-c|sh\s+-c|sudo\s+-n\s+sh\s+-c)\s+(.*)$') { $s = $Matches[1] }
    if ($s.StartsWith("'")) { $s = $s.Substring(1) }
    if ($s.EndsWith("'")) { $s = $s.Substring(0, $s.Length - 1) }
    return $s.Replace("'\''", "'")
}

function global:sh {
    param([string]$c, [switch]$q)
    $cmd = Unwrap $c
    if ($cmd -match "^cat '([^']+)'") {
        $p = $Matches[1]
        if ($state.Contains($p)) { return $state[$p] }
        return $null
    }
    if ($cmd -match "^echo '([^']*)' > '([^']+)'") {
        $v = $Matches[1]; $p = $Matches[2]
        if ($state.Contains($p)) { $state[$p] = $v; return '' }
        return 'read-only'
    }
    return ''
}

function emit { param($o) }
function rule { param($n) }
function log { param($m, $l) }

Write-Host "=== quoting a real posix shell would receive ==="
$probe = "cat '/proc/sys/net/ipv4/tcp_congestion_control' 2>/dev/null"
$bad = 0
foreach ($m in @('su -c', 'su 0', 'ksud', 'apd', 'magisk su', 'sudo -n', 'debug ramdisk')) {
    $back = Unwrap (wrapCmd (rootWrap $m) $probe)
    if ($back -eq $probe) { Write-Host ("  {0,-13} round-trips" -f $m) }
    else { Write-Host ("  {0,-13} MANGLED -> {1}" -f $m, $back) -ForegroundColor Red; $bad++ }
}
if ($bad) { Write-Host "  FAIL: quoting broken" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=== doKernelNet on a kernel WITH bbr ==="
doKernelNet
$cc = $state['/proc/sys/net/ipv4/tcp_congestion_control']
$qd = $state['/proc/sys/net/core/default_qdisc']
Write-Host ("  congestion_control = {0}" -f $cc)
Write-Host ("  default_qdisc      = {0}" -f $qd)
if ($cc -ne 'bbr') { Write-Host "  FAIL: bbr not applied" -ForegroundColor Red; exit 1 }
if ($qd -ne 'fq') { Write-Host "  FAIL: fq qdisc not applied" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=== baseline captured for rollback ==="
foreach ($p in $script:kernelSnap.Keys) {
    Write-Host ("  {0}  was {1}" -f $p, $script:kernelSnap[$p].before)
}
if ($script:kernelSnap['/proc/sys/net/ipv4/tcp_congestion_control'].before -ne 'cubic') {
    Write-Host "  FAIL: baseline did not record the original cubic" -ForegroundColor Red; exit 1
}
Write-Host "  congestion_control baseline = cubic (correct)" -ForegroundColor Green

Write-Host ""
Write-Host "=== undoKernel restores the original values ==="
undoKernel
if ($state['/proc/sys/net/ipv4/tcp_congestion_control'] -ne 'cubic') { Write-Host "  FAIL: cc not restored" -ForegroundColor Red; exit 1 }
if ($state['/proc/sys/net/ipv4/tcp_fastopen'] -ne '1') { Write-Host "  FAIL: fastopen not restored" -ForegroundColor Red; exit 1 }
if ($state['/proc/sys/net/core/default_qdisc'] -ne 'pfifo_fast') { Write-Host "  FAIL: qdisc not restored" -ForegroundColor Red; exit 1 }
Write-Host "  congestion_control = cubic, qdisc = pfifo_fast, fastopen = 1" -ForegroundColor Green

Write-Host ""
Write-Host "=== doKernelVm uses memory-proportional min_free_kbytes ==="
doKernelVm
Write-Host ("  swappiness = {0}" -f $state['/proc/sys/vm/swappiness'])
if ($state['/proc/sys/vm/swappiness'] -ne '40') { Write-Host "  FAIL" -ForegroundColor Red; exit 1 }
Write-Host "  vm tuning OK" -ForegroundColor Green

Write-Host ""
Write-Host "=== kernel WITHOUT bbr must not force it ==="
$state['/proc/sys/net/ipv4/tcp_available_congestion_control'] = 'reno cubic'
$state['/proc/sys/net/ipv4/tcp_congestion_control'] = 'cubic'
$script:kernelSnap = [ordered]@{}
doKernelNet
$cc2 = $state['/proc/sys/net/ipv4/tcp_congestion_control']
Write-Host ("  congestion_control = {0}" -f $cc2)
if ($cc2 -ne 'reno') { Write-Host "  FAIL: expected fallback to reno" -ForegroundColor Red; exit 1 }
Write-Host "  fell back to reno without touching the qdisc" -ForegroundColor Green

Remove-Item (Join-Path $env:TEMP 'rift_mock') -Recurse -Force -EA 0
Write-Host "`nRESULT: PASS" -ForegroundColor Green