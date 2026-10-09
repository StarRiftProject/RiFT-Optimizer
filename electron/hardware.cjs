'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { createCpuSampler, readMemory } = require('./hotpath.cjs')

const DEFAULT_INTERVAL_MS = 1500
const FAST_INTERVAL_MS = 250
const MAX_BACKLOG = 240

let child = null
let reader = null
let restartTimer = null
let stopping = false
let lastEvent = null
let subscribers = new Set()

let fastTimer = null
let tick = 0
let cachedGpu = null
let cachedGpuSource = null
let cachedDisk = null
let cachedUptime = null
const sampleCpu = createCpuSampler()

function scriptPath() {
  const candidates = [
    path.join(__dirname, '..', 'engine', 'rift-sensors.ps1'),
    path.join(process.resourcesPath || '', 'engine', 'rift-sensors.ps1'),
  ]
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null
}

function sensorsInfo() {
  const script = scriptPath()
  return {
    available: Boolean(script),
    script,
    name: script ? path.basename(script) : null,
    intervalMs: DEFAULT_INTERVAL_MS,
    running: Boolean(child),
  }
}

function parse(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const value = JSON.parse(trimmed)
    return value && typeof value.e === 'string' ? value : null
  } catch {
    return null
  }
}

function publish(event) {
  lastEvent = event
  for (const subscriber of subscribers) {
    try {
      subscriber(event)
    } catch {
      /* one bad subscriber must not kill the feed */
    }
  }
}

function fastTick() {
  sampleCpu()
  tick += 1

  const cpu = sampleCpu()
  const mem = readMemory()

  const rows = cpu.coreLoad ?? []

  publish({
    e: 'sample',
    n: tick,
    at: new Date().toISOString(),
    cpuLoad: cpu.load,
    cpuSource: 'kernel-delta',
    cpuCores: cpu.cores,
    cpuCoreLoad: rows,
    cpuClockMHz: cpu.speedMHz ?? null,
    ramLoad: mem.load,
    ramUsedMB: mem.usedMB,
    ramTotalMB: mem.totalMB,
    ramSource: 'globalmemorystatus',
    diskLoad: cachedDisk,
    uptimeH: cachedUptime,
    gpuSource: cachedGpuSource,
    gpu: cachedGpu ? [cachedGpu] : null,
  })
}

function startFastPath() {
  if (fastTimer) return
  sampleCpu()
  fastTimer = setInterval(fastTick, FAST_INTERVAL_MS)
  if (typeof fastTimer.unref === 'function') fastTimer.unref()
}

function stopFastPath() {
  if (!fastTimer) return
  clearInterval(fastTimer)
  fastTimer = null
}

function startSensors() {
  if (child) {
    startFastPath()
    return { started: true, alreadyRunning: true }
  }

  const script = scriptPath()
  if (!script) return { started: false, reason: 'sensor-script-missing' }

  stopping = false

  try {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-IntervalMs', String(DEFAULT_INTERVAL_MS)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } },
    )
  } catch (error) {
    child = null
    return { started: false, reason: error instanceof Error ? error.message : String(error) }
  }

  const active = child
  reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  reader.on('line', (line) => {
    const event = parse(line)
    if (!event) return

    if (event.e === 'sample') {
      const list = Array.isArray(event.gpu) ? event.gpu : []
      cachedGpu = list[0] ?? null
      cachedGpuSource = event.gpuSource ?? null
      if (event.diskLoad != null) cachedDisk = event.diskLoad
      if (event.uptimeH != null) cachedUptime = event.uptimeH
      return
    }

    publish(event)
  })

  const errors = readline.createInterface({ input: child.stderr, crlfDelay: Infinity })
  errors.on('line', (line) => {
    const text = line.trim()
    if (text) publish({ e: 'log', l: 'warn', m: text })
  })

  child.on('error', (error) => {
    publish({ e: 'log', l: 'err', m: error instanceof Error ? error.message : String(error) })
  })

  child.on('close', (code) => {
    child = null
    reader = null
    publish({ e: 'sensors-stopped', code })
    if (stopping) return
    restartTimer = setTimeout(() => {
      if (!stopping) startSensors()
    }, 1500)
  })

  startFastPath()

  return { started: true }
}

function stopSensors() {
  stopping = true
  stopFastPath()
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (child) {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
  child = null
  return { stopped: true }
}

function sensorsStatus() {
  const info = sensorsInfo()
  if (!lastEvent) return { ...info, latest: null }
  return { ...info, latest: lastEvent }
}

function onHardware(listener) {
  if (typeof listener !== 'function') return () => {}
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

function backlog() {
  return lastEvent ? [lastEvent] : []
}

module.exports = {
  sensorsInfo,
  sensorsStatus,
  startSensors,
  stopSensors,
  onHardware,
  backlog,
  MAX_BACKLOG,
}