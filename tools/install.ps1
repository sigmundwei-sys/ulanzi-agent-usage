[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Repository = $env:ULANZI_REPO,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$pluginName = 'com.ulanzi.agentusage.ulanziPlugin'

if ([string]::IsNullOrWhiteSpace($Repository) -or $Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'Usage: .\install.ps1 -Repository <owner>/<repo> [-Force]'
}

$pluginDirectory = $env:ULANZI_PLUGIN_DIR
if ([string]::IsNullOrWhiteSpace($pluginDirectory)) {
    $pluginDirectory = Join-Path $env:APPDATA 'Ulanzi\UlanziDeck\Plugins'
}

$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('ulanzi-agent-usage-' + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $tempDirectory ($pluginName + '.zip')
$checksumFile = Join-Path $tempDirectory ($pluginName + '.zip.sha256')
$unpacked = Join-Path $tempDirectory 'unpacked'
$target = Join-Path $pluginDirectory $pluginName
$downloadUrl = "https://github.com/$Repository/releases/latest/download/$pluginName.zip"

New-Item -ItemType Directory -Path $tempDirectory, $unpacked -Force | Out-Null

try {
    Write-Host "Downloading $downloadUrl"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
    Invoke-WebRequest -Uri ($downloadUrl + '.sha256') -OutFile $checksumFile
    $expectedHash = ((Get-Content -LiteralPath $checksumFile -TotalCount 1) -split '\s+')[0].ToUpperInvariant()
    $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($expectedHash -ne $actualHash) {
        throw "SHA-256 verification failed for $archive"
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $unpacked -Force

    $source = Join-Path $unpacked $pluginName
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        throw "Release archive does not contain $pluginName/."
    }

    New-Item -ItemType Directory -Path $pluginDirectory -Force | Out-Null
    if (Test-Path -LiteralPath $target) {
        if (-not $Force) {
            throw "Target already exists: $target. Re-run with -Force to replace it."
        }
        $backup = Join-Path $pluginDirectory ($pluginName + '.backup.' + (Get-Date -Format 'yyyyMMddHHmmss'))
        Move-Item -LiteralPath $target -Destination $backup
        Write-Host "Previous installation moved to $backup"
    }

    Move-Item -LiteralPath $source -Destination $target
    Push-Location $target
    try {
        npm ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    Write-Host "Installed $pluginName to $target"
    Write-Host 'Restart Ulanzi Studio, then add the desired actions to your keys.'
}
finally {
    if (Test-Path -LiteralPath $tempDirectory) {
        Remove-Item -LiteralPath $tempDirectory -Recurse -Force
    }
}
