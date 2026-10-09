param([switch]$Apply)

# Probes whether this guest will actually accept a candidate tuning value.
# Everything is snapshotted first and rolled back at the end, so the probe
# leaves the device exactly as it found it.

$ErrorActionPreference = 'SilentlyContinue'

$dev = (& adb devices 2>$null | Select-String 'device$' | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1)
if (-not $dev) { Write-Host 'no device'; exit 1 }
Write-Host "device: $dev   id -u: $((& adb -s $dev shell id -u 2>$null) -join '')"
Write-Host "apply mode: $($Apply.IsPresent)"
Write-Host ""

function A([string]$c) { return ((& adb -s $dev shell $c 2>$null) -join '').Trim() }

$results = New-Object System.Collections.ArrayList
$saved = New-Object System.Collections.ArrayList

function Probe {
    param(
        [string]$Group,
        [string]$Kind,       # prop | settings | sysctl
        [string]$Name,       # prop name, or "namespace/key" for settings
        [string]$Path,       # sysctl path
        [string]$Value,
        [string]$Why = ''
    )

    $readCur = ''
    $writeCmd = $null
    $readCmd = $null

    if ($Kind -eq 'prop') {
        $readCmd = "getprop $Name"
        $writeCmd = "setprop $Name $Value"
    }
    elseif ($Kind -eq 'settings') {
        $parts = $Name -split '/'
        $readCmd = "settings get $($parts[0]) $($parts[1])"
        $writeCmd = "settings put $($parts[0]) $($parts[1]) $Value"
    }
    else {
        $readCmd = "cat $Path"
        $writeCmd = "echo $Value > $Path"
    }

    $before = A $readCmd
    $readable = $null -ne $before
    $accepted = $false
    $verified = $false

    if ($Apply -and $readable) {
        # build the exact restore command now, while the original value is known,
        # so rollback cannot guess or misfire later
        $restore = $null
        if ($Kind -eq 'prop') {
            if ([string]::IsNullOrEmpty($before)) { $restore = "setprop $Name ''" }
            else { $restore = "setprop $Name $before" }
        }
        elseif ($Kind -eq 'settings') {
            $parts = $Name -split '/'
            if ([string]::IsNullOrEmpty($before) -or $before -eq 'null') { $restore = "settings delete $($parts[0]) $($parts[1])" }
            else { $restore = "settings put $($parts[0]) $($parts[1]) $before" }
        }
        else {
            if ([string]::IsNullOrEmpty($before)) { $restore = "echo 0 > $Path" }
            else { $restore = "echo $before > $Path" }
        }
        [void]$saved.Add([pscustomobject]@{ name = $Name; restore = $restore; before = $before })
        A $writeCmd | Out-Null
        $after = A $readCmd
        $accepted = ($after -eq $Value)
        $verified = $accepted
    }

    [void]$results.Add([pscustomobject]@{
        Group = $Group; Name = $Name; Current = $before
        Readable = $readable; Accepted = $accepted; Verified = $verified; Why = $Why
    })
}

# ---------- frame pacing / refresh ----------
Probe 'refresh' settings 'global/min_refresh_rate' $null '120' 'lower floor stops the compositor hunting between targets'
Probe 'refresh' settings 'global/peak_refresh_rate' $null '120' 'must match min, mismatched floors cause pacing churn'
Probe 'refresh' settings 'system/peak_refresh_rate' $null '120' 'per-app override of the global peak'
Probe 'refresh' settings 'system/min_refresh_rate' $null '120' 'per-app override of the global floor'

# ---------- vsync / rendering ----------
Probe 'render' prop 'debug.sf.disable_vsync' $null '1' 'removes the guest vsync wait'
Probe 'render' prop 'debug.hwui.disable_vsync' $null '1' 'stops the UI toolkit waiting on vsync'
Probe 'render' prop 'debug.sf.latch_unsignaled' $null '1' 'reduces input to photon latency'
Probe 'render' prop 'debug.composition.type' $null 'gpu' 'gpu composition'
Probe 'render' prop 'windowsmgr.force_fps' $null '120' 'pins the guest display to a real rate'

# ---------- input latency ----------
Probe 'input' settings 'system/windowsmgr.max_events_per_sec' $null '500' 'longer input queue drain window'
Probe 'input' settings 'system/input_boost_duration' $null '300' 'keeps input boosted after a tap'
Probe 'input' prop 'debug.hwui.fps_divisor' $null '1' 'no artificial hwui frame cap'
Probe 'input' prop 'qemu.mouse.smooth' $null 'true' 'emulator mouse smoothing on'
Probe 'input' prop 'qemu.input.raw_mouse' $null 'true' 'raw mouse input, no translation lag'
Probe 'input' prop 'qemu.touch.sampling_rate' $null '120' 'touch poll rate matches the display'
Probe 'input' prop 'qemu.input.raw_keyboard' $null 'true' 'raw keyboard input'

# ---------- network ----------
Probe 'net' sysctl $null '/proc/sys/net/ipv4/tcp_fastopen' '3' 'forward reverse, fewer round trips on connect'
Probe 'net' sysctl $null '/proc/sys/net/ipv4/tcp_no_delay_save' '1' 'kills the nagle/delayed-ack 40ms stall'
Probe 'net' sysctl $null '/proc/sys/net/core/rmem_max' '16777216' 'larger receive buffers for bursts'
Probe 'net' sysctl $null '/proc/sys/net/core/wmem_max' '16777216' 'larger send buffers'
Probe 'net' sysctl $null '/proc/sys/net/core/netdev_max_backlog' '5000' 'deeper rx queue under load'
Probe 'net' settings 'global/tcp_default_init_rwnd' $null '60' 'bigger initial window'
Probe 'net' settings 'global/private_dns_mode' $null 'hostname' 'encrypted dns'

# ---------- memory / gc ----------
Probe 'mem' prop 'dalvik.vm.dex2oat-filter' $null '~lib:*' 'skip dex2oat on hot system libs'
Probe 'mem' prop 'dalvik.vm.heaptargetutilization' $null '0.5' 'more aggressive gc, steadier frame times'
Probe 'mem' prop 'dalvik.vm.heapmaxfree' $null '8m' 'smaller heap headroom'
Probe 'mem' prop 'dalvik.vm.heapgrowthlimit' $null '512m' 'lets the heap grow without a hard stall'
Probe 'mem' settings 'global/sustained_performance_mode' $null '1' 'sustained clocks while hot'

# ---------- scheduler ----------
Probe 'sched' sysctl $null '/proc/sys/kernel/sched_latency_ns' '6000000' 'shorter scheduling quantum'
Probe 'sched' sysctl $null '/proc/sys/kernel/sched_wakeup_granularity_ns' '4000000' 'wakes runnable tasks faster'
Probe 'sched' sysctl $null '/proc/sys/kernel/sched_min_granularity_ns' '300000' 'finer wakeup granularity'
Probe 'sched' sysctl $null '/proc/sys/kernel/sched_rt_runtime_us' '950000' 'less realtime throttling'
Probe 'sched' sysctl $null '/proc/sys/vm/swappiness' '60' 'normal swap behaviour'

Write-Host "=== RESULTS ==="
Write-Host ""
foreach ($g in @('refresh', 'render', 'input', 'net', 'mem', 'sched')) {
    $rows = @($results | Where-Object { $_.Group -eq $g })
    Write-Host "--- $g ---"
    foreach ($r in $rows) {
        $status = if (-not $r.Readable) { 'UNREADABLE' }
                  elseif ($r.Verified) { 'ACCEPTED' }
                  elseif ($Apply) { 'REJECTED' }
                  else { 'readable' }
        $cur = if ([string]::IsNullOrEmpty($r.Current)) { '(empty)' } else { $r.Current }
        if ($cur.Length -gt 26) { $cur = $cur.Substring(0, 26) }
        Write-Host ("  {0,-34} {1,-26} {2,-11} {3}" -f $r.Name, $cur, $status, $r.Why)
    }
    Write-Host ""
}

$readable = @($results | Where-Object { $_.Readable }).Count
$total = $results.Count
if ($Apply) {
    $ok = @($results | Where-Object { $_.Verified }).Count
    $rej = @($results | Where-Object { $_.Readable -and -not $_.Verified }).Count
    $unread = $total - $readable
    Write-Host ("SUMMARY: {0} candidates, {1} readable, {2} accepted, {3} rejected, {4} unreadable" -f $total, $readable, $ok, $rej, $unread)
}
else {
    Write-Host ("SUMMARY (read only): {0} candidates, {1} readable, {2} not present/readable" -f $total, $readable)
}

# ---------- roll everything back ----------
if ($Apply -and @($saved).Count) {
    Write-Host ""
    Write-Host "rolling back $($saved.Count) probe writes..."
    $failed = 0
    foreach ($s in $saved) {
        A $s.restore | Out-Null
        # confirm it took
        $kindCmd = switch -Regex ($s.name) {
            '/' { "settings get $(($s.name -split '/')[0]) $(($s.name -split '/')[1])" }
            default { "getprop $($s.name)" }
        }
        if ($s.name -like '/proc/*') { $kindCmd = "cat $($s.name)" }
        $now = A $kindCmd
        if ($now -ne $s.before) {
            Write-Host ("  ROLLBACK MISMATCH {0}: now='{1}' expected='{2}'" -f $s.name, $now, $s.before)
            $failed++
        }
    }
    Write-Host ("rollback done, {0} mismatches" -f $failed)
}