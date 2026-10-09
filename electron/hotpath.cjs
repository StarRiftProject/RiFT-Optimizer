'use strict'

/**
 * Hot-path CPU and memory sampling, in-process.
 *
 * The WMI route costs 260-320ms per counter class, which caps the whole
 * dashboard at roughly one sample per second. CPU and RAM do not need WMI:
 * the CPU deltas come straight from the kernel's per-core time accounting and
 * RAM from GlobalMemoryStatusEx, the same API Task Manager uses. Both are
 * effectively free, so they run at a high rate and only the genuinely
 * expensive GPU probe stays delegated to the sensor process.
 */

const os = require('node:os')

const IDLE_KEYS = ['idle']

function totalTime(times) {
  let total = 0
  for (const key of Object.keys(times)) {
    if (IDLE_KEYS.includes(key)) continue
    total += times[key]
  }
  return total + times.idle
}

function createCpuSampler() {
  let previous = null

  return function read() {
    const cores = os.cpus()
    const perCore = new Array(cores.length)
    let busy = 0
    let total = 0

    for (let i = 0; i < cores.length; i += 1) {
      const times = cores[i].times
      const all = totalTime(times)
      total += all
      busy += all - times.idle
      perCore[i] = { total: all, busy: all - times.idle }
    }

    if (previous && total > previous.total) {
      const deltaTotal = total - previous.total
      const deltaBusy = busy - previous.busy

      const coreLoad = perCore.map((core, i) => {
        const before = previous.perCore[i]
        if (!before) return 0
        const span = core.total - before.total
        if (span <= 0) return 0
        return Number(((((core.busy - before.busy) / span) * 100) || 0).toFixed(1))
      })

      return {
        load: Number((((deltaBusy / deltaTotal) * 100) || 0).toFixed(1)),
        coreLoad,
        cores: cores.length,
        model: cores[0]?.model ?? null,
        speedMHz: cores[0]?.speed ?? null,
        physicalGuess: estimatePhysical(cores),
      }
    }

    previous = { total, busy, perCore }
    return {
      load: null,
      coreLoad: perCore.map(() => 0),
      cores: cores.length,
      model: cores[0]?.model ?? null,
      speedMHz: cores[0]?.speed ?? null,
      physicalGuess: estimatePhysical(cores),
    }
  }
}

function estimatePhysical(cores) {
  try {
    const seen = new Set()
    for (const core of cores) {
      if (!core.model) continue
      seen.add(`${core.model}|${core.speed}`)
    }
    return seen.size || null
  } catch {
    return null
  }
}

function readMemory() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free

  return {
    totalMB: Math.round(total / 1048576),
    usedMB: Math.round(used / 1048576),
    freeMB: Math.round(free / 1048576),
    load: Number((((used / total) * 100) || 0).toFixed(1)),
  }
}

module.exports = { createCpuSampler, readMemory }