param([string]$Out = 'C:\Users\Lover\Documents\Codex\2026-10-07\im-making-that-pubg-optimizer-tool\data\rift-full.png',
      [int]$CropX = -1, [int]$CropY = -1, [int]$CropW = 0, [int]$CropH = 0, [double]$Zoom = 1)

Add-Type -AssemblyName System.Drawing
$src = @'
using System;using System.Text;using System.Runtime.InteropServices;
public class Cap {
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after,int x,int y,int cx,int cy,uint f);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool f);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 public struct R{public int L,T,Rt,B;}
}
'@
if (-not ('Cap' -as [type])) { Add-Type -TypeDefinition $src }

$rift = Get-Process -Name electron -EA 0 | Where-Object { $_.MainWindowTitle -like '*R i F T*' } | Select-Object -First 1
if (-not $rift) { throw 'rift window not found' }
$target = $rift.MainWindowHandle
$me = (Get-Process -Id $PID).Id

# push everything else out of the way (minimise, reversible)
[Cap]::EnumWindows({ param($h,$l)
  if ([Cap]::IsWindowVisible($h) -and $h -ne $target) {
    $len=[Cap]::GetWindowTextLength($h)
    if ($len -gt 0) {
      $sb=New-Object System.Text.StringBuilder ($len+1); [void][Cap]::GetWindowText($h,$sb,$sb.Capacity)
      $pid2=0; [void][Cap]::GetWindowThreadProcessId($h,[ref]$pid2)
      if ($pid2 -ne $me) { [void][Cap]::ShowWindow($h,6) }
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

$TOPMOST = [IntPtr](-1)
$NOTOP   = [IntPtr](-2)
$fgPid = 0
for ($try = 1; $try -le 6; $try++) {
  $fg = [Cap]::GetWindowThreadProcessId($target,[ref]([uint32]0))
  $cur = [Cap]::GetCurrentThreadId()
  [void][Cap]::AttachThreadInput($cur,$fg,$true)
  [void][Cap]::ShowWindow($target,9)
  [void][Cap]::BringWindowToTop($target)
  [void][Cap]::SetWindowPos($target,$TOPMOST,0,0,0,0,0x0003 -bor 0x0040)
  [void][Cap]::SetForegroundWindow($target)
  [void][Cap]::AttachThreadInput($cur,$fg,$false)
  Start-Sleep -Milliseconds 700
  $hwnd = [Cap]::GetForegroundWindow()
  $fgPid = 0; [void][Cap]::GetWindowThreadProcessId($hwnd,[ref]$fgPid)
  if ($hwnd -eq $target) { break }
  Start-Sleep -Milliseconds 400
}
[void][Cap]::SetWindowPos($target,$NOTOP,0,0,0,0,0x0003 -bor 0x0040)
Start-Sleep -Milliseconds 900

$r = New-Object Cap+R
[void][Cap]::GetWindowRect($target,[ref]$r)
$w = $r.Rt - $r.L; $h = $r.B - $r.T
if ($w -le 0 -or $h -le 0) { throw 'bad window rect' }

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()

if ($CropW -gt 0 -and $CropH -gt 0) {
  $cx = if ($CropX -ge 0) { $CropX } else { [int](($w - $CropW) / 2) }
  $cy = if ($CropY -ge 0) { $CropY } else { [int](($h - $CropH) / 2) }
  $crop = New-Object System.Drawing.Bitmap $CropW, $CropH
  $gc = [System.Drawing.Graphics]::FromImage($crop)
  $gc.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $CropW, $CropH),
               (New-Object System.Drawing.Rectangle $cx, $cy, $CropW, $CropH), [System.Drawing.GraphicsUnit]::Pixel)
  $gc.Dispose(); $bmp.Dispose(); $bmp = $crop
  $w = $CropW; $h = $CropH
}

if ($Zoom -gt 1) {
  $nw = [int]($w * $Zoom); $nh = [int]($h * $Zoom)
  $big = New-Object System.Drawing.Bitmap $nw, $nh
  $g2 = [System.Drawing.Graphics]::FromImage($big)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g2.DrawImage($bmp, 0, 0, $nw, $nh)
  $g2.Dispose(); $bmp.Dispose(); $bmp = $big
}

$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"captured ${w}x${h} (fgVerified=$($fgPid -eq $me)) -> $Out"