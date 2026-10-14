param(
    [Parameter(Mandatory)][string]$WslDirectory,
    [string]$BuildDirectory = (Join-Path $PSScriptRoot '../artifacts/MDV-dual-win-x64'),
    [string]$ReportDirectory = (Join-Path $PSScriptRoot '../artifacts/verification/wsl')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($WslDirectory -notmatch '^\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+\\') {
    throw 'WslDirectory must be an existing writable WSL UNC directory.'
}
$exe = @(Get-ChildItem -LiteralPath $BuildDirectory -Filter '*.exe')
if ($exe.Count -ne 1) { throw 'BuildDirectory must contain exactly one EXE.' }
$staging = Join-Path ([IO.Path]::GetTempPath()) ('mdv-wsl-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
$process = $null
try {
    Copy-Item -LiteralPath $exe[0].FullName -Destination (Join-Path $staging 'MDV.exe')
    foreach ($server in @('wsl.localhost', 'wsl$')) {
        $directory = '\\' + $server + $WslDirectory.Substring($WslDirectory.IndexOf('\', 2))
        $report = Join-Path $staging ($server + '.json')
        $arguments = @('--smoke-test', ('"' + $report + '"'), '--smoke-wsl-directory', ('"' + $directory.TrimEnd('\') + '"'))
        $process = Start-Process -FilePath (Join-Path $staging 'MDV.exe') -ArgumentList $arguments -PassThru
        $handle = $process.Handle
        if (-not $process.WaitForExit(90000)) { throw 'WSL smoke test timed out.' }
        if (-not (Test-Path $report)) { throw "No report produced. Exit: $($process.ExitCode)" }
        Copy-Item -LiteralPath $report -Destination $ReportDirectory
        $result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
        if ($process.ExitCode -ne 0 -or -not $result.success) { Get-Content $report; throw 'WSL smoke test failed.' }
        if (Test-Path $result.userData) { throw 'Temporary browser data was not cleaned up.' }
        Write-Host "$server : $($result.checks.Count) checks passed"
    }
}
finally {
    if ($null -ne $process -and -not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    Remove-Item -LiteralPath $staging -Recurse -Force
}
