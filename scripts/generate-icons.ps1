param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\public\icons'))

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function New-PlaniblyIcon {
    param(
        [int]$Size,
        [string]$Name,
        [bool]$Maskable
    )

    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#5B67C8'))

    $scale = if ($Maskable) { 0.54 } else { 0.68 }
    $font = [System.Drawing.Font]::new('Segoe UI', $Size * $scale, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $accent = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#69C5BE'))

    $graphics.DrawString('P', $font, $brush, [System.Drawing.RectangleF]::new(0, -$Size * 0.04, $Size, $Size), $format)
    if ($Maskable) {
        $dotSize = $Size * 0.10
        $dotInset = $Size * 0.20
    } else {
        $dotSize = $Size * 0.12
        $dotInset = $Size * 0.12
    }
    $graphics.FillEllipse($accent, $Size - $dotInset - $dotSize, $Size - $dotInset - $dotSize, $dotSize, $dotSize)

    $bitmap.Save((Join-Path $OutputDirectory $Name), [System.Drawing.Imaging.ImageFormat]::Png)
    $accent.Dispose()
    $brush.Dispose()
    $format.Dispose()
    $font.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

New-PlaniblyIcon -Size 180 -Name 'apple-touch-icon.png' -Maskable $false
New-PlaniblyIcon -Size 192 -Name 'icon-192.png' -Maskable $false
New-PlaniblyIcon -Size 512 -Name 'icon-512.png' -Maskable $false
New-PlaniblyIcon -Size 192 -Name 'icon-maskable-192.png' -Maskable $true
New-PlaniblyIcon -Size 512 -Name 'icon-maskable-512.png' -Maskable $true
