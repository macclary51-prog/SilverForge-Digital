$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$siteRoot = Split-Path $PSScriptRoot -Parent
$iconFolder = Join-Path $siteRoot 'icons'
New-Item -ItemType Directory -Force -Path $iconFolder | Out-Null
$brandImage = [System.Drawing.Image]::FromFile((Join-Path $siteRoot 'logo.png'))
try {
    foreach ($iconSize in @(192, 512)) {
        $canvas = New-Object System.Drawing.Bitmap($iconSize, $iconSize)
        $drawing = [System.Drawing.Graphics]::FromImage($canvas)
        try {
            $drawing.Clear([System.Drawing.Color]::FromArgb(8, 41, 77))
            $drawing.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $brandWidth = [int]($iconSize * 0.9)
            $brandHeight = [int]($brandWidth * $brandImage.Height / $brandImage.Width)
            $drawing.DrawImage($brandImage, [int](($iconSize - $brandWidth) / 2), [int](($iconSize - $brandHeight) / 2), $brandWidth, $brandHeight)
            $canvas.Save((Join-Path $iconFolder "icon-$iconSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $drawing.Dispose(); $canvas.Dispose() }
    }
} finally { $brandImage.Dispose() }
Write-Output 'PASS Created square PWA icons from the unchanged SilverForge logo.'
