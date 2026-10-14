param(
    [Parameter(Mandatory=$true)][string]$RubyDirectory,
    [string]$OutputDirectory = 'artifacts/OriginalEngines'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    $rubyRoot = (Resolve-Path $RubyDirectory).Path
    $ruby = Join-Path $rubyRoot 'bin/ruby.exe'
    if (-not (Test-Path $ruby)) { throw "Missing $ruby" }
    $version = & $ruby -e 'print RUBY_VERSION'
    if ($LASTEXITCODE -ne 0 -or $version -ne '3.4.11') { throw 'Use Ruby 3.4.11 x64 with Bundler 2.6.9 and build tools available.' }
    $output = [IO.Path]::GetFullPath($OutputDirectory)
    if ($output.StartsWith($rubyRoot.TrimEnd("\") + "\", [StringComparison]::OrdinalIgnoreCase)) { throw 'OutputDirectory must be outside RubyDirectory.' }
    if (Test-Path $output) { throw 'OutputDirectory must not exist. Choose a new staging directory.' }
    New-Item -ItemType Directory -Path $output | Out-Null
    # Do not ship the compiler/MSYS development environment. Include Ruby's own
    # runtime, standard library, default gems, and license files unchanged.
    $runtime = Join-Path $output 'ruby'
    New-Item -ItemType Directory -Path $runtime | Out-Null
    Get-ChildItem -LiteralPath $rubyRoot | Where-Object { $_.Name -ne 'msys64' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $runtime -Recurse
    }
    Copy-Item engines/original/Gemfile, engines/original/Gemfile.lock, engines/original/worker.rb -Destination $output
    $saved = @{}
    foreach ($key in @('BUNDLE_GEMFILE','BUNDLE_PATH','BUNDLE_FROZEN','BUNDLE_IGNORE_CONFIG','GEM_HOME','GEM_PATH')) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key)
    }
    try {
        $env:BUNDLE_GEMFILE = Join-Path $output 'Gemfile'
        $env:BUNDLE_PATH = Join-Path $output 'gems'
        $env:BUNDLE_FROZEN = 'true'
        $env:BUNDLE_IGNORE_CONFIG = 'true'
        Remove-Item Env:GEM_HOME, Env:GEM_PATH -ErrorAction SilentlyContinue
        & $ruby -S bundle _2.6.9_ install
        if ($LASTEXITCODE -ne 0) { throw 'Locked gem installation failed.' }
    } finally {
        foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
    }
    $notices = Get-ChildItem -LiteralPath $output -Recurse -File | Where-Object {
        $_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE|LEGAL|BSDL|COPYRIGHT)([.-]|$)' -and $_.FullName -notmatch '[\\/]\.git[\\/]'
    } | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($output.Length + 1) + "`n`n" + [IO.File]::ReadAllText($_.FullName)
    }
    [IO.File]::WriteAllText((Join-Path $output 'THIRD-PARTY-NOTICES.txt'), ($notices -join "`n`n========================================================================`n`n"), [Text.UTF8Encoding]::new($false))
    # Exercise the relocated Ruby and gems through the actual C# transport.
    & dotnet run --project tools/Mdv.EngineProbe -c Release -- $output
    if ($LASTEXITCODE -ne 0) { throw 'Packaged original engine verification failed.' }
    Write-Host "Prepared: $output"
    Write-Host 'Pass this directory to scripts/build.ps1 -OriginalEngineDirectory, or copy it beside the development executable as OriginalEngines.'
} finally { Pop-Location }
