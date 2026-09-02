<#
.SYNOPSIS
  Builds a self-contained embeddable Python runtime (Windows) with the demo
  parser's dependencies installed, for bundling via electron-builder's
  extraResources instead of compiling parse_demo.py with PyInstaller.

  PyInstaller has a history of silently mishandling demoparser2 (a Rust/PyO3
  native extension) - missing hidden imports or dropping the compiled .pyd.
  Shipping a real (if minimal) Python interpreter plus its site-packages is
  more predictable and much easier to debug (you can just run the exe by
  hand).

.PARAMETER Force
  Delete and rebuild python-runtime/ even if it already exists.
#>
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $RepoRoot 'python-runtime'
$PythonVersion = '3.11.9'
$PythonTag = '311'
$EmbedUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$GetPipUrl = 'https://bootstrap.pypa.io/get-pip.py'
$RequirementsFile = Join-Path $RepoRoot 'python\requirements.txt'

if ((Test-Path (Join-Path $RuntimeDir 'python.exe')) -and -not $Force) {
    Write-Host "python-runtime/ already exists (python.exe found). Use -Force to rebuild."
    exit 0
}

if (Test-Path $RuntimeDir) {
    Write-Host "Removing existing python-runtime/ ..."
    Remove-Item -Recurse -Force $RuntimeDir
}
New-Item -ItemType Directory -Path $RuntimeDir | Out-Null

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("csda-pyembed-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
    $EmbedZip = Join-Path $TempDir 'python-embed.zip'
    Write-Host "Downloading embeddable Python $PythonVersion ..."
    Invoke-WebRequest -Uri $EmbedUrl -OutFile $EmbedZip

    Write-Host "Extracting to python-runtime/ ..."
    Expand-Archive -Path $EmbedZip -DestinationPath $RuntimeDir -Force

    # The embeddable distribution ships with `import site` disabled and no
    # pip. Re-enable site-packages so pip-installed deps (and the
    # site-packages dir itself) are importable at runtime.
    $PthFile = Join-Path $RuntimeDir "python$PythonTag._pth"
    if (-not (Test-Path $PthFile)) {
        throw "Expected $PthFile after extracting the embeddable zip - layout may have changed."
    }
    $PthContent = Get-Content $PthFile
    $PthContent = $PthContent -replace '^#import site$', 'import site'
    if ($PthContent -notcontains 'Lib\site-packages') {
        $PthContent += 'Lib\site-packages'
    }
    Set-Content -Path $PthFile -Value $PthContent -Encoding ASCII

    $GetPipPy = Join-Path $TempDir 'get-pip.py'
    Write-Host "Downloading get-pip.py ..."
    Invoke-WebRequest -Uri $GetPipUrl -OutFile $GetPipPy

    $PythonExe = Join-Path $RuntimeDir 'python.exe'
    Write-Host "Bootstrapping pip ..."
    & $PythonExe $GetPipPy --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw "get-pip.py failed with exit code $LASTEXITCODE" }

    Write-Host "Installing python/requirements.txt ..."
    & $PythonExe -m pip install --no-warn-script-location -r $RequirementsFile
    if ($LASTEXITCODE -ne 0) { throw "pip install failed with exit code $LASTEXITCODE" }

    # Trim install artifacts that only matter at install time, to keep the
    # bundled resource smaller.
    Get-ChildItem -Path $RuntimeDir -Recurse -Directory -Filter '__pycache__' |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "python-runtime/ is ready ($RuntimeDir)."
}
finally {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
