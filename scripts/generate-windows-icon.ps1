# Generate Windows-compatible, multi-resolution ICO frames from the exact
# original school icon. No npm/image-processing dependency required on Windows.
# PNG for 256px; alpha-preserving 32bpp BMP/DIB with AND masks for smaller sizes.
# The source at public/icon.png is only read, never modified.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'public\icon.png'
$resources = Join-Path $root 'build'
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$image = [System.Drawing.Bitmap]::new($source)

try {
  if ($image.Width -lt 512 -or $image.Height -lt 512) {
    throw "Source icon is $($image.Width)x$($image.Height). A minimum of 512x512 is required; no upscaling will be performed."
  }
  New-Item -ItemType Directory -Force -Path $resources | Out-Null
  Copy-Item -LiteralPath $source -Destination (Join-Path $resources 'icon.png') -Force

  $frames = [System.Collections.Generic.List[byte[]]]::new()
  foreach ($size in $sizes) {
    $resized = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($resized)
      try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.DrawImage($image, 0, 0, $size, $size)
      } finally { $graphics.Dispose() }

      $buffer = [System.IO.MemoryStream]::new()
      $writer = [System.IO.BinaryWriter]::new($buffer)
      try {
        if ($size -eq 256) {
          $resized.Save($buffer, [System.Drawing.Imaging.ImageFormat]::Png)
        } else {
          $stride = [int]($size * 4)
          $andStride = [int]([math]::Ceiling($size / 32.0) * 4)
          $andRow = [byte[]]::new($andStride)
          $writer.Write([uint32]40)           # BITMAPINFOHEADER
          $writer.Write([int32]$size)
          $writer.Write([int32]($size * 2))    # XOR bitmap + AND transparency mask
          $writer.Write([uint16]1)            # color planes
          $writer.Write([uint16]32)           # bits per pixel
          $writer.Write([uint32]0)            # BI_RGB
          $writer.Write([uint32]($stride * $size + $andStride * $size))
          $writer.Write([int32]0)
          $writer.Write([int32]0)
          $writer.Write([uint32]0)
          $writer.Write([uint32]0)

          for ($y = $size - 1; $y -ge 0; $y--) {
            for ($x = 0; $x -lt $size; $x++) {
              $color = $resized.GetPixel($x, $y)
              $writer.Write([byte]$color.B)
              $writer.Write([byte]$color.G)
              $writer.Write([byte]$color.R)
              $writer.Write([byte]$color.A)
            }
          }
          for ($y = $size - 1; $y -ge 0; $y--) {
            [array]::Clear($andRow, 0, $andRow.Length)
            for ($x = 0; $x -lt $size; $x++) {
              if ($resized.GetPixel($x, $y).A -lt 128) {
                $byteIndex = [int][math]::Floor($x / 8)
                $andRow[$byteIndex] = [byte]($andRow[$byteIndex] -bor (1 -shl (7 - ($x % 8))))
              }
            }
            $writer.Write($andRow)
          }
        }
        $writer.Flush()
        $frames.Add($buffer.ToArray())
      } finally {
        $writer.Dispose()
        $buffer.Dispose()
      }
    } finally { $resized.Dispose() }
  }

  $target = Join-Path $resources 'icon.ico'
  $stream = [System.IO.File]::Create($target)
  $ico = [System.IO.BinaryWriter]::new($stream)
  try {
    $ico.Write([uint16]0)                      # reserved
    $ico.Write([uint16]1)                      # icon
    $ico.Write([uint16]$sizes.Count)
    $offset = [uint32](6 + $sizes.Count * 16)
    for ($i = 0; $i -lt $sizes.Count; $i++) {
      $size = $sizes[$i]
      $frame = $frames[$i]
      $ico.Write([byte]($size % 256))          # zero represents 256 pixels
      $ico.Write([byte]($size % 256))
      $ico.Write([byte]0)
      $ico.Write([byte]0)
      $ico.Write([uint16]1)
      $ico.Write([uint16]32)
      $ico.Write([uint32]$frame.Length)
      $ico.Write([uint32]$offset)
      $offset += [uint32]$frame.Length
    }
    foreach ($frame in $frames) { $ico.Write([byte[]]$frame) }
  } finally { $ico.Dispose() }

  Write-Output "Generated build/icon.ico: $($sizes -join ', ') px; build/icon.png: $($image.Width)x$($image.Height)."
} finally { $image.Dispose() }
