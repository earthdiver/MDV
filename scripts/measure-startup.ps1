param(
    [Parameter(Mandatory = $true)][string]$BuildRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string[]]$Editions = @('dual', 'custom', 'upstream'),
    [ValidateRange(1, 20)][int]$Runs = 3
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$build = (Resolve-Path $BuildRoot).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $output | Out-Null
$staging = Join-Path ([IO.Path]::GetTempPath()) ('mdv-startup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
$results = @()
try {
    $plain = Join-Path $staging 'plain.md'
    [IO.File]::WriteAllText($plain, "# Startup benchmark`n`nPlain text without math, diagrams, images, or code blocks.`n")
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors
    $system = Get-CimInstance Win32_ComputerSystem
    @{ cpu = $cpu; memoryGiB = [Math]::Round($system.TotalPhysicalMemory / 1GB, 1); os = [Environment]::OSVersion.VersionString;
       runs = $Runs; warmupsPerCase = 1; profile = 'Fresh WebView2 user data on every launch, as in production';
       source = $build; measuredAt = [DateTimeOffset]::Now.ToString('o') } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $output 'environment.json') -Encoding UTF8
    foreach ($edition in $Editions) {
        $folder = Join-Path $staging $edition
        New-Item -ItemType Directory -Path $folder | Out-Null
        $exe = Join-Path $folder 'MDV.exe'
        Copy-Item (Join-Path $build "$edition/MDV.exe") $exe
        $engines = if ($edition -eq 'dual') { @('original', 'legacy') } elseif ($edition -eq 'custom') { @('legacy') } else { @('original') }
        foreach ($engine in $engines) { foreach ($mode in @('github', 'qiita')) { foreach ($document in @('sample', 'plain')) {
            for ($run = 0; $run -le $Runs; $run++) {
                $name = "$edition-$engine-$mode-$document-$run"
                [IO.File]::WriteAllText((Join-Path $folder 'MDV.ini'), "[Viewer]`r`nLanguage=ja`r`nEngine=$engine`r`nMode=$mode`r`nTheme=light`r`nAllowRemoteImages=False`r`n")
                $report = Join-Path $staging "$name.json"
                $arguments = @('--smoke-test', ('"' + $report + '"'), '--smoke-startup')
                if ($document -eq 'plain') { $arguments += @('--smoke-document', ('"' + $plain + '"')) }
                $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $folder -PassThru
                try {
                    if (-not $process.WaitForExit(120000)) { $process.Kill(); throw "Startup timed out: $name" }
                    if (-not (Test-Path $report)) { throw "No report: $name (exit $($process.ExitCode))" }
                    $result = Get-Content $report -Raw | ConvertFrom-Json
                    if (-not $result.success) { throw "Failed startup: $name $(Get-Content $report -Raw)" }
                    if (Test-Path $result.userData) { throw "Browser profile was not cleaned up: $name" }
                    $result | Add-Member -NotePropertyName run -NotePropertyValue $run
                    $result | Add-Member -NotePropertyName warmup -NotePropertyValue ($run -eq 0)
                    $result | Add-Member -NotePropertyName documentCase -NotePropertyValue $document
                    $results += $result
                    $results | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $output 'runs.json') -Encoding UTF8
                    Write-Host "$name : $([Math]::Round($result.startupMilliseconds)) ms"
                } finally { $process.Dispose() }
            }
        } } }
    }
} finally {
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
}
