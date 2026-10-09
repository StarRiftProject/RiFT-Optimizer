'use strict'

const { ipcMain, shell } = require('electron')
const https = require('node:https')
const path = require('node:path')
const fs = require('node:fs/promises')

const OWNER = 'StarRiftProject'
const REPO = 'RiFT-Optimizer'
const RELEASES = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`
const DOWNLOADS = `https://github.com/${OWNER}/${REPO}/releases/latest`
const TIMEOUT_MS = 12000
const USER_AGENT = 'RiFT-Optimizer-updater'

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

async function check() {
  if (cached) return cached
  const from = currentVersion()
  cached = (async () => {
    try {
      const release = await fetchJson(RELEASES)
      const latest = String(release.tag_name || '').replace(/^v/, '') || '0.0.0'
      const notes = changelogLines(release.body)
      if (compare(latest, from) > 0) {
        return {
          state: 'available',
          from,
          to: latest,
          notes,
          url: release.html_url || DOWNLOADS,
          publishedAt: release.published_at || null,
        }
      }
      return { state: 'current', from, to: from, notes: [], url: DOWNLOADS }
    } catch (error) {
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

function register() {
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
}

module.exports = { register, check, currentVersion, DOWNLOADS }