$src = @'
using System;
using System.Runtime.InteropServices;

public static class D {
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetCompositionTimingInfo")]
    public static extern int Get(IntPtr hwnd, IntPtr info);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
Add-Type -TypeDefinition $src

$script:hwnd = [IntPtr]::Zero
$cb = [D+EnumProc] {
    param($h, $l)
    if ($script:hwnd -eq [IntPtr]::Zero -and [D]::GetWindowTextLength($h) -gt 0 -and [D]::IsWindowVisible($h)) { $script:hwnd = $h }
    return $true
}
[D]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
Write-Host ("probing hwnd 0x{0:X}" -f $script:hwnd.ToInt64())
Write-Host ""

foreach ($size in 48,52,56,60,64,68,72,76,80,88,96,104,112,120,128) {
    $buf = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
    try {
        for ($i = 0; $i -lt $size; $i += 4) { [Runtime.InteropServices.Marshal]::WriteInt32($buf, $i, 0) }
        $hr = [D]::Get($script:hwnd, $buf)
        if ($hr -eq 0) {
            $frame = [Runtime.InteropServices.Marshal]::ReadInt32($buf, 40)
            $hzNum = [Runtime.InteropServices.Marshal]::ReadInt16($buf, 48)
            $hzDen = [Runtime.InteropServices.Marshal]::ReadInt16($buf, 50)
            Write-Host ("  ACCEPTED size={0,-4} dwFrameNumber={1} refresh={2}/{3}" -f $size, $frame, $hzNum, $hzDen)
        }
        else {
            Write-Host ("  rejected size={0,-4} hr=0x{1:X8}" -f $size, $hr)
        }
    }
    finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($buf) }
}