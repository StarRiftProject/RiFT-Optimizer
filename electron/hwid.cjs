'use strict'

// A stable per-machine id. Local only: the parts are read from Windows and
// hashed with scrypt into an id that cannot be walked back to the raw serials.
// Nothing here talks to the network.

const crypto = require('node:crypto')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function powershell(script) {
  try {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 },
    ).trim()
  } catch {
    return ''
  }
}

function machineGuid() {
  return powershell("(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid")
}

function boardSerial() {
  return powershell(
    "(Get-CimInstance Win32_BaseBoard -EA 0 | Select-Object -First 1 -ExpandProperty SerialNumber)",
  )
}

function diskSerial() {
  return powershell(
    "(Get-PhysicalDisk -EA 0 | Select-Object -First 1 -ExpandProperty UniqueId)",
  )
}

function biosSerial() {
  return powershell("(Get-CimInstance Win32_BIOS -EA 0 | Select-Object -First 1 -ExpandProperty SerialNumber)")
}

// placeholders are dropped so a failed read never becomes a fingerprint: two
// machines both missing a serial must not collapse onto the same id.
function normalise(value) {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return ''
  if (/^(TO BE FILLED BY O\.E\.M\.|DEFAULT STRING|INVALID|UNKNOWN|NONE|NULL|0{8,})$/.test(text)) return ''
  return text
}

function parts() {
  const collected = {
    guid: normalise(machineGuid()),
    board: normalise(boardSerial()),
    disk: normalise(diskSerial()),
    bios: normalise(biosSerial()),
  }
  const usable = Object.values(collected).filter(Boolean)
  return {
    collected,
    // fewer than two real identifiers means we cannot call this machine-specific
    reliable: usable.length >= 2,
    usableCount: usable.length,
  }
}

function hwid() {
  const { collected, reliable, usableCount } = parts()
  const material = [collected.guid, collected.board, collected.disk, collected.bios]
    .filter(Boolean)
    .join('|')
  if (!material) return { hwid: '', reliable: false, usableCount: 0, parts: {} }
  const digest = crypto.scryptSync(material, 'rift.hwid.v1', 32).toString('hex')
  const grouped = digest.match(/.{1,8}/g).join('-')
  // the raw serial values are deliberately not returned, so nothing downstream
  // can log or ship them by accident
  return { hwid: grouped, reliable, usableCount, parts: {} }
}

const STORE = () => path.join(appDataPath(), 'hwid.json')

function appDataPath() {
  const base = process.env.APPDATA || os.homedir() || '.'
  return path.join(base, 'RIFT')
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE(), 'utf8'))
  } catch {
    return null
  }
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(STORE()), { recursive: true })
  fs.writeFileSync(STORE(), JSON.stringify(data, null, 2), 'utf8')
}

// The id is computed, then remembered. If it later disagrees with what this PC
// reports, something copied the folder, and we say so rather than silently
// re-binding to the new machine.
function resolve() {
  const current = hwid()
  const stored = readStore()

  if (!stored || !stored.hwid) {
    if (current.hwid) {
      writeStore({ hwid: current.hwid, firstSeen: new Date().toISOString(), reliable: current.reliable })
    }
    return { ...current, bound: current.hwid, mismatch: false, firstBind: true }
  }

  const mismatch = Boolean(current.hwid) && stored.hwid !== current.hwid
  return {
    ...current,
    bound: stored.hwid,
    mismatch,
    firstBind: false,
    firstSeen: stored.firstSeen || null,
  }
}

function short(id) {
  return id ? id.slice(0, 18) : ''
}

module.exports = { hwid, resolve, parts, short, STORE }