$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class P {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [StructLayout(LayoutKind.Sequential)]
    public struct Timing {
        public ulong qpcCompose, qpcVBlank, qpcFlipStart, qpcFlipComplete, qpcCommit;
        public uint dwFrameNumber, dwInputEmitted;
        public ushort rateNum, rateDen;
        public ulong pad1, pad2, pad3, pad4, pad5, pad6;
    }
    [DllImport("dwmapi.dll")] public static extern int DwmGetCompositionTimingInfo(IntPtr h, out Timing t);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
}
'@

Add-Type -TypeDefinition $src

$script:ok = 0
$script:fail = 0
$script:rows = New-Object System.Collections.ArrayList

$cb = [P+EnumProc] {
    param($h, $l)
    $len = [P]::GetWindowTextLength($h)
    if ($len -gt 0 -and [P]::IsWindowVisible($h)) {
        $t = New-Object 'P+Timing'
        $hr = [P]::DwmGetCompositionTimingInfo($h, [ref]$t)
        $sb = New-Object System.Text.StringBuilder 160
        [void][P]::GetWindowText($h, $sb, 160)
        $cloaked = 0
        [void][P]::DwmGetWindowAttribute($h, 14, [ref]$cloaked, 4)
        $hz = '?'
        if ($t.rateDen -ne 0) { $hz = [math]::Round($t.rateNum / $t.rateDen, 1) }
        if ($hr -eq 0) {
            $script:ok++
            [void]$script:rows.Add(("  OK    frame={0,-8} hz={1,-6} cloaked={2} '{3}'" -f $t.dwFrameNumber, $hz, $cloaked, $sb.ToString()))
        }
        else {
            $script:fail++
            $sb2 = New-Object System.Text.StringBuilder 120
            [void][P]::GetWindowText($h, $sb2, 120)
            [void]$script:rows.Add(("  FAIL  hr=0x{0:X8} ({1}) '{2}'" -f $hr, [System.Runtime.InteropServices.Marshal]::GetExceptionForHR($hr).Message.Split("`n")[0], $sb2.ToString()))
        }
    }
    return $true
}

[P]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

Write-Host "windows with timing available : $($script:ok)"
Write-Host "windows without              : $($script:fail)"
Write-Host ""
Write-Host "sample of windows that DO report timing:"
$script:rows | Select-Object -First 12 | ForEach-Object { Write-Host $_ }

if ($script:ok -gt 0) {
    Write-Host ""
    Write-Host "--- sampling one twice to prove the counter moves ---"
    $target = [IntPtr]::Zero
    $cb2 = [P+EnumProc] {
        param($h, $l)
        if ($target -eq [IntPtr]::Zero -and [P]::GetWindowTextLength($h) -gt 0 -and [P]::IsWindowVisible($h)) {
            $t = New-Object 'P+Timing'
            if ([P]::DwmGetCompositionTimingInfo($h, [ref]$t) -eq 0 -and $t.dwFrameNumber -gt 0) { $target = $h }
        }
        return $true
    }
    [P]::EnumWindows($cb2, [IntPtr]::Zero) | Out-Null

    if ($target -ne [IntPtr]::Zero) {
        $a = New-Object 'P+Timing'
        $b = New-Object 'P+Timing'
        [void][P]::DwmGetCompositionTimingInfo($target, [ref]$a)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        Start-Sleep -Seconds 3
        $sw.Stop()
        [void][P]::DwmGetCompositionTimingInfo($target, [ref]$b)
        $delta = $b.dwFrameNumber - $a.dwFrameNumber
        Write-Host ("  frame number {0} -> {1}  (delta {2} over {3:N2}s = {4} present/s)" -f $a.dwFrameNumber, $b.dwFrameNumber, $delta, $sw.Elapsed.TotalSeconds, [math]::Round($delta / $sw.Elapsed.TotalSeconds, 2))
    }
    else {
        Write-Host "  no window with a non-zero frame counter was found"
    }
}