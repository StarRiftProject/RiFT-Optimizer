$ErrorActionPreference = 'Stop'

$enginePath = (Resolve-Path (Join-Path $PSScriptRoot '..\engine\rift-boost.ps1')).Path
$src = Get-Content -LiteralPath $enginePath -Raw
$src = $src -replace '(?ms)^boot[\s\S]*$', ''
$tmp = Join-Path $env:TEMP ('rift_root_' + [guid]::NewGuid().ToString('N') + '.ps1')
$src | Out-File -LiteralPath $tmp -Encoding UTF8
. $tmp
Remove-Item $tmp -Force

function emit { param($o) }
function rule { param($n) }
$script:logLines = @()
function log { param($m, $l) $script:logLines += "[$l] $m" }

$script:suid = 'Permission denied'
$script:perMethod = @{}
$script:selinuxOut = 'Enforcing'

function global:sh {
    param([string]$c, [switch]$q)

    # answer the probes the way a real device would, so method selection is exercised
    if ($c -match "getenforce") { return $script:selinuxOut }
    if ($c -match "\[ -d '/data/adb/(magisk|ksu|apatch)'") { return '0' }
    if ($c -match 'magisk -v') { return '' }
    if ($c -match "\[ -e '(/system|/sbin|/vendor|/debug_ramdisk)[\w/.]*'") { return '1' }
    if ($c -match 'getprop ro.debuggable') { return '0' }
    if ($c -match 'getprop ro.build.type') { return 'user' }

    if ($c -match "^id -u$") { return $script:plainUid }
    if ($c -match "^(?<w>su -c|su 0 -c|ksud -c|apd -c|magisk su -c|sudo -n sh -c|sh -c) 'id -u'$") {
        $w = $Matches['w']
        if ($script:perMethod.ContainsKey($w)) { return $script:perMethod[$w] }
        return 'Permission denied'
    }
    return ''
}

function Run-Case {
    param([string]$Name, [hashtable]$PerMethod, [string]$PlainUid, [bool]$ExpectRoot, [string]$ExpectMethod)
    $script:perMethod = $PerMethod
    $script:plainUid = $PlainUid
    $script:selinuxOut = 'Enforcing'
    $script:logLines = @()
    $script:root = $false; $script:uid0 = $false
    $script:rootMethod = ''; $script:rootManager = ''; $script:selinux = ''
    $script:dev = 'mock:5555'

    checkRoot

    $gotRoot = $script:root
    $gotMethod = $script:rootMethod
    $pass = ($gotRoot -eq $ExpectRoot)
    if ($ExpectMethod) { $pass = $pass -and ($gotMethod -eq $ExpectMethod) }

    $tag = if ($pass) { 'PASS' } else { 'FAIL' }
    $color = if ($pass) { 'Green' } else { 'Red' }
    Write-Host ("  [{0}] {1,-22} root={2,-5} method={3}" -f $tag, $Name, $gotRoot, ($(if($gotMethod){$gotMethod}else{'-'}))) -ForegroundColor $color
    if (-not $pass) {
        Write-Host ("         expected root={0} method={1}" -f $ExpectRoot, $ExpectMethod) -ForegroundColor DarkGray
        $script:logLines | Select-Object -First 4 | ForEach-Object { Write-Host ("         $_") -ForegroundColor DarkGray }
    }
    return $pass
}

$denied = 'Permission denied'
$results = @()

Write-Host "=== ROOT DETECTION MATRIX ===" -ForegroundColor Cyan
$results += Run-Case 'already uid 0'        @{}                              '0'     $true  'uid0'
$results += Run-Case 'su works'             @{ 'su -c' = '0' }                '2000' $true  'su -c'
$results += Run-Case 'su returns id output' @{ 'su -c' = 'uid=0(root)' }      '2000' $true  'su -c'
$results += Run-Case 'su refused'           @{}                              '2000' $false $null
$results += Run-Case 'su returns 1000'      @{ 'su -c' = '1000' }             '2000' $false $null
$results += Run-Case 'kernelsu ksud only'   @{ 'ksud -c' = '0' }              '2000' $true  'ksud'
$results += Run-Case 'apatch apd only'      @{ 'apd -c' = '0' }               '2000' $true  'apd'
$results += Run-Case 'magisk su only'       @{ 'magisk su -c' = '0' }         '2000' $true  'magisk su'
$results += Run-Case 'su 0 form'            @{ 'su 0 -c' = '0' }              '2000' $true  'su 0'
$results += Run-Case 'shell is uid 2000'    @{}                              '2000' $false $null
$results += Run-Case 'no su at all'         @{}                              '2000' $false $null
$results += Run-Case 'uid 0 with junk'      @{ 'su -c' = "0`nwarn: noise" }   '2000' $true  'su -c'

$failed = @($results | Where-Object { -not $_ })
Write-Host ""
if ($failed.Count) {
    Write-Host ("RESULT: FAIL ({0}/{1} cases)" -f $failed.Count, $results.Count) -ForegroundColor Red
    exit 1
}
Write-Host ("RESULT: PASS ({0}/{1} cases)" -f $results.Count, $results.Count) -ForegroundColor Green