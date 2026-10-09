param(
    [int]$IntervalMs = 1500,
    [int]$MaxSamples = 0
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

$script:tick = 0

function emit {
    param([hashtable]$Data)
    try { [Console]::Out.WriteLine(($Data | ConvertTo-Json -Compress -Depth 6)) } catch {}
}

function clean {
    param($Value)
    if ($null -eq $Value) { return $null }
    $text = ([string]$Value).Trim()
    if (-not $text) { return $null }
    return $text
}

function num {
    param($Value)
    if ($null -eq $Value) { return $null }
    try { return [math]::Round([double]$Value, 2) } catch { return $null }
}

function nvidia {
    $exe = 'nvidia-smi.exe'
    $cmd = Get-Command $exe -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    foreach ($p in @(
        "$env:SystemRoot\System32\nvidia-smi.exe"
        "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
    )) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    return $null
}

$script:nv = nvidia

function readNvidia {
    if (-not $script:nv) { return $null }

    $query = 'utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,clocks.gr'
    $raw = & $script:nv "--query-gpu=$query" --format=csv,noheader,nounits 2>&1
    if (-not $raw) { return $null }

    $lines = @($raw | Where-Object { ([string]$_).Trim() })
    if (-not $lines.Count) { return $null }

    $out = @()
    foreach ($line in $lines) {
        $parts = ([string]$line) -split '\s*,\s*'
        if ($parts.Count -lt 7) { continue }

        $out += [ordered]@{
            load      = (num $parts[0])
            memLoad   = (num $parts[1])
            memUsedMB = (num $parts[2])
            memTotalMB = (num $parts[3])
            tempC     = (num $parts[4])
            watt      = (num $parts[5])
            clockMHz  = (num $parts[6])
        }
    }

    if (-not $out.Count) { return $null }
    return , $out
}

function gpuFromCounters {
    $engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)
    if (-not $engines.Count) { return $null }

    $total = 0.0
    foreach ($e in $engines) {
        $name = [string]$e.Name
        if ($name -match '_0$') { continue }
        $v = $e.CookedValue
        if ($null -eq $v) { continue }
        try { $total += [double]$v } catch {}
    }

    if ($total -le 0) { return $null }
    if ($total -gt 100) { $total = 100 }

    $adapter = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory
    $committed = $null
    if ($adapter) {
        $sum = 0.0
        foreach ($a in $adapter) {
            if ($null -eq $a.CommittedBytes) { continue }
            try { $sum += [double]$a.CommittedBytes } catch {}
        }
        if ($sum -gt 0) { $committed = [math]::Round($sum / 1MB, 0) }
    }

    return [ordered]@{
        load        = [math]::Round($total, 1)
        memLoad     = $null
        memUsedMB   = $committed
        memTotalMB  = $null
        tempC       = $null
        watt        = $null
        clockMHz    = $null
    }
}

function staticInfo {
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $cs  = Get-CimInstance Win32_ComputerSystem
    $gpu = @(Get-CimInstance Win32_VideoController)

    $ramModules = @(Get-CimInstance Win32_PhysicalMemory)

    $ramTotalMB = 0
    if ($cs -and $cs.TotalPhysicalMemory) {
        $ramTotalMB = [math]::Round([double]$cs.TotalPhysicalMemory / 1MB, 0)
    }

    $slots = @()
    foreach ($m in $ramModules) {
        $capacityGB = $null
        if ($m.Capacity) { $capacityGB = [math]::Round([double]$m.Capacity / 1GB, 0) }
        $speed = $null
        if ($m.ConfiguredClockSpeed) { $speed = [int]$m.ConfiguredClockSpeed }
        elseif ($m.Speed) { $speed = [int]$m.Speed }

        $slots += [ordered]@{
            bank     = (clean $m.DeviceLocator)
            sizeGB   = $capacityGB
            speedMTs = $speed
            type     = (clean $m.SMBIOSMemoryType)
            maker    = (clean $m.Manufacturer)
            part     = (clean $m.PartNumber)
        }
    }

    $fastest = $null
    foreach ($s in $slots) { if ($s.speedMTs -and ($null -eq $fastest -or $s.speedMTs -gt $fastest)) { $fastest = $s.speedMTs } }
    if ($null -eq $fastest) {
        $sm = Get-CimInstance Win32_PhysicalMemoryArray
        if ($sm -and $sm.MemoryDevices -and $ramModules.Count) {
            $fastest = [int]([math]::Round([double]$sm.MemorySpeed))
        }
    }

    $nvList = readNvidia
    $nvGpu = $null
    if ($nvList) { $nvGpu = @($nvList) }

    $gpus = @()
    foreach ($v in $gpu) {
        if (-not $v.Name) { continue }

        $vramGB = $null
        $vramExact = $false

        if ($nvGpu) {
            foreach ($n in $nvGpu) {
                if ($n.memTotalMB -and $n.memTotalMB -ge 1024) {
                    $vramGB = [math]::Round($n.memTotalMB / 1024, 1)
                    $vramExact = $true
                    break
                }
            }
        }

        if ($null -eq $vramGB -and $v.AdapterRAM) {
            try { $vramGB = [math]::Round([double]$v.AdapterRAM / 1GB, 0) } catch {}
        }

        $res = $null
        if ($v.CurrentHorizontalResolution -and $v.CurrentVerticalResolution) {
            $res = ("{0}x{1}" -f $v.CurrentHorizontalResolution, $v.CurrentVerticalResolution)
        }

        $gpus += [ordered]@{
            name      = (clean $v.Name)
            driver    = (clean $v.DriverVersion)
            date      = (clean $v.DriverDate)
            vramGB    = $vramGB
            vramExact = $vramExact
            resolution = $res
            refreshHz = (num $v.CurrentRefreshRate)
            mode      = (clean $v.VideoModeDescription)
        }
    }

    return [ordered]@{
        cpu = [ordered]@{
            name  = (clean $cpu.Name)
            cores = $(if ($cpu) { [int]$cpu.NumberOfCores } else { $null })
            threads = $(if ($cpu) { [int]$cpu.NumberOfLogicalProcessors } else { $null })
            baseGHz = $(if ($cpu -and $cpu.MaxClockSpeed) { [math]::Round([double]$cpu.MaxClockSpeed / 1000, 2) } else { $null })
            l2KB   = $(if ($cpu) { [int]$cpu.L2CacheSize } else { $null })
            l3KB   = $(if ($cpu) { [int]$cpu.L3CacheSize } else { $null })
            socket = $(if ($cs -and $cs.NumberOfProcessors) { [int]$cs.NumberOfProcessors } else { $null })
        }
        ram = [ordered]@{
            totalMB  = $ramTotalMB
            slots    = $ramModules.Count
            speedMTs = $fastest
            modules  = $slots
        }
        gpu = $gpus
        board = [ordered]@{
            maker = (clean $cs.Manufacturer)
            model = (clean $cs.Model)
        }
        os = [ordered]@{
            caption = (clean (Get-CimInstance Win32_OperatingSystem).Caption)
            build   = (clean $env:PROCESSOR_ARCHITECTURE)
        }
    }
}

function sample {
    $cpuPerf = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
    $memPerf = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
    $sysPerf = Get-CimInstance Win32_PerfFormattedData_PerfOS_System
    $dskPerf = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"

    $cpuLoad = $null
    if ($cpuPerf) { $cpuLoad = num $cpuPerf.PercentProcessorTime }

    $ramUsedMB = $null
    $ramTotalMB = $null
    $ramLoad = $null
    if ($memPerf) {
        $ramUsedMB = [math]::Round([double]$memPerf.CommittedBytes / 1MB, 0)
        $ramTotalMB = [math]::Round([double]$memPerf.CommitLimit / 1MB, 0)
        if ($ramTotalMB -gt 0) {
            $ramLoad = [math]::Round(($ramUsedMB / $ramTotalMB) * 100, 1)
        }
    }

    $gpus = readNvidia
    $source = 'nvidia-smi'
    if (-not $gpus) {
        $fallback = gpuFromCounters
        if ($fallback) {
            $gpus = @($fallback)
            $source = 'gpu-engine-counters'
        }
    }

    $gpuList = $null
    if ($gpus) { $gpuList = @($gpus) }

    $uptime = $null
    if ($sysPerf) { $uptime = [math]::Round([double]$sysPerf.SystemUpTime / 3600, 1) }

    $diskLoad = $null
    if ($dskPerf) { $diskLoad = num $dskPerf.PercentDiskTime }

    return [ordered]@{
        e       = 'sample'
        n       = $script:tick
        at      = (Get-Date -Format 'o')
        cpuLoad = $cpuLoad
        ramLoad = $ramLoad
        ramUsedMB  = $ramUsedMB
        ramCommitMB = $ramTotalMB
        diskLoad = $diskLoad
        uptimeH = $uptime
        gpuSource = $source
        gpu = $gpuList
    }
}

try {
    emit ([ordered]@{ e = 'hello'; at = (Get-Date -Format 'o'); intervalMs = $IntervalMs; hw = (staticInfo) })
} catch {
    emit ([ordered]@{ e = 'fatal'; m = ("static probe failed: {0}" -f $_.Exception.Message) })
    exit 1
}

while ($true) {
    Start-Sleep -Milliseconds $IntervalMs
    $script:tick++

    try {
        emit (sample)
    } catch {
        emit ([ordered]@{ e = 'log'; l = 'warn'; m = ("sample failed: {0}" -f $_.Exception.Message) })
    }

    if ($MaxSamples -gt 0 -and $script:tick -ge $MaxSamples) { break }
}