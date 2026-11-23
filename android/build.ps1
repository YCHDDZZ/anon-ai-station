# Manual APK build (no Gradle / Android Studio)
$ErrorActionPreference = 'Stop'
$SDK = $env:ANDROID_HOME
if (-not $SDK) { throw '请先设置 ANDROID_HOME 环境变量' }
$BT = "$SDK\build-tools\android-14"
$PLATFORM = "$SDK\platforms\android-34\android.jar"
$JAVA_HOME = $env:JAVA_HOME
if (-not $JAVA_HOME) { throw '请先设置 JAVA_HOME 环境变量' }
$env:JAVA_HOME = $JAVA_HOME
$env:PATH = "$JAVA_HOME\bin;$env:PATH"

$VERSION_CODE = 2
$VERSION_NAME = '1.1.0'

$SRC = $PSScriptRoot
# native tools cannot handle the Chinese source path; build from an ASCII workspace
$WORK = if ($env:BUILD_WORK) { $env:BUILD_WORK } else { Join-Path $env:TEMP 'anon-android-build' }
if (Test-Path $WORK) { Remove-Item $WORK -Recurse -Force }
New-Item -ItemType Directory -Force -Path $WORK | Out-Null
Copy-Item "$SRC\java" -Destination $WORK -Recurse -Force
Copy-Item "$SRC\res" -Destination $WORK -Recurse -Force
Copy-Item "$SRC\AndroidManifest.xml" -Destination $WORK -Force
if (Test-Path "$SRC\keystore") { Copy-Item "$SRC\keystore" -Destination $WORK -Recurse -Force }

$BUILD = Join-Path $WORK 'build'
$OUT = Join-Path $WORK 'anno-ai.apk'
$KS = Join-Path $WORK 'keystore\anon.keystore'

if (-not (Test-Path $PLATFORM)) { throw "android.jar missing: $PLATFORM" }
if (-not (Test-Path "$BT\aapt2.exe")) { throw "build-tools missing: $BT" }

New-Item -ItemType Directory -Force -Path "$BUILD\gen", "$BUILD\classes", "$BUILD\dex" | Out-Null

Write-Host '[1/6] compile resources'
& "$BT\aapt2.exe" compile --dir "$WORK\res" -o "$BUILD\res.zip"
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '[2/6] link resources'
$linkArgs = @(
    'link', '-o', "$BUILD\base.apk", '-I', $PLATFORM, '--manifest', "$WORK\AndroidManifest.xml",
    "$BUILD\res.zip", '--java', "$BUILD\gen",
    '--min-sdk-version', '24', '--target-sdk-version', '34',
    '--version-code', "$VERSION_CODE", '--version-name', $VERSION_NAME
)
& "$BT\aapt2.exe" @linkArgs
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Write-Host '[3/6] compile java'
$javaSources = @()
$javaSources += Get-ChildItem "$WORK\java" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$javaSources += Get-ChildItem "$BUILD\gen" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& "$JAVA_HOME\bin\javac.exe" --release 8 -encoding UTF-8 -classpath $PLATFORM -d "$BUILD\classes" @javaSources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Write-Host '[4/6] build dex'
$classes = Get-ChildItem "$BUILD\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& "$BT\d8.bat" --lib $PLATFORM --min-api 24 --output "$BUILD\dex" @classes
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Write-Host '[5/6] package and align'
& "$JAVA_HOME\bin\jar.exe" uf "$BUILD\base.apk" -C "$BUILD\dex" classes.dex
if ($LASTEXITCODE -ne 0) { throw 'jar packaging failed' }
& "$BT\zipalign.exe" -f 4 "$BUILD\base.apk" "$BUILD\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

Write-Host '[6/6] sign'
if (-not (Test-Path $KS)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $KS) | Out-Null
    & "$JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $KS -alias anon -keyalg RSA -keysize 2048 `
        -validity 10000 -storepass android -keypass android `
        -dname "CN=Anon AI,O=Chihaya,C=CN" 2>&1 | Out-Null
}
# v1 + v2 + v3 all enabled: Android 7..15 and most OEM installers accept it
$signArgs = @(
    'sign', '--ks', $KS, '--ks-pass', 'pass:android', '--key-pass', 'pass:android',
    '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true',
    '--out', $OUT, "$BUILD\aligned.apk"
)
& "$BT\apksigner.bat" @signArgs
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }
& "$BT\apksigner.bat" verify --verbose --print-certs $OUT
if ($LASTEXITCODE -ne 0) { throw 'apksigner verify failed' }

Write-Host "APK built: $OUT"
$dest = Join-Path $SRC 'anno-ai.apk'
Copy-Item -LiteralPath $OUT -Destination $dest -Force
Get-Item -LiteralPath $OUT, $dest | Select-Object FullName, Length, LastWriteTime | Format-List
$hash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
Write-Host "SHA256: $hash"

# Version sidecar: the host cannot parse binary AndroidManifest.xml, so publish
# the real APK version alongside it for the admin panel to display.
$meta = [ordered]@{
    versionCode = $VERSION_CODE
    versionName = $VERSION_NAME
    package     = 'com.chihaya.anon'
    sha256      = $hash.ToLowerInvariant()
    size        = (Get-Item -LiteralPath $dest).Length
    builtAt     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
$metaPath = Join-Path $SRC 'anno-ai-version.json'
$json = $meta | ConvertTo-Json -Depth 3
# Windows PowerShell 5.1 的 -Encoding utf8 会写入 BOM，PHP 的 json_decode 解析不了
[System.IO.File]::WriteAllText($metaPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Version metadata: $metaPath"
