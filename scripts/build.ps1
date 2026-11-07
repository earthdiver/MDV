param(
    [ValidateSet('dual', 'custom', 'all')][string]$Edition = 'dual',
    [ValidateSet('win-x64', 'win-arm64')][string]$Runtime = 'win-x64',
    [string]$OriginalEngineDirectory,
    [ValidateSet('brotli', 'zstd')][string]$CompressionCodec = 'zstd',
    [Nullable[int]]$CompressionQuality,
    [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    $editions = if ($Edition -eq 'all') { @('dual', 'custom') } else { @($Edition) }
    $needsUpstream = @($editions | Where-Object { $_ -eq 'dual' }).Count -gt 0
    if ($needsUpstream) {
        if ($Runtime -ne 'win-x64') { throw 'The dual edition requires win-x64.' }
        if (-not $OriginalEngineDirectory) { throw 'Specify -OriginalEngineDirectory prepared by scripts/prepare-original-engines.ps1.' }
        $original = (Resolve-Path $OriginalEngineDirectory).Path
        foreach ($file in @('worker.rb', 'Gemfile', 'Gemfile.lock', 'ruby/bin/ruby.exe', 'THIRD-PARTY-NOTICES.txt')) {
            if (-not (Test-Path (Join-Path $original $file))) { throw "Missing upstream asset: $file" }
        }
        foreach ($file in @('worker.rb', 'Gemfile', 'Gemfile.lock')) {
            if ((Get-FileHash (Join-Path $original $file)).Hash -ne (Get-FileHash (Join-Path 'engines/original' $file)).Hash) { throw "Outdated upstream asset: $file" }
        }
    }
    $extension = if ($CompressionCodec -eq 'zstd') { 'zst' } else { 'br' }
    $quality = if ($null -ne $CompressionQuality) { [int]$CompressionQuality } elseif ($CompressionCodec -eq 'zstd') { 3 } else { 11 }
    $maximum = if ($CompressionCodec -eq 'zstd') { 22 } else { 11 }
    $minimum = if ($CompressionCodec -eq 'zstd') { 1 } else { 0 }
    if ($quality -lt $minimum -or $quality -gt $maximum) { throw 'CompressionQuality is out of range for the selected codec.' }
    function Invoke-Checked([string]$Command, [string[]]$Arguments) {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
    }
    Invoke-Checked npm @('ci')
    if (-not $SkipTests) { Invoke-Checked npm @('test') }
    if ($needsUpstream) { Invoke-Checked dotnet @('run', '--project', 'tools/Mdv.EngineProbe', '-c', 'Release', '--', $original) }
    $version = ([xml](Get-Content src/Mdv.App/Mdv.App.csproj -Raw)).SelectSingleNode('/Project/PropertyGroup/Version').InnerText
    $results = @()
    foreach ($variant in $editions) {
        if (-not $SkipTests) { Invoke-Checked dotnet @('run', '--project', 'tests/Mdv.Core.Tests', '-c', 'Release', "-p:MdvEdition=$variant") }
        $renderer = "artifacts/renderer-$variant"
        Invoke-Checked node @('scripts/build-renderer.mjs', $variant, $renderer)
        Invoke-Checked dotnet @('restore', 'src/Mdv.App/Mdv.App.csproj', '-r', $Runtime, '-p:PortableBuild=true', "-p:MdvEdition=$variant")
        $payload = Join-Path (Get-Location) "artifacts/payload-$variant-$Runtime"
        if (Test-Path $payload) { Remove-Item -LiteralPath $payload -Recurse -Force }
        New-Item -ItemType Directory -Path $payload | Out-Null
        Copy-Item $renderer -Destination (Join-Path $payload 'Renderer') -Recurse
        if ($variant -eq 'dual') { Copy-Item -LiteralPath $original -Destination (Join-Path $payload 'OriginalEngines') -Recurse }
        Copy-Item samples -Destination (Join-Path $payload 'Samples') -Recurse
        Copy-Item README.md, README.en.md, LICENSE -Destination $payload
        Copy-Item docs -Destination $payload -Recurse
        Invoke-Checked node @('scripts/collect-native-licenses.mjs', $payload, $Runtime)
        Invoke-Checked node @('scripts/optimize-payload.mjs', $payload, '--apply', "--report=artifacts/payload-optimization-$variant-$Runtime.json")
        $packed = "src/Mdv.App/PortablePayload/$variant/payload.$extension"
        Invoke-Checked dotnet @('run', '--project', 'tools/Mdv.Pack', '-c', 'Release', '--', $payload, $packed, "$quality")
        $output = Join-Path (Get-Location) "artifacts/MDV-$variant-$Runtime"
        if (Test-Path $output) { Remove-Item -LiteralPath $output -Recurse -Force }
        $rendererFull = (Resolve-Path $renderer).Path
        Invoke-Checked dotnet @('publish', 'src/Mdv.App/Mdv.App.csproj', '-c', 'Release', '-r', $Runtime, '--self-contained', 'true', '-p:PortableBuild=true', "-p:MdvEdition=$variant", "-p:RendererDirectory=$rendererFull", "-p:PayloadCompression=$CompressionCodec", '--no-restore', '-o', $output)
        Get-ChildItem -LiteralPath $output -File | Where-Object { $_.Extension -eq '.pdb' -or $_.Name -like 'Microsoft.Web.WebView2.*.xml' } | Remove-Item -Force
        $files = @(Get-ChildItem -LiteralPath $output -Recurse -File)
        if ($files.Count -ne 1 -or $files[0].Name -ne 'MDV.exe') { throw 'Portable output must contain exactly one executable.' }
        $filename = "MDV-v$version-$variant-$Runtime.exe"
        Rename-Item -LiteralPath (Join-Path $output 'MDV.exe') -NewName $filename
        $exe = Get-Item (Join-Path $output $filename)
        $checksum = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -Path "$output.sha256" -Value "$checksum  $filename" -Encoding ASCII
        $results += [ordered]@{ edition = $variant; file = $exe.FullName; bytes = $exe.Length; sha256 = $checksum }
        Write-Host "Built: $($exe.FullName)"
    }
    if ($Edition -eq 'all') {
        $report = [ordered]@{ version = $version; runtime = $Runtime; compression = $CompressionCodec; quality = $quality; files = $results }
        $report | ConvertTo-Json -Depth 5 | Set-Content "artifacts/edition-sizes-$Runtime.json" -Encoding utf8
    }
} finally { Pop-Location }
