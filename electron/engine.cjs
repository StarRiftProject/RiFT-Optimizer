'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const RUN_TIMEOUT_MS = 8 * 60 * 1000
const ALLOWED_ACTIONS = new Set(['status', 'watch', 'bench', 'preview', 'lite', 'max', 'ultra', 'windows', 'custom', 'restore'])
const ALLOWED_MODULE_IDS = new Set(['system', 'pubg', 'network', 'memory', 'input', 'privacy'])

let activeChild = null
let watchChild = null
let watchTimer = null
let watchSink = null

function enginePath() {
  const candidates = [
    path.join(__dirname, '..', 'engine', 'rift-boost.ps1'),
    path.join(process.resourcesPath || '', 'engine', 'rift-boost.ps1'),
    path.join(process.cwd(), 'engine', 'rift-boost.ps1'),
  ]
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null
}

function engineInfo() {
  const script = enginePath()
  if (!script) {
    return { available: false, script: null, reason: 'The tuning engine was not found next to the app.' }
  }
  return {
    available: true,
    script,
    name: path.basename(script),
    folder: path.dirname(script),
  }
}

function sanitizeAction(action) {
  return typeof action === 'string' && ALLOWED_ACTIONS.has(action) ? action : null
}

function sanitizeModules(modules) {
  if (!Array.isArray(modules)) return []
  const seen = new Set()
  for (const raw of modules) {
    if (typeof raw !== 'string') continue
    const id = raw.trim().toLowerCase()
    if (ALLOWED_MODULE_IDS.has(id)) seen.add(id)
  }
  return [...seen]
}

function killActiveRun() {
  if (!activeChild) return false
  try {
    activeChild.kill()
  } catch {
    /* the process is already gone */
  }
  activeChild = null
  return true
}

function stopWatch() {
  if (!watchChild) return false
  try {
    watchChild.kill()
  } catch {
    /* already gone */
  }
  watchChild = null
  return true
}

// long lived process that keeps reporting whether emulator-5554 is there.
// it never times out and it restarts itself if powershell dies, so the ui
// always knows the current state without anyone pressing refresh
function startWatch(onEvent) {
  // exactly one watcher may exist. anything left over is killed first so a
  // restart race can never leave two pollers fighting over the device.
  if (watchTimer) {
    clearTimeout(watchTimer)
    watchTimer = null
  }
  watchSink = typeof onEvent === 'function' ? onEvent : null
  stopWatch()

  const info = engineInfo()
  if (!info.available) return false

  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', info.script, '-Action', 'watch', '-Json']

  let child
  try {
    child = spawn('powershell.exe', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    })
  } catch {
    return false
  }

  watchChild = child

  const stdout = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const stderr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity })

  stdout.on('line', (line) => {
    const event = parseEvent(line)
    if (event) onEvent(event)
  })

  stderr.on('line', (line) => {
    const text = line.trim()
    if (text) onEvent({ e: 'log', l: 'warn', m: text })
  })

  child.on('close', () => {
    if (watchChild === child) watchChild = null
    if (activeChild) return
    watchTimer = setTimeout(() => {
      watchTimer = null
      startWatch(onEvent)
    }, 1500)
  })

  child.on('error', () => {
    if (watchChild === child) watchChild = null
  })

  return true
}

function parseEvent(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed.e === 'string' ? parsed : null
  } catch {
    return null
  }
}

function runEngine(action, modules, onEvent, benchSeconds) {
  const clean = sanitizeAction(action)
  if (!clean) return Promise.reject(new Error('That action is not on the list.'))

  const info = engineInfo()
  if (!info.available) return Promise.reject(new Error(info.reason))

  if (activeChild) return Promise.reject(new Error('A run is already in progress.'))

  // the watcher stands down for the length of a run so it cannot poll or log
  // while the engine is busy writing to the device
  stopWatch()

  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', info.script, '-Action', clean, '-Json']
  if (clean === 'bench') args.push('-BenchSeconds', String(benchSeconds ?? 8))
  const picked = clean === 'custom' ? sanitizeModules(modules) : []
  if (picked.length) args.push('-Modules', picked.join(','))

  return new Promise((resolve) => {
    let child
    try {
      child = spawn('powershell.exe', args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      })
    } catch (error) {
      onEvent({ e: 'fatal', m: error instanceof Error ? error.message : String(error) })
      resolve({ started: false, reason: 'spawn-failed' })
      return
    }

    activeChild = child
    onEvent({ e: 'start', action: clean, modules: picked })

    const stdout = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
    const stderr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity })

    stdout.on('line', (line) => {
      const event = parseEvent(line)
      if (event) onEvent(event)
    })

    stderr.on('line', (line) => {
      const text = line.trim()
      if (text) onEvent({ e: 'log', l: 'err', m: text })
    })

    const timer = setTimeout(() => {
      onEvent({ e: 'log', l: 'warn', m: 'The run passed its time limit and was stopped.' })
      killActiveRun()
    }, RUN_TIMEOUT_MS)

    let settled = false
    const settle = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdout.close()
      stderr.close()
      if (activeChild === child) activeChild = null
      onEvent({ e: 'exit', code: child.exitCode, ...payload })
      // the watcher comes back once the device is free again
      if (watchSink) startWatch(watchSink)
      resolve({ started: true, ...payload })
    }

    child.on('error', (error) => {
      onEvent({ e: 'fatal', m: error instanceof Error ? error.message : String(error) })
      settle({ ok: false, reason: 'spawn-failed' })
    })

    child.on('close', (code) => {
      settle({ ok: code === 0, reason: code === 0 ? 'complete' : `exit-${code}` })
    })
  })
}

module.exports = { engineInfo, runEngine, killActiveRun, startWatch, stopWatch }