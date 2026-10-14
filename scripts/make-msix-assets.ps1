# make-msix-assets.ps1 — generate the MSIX tile logos + installer icon.
#
# Same philosophy as check-desktop-assets.mjs: reproducible in-repo generation
# from public/android-chrome-512x512.png, no designer step to forget. Center-
# crops to each tile's aspect (square tiles from a square source; the wide tile
# crops the 512² source to 62:30) then resamples with high-quality bicubic.
#
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-msix-assets.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'public\android-chrome-512x512.png'
$outDir = Join-Path $root 'desktop-resources\appx'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$image = [System.Drawing.Image]::FromFile($src)
try {
    $targets = @(
        @{ Name = 'StoreLogo.png';          W = 50;  H = 50 },
        @{ Name = 'Square44x44Logo.png';    W = 44;  H = 44 },
        @{ Name = 'Square150x150Logo.png';  W = 150; H = 150 },
        @{ Name = 'Wide310x150Logo.png';    W = 310; H = 150 },
        @{ Name = 'SplashScreen.png';       W = 620; H = 300 }
    )
    foreach ($t in $targets) {
        # Center-crop to the target aspect ratio first, so nothing stretches.
        $targetAspect = $t.W / $t.H
        $srcAspect = $image.Width / $image.Height
        if ($srcAspect -gt $targetAspect) {
            $cropW = [int]([math]::Round($image.Height * $targetAspect))
            $cropH = $image.Height
        } else {
            $cropW = $image.Width
            $cropH = [int]([math]::Round($image.Width / $targetAspect))
        }
        $cropX = [int](($image.Width - $cropW) / 2)
        $cropY = [int](($image.Height - $cropH) / 2)

        $bmp = New-Object System.Drawing.Bitmap($t.W, $t.H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $rect = New-Object System.Drawing.Rectangle(0, 0, $t.W, $t.H)
        $g.DrawImage($image, $rect, $cropX, $cropY, $cropW, $cropH, [System.Drawing.GraphicsUnit]::Pixel)
        $g.Dispose()
        $out = Join-Path $outDir $t.Name
        $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Write-Host "  wrote desktop-resources\appx\$($t.Name) ($($t.W)x$($t.H))"
    }

    # Installer / window icon: 512² png in buildResources root (electron-builder
    # converts it to .ico for the exe).
    Copy-Item $src (Join-Path $root 'desktop-resources\icon.png') -Force
    Write-Host '  wrote desktop-resources\icon.png (512x512 copy)'
} finally {
    $image.Dispose()
}
Write-Host 'MSIX assets generated.' -ForegroundColor Green
