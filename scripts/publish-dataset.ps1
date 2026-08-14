[CmdletBinding()]
param(
    [string]$Repository = "Koodattu/niilo22-dev",
    [string]$Tag,
    [switch]$KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$videosJsonPath = Join-Path $repoRoot "videos.json"
$outputPath = Join-Path $repoRoot "output"
$archiveName = "niilo22-dataset.tar.gz"
$checksumName = "$archiveName.sha256"

foreach ($commandName in @("gh", "git", "tar")) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$commandName' was not found."
    }
}

if (-not (Test-Path -LiteralPath $videosJsonPath -PathType Leaf)) {
    throw "Missing dataset metadata file: $videosJsonPath"
}

if (-not (Test-Path -LiteralPath $outputPath -PathType Container)) {
    throw "Missing transcript directory: $outputPath"
}

$videosFile = Get-Content -LiteralPath $videosJsonPath -Raw | ConvertFrom-Json
$videoCount = @($videosFile.videos).Count
$transcriptCount = @(Get-ChildItem -LiteralPath $outputPath -File -Filter "*.json").Count

if ($videoCount -eq 0) {
    throw "videos.json contains no videos."
}

if ([string]::IsNullOrWhiteSpace($Tag)) {
    $Tag = "dataset-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
}

if ($Tag -notmatch '^dataset-[0-9]{8}T[0-9]{6}Z$') {
    throw "Dataset tags must use the form dataset-yyyyMMddTHHmmssZ."
}

& gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
}

$headSha = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($headSha)) {
    throw "Could not determine the current Git commit."
}

$workPath = Join-Path ([System.IO.Path]::GetTempPath()) "$Tag-$([Guid]::NewGuid().ToString('N'))"
$archivePath = Join-Path $workPath $archiveName
$checksumPath = Join-Path $workPath $checksumName
New-Item -ItemType Directory -Path $workPath | Out-Null

try {
    Write-Host "Creating $archiveName from $videoCount videos and $transcriptCount transcript files..."
    & tar -czf $archivePath -C $repoRoot "videos.json" "output"
    if ($LASTEXITCODE -ne 0) {
        throw "tar failed while creating the dataset archive."
    }

    $archiveSize = (Get-Item -LiteralPath $archivePath).Length
    if ($archiveSize -ge 2GB) {
        throw "The archive is $archiveSize bytes; GitHub release assets must remain below 2 GiB."
    }

    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    [System.IO.File]::WriteAllText(
        $checksumPath,
        "$archiveHash  $archiveName`n",
        [System.Text.UTF8Encoding]::new($false)
    )

    $releaseNotes = @"
Niilo22 dataset snapshot generated at $([DateTime]::UtcNow.ToString('u')).

- Videos: $videoCount
- Transcript files: $transcriptCount
- videos.json lastUpdated: $($videosFile.lastUpdated)
- Archive SHA-256: $archiveHash
"@

    Write-Host "Uploading release $Tag to $Repository..."
    & gh release create $Tag $archivePath $checksumPath --repo $Repository --target $headSha --title "Niilo22 dataset $Tag" --notes $releaseNotes --latest=false
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub release creation failed."
    }

    Write-Host "Published $Tag ($archiveSize bytes)."
}
finally {
    if ($KeepArtifacts) {
        Write-Host "Kept release artifacts at $workPath"
    }
    elseif (Test-Path -LiteralPath $workPath) {
        Remove-Item -LiteralPath $workPath -Recurse -Force
    }
}
