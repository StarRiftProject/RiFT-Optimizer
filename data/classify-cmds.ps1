param([string]$UniqueFile = "$env:TEMP\rift-unique-cmds.txt")

$cmds = @()
foreach ($l in Get-Content -LiteralPath $UniqueFile) {
    if (-not $l.Trim()) { continue }
    $parts = $l -split "`t", 2
    if ($parts.Count -lt 2) { continue }
    $cmds += $parts[1].Trim()
}

$covered = [ordered]@{
    'qemu mouse smoothing'      = 'qemu\.mouse\.smooth'
    'qemu mouse acceleration'   = 'qemu\.mouse\.acceleration'
    'qemu touch smoothing'      = 'qemu\.touch\.smoothing'
    'qemu touch sampling rate'  = 'qemu\.touch\.sampling_rate'
    'qemu raw mouse'            = 'qemu\.input\.raw_mouse'
    'qemu raw keyboard'         = 'qemu\.input\.raw_keyboard'
    'qemu key repeat delay'     = 'qemu\.keyboard\.repeat\.delay'
    'qemu key repeat interval'  = 'qemu\.keyboard\.repeat\.interval'
    'bbr'                       = 'tcp_congestion_control'
    'tcp rmem/wmem/rmem_max/wmem_max' = 'net/(ipv4/tcp_rmem|ipv4/tcp_wmem|core/rmem_max|core/wmem_max)'
    'tcp fastopen'              = 'tcp_fastopen'
    'tcp slow start after idle' = 'tcp_slow_start_after_idle'
    'tcp mtu probing'           = 'tcp_mtu_probing'
    'somaxconn'                 = 'somaxconn'
    'netdev backlog'            = 'netdev_max_backlog'
    'tcp no metrics save'       = 'tcp_no_metrics_save'
    'qdisc fq'                  = 'default_qdisc'
    'swappiness'                = 'vm[./]swappiness'
    'vfs_cache_pressure'        = 'vfs_cache_pressure'
    'min_free_kbytes'           = 'min_free_kbytes'
    'dirty_ratio'               = 'dirty_ratio'
    'dirty_background_ratio'    = 'dirty_background_ratio'
    'dirty_expire_centisecs'    = 'dirty_expire_centisecs'
    'overcommit_memory'         = 'overcommit_memory'
    'page-cluster'              = 'page-cluster'
    'compaction_proactiveness'  = 'compaction_proactiveness'
    'cpu governor'              = 'scaling_governor'
    'cpu min/max freq'          = 'scaling_(min|max)_freq'
    'sched latency/granularity' = 'sched_(latency|min_granularity|wakeup_granularity|rt_runtime)'
    'io scheduler'              = 'queue/scheduler'
    'read_ahead_kb'             = 'read_ahead_kb'
    'nr_requests'               = 'nr_requests'
    'gpu devfreq'               = '(kgsl|devfreq).*(min|max)_freq'
    'renice'                    = 'renice'
    'dex2oat/jit'               = 'dex2oat'
    'dalvik heap'               = 'dalvik\.vm\.heap'
    'animation scales'          = 'animation_scale'
    'refresh/fps props'         = '(min_refresh_rate|peak_refresh_rate|fps_max|game_driver|frame_rate)'
    'hwui tuning'               = 'hwui'
    'surfaceflinger latch'      = 'latch'
    'nobootanimation'           = 'nobootanimation'
    'persist ui hw'             = 'persist\.sys\.ui\.hw'
    'network props'             = '(wifi_scan|multicore_packet|network_boost|captive_portal|private_dns|tcp_default_init_rwnd|ble_scan)'
    'background/thermal/trim'   = '(restrict_background_data|heads_up|thermal_engine|fstrim|sustained_performance_mode|low_power|dynamic_power_savings|always_finish_activities)'
    'gpu rendering'             = 'force_gpu_rendering'
    'pointer/touch'             = '(pointer_speed|touch_boost|input_boost_duration|touch_exclusion)'
    'appops/bg compile'         = '(RUN_ANY_IN_BACKGROUND|compile -m speed|bg-dexopt)'
    'prop get/set non-ro'       = '^(setprop|getprop)\s+(?!ro\.)'
    'am start game'             = 'am start -n com\.'
    'wm size/density (query)'   = '^wm (size|density)$'
    'dumpsys/ps/getprop/logcat' = '^(dumpsys|ps|getprop|logcat|ls |cat |ping |top |free |netstat|vmstat|iostat|mpstat|ndc |svc |netcfg|cmd power|settings (get|put)|media |arecord|aplay|lsmod|dmesg|cat /proc|input keyevent KEYCODE_(F|BACK|HOME|MENU))'
}

$used = [System.Collections.ArrayList]::new()
$not  = [System.Collections.ArrayList]::new()

foreach ($c in $cmds) {
    $hit = $null
    foreach ($k in $covered.Keys) { if ($c -match $covered[$k]) { $hit = $k; break } }
    if ($hit) { [void]$used.Add([pscustomobject]@{ via = $hit; cmd = $c }) }
    else { [void]$not.Add($c) }
}

$tot = $cmds.Count
"=== TALLY over $tot unique commands ==="
"USED by the engine   : $($used.Count)"
"NOT used             : $($not.Count)"
"used percent         : $([math]::Round($used.Count / $tot * 100, 1))%"
""

$b = [ordered]@{
    'nonexistent property (rtx/ssao/bloom/...)' = @()
    'read-only ro.* setprop (silently no-op)'    = @()
    'invented subcommands / placeholder junk'    = @()
    'input macro / automation'                   = @()
    'packet capture / rogue AP'                  = @()
    'destructive (pm clear/uninstall/mount/rm)'   = @()
    'harmful tcp tuning (fights BBR)'            = @()
    'debug / inspect only (not an optimisation)' = @()
    'unimplemented but plausible'                = @()
}

foreach ($c in $not) {
    switch -Regex ($c) {
        'rtx\.rtgi\.|ssao\.|ssgi\.|\bssr\.|hbao\.|vxao\.|bloom\.|lens\.|film\.|chromatic\.|vignette\.|motion\.blur|depth\.of\.field|ray\.tracing|dlss\.|fsr\.|taa\.|fxaa\.|msaa\.|smaa\.|txaa\.|cgaa\.|dda\.|particle\.|shadow\.mapping|ambient\.|texture\.|image\.scaling|video\.buffering|audio\.latency' { $b['nonexistent property (rtx/ssao/bloom/...)'] += $c; break }
        '^setprop ro\.'                 { $b['read-only ro.* setprop (silently no-op)'] += $c; break }
        '^content://|^(pm|am) (split|cache|code|data|app-dir|native-lib|resource-dir|legacy-code|activity|service|receiver|provider|content|intent|profile|manifest|array-|compat|dexopt-count|compile|uninstall|grant|revoke)' { $b['invented subcommands / placeholder junk'] += $c; break }
        '^input (tap|swipe|keyevent|text|motionevent|draganddrop)' { $b['input macro / automation'] += $c; break }
        '^(tcpdump|wireshark|iftop|nethogs|ngrep|hostapd|dnsmasq|dhcpd|udhcpd)$' { $b['packet capture / rogue AP'] += $c; break }
        '^(pm clear|pm uninstall|pm disable-user|mount |dd |chmod |chown |vi |rm |rmdir|cat /data/)' { $b['destructive (pm clear/uninstall/mount/rm)'] += $c; break }
        'tcp_(timestamps|sack|window_scaling|delack)' { $b['harmful tcp tuning (fights BBR)'] += $c; break }
        '^(getprop|logcat|dmesg|lsmod|dumpsys|cat |ls |ps |ping |top |vmstat|iostat|mpstat|netstat|free |media |arecord|aplay|ndc |svc |netcfg|cmd |settings |input keyevent)' { $b['debug / inspect only (not an optimisation)'] += $c; break }
        default { $b['unimplemented but plausible'] += $c }
    }
}

"=== the $($not.Count) NOT-used commands, by reason ==="
foreach ($k in $b.Keys) { "  {0,-46} {1}" -f $k, $b[$k].Count }
""
"=== top 15 'unimplemented but plausible' (real candidates) ==="
$b['unimplemented but plausible'] | Select-Object -First 15 | ForEach-Object { "  $_" }
""
"=== which engine features absorbed the most ==="
$used | Group-Object via | Sort-Object Count -Descending | Select-Object -First 8 | ForEach-Object { "  {0,-34} {1}" -f $_.Name, $_.Count }

$not | Out-File "$env:TEMP\rift-not-used.txt" -Encoding UTF8