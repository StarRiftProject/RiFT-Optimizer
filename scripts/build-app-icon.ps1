Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pngPath = Join-Path $root 'build/icon.png'
$icoPath = Join-Path $root 'build/icon.ico'
$size = 512

$image = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($image)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 5, 5, 7))

$background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.Rectangle]::new(0, 0, $size, $size),
  [System.Drawing.Color]::FromArgb(255, 25, 25, 30),
  [System.Drawing.Color]::FromArgb(255, 4, 4, 6),
  [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
)
$graphics.FillRectangle($background, 0, 0, $size, $size)

$silver = [System.Drawing.Color]::FromArgb(255, 236, 236, 241)
$dimSilver = [System.Drawing.Color]::FromArgb(210, 139, 139, 148)
$frame = [System.Drawing.Drawing2D.GraphicsPath]::new()
$framePoints = [System.Drawing.Point[]]@(
  [System.Drawing.Point]::new(256, 34),
  [System.Drawing.Point]::new(376, 78),
  [System.Drawing.Point]::new(448, 166),
  [System.Drawing.Point]::new(436, 284),
  [System.Drawing.Point]::new(382, 376),
  [System.Drawing.Point]::new(256, 478),
  [System.Drawing.Point]::new(130, 376),
  [System.Drawing.Point]::new(76, 284),
  [System.Drawing.Point]::new(64, 166),
  [System.Drawing.Point]::new(136, 78)
)
$frame.AddPolygon($framePoints)
$framePen = [System.Drawing.Pen]::new($dimSilver, 3.5)
$graphics.DrawPath($framePen, $frame)

$innerRing = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(105, 230, 230, 235), 2)
$graphics.DrawEllipse($innerRing, 99, 102, 314, 314)

$ornamentFill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(230, 210, 210, 218))
$spikes = @(
  [System.Drawing.Point[]]@([System.Drawing.Point]::new(256, 54), [System.Drawing.Point]::new(276, 116), [System.Drawing.Point]::new(256, 104), [System.Drawing.Point]::new(236, 116)),
  [System.Drawing.Point[]]@([System.Drawing.Point]::new(256, 458), [System.Drawing.Point]::new(276, 396), [System.Drawing.Point]::new(256, 408), [System.Drawing.Point]::new(236, 396)),
  [System.Drawing.Point[]]@([System.Drawing.Point]::new(78, 256), [System.Drawing.Point]::new(140, 236), [System.Drawing.Point]::new(128, 256), [System.Drawing.Point]::new(140, 276)),
  [System.Drawing.Point[]]@([System.Drawing.Point]::new(434, 256), [System.Drawing.Point]::new(372, 236), [System.Drawing.Point]::new(384, 256), [System.Drawing.Point]::new(372, 276))
)
foreach ($points in $spikes) { $graphics.FillPolygon($ornamentFill, $points) }

$crossPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(150, 205, 205, 212), 3)
$crossPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$crossPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($crossPen, 256, 117, 256, 395)
$graphics.DrawLine($crossPen, 137, 256, 375, 256)

$letterPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
$letterFormat = [System.Drawing.StringFormat]::new()
$letterFormat.Alignment = [System.Drawing.StringAlignment]::Center
$letterFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
$letterFont = [System.Drawing.FontFamily]::new('Georgia')
$letterPath.AddString('R', $letterFont, [int][System.Drawing.FontStyle]::Bold, 278, [System.Drawing.RectangleF]::new(91, 83, 330, 342), $letterFormat)
$letterShadow = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 3, 3, 5), 13)
$letterShadow.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawPath($letterShadow, $letterPath)
$letterBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.Rectangle]::new(100, 100, 312, 320),
  [System.Drawing.Color]::FromArgb(255, 255, 255, 255),
  [System.Drawing.Color]::FromArgb(255, 170, 170, 180),
  [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
)
$graphics.FillPath($letterBrush, $letterPath)
$letterOutline = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(235, 247, 247, 250), 2)
$graphics.DrawPath($letterOutline, $letterPath)

$image.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$sizes = @(256, 128, 64, 48, 32, 24, 16)
$frames = [System.Collections.Generic.List[byte[]]]::new()
foreach ($frameSize in $sizes) {
  $frameImage = [System.Drawing.Bitmap]::new($frameSize, $frameSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $frameGraphics = [System.Drawing.Graphics]::FromImage($frameImage)
  $frameGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $frameGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $frameGraphics.DrawImage($image, 0, 0, $frameSize, $frameSize)
  $frameStream = [System.IO.MemoryStream]::new()
  $frameImage.Save($frameStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $frames.Add($frameStream.ToArray())
  $frameStream.Dispose()
  $frameGraphics.Dispose()
  $frameImage.Dispose()
}

$iconStream = [System.IO.File]::Create($icoPath)
$writer = [System.IO.BinaryWriter]::new($iconStream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)
$offset = [UInt32](6 + 16 * $sizes.Count)
for ($index = 0; $index -lt $sizes.Count; $index++) {
  $frameSize = $sizes[$index]
  $icoDimension = if ($frameSize -eq 256) { 0 } else { $frameSize }
  $frameBytes = $frames[$index]
  $writer.Write([Byte]$icoDimension)
  $writer.Write([Byte]$icoDimension)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$frameBytes.Length)
  $writer.Write($offset)
  $offset += [UInt32]$frameBytes.Length
}
foreach ($frameBytes in $frames) { $writer.Write($frameBytes) }
$writer.Dispose()
$iconStream.Dispose()

$graphics.Dispose()
$image.Dispose()
$background.Dispose()
$frame.Dispose()
$framePen.Dispose()
$innerRing.Dispose()
$ornamentFill.Dispose()
$crossPen.Dispose()
$letterFormat.Dispose()
$letterFont.Dispose()
$letterShadow.Dispose()
$letterBrush.Dispose()
$letterOutline.Dispose()

Write-Output "Updated app icon: $pngPath and $icoPath"
