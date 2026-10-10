'use strict'

const { app, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const https = require('node:https')
const path = require('node:path')
const fs = require('node:fs/promises')
const { createWriteStream } = require('node:fs')
const { createHash } = require('node:crypto')
const { pipeline } = require('node:stream/promises')

const OWNER = 'StarRiftProject'
const REPO = 'RiFT-Optimizer'
const RELEASES = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`
const DOWNLOADS = `https://github.com/${OWNER}/${REPO}/releases/latest`
const TIMEOUT_MS = 12000
const USER_AGENT = 'RiFT-Optimizer-updater'
const DOWNLOAD_FOLDER = 'RiFT Updates'
const REDIRECT_LIMIT = 6

function currentVersion() {
  try {
    return require(path.join(__dirname, '..', 'package.json')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function compare(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          fetchJson(response.headers.location).then(resolve, reject)
          return
        }
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`github responded ${response.statusCode}`))
          return
        }
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error('timeout')))
    request.on('error', reject)
  })
}

// tags get typed as v0.2.1, V0.2.1, 0.2.1 or release-0.2.1. all of them mean
// the same build, so they all normalise to the same version.
function normaliseTag(tag) {
  const cleaned = String(tag || '')
    .trim()
    .replace(/^[vVrR]/, '')
    .replace(/^(release|rel)[-_.]?/i, '')
  const digits = cleaned.match(/\d+(?:\.\d+)*/)
  return digits ? digits[0] : '0.0.0'
}

function changelogLines(body) {
  if (!body) return []
  return String(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s/.test(line))
    // bullet markers come off here so the ui never has to guess at the shape
    .map((line) => line.replace(/^[-*+]\s+/, ''))
    .filter(Boolean)
    .slice(0, 12)
}

let cached = null
let latestAsset = null
let downloadRunning = false
let lastDownloadedPath = null

async function check() {
  if (cached) return cached
  const from = currentVersion()
  cached = (async () => {
    try {
      const release = await fetchJson(RELEASES)
      const latest = normaliseTag(release.tag_name)
      const notes = changelogLines(release.body)
      if (compare(latest, from) > 0) {
        const expectedAssetName = `R-i-F-T-${latest}-win-x64.zip`
        const asset = Array.isArray(release.assets)
          ? release.assets.find((item) => item?.name === expectedAssetName && Number(item.size) > 0)
          : null
        latestAsset = asset
          ? {
              name: asset.name,
              size: Number(asset.size),
              url: asset.browser_download_url,
              digest: typeof asset.digest === 'string' ? asset.digest : null,
              version: latest,
            }
          : null
        return {
          state: 'available',
          from,
          to: latest,
          notes,
          url: release.html_url || DOWNLOADS,
          publishedAt: release.published_at || null,
          downloadAvailable: Boolean(latestAsset),
          assetName: latestAsset?.name,
          assetSize: latestAsset?.size,
        }
      }
      latestAsset = null
      return { state: 'current', from, to: from, notes: [], url: DOWNLOADS }
    } catch (error) {
      latestAsset = null
      return {
        state: 'offline',
        from,
        to: from,
        notes: [],
        url: DOWNLOADS,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  })()
  return cached
}

function emitProgress(onProgress, payload) {
  try {
    onProgress(payload)
  } catch {
    /* a closed renderer must not interrupt a download */
  }
}

function requestAsset(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error('The release download link is invalid.'))
      return
    }
    const hostAllowed =
      parsed.hostname === 'github.com' ||
      parsed.hostname === 'release-assets.githubusercontent.com' ||
      parsed.hostname === 'objects.githubusercontent.com'
    if (parsed.protocol !== 'https:' || !hostAllowed) {
      reject(new Error('The release download link is not a trusted GitHub address.'))
      return
    }

    const request = https.get(
      parsed,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' } },
      (response) => {
        const status = response.statusCode || 0
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume()
          if (redirects >= REDIRECT_LIMIT) {
            reject(new Error('The release download had too many redirects.'))
            return
          }
          const next = new URL(response.headers.location, parsed)
          requestAsset(next.href, redirects + 1).then(resolve, reject)
          return
        }
        if (status !== 200) {
          response.resume()
          reject(new Error(`GitHub could not provide the update (HTTP ${status}).`))
          return
        }
        resolve(response)
      },
    )
    request.setTimeout(60000, () => request.destroy(new Error('The update download timed out.')))
    request.on('error', reject)
  })
}

async function chooseDownloadPath(directory, name) {
  const extension = path.extname(name)
  const stem = path.basename(name, extension)
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidateName = suffix === 0 ? name : `${stem} (${suffix + 1})${extension}`
    const candidate = path.join(directory, candidateName)
    try {
      await fs.stat(candidate)
    } catch (error) {
      if (error?.code === 'ENOENT') return candidate
      throw error
    }
  }
  throw new Error('Too many copies of this update already exist in the RiFT Updates folder.')
}

async function downloadAsset(asset, onProgress) {
  const safeName = path.basename(asset.name)
  const downloadDirectory = path.join(app.getPath('downloads'), DOWNLOAD_FOLDER)
  await fs.mkdir(downloadDirectory, { recursive: true })
  const destination = await chooseDownloadPath(downloadDirectory, safeName)

  const partialPath = `${destination}.part`
  const response = await requestAsset(asset.url)
  const responseSize = Number(response.headers['content-length'])
  const totalBytes = asset.size || (Number.isFinite(responseSize) && responseSize > 0 ? responseSize : null)
  let downloadedBytes = 0
  let lastPercent = -1
  const hash = createHash('sha256')
  const expectedDigest = typeof asset.digest === 'string' ? asset.digest.match(/^sha256:([a-f0-9]{64})$/i)?.[1] : null
  emitProgress(onProgress, {
    state: 'downloading',
    version: asset.version,
    name: safeName,
    downloadedBytes,
    totalBytes,
    percent: totalBytes ? 0 : null,
  })

  response.on('data', (chunk) => {
    downloadedBytes += chunk.length
    hash.update(chunk)
    const percent = totalBytes ? Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100)) : null
    if (percent !== lastPercent) {
      lastPercent = percent
      emitProgress(onProgress, {
        state: 'downloading',
        version: asset.version,
        name: safeName,
        downloadedBytes,
        totalBytes,
        percent,
      })
    }
  })

  try {
    await pipeline(response, createWriteStream(partialPath, { flags: 'w' }))
    if (totalBytes && downloadedBytes !== totalBytes) {
      throw new Error('The downloaded update size did not match the published release.')
    }
    if (expectedDigest && hash.digest('hex').toLowerCase() !== expectedDigest.toLowerCase()) {
      throw new Error('The downloaded update failed its release checksum.')
    }
    await fs.rename(partialPath, destination)
  } catch (error) {
    await fs.rm(partialPath, { force: true }).catch(() => {})
    throw error
  }

  lastDownloadedPath = destination
  return { name: path.basename(destination), path: destination }
}

function beginDownload(onProgress) {
  if (!latestAsset) return { started: false, reason: 'missing-release-asset' }
  if (downloadRunning) return { started: false, reason: 'already-downloading' }

  const asset = latestAsset
  downloadRunning = true
  emitProgress(onProgress, {
    state: 'downloading',
    version: asset.version,
    name: asset.name,
    downloadedBytes: 0,
    totalBytes: asset.size,
    percent: 0,
  })
  void downloadAsset(asset, onProgress)
    .then((download) => {
      emitProgress(onProgress, {
        state: 'complete',
        version: asset.version,
        name: download.name,
        downloadedBytes: asset.size,
        totalBytes: asset.size,
        percent: 100,
      })
      setTimeout(() => launchDownloadedUpdate(download.path, asset, onProgress), 900)
    })
    .catch((error) => {
      emitProgress(onProgress, {
        state: 'error',
        version: asset.version,
        name: asset.name,
        downloadedBytes: 0,
        totalBytes: asset.size,
        percent: null,
        message: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      downloadRunning = false
    })
  return { started: true, name: asset.name }
}

function powershellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function launchDownloadedUpdate(downloadPath, asset, onProgress) {
  const status = {
    version: asset.version,
    name: asset.name,
    downloadedBytes: asset.size,
    totalBytes: asset.size,
    percent: 100,
  }
  emitProgress(onProgress, { ...status, state: 'installing' })

  if (process.platform !== 'win32') {
    emitProgress(onProgress, {
      ...status,
      state: 'error',
      message: 'The update folder is downloaded. Restart RiFT and open the update package in Downloads > RiFT Updates.',
    })
    return
  }

  const installDirectory = path.resolve(path.dirname(app.getPath('exe')))
  const currentExecutable = path.resolve(app.getPath('exe'))
  const installParent = path.resolve(app.getPath('desktop'))
  const nextDirectory = path.join(installParent, `RiFT Optimizer v${asset.version}`)
  const stagingDirectory = path.join(installParent, `.rift-update-${asset.version}-${process.pid}`)
  const previousDirectory = path.join(
    installParent,
    `.RiFT Optimizer v${currentVersion()}.backup-${Date.now()}`,
  )
  const replacementBackup = path.join(
    installParent,
    `.RiFT Optimizer v${asset.version}.backup-${Date.now()}`,
  )
  const executableName = path.basename(currentExecutable)
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$download = ${powershellLiteral(downloadPath)}`,
    `$currentDirectory = ${powershellLiteral(installDirectory)}`,
    `$currentExecutableName = ${powershellLiteral(executableName)}`,
    `$nextDirectory = ${powershellLiteral(nextDirectory)}`,
    `$stagingDirectory = ${powershellLiteral(stagingDirectory)}`,
    `$previousDirectory = ${powershellLiteral(previousDirectory)}`,
    `$replacementBackup = ${powershellLiteral(replacementBackup)}`,
    `$oldProcessId = ${process.pid}`,
    '$movedCurrent = $false',
    '$movedReplacement = $false',
    '$installedUpdate = $false',
    '$newAppStarted = $false',
    'try {',
    '  $waitUntil = (Get-Date).AddSeconds(60)',
    '  while (Get-Process -Id $oldProcessId -ErrorAction SilentlyContinue) { if ((Get-Date) -gt $waitUntil) { throw "The previous RiFT window did not close in time." }; Start-Sleep -Milliseconds 250 }',
    "  if (-not (Test-Path -LiteralPath $download -PathType Leaf)) { throw 'The downloaded update is missing.' }",
    '  if (Test-Path -LiteralPath $stagingDirectory) { Remove-Item -LiteralPath $stagingDirectory -Recurse -Force }',
    '  New-Item -ItemType Directory -Path $stagingDirectory | Out-Null',
    '  Expand-Archive -LiteralPath $download -DestinationPath $stagingDirectory -Force',
    "  $packageExecutable = Get-ChildItem -LiteralPath $stagingDirectory -Filter 'R i F T.exe' -Recurse -File | Select-Object -First 1",
    "  if (-not $packageExecutable) { throw 'The downloaded RiFT app folder does not contain R i F T.exe.' }",
    '  $packageDirectory = $packageExecutable.DirectoryName',
    '  if (Test-Path -LiteralPath $nextDirectory) { Move-Item -LiteralPath $nextDirectory -Destination $replacementBackup; $movedReplacement = $true }',
    '  if (Test-Path -LiteralPath $currentDirectory) { Move-Item -LiteralPath $currentDirectory -Destination $previousDirectory; $movedCurrent = $true }',
    '  Move-Item -LiteralPath $packageDirectory -Destination $nextDirectory',
    '  $installedUpdate = $true',
    "  $newExecutable = Join-Path $nextDirectory 'R i F T.exe'",
    "  if (-not (Test-Path -LiteralPath $newExecutable -PathType Leaf)) { throw 'The new RiFT executable was not found after installation.' }",
    '  $newProcess = Start-Process -FilePath $newExecutable -WorkingDirectory $nextDirectory -PassThru',
    '  Start-Sleep -Milliseconds 1800',
    '  $newProcess.Refresh()',
    "  if ($newProcess.HasExited) { throw 'The updated RiFT app closed during startup.' }",
    '  $newAppStarted = $true',
    '  Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue',
    '  if (Test-Path -LiteralPath $stagingDirectory) { Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue }',
    '  foreach ($oldFolderPath in @($previousDirectory, $replacementBackup)) {',
    '    for ($attempt = 1; $attempt -le 5 -and (Test-Path -LiteralPath $oldFolderPath); $attempt++) {',
    '      try { Remove-Item -LiteralPath $oldFolderPath -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds (250 * $attempt) }',
    '    }',
    '  }',
    '  if ((Test-Path -LiteralPath $previousDirectory) -or (Test-Path -LiteralPath $replacementBackup)) { try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("RiFT updated successfully, but Windows could not remove a previous app folder. Close any windows using RiFT, then check the Desktop for a leftover folder starting with .RiFT Optimizer.", "RiFT update", "OK", "Warning") | Out-Null } catch { } }',
    '} catch {',
    '  $failure = $_.Exception.Message',
    '  if ($newAppStarted) { try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("RiFT updated and launched, but cleanup did not finish. You can remove the old version folder from your Desktop.`r`n`r`n$failure", "RiFT update", "OK", "Warning") | Out-Null } catch { }; exit 0 }',
    '  if ($installedUpdate -and (Test-Path -LiteralPath $nextDirectory)) { Remove-Item -LiteralPath $nextDirectory -Recurse -Force -ErrorAction SilentlyContinue }',
    '  if ($movedCurrent -and (Test-Path -LiteralPath $previousDirectory)) { Move-Item -LiteralPath $previousDirectory -Destination $currentDirectory -ErrorAction SilentlyContinue }',
    '  if ($movedReplacement -and (Test-Path -LiteralPath $replacementBackup)) { Move-Item -LiteralPath $replacementBackup -Destination $nextDirectory -ErrorAction SilentlyContinue }',
    '  if (Test-Path -LiteralPath $stagingDirectory) { Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue }',
    '  $oldExecutable = Join-Path $currentDirectory $currentExecutableName',
    '  if (Test-Path -LiteralPath $oldExecutable -PathType Leaf) { Start-Process -FilePath $oldExecutable -WorkingDirectory $currentDirectory -ErrorAction SilentlyContinue }',
    "  try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(\"RiFT could not finish the update. Your previous version was restored.\r\n\r\n$failure\", 'RiFT update', 'OK', 'Error') | Out-Null } catch { }",
    '}',
  ].join('\n')
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  const powerShell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )

  let handedOff = false
  const helper = spawn(powerShell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  helper.once('error', (error) => {
    emitProgress(onProgress, {
      ...status,
      state: 'error',
      message: `The update downloaded, but RiFT could not start the installer helper. It is saved in Downloads > ${DOWNLOAD_FOLDER}. ${error.message}`,
    })
  })
  helper.once('spawn', () => {
    handedOff = true
    helper.unref()
    app.quit()
  })
  helper.once('close', (code) => {
    if (handedOff || code === 0) return
    emitProgress(onProgress, {
      ...status,
      state: 'error',
      message: `The update downloaded, but RiFT could not start the installer helper. It is saved in Downloads > ${DOWNLOAD_FOLDER}.`,
    })
  })
}

function revealDownloadedUpdate() {
  if (!lastDownloadedPath) return false
  shell.showItemInFolder(lastDownloadedPath)
  return true
}

function register(onDownloadProgress = () => {}) {
  ipcMain.handle('rift:version', () => ({ version: currentVersion(), repo: `${OWNER}/${REPO}` }))
  ipcMain.handle('rift:update-check', () => check())
  ipcMain.handle('rift:update-open', () => {
    shell.openExternal(DOWNLOADS)
    return true
  })
  ipcMain.handle('rift:update-reset', async () => {
    cached = null
    return check()
  })
  ipcMain.handle('rift:update-download', () => beginDownload(onDownloadProgress))
  ipcMain.handle('rift:update-reveal', () => revealDownloadedUpdate())
}

module.exports = { register, check, currentVersion, DOWNLOADS }
