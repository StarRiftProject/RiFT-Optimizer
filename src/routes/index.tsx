import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { UIButton } from '../components/ui-button'
import {
  actionForPreset,
  bridgeAvailable,
  cancelRun,
  checkForUpdate,
  downloadUpdate,
  getAppVersion,
  getEngine,
  getHardware,
  recheckForUpdate,
  revealUpdateDownload,
  runEngine,
  subscribeEngine,
  subscribeHardware,
  subscribeUpdate,
  subscribeUpdateDownload,
} from '../lib/rift-bridge'
import type { AuthProviderId } from '../lib/firebase'
import { CathedralScene } from '../components/cathedral-scene'
import { LeftRail, RightRail } from '../components/overview-rails'
import type {
  Account,
  DeviceStatus,
  EngineEvent,
  EngineInfo,
  GpuLive,
  HardwareEvent,
  HardwareProfile,
  HwidInfo,
  RunAction,
  RunResult,
  UpdateDownloadStatus,
  UpdateStatus,
} from '../lib/rift-bridge'

export const Route = createFileRoute('/')({ component: RiftConsole })

type ModuleId = 'system' | 'pubg' | 'network' | 'memory' | 'input' | 'privacy'
type PresetId = 'balanced' | 'competitive' | 'unleashed' | 'custom'
type SectionId = 'tuning' | 'hardware' | 'community' | 'overview' | 'optimizations' | 'activity' | 'settings' | 'game'
type RunState = 'running' | 'complete' | 'cancelled' | null
type TabId = 'lite' | 'max' | 'ultra' | 'windows'

type TabDefinition = {
  id: TabId
  label: string
  kicker: string
  title: string
  blurb: string
  action: RunAction
  requiresRoot: boolean
  needsDevice: boolean
  steps: { name: string; detail: string; kind: 'android' | 'root' | 'windows' | 'game' }[]
}

type ModuleDefinition = {
  id: ModuleId
  name: string
  description: string
  category: string
  icon: IconName
  index: string
}

type Session = {
  id: string
  timestamp: string
  preset: string
  moduleCount: number
  status: string
  output?: TerminalLine[]
}

type TerminalLine = { id: string; text: string; level: 'info' | 'ok' | 'warn' | 'err' | 'dbg' | 'stage'; base: string; count: number }

type BenchResult = {
  ok: boolean
  reason?: string
  source?: 'device' | 'host'
  package?: string
  fps?: number
  rate?: number
  frames?: number
  seconds?: number
  jank?: number | null
  jankPct?: number | null
  monitor?: number | null
  keepingUp?: boolean | null
  device?: string
  host?: string
  message?: string
}

const modules: ModuleDefinition[] = [
  { id: 'system', name: 'System core', description: 'Less background noise. More room to play.', category: 'WINDOWS', icon: 'core', index: '01' },
  { id: 'pubg', name: 'PUBG engine', description: 'A sharper configuration for the battleground.', category: 'GAME', icon: 'game', index: '02' },
  { id: 'network', name: 'Network flow', description: 'Put your connection on the front line.', category: 'NETWORK', icon: 'network', index: '03' },
  { id: 'memory', name: 'Memory purge', description: 'Clear the clutter. Keep the essentials.', category: 'MEMORY', icon: 'memory', index: '04' },
  { id: 'input', name: 'Input precision', description: 'Every movement. Without the interference.', category: 'PERIPHERALS', icon: 'input', index: '05' },
  { id: 'privacy', name: 'Silent running', description: 'Quiet the telemetry. Reclaim your focus.', category: 'PRIVACY', icon: 'privacy', index: '06' },
]

const presets: { id: Exclude<PresetId, 'custom'>; name: string; description: string; modules: ModuleId[]; marker?: string }[] = [
  { id: 'balanced', name: 'Balanced', description: 'Performance meets stability', modules: ['system', 'pubg', 'memory'] },
  { id: 'competitive', name: 'Competitive', description: 'Built for the last circle', modules: ['system', 'pubg', 'network', 'memory', 'input'], marker: 'RECOMMENDED' },
  { id: 'unleashed', name: 'Unleashed', description: 'Every ounce of performance', modules: modules.map((item) => item.id) },
]

const presetNames: Record<PresetId, string> = {
  balanced: 'Balanced',
  competitive: 'Competitive',
  unleashed: 'Unleashed',
  custom: 'Custom configuration',
}

const navItems: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'tuning', label: 'Tuning', icon: 'sliders' },
  { id: 'hardware', label: 'Hardware', icon: 'core' },
  { id: 'community', label: 'Community', icon: 'activity' },
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'optimizations', label: 'Optimizations', icon: 'shield' },
  { id: 'activity', label: 'Activity log', icon: 'file' },
  { id: 'game', label: 'Game profile', icon: 'game' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

const APP_VERSION = '0.2.0'

type ChatMessage = {
  id: string
  at: string
  name: string
  text: string
  preset: string | null
}

type CommunitySnapshot = {
  online: number
  messages: ChatMessage[]
  votes: Record<string, number>
  versions: { version: string; count: number }[]
  uptimeSeconds: number
}

const boostTabs: TabDefinition[] = [
  {
    id: 'lite',
    label: 'Lite',
    kicker: '01 / SAFE BASELINE',
    title: 'Core boost only.',
    blurb: 'Animations off, device idle released, background work flushed. Nothing that needs root.',
    action: 'lite',
    requiresRoot: false,
    needsDevice: true,
    steps: [
      { name: 'Core boost', detail: 'deviceidle off, kill-all, idle-maintenance', kind: 'android' },
      { name: 'Graphics props', detail: 'vsync off, gpu composition', kind: 'android' },
      { name: 'Ram purge', detail: 'kill-all plus cache trim', kind: 'android' },
      { name: 'Process priority', detail: 'emulator to High', kind: 'windows' },
    ],
  },
  {
    id: 'max',
    label: 'Max',
    kicker: '02 / FULL DEVICE',
    title: 'Everything the device will take.',
    blurb: 'Adds JIT filters, heap pinning, surfaceflinger latch, DNS, frame target and telemetry purge.',
    action: 'max',
    requiresRoot: false,
    needsDevice: true,
    steps: [
      { name: 'Core boost', detail: 'idle off, background data open', kind: 'android' },
      { name: 'JIT and VM', detail: 'dex2oat speed, heap 512m', kind: 'android' },
      { name: 'Graphics props', detail: 'dirty regions, swapinterval 0', kind: 'android' },
      { name: 'Latch and input', detail: 'latch_unsignaled, touch_slop 0', kind: 'android' },
      { name: 'Network', detail: 'Cloudflare DNS, BBR if root', kind: 'android' },
      { name: 'Frame target', detail: 'peak and min refresh', kind: 'android' },
      { name: 'Telemetry purge', detail: 'Tencent reporting packages off', kind: 'android' },
      { name: 'Process priority', detail: 'emulator to High', kind: 'windows' },
    ],
  },
  {
    id: 'ultra',
    label: 'Ultra',
    kicker: '03 / ROOT UNLOCKED',
    title: 'Kernel, clocks and the game config.',
    blurb: 'Max plus performance governors, GPU clock floor, noop scheduler, TCP buffers and the PUBG ini patch.',
    action: 'ultra',
    requiresRoot: true,
    needsDevice: true,
    steps: [
      { name: 'Max pack', detail: 'every device-side step above', kind: 'android' },
      { name: 'CPU governor', detail: 'pin every core to performance', kind: 'root' },
      { name: 'GPU clock floor', detail: 'kgsl devfreq min to max', kind: 'root' },
      { name: 'IO scheduler', detail: 'noop, 512kb read ahead', kind: 'root' },
      { name: 'TCP buffers', detail: 'rmem and wmem widened', kind: 'root' },
      { name: 'PUBG config', detail: 'UE4 ini patched and verified', kind: 'game' },
    ],
  },
  {
    id: 'windows',
    label: 'Windows',
    kicker: '04 / HOST SIDE',
    title: 'This PC, not the emulator.',
    blurb: 'GPU preference for every emulator binary, game mode on, background capture off, high performance plan.',
    action: 'windows',
    requiresRoot: false,
    needsDevice: false,
    steps: [
      { name: 'GPU preference', detail: 'GpuPreference=2 on every exe', kind: 'windows' },
      { name: 'Process priority', detail: 'emulator to High', kind: 'windows' },
      { name: 'Game mode', detail: 'AutoGameModeEnabled, DVR off', kind: 'windows' },
      { name: 'Power plan', detail: 'high performance, usb sleep off', kind: 'windows' },
      { name: 'Cache cleanup', detail: 'TxGameAssistant temp folders', kind: 'windows' },
      { name: 'Services', detail: 'Tencent updater set to manual', kind: 'windows' },
    ],
  },
]

function RiftConsole() {
  const [section, setSection] = useState<SectionId>('overview')
  const [presetId, setPresetId] = useState<PresetId>('competitive')
  const [selectedModules, setSelectedModules] = useState<ModuleId[]>([...presets[1].modules])
  const [livingEnvironment, setLivingEnvironment] = useState(true)
  const [systemReducedMotion, setSystemReducedMotion] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [runState, setRunState] = useState<RunState>(null)
  const [runSnapshot, setRunSnapshot] = useState<{ preset: string; modules: ModuleId[] } | null>(null)
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([])
  const [progress, setProgress] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [engine, setEngine] = useState<EngineInfo | null>(null)
  const [device, setDevice] = useState<DeviceStatus | null>(null)
  const [lastRun, setLastRun] = useState<RunResult | null>(null)
  const [stage, setStage] = useState('standing by')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [bench, setBench] = useState<BenchResult | null>(null)
  const [benchBefore, setBenchBefore] = useState<BenchResult | null>(null)
const [benching, setBenchmarking] = useState(false)
const [tab, setTab] = useState<TabId>('max')
const [appVersion, setAppVersion] = useState('0.2.0')
const [updateInfo, setUpdateInfo] = useState<UpdateStatus | null>(null)
const [updateOpen, setUpdateOpen] = useState(false)
const [updateDismissed, setUpdateDismissed] = useState(false)
const [checkingUpdate, setCheckingUpdate] = useState(false)
const [updateDownload, setUpdateDownload] = useState<UpdateDownloadStatus | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [machineId, setMachineId] = useState('')
  const [authSettled, setAuthSettled] = useState(false)

const [hardware, setHardware] = useState<HardwareProfile | null>(null)
  const [live, setLive] = useState<Extract<HardwareEvent, { e: 'sample' }> | null>(null)
  const [feedLive, setFeedLive] = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [history, setHistory] = useState<{ cpu: number[]; ram: number[]; gpu: number[] }>({ cpu: [], ram: [], gpu: [] })
  const [rateHz, setRateHz] = useState<number | null>(null)
  const rateRef = useRef<{ count: number; started: number } | null>(null)
  const runActiveRef = useRef(false)
  const autoCloseRef = useRef<number | null>(null)
  const linesRef = useRef<TerminalLine[]>([])
  linesRef.current = terminalLines
  const [communityNode] = useState(() => {
    const override = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_RIFT_NODE
    return override || 'http://127.0.0.1:8787'
  })
  const setRateRef = useCallback((next: { count: number; started: number } | null) => {
    rateRef.current = next
  }, [])
  const dialogRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const selectedSet = useMemo(() => new Set(selectedModules), [selectedModules])
  const activeModuleCount = selectedModules.length
  const environmentMoves = livingEnvironment && !systemReducedMotion
  const engineReady = Boolean(engine?.available)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const bridgeLive = mounted && bridgeAvailable()

  useEffect(() => {
    let cancelled = false
    getAppVersion().then((value) => {
      if (!cancelled) setAppVersion(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

useEffect(() => {
    let off = () => {}
    // in a real browser there is no local bridge, so no sign-in is needed
    if (!mounted || !bridgeAvailable()) return
    let cancelled = false
    // the gate cannot decide anything until firebase has had a chance to load,
    // otherwise the console flashes past for a frame and the user sees the
    // preview instead of the sign-in screen
    import('../lib/firebase')
      .then((mod) => {
        if (cancelled) return
        // Restore the saved account before the gate decides whether to show
        // sign-in, so existing sessions never flash the login screen.
        return mod.restoreAccount().then((existing) => {
          if (cancelled) return
          if (existing) setAccount(existing)
          setAuthSettled(true)
          off = mod.watchAccount((next) => {
            if (!cancelled) setAccount(next)
          })
        })
      })
      .catch((error) => {
        if (cancelled) return
        // if firebase cannot load at all we must not lock the user out of
        // their own machine, so we let the app through and say why
        console.error('sign-in unavailable:', error)
        setAuthSettled(true)
      })
    return () => {
      cancelled = true
      off()
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    window.rift?.hwid?.().then((info) => {
      if (info?.hwid) setMachineId(info.hwid)
    })
  }, [mounted])

  // the main process pushes this once, shortly after launch, when it finds a
  // newer tag on our own release feed. it never blocks anything the user is doing.
  useEffect(() => {
    const off = subscribeUpdate((payload) => {
      setUpdateInfo(payload)
      setUpdateDownload(null)
      if (payload.state === 'available') setUpdateOpen(true)
    })
    const offDownload = subscribeUpdateDownload(setUpdateDownload)
    return () => {
      off()
      offDownload()
    }
  }, [])

  const openDownload = useCallback(async () => {
    if (!updateInfo) return
    const initial: UpdateDownloadStatus = {
      state: 'downloading',
      version: updateInfo.to,
      name: updateInfo.assetName || `R-i-F-T-${updateInfo.to}-win-x64.zip`,
      downloadedBytes: 0,
      totalBytes: updateInfo.assetSize ?? null,
      percent: 0,
    }
    if (!updateInfo.downloadAvailable) {
      setUpdateDownload({
        ...initial,
        state: 'error',
        percent: null,
        message: 'The Windows app folder is not attached to this release yet.',
      })
      return
    }
    setUpdateDownload(initial)
    const result = await downloadUpdate()
    if (!result.started && result.reason !== 'already-downloading') {
      setUpdateDownload({
        ...initial,
        state: 'error',
        percent: null,
        message:
          result.reason === 'missing-release-asset'
            ? 'The release has no Windows update file attached yet.'
            : result.reason || 'The update download could not start.',
      })
    }
  }, [updateInfo])

  const showDownloadedUpdate = useCallback(async () => {
    const opened = await revealUpdateDownload()
    if (!opened) {
      setUpdateDownload((current) =>
        current
          ? { ...current, message: 'The downloaded update could not be found. Please download it again.' }
          : current,
      )
    }
  }, [])

  const checkNow = useCallback(async () => {
    setCheckingUpdate(true)
    const result = await recheckForUpdate()
    setUpdateInfo(result)
    setUpdateDownload(null)
    setCheckingUpdate(false)
    if (result.state === 'available') setUpdateOpen(true)
  }, [])

  const lastLineRef = useRef<{ text: string; count: number } | null>(null)

  const pushLine = useCallback((text: string, level: TerminalLine['level'] = 'info') => {
    setTerminalLines((current) => {
      const tail = current[current.length - 1]
      if (tail && tail.base === text) {
        // a repeating line is folded into a counter instead of filling the log
        const count = tail.count + 1
        return [...current.slice(0, -1), { ...tail, count, text: `${text} (x${count})` }]
      }
      const next = [...current, { id: `${current.length}-${Date.now()}`, text, level, base: text, count: 1 }]
      return next.length > 400 ? next.slice(next.length - 400) : next
    })
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let cancelled = false
    getEngine().then((info) => {
      if (!cancelled) setEngine(info)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!bridgeLive) {
      setFeedError('Browser preview has no local sensor feed. Start the desktop build for live hardware.')
      return
    }

    let cancelled = false
    getHardware().then((status) => {
      if (cancelled) return
      if (!status.available) {
        setFeedError(status.reason ?? 'The sensor script was not found next to the app.')
        return
      }
      if (status.latest && status.latest.e === 'hello') setHardware(status.latest.hw)
      if (status.latest && status.latest.e === 'sample') setLive(status.latest)
      setFeedLive(true)
    })
    void 0

    const off = subscribeHardware((event: HardwareEvent) => {
      if (event.e === 'hello') {
        setHardware(event.hw)
        setFeedError(null)
        setFeedLive(true)
      } else if (event.e === 'sample') {
        setLive((current) => (current ? { ...event, diskLoad: event.diskLoad ?? current.diskLoad, uptimeH: event.uptimeH ?? current.uptimeH } : event))
        setFeedError(null)
        setFeedLive(true)
      } else if (event.e === 'sensors-stopped') {
        setFeedLive(false)
      } else if (event.e === 'fatal') {
        setFeedError(event.m)
        setFeedLive(false)
      } else if (event.e === 'log' && event.l !== 'info') {
        setFeedError(event.m)
      }
    })

    return () => {
      cancelled = true
      off()
    }
  }, [bridgeLive])

  useEffect(() => {
    if (!live) return
    const now = Date.now()
    const previous = rateRef.current
    if (!previous) {
      setRateRef({ count: 1, started: now })
    } else {
      const count = previous.count + 1
      const elapsed = now - previous.started
      setRateHz(elapsed >= 400 ? Number(((count * 1000) / elapsed).toFixed(1)) : null)
      setRateRef({ count, started: previous.started })
    }
    const cap = 180
    setHistory((current) => {
      const push = (list: number[], value: number | null) => {
        if (value == null) return list
        const next = [...list, value]
        return next.length > cap ? next.slice(next.length - cap) : next
      }
      return {
        cpu: push(current.cpu, live.cpuLoad),
        ram: push(current.ram, live.ramLoad),
        gpu: push(current.gpu, live.gpu?.[0]?.load ?? null),
      }
    })
  }, [live])

  useEffect(() => {
    if (runState !== 'running' || !dialogRef.current) return
    dialogRef.current.focus()
  }, [runState, helpOpen])

  useEffect(() => {
    const output = terminalRef.current
    if (output) output.scrollTop = output.scrollHeight
  }, [terminalLines])

  useEffect(() => {
    if (!bridgeLive) {
      pushLine('browser preview: no local bridge, run the desktop app to execute', 'warn')
      return
    }

    return subscribeEngine((event: EngineEvent) => {
      switch (event.e) {
        case 'start':
          runActiveRef.current = true
          // keep the reading we had before the run so we can show a real delta
          setBenchBefore((current) => {
            if (bench && bench.ok) return bench
            return current
          })
          setProgress(2)
          setStage('handing off to the engine')
          pushLine(`engine started: ${event.action}${event.modules.length ? ' [' + event.modules.join(', ') + ']' : ''}`, 'info')
          break
        case 'stage':
          setStage(event.m)
          pushLine(`— ${event.m} —`, 'stage')
          break
        case 'progress':
          setProgress(Math.max(0, Math.min(100, Math.round(event.p))))
          break
        case 'bench':
          setBenchmarking(false)
          setBench(event as BenchResult)
          break
        case 'status':
          setDevice(event)
          // the watcher reports continuously, so never let it stomp on the
          // stage text of a run that is actually in progress
          if (!runActiveRef.current) {
            setStage(event.online ? `device online · ${event.device}` : event.device ? 'device not answering' : 'searching for emulator-5554')
          }
          pushLine(`device ${event.device ?? 'none'} ${event.brand} ${event.model} · root ${event.root ? 'yes' : 'no'}`, 'info')
          break
        case 'log':
          if (event.l === 'dbg') return
          pushLine(event.m, event.l)
          break
        case 'done':
          setLastRun({ ok: event.ok, warn: event.warn, err: event.err, action: event.action, log: event.log })
          pushLine(`run finished · ${event.ok} applied · ${event.warn} skipped · ${event.err} failed`, 'ok')
          break
        case 'fatal':
          pushLine(event.m, 'err')
          break
        case 'exit':
          runActiveRef.current = false
          setProgress((current) => (event.ok ? 100 : current))
          pushLine(`engine exited with code ${event.code ?? 'none'} (${event.reason})`, event.ok ? 'ok' : 'warn')
          break
      }
    })
  }, [bridgeLive, progress, pushLine])

useEffect(() => {
    if (runState !== 'running' || !runSnapshot) return

    const sessionId = window.crypto?.randomUUID?.() ?? String(Date.now())

    setSessions((current) => [
      {
        id: sessionId,
        timestamp: new Date().toISOString(),
        preset: runSnapshot.preset,
        moduleCount: runSnapshot.modules.length,
        status: 'EXECUTING',
      },
      ...current,
    ])

    setActiveSessionId(sessionId)
  }, [runState, runSnapshot])

  useEffect(() => {
    if (runState !== 'complete' || !activeSessionId || !lastRun) return
    const output = linesRef.current.slice(-200)
    setSessions((current) =>
      current.map((item) =>
        item.id === activeSessionId
          ? { ...item, status: lastRun.err > 0 ? 'COMPLETE WITH ERRORS' : 'COMPLETE', output }
          : item,
      ),
    )
  }, [runState, lastRun, activeSessionId])

  useEffect(() => {
    if (runState !== 'cancelled' || !activeSessionId) return
    setSessions((current) =>
      current.map((item) => (item.id === activeSessionId ? { ...item, status: 'CANCELLED' } : item)),
    )
  }, [runState, activeSessionId])

  // the execution sequence closes itself once the run is over. the result stays
  // in the activity log, this only clears the modal and the live terminal.
  useEffect(() => {
    if (runState !== 'complete' && runState !== 'cancelled') return
    if (autoCloseRef.current !== null) window.clearTimeout(autoCloseRef.current)
    autoCloseRef.current = window.setTimeout(() => {
      autoCloseRef.current = null
      closePreview()
    }, 1500)
    return () => {
      if (autoCloseRef.current !== null) {
        window.clearTimeout(autoCloseRef.current)
        autoCloseRef.current = null
      }
    }
  }, [runState])

  useEffect(() => {
    if (runState !== 'running') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (runState === 'running') {
        void cancelPreview()
      } else {
        closePreview()
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runState, helpOpen])

  function selectPreset(id: Exclude<PresetId, 'custom'>) {
    const preset = presets.find((item) => item.id === id)
    if (!preset) return
    setPresetId(id)
    setSelectedModules([...preset.modules])
  }

  function toggleModule(id: ModuleId) {
    setPresetId('custom')
    setSelectedModules((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function resetCompetitive() {
    selectPreset('competitive')
  }

  function exportConfiguration() {
    const payload = {
      product: 'R i F T — In alliance with AL',
      game: 'PUBG: BATTLEGROUNDS',
      mode: 'preview-only',
      exportedAt: new Date().toISOString(),
      preset: presetNames[presetId],
      selectedModules: modules.filter((item) => selectedSet.has(item.id)).map(({ id, name, category }) => ({ id, name, category })),
      note: 'This configuration is a UI preview. It has not been applied to this PC.',
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'rift-preview-config-' + new Date().toISOString().slice(0, 10) + '.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function startPreview() {
    if (activeModuleCount === 0) return

    setProgress(0)
    setTerminalLines([])
    setStage('starting')
    setRunSnapshot({ preset: presetNames[presetId], modules: [...selectedModules] })
    setRunState('running')

    if (!bridgeLive) {
      pushLine('no desktop bridge in this browser, nothing was executed', 'warn')
      setRunState('cancelled')
      return
    }

    const action = actionForPreset(presetId)
    const started = await runEngine(action, selectedModules)

    if (!started.started) {
      pushLine(`run refused: ${started.reason ?? 'unknown reason'}`, 'err')
      setRunState('cancelled')
      setActiveSessionId((current) => {
        if (current) {
          setSessions((items) => items.map((item) => (item.id === current ? { ...item, status: 'REFUSED' } : item)))
        }
        return null
      })
    }
  }

  async function runTab(next: TabId) {
    const definition = boostTabs.find((item) => item.id === next)
    if (!definition) return
    if (!bridgeLive || !engineReady) {
      pushLine('no engine attached, nothing was executed', 'warn')
      return
    }

    setTab(next)
    setProgress(0)
    setTerminalLines([])
    setStage('starting')
    setRunSnapshot({ preset: definition.label, modules: [...selectedModules] })
    setRunState('running')

    const started = await runEngine(definition.action as RunAction)
    if (!started.started) {
      pushLine(`run refused: ${started.reason ?? 'unknown reason'}`, 'err')
      setRunState('cancelled')
    }
  }

  async function measureFrameRate() {
    if (!engineReady || benching) return
    setBenchmarking(true)
    setTerminalLines([])
    setStage('measuring frame rate')
    setRunSnapshot({ preset: 'Frame rate measurement', modules: [] })
    setRunState('running')
    const started = await runEngine('bench', [], 8)
    if (!started.started) {
      pushLine(`measure refused: ${started.reason ?? 'unknown reason'}`, 'err')
      setRunState('cancelled')
      setBenchmarking(false)
    }
  }

  async function previewRollback() {
    if (!engineReady) return
    setTerminalLines([])
    setStage('checking what restore would change')
    setRunSnapshot({ preset: 'Rollback preview', modules: [] })
    setRunState('running')
    const started = await runEngine('preview')
    if (!started.started) {
      pushLine(`preview refused: ${started.reason ?? 'unknown reason'}`, 'err')
      setRunState('cancelled')
    }
  }

  async function restoreBackup() {
    if (!engineReady) return
    setRestoring(true)
    setTerminalLines([])
    setStage('restoring settings')
    setRunSnapshot({ preset: 'Rollback', modules: [...selectedModules] })
    setRunState('running')

    const started = await runEngine('restore')
    if (!started.started) {
      pushLine(`restore refused: ${started.reason ?? 'unknown reason'}`, 'err')
      setRunState('cancelled')
    }
    setRestoring(false)
  }

  async function cancelPreview() {
    const stopped = await cancelRun()
    setRunState('cancelled')
    pushLine(stopped ? 'engine stopped by request' : 'nothing was running', 'warn')
  }

  function closePreview() {
    setRunState(null)
    setRunSnapshot(null)
    setTerminalLines([])
    setProgress(0)
    setStage('standing by')
  }

  const appClass = ['rift-app', environmentMoves ? '' : 'rift-app--still'].filter(Boolean).join(' ')

// sign-in gates the app, but only once we know whether an account already
  // exists, so a signed-in user never sees the gate flash past
  if (mounted && bridgeLive && authSettled && !account) {
    return <SignInGate onSignedIn={setAccount} hwid={machineId} />
  }

return (
    <div className={appClass}>
      <CathedralScene animate={environmentMoves} />
      <EmberField />
      <div className="scene-scrim" aria-hidden="true" />
      <div className="app-frame">
        <aside className="sidebar" aria-label="R i F T navigation">
          <Brand />
          <div className="sidebar-section-label">CONTROL DECK <span>01—05</span></div>
          <nav className="primary-nav" aria-label="Main navigation">
            {navItems.slice(0, 3).map((item) => (
              <NavButton key={item.id} item={item} active={section === item.id} onClick={() => setSection(item.id)} />
            ))}
            <div className="nav-divider" />
            {navItems.slice(3).map((item) => (
              <NavButton key={item.id} item={item} active={section === item.id} onClick={() => setSection(item.id)} />
            ))}
            <UIButton className="nav-button nav-export" onClick={exportConfiguration} aria-label="Export selected configuration as JSON">
              <Icon name="export" />
              <span>Export config</span>
              <Icon name="arrowDown" size={14} />
            </UIButton>
          </nav>

          <div className="sidebar-spacer" />
          <div className={['sidebar-connection', engineReady ? 'sidebar-connection--live' : ''].filter(Boolean).join(' ')}>
            <div className="connection-pulse" />
            <div><span className="micro-label">LOCAL BRIDGE</span><strong>{engineReady ? 'ENGINE READY' : bridgeLive ? 'ENGINE MISSING' : 'BROWSER ONLY'}</strong></div>
            <span className="connection-dash">{engineReady ? '●' : '—'}</span>
          </div>
          <button className="protocol-link" type="button" onClick={() => setHelpOpen(true)}>
            <Icon name="help" size={15} />
            <span>RIFT protocol</span>
            <span className="protocol-shortcut">?</span>
          </button>
          <div className="sidebar-foot">
            <span>
              R i F T <i>v{appVersion}</i>{' '}
              {updateInfo?.state === 'available' && <em className="version-pip" aria-label="update available" />}
            </span>
            <span>ALLIANCE / AL</span>
          </div>
        </aside>

        <div className="workspace">
          <header className="topbar">
            <div className="mobile-brand"><Brand compact /></div>
            <div className="topbar-left">
              <span className="preview-beacon"><i /> SYSTEM PREVIEW</span>
              <span className="topbar-divider" />
              <span className="game-label"><span className="game-label-small">GAME PROFILE</span> PUBG: BATTLEGROUNDS</span>
            </div>
            <div className="topbar-right">
              <span className={['link-status', engineReady ? 'link-status--live' : ''].filter(Boolean).join(' ')}>
                <span className="status-dot" />
                {engineReady ? (device?.online ? `DEVICE ${device.device}` : 'SEARCHING · emulator-5554') : bridgeLive ? 'ENGINE NOT FOUND' : 'BROWSER PREVIEW'}
              </span>
              <UIButton variant="outline" className="help-button" onClick={() => setHelpOpen(true)} aria-label="Open RIFT protocol help">
                <Icon name="help" size={16} /><span>RIFT protocol</span>
              </UIButton>
            </div>
          </header>

          <nav className="mobile-nav" aria-label="Compact navigation">
            {navItems.map((item) => (
              <NavButton key={item.id} item={item} active={section === item.id} onClick={() => setSection(item.id)} compact />
            ))}
          </nav>

          <main className="main-content" key={section}>
            {section === 'tuning' && (
              <Tuning
                tab={tab}
                onTab={setTab}
                onRun={runTab}
                engineReady={engineReady}
                bridgeLive={bridgeLive}
                device={device}
                runState={runState}
                stage={stage}
              />
            )}
            {section === 'hardware' && (
              <Hardware
                hardware={hardware}
                live={live}
                history={history}
                feedLive={feedLive}
                error={feedError}
                rateHz={rateHz}
              />
            )}
            {section === 'community' && <Community node={communityNode} />}
            {section === 'overview' && (
              <Overview
                presetId={presetId}
                selectedSet={selectedSet}
                activeModuleCount={activeModuleCount}
                onPreset={selectPreset}
                onToggle={toggleModule}
                onReset={resetCompetitive}
                onInitialize={startPreview}
                onOptimizations={() => setSection('optimizations')}
                engineReady={engineReady}
                bridgeLive={bridgeLive}
                device={device}
                stage={stage}
                lastRun={lastRun}
onMeasure={measureFrameRate}
    bench={bench}
    benchBefore={benchBefore}
    benching={benching}
    history={history}
    version={appVersion}
    />
            )}
            {section === 'optimizations' && (
              <Optimizations
                presetId={presetId}
                selectedSet={selectedSet}
                activeModuleCount={activeModuleCount}
                onPreset={selectPreset}
                onToggle={toggleModule}
                onReset={resetCompetitive}
                onInitialize={startPreview}
                engineReady={engineReady}
                bridgeLive={bridgeLive}
              />
            )}
            {section === 'activity' && (
              <Activity sessions={sessions} onClear={() => setSessions([])} />
            )}
            {section === 'settings' && (
              <Settings
                livingEnvironment={livingEnvironment}
                onEnvironment={setLivingEnvironment}
                systemReducedMotion={systemReducedMotion}
                onExport={exportConfiguration}
                engine={engine}
                device={device}
                onRestore={restoreBackup}
      onPreview={previewRollback}
                restoring={restoring}
              />
            )}
            {section === 'game' && <GameProfile onOpenSettings={() => setSection('settings')} engineReady={engineReady} />}
          </main>

          <footer className="workspace-foot">
            <span><i className="foot-mark" />ENGINEERED FOR THE EDGE. NOT THE ORDINARY.</span>
            <span>PREVIEW BUILD <b>·</b> SESSION DATA HELD IN MEMORY</span>
          </footer>
        </div>
      </div>

      {runState && (
        <div className="modal-layer">
          <div className="modal-backdrop" />
          <section
            className="rift-dialog preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            aria-describedby="preview-description"
            tabIndex={-1}
            ref={dialogRef}
          >
            <div className="dialog-topline"><span>RIFT / {engineReady ? 'EXECUTION SEQUENCE' : 'PREVIEW SEQUENCE'}</span><span className="dialog-number">{runState === 'running' ? '01 / 04' : '04 / 04'}</span></div>
            <div className="dialog-sigil">
              <span className="sigil-ring" />
              <span className="sigil-core">{runState === 'running' ? <Ring size={34} /> : 'R'}</span>
            </div>
            <p className="eyebrow dialog-eyebrow">{runState === 'running' ? 'CROSSING THE THRESHOLD.' : runState === 'complete' ? 'SEQUENCE COMPLETE' : 'SEQUENCE HALTED'}</p>
            <h2 id="preview-title">{runState === 'running' ? 'CROSSING THE THRESHOLD.' : runState === 'complete' ? 'YOU’VE ENTERED THE RIFT.' : 'THE RIFT REMAINS CLOSED.'}</h2>
            <p id="preview-description" className="dialog-subtitle">
              {runState === 'running'
                ? engineReady
                  ? 'The engine is applying your modules to this PC now. Output streams in live.'
                  : 'No engine is attached, so nothing is being executed.'
                : runState === 'complete'
                  ? lastRun
                    ? `${lastRun.ok} changes applied, ${lastRun.warn} skipped, ${lastRun.err} failed. Settings were backed up before the run.`
                    : 'The run finished.'
                  : 'The sequence stopped before completion.'}
            </p>
            <div className="progress-track" aria-label={'Run progress ' + progress + '%'} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: progress + '%' }} />
            </div>
            <div className="progress-meta"><span>{runState === 'running' ? stage.toUpperCase() : runState === 'complete' ? 'COMPLETE' : 'CANCELLED'}</span><span>{String(progress).padStart(2, '0')}<i>%</i></span></div>
            <div className="terminal-window" aria-live="polite" aria-relevant="additions text">
              <div className="terminal-head"><span><i />{engineReady ? 'LOCAL TERMINAL / LIVE' : 'LOCAL TERMINAL / READ ONLY'}</span><span>RIFT_SHELL</span></div>
              <div className="terminal-output" ref={terminalRef}>
                {terminalLines.map((line) => (
                  <p key={line.id} className={'terminal-line terminal-line--' + line.level}>
                    <span className="terminal-prompt">{line.level === 'stage' ? '·' : line.level === 'err' ? 'x' : line.level === 'warn' ? '!' : line.level === 'ok' ? '+' : '>'}</span>
                    {line.text}
                  </p>
                ))}
                {runState === 'running' && <p className="terminal-cursor-line"><span className="terminal-prompt">›</span><i className="terminal-cursor" /></p>}
              </div>
            </div>
            {runState === 'running' ? (
              <UIButton variant="outline" className="dialog-action" onClick={cancelPreview}>Stop the run <span>ESC</span></UIButton>
            ) : (
              <UIButton variant="primary" className="dialog-action" onClick={closePreview}>RETURN TO CONTROL <Icon name="arrowRight" size={17} /></UIButton>
            )}
            <p className="dialog-footnote"><Icon name="lock" size={13} /> {engineReady ? 'LIVE RUN' : 'PREVIEW ONLY'} <span>·</span> {engineReady ? 'CHANGES APPLIED TO THIS PC' : 'NO COMMANDS SENT TO WINDOWS'}</p>
          </section>
        </div>
      )}

      {helpOpen && (
        <div className="modal-layer">
          <div className="modal-backdrop" onMouseDown={() => setHelpOpen(false)} />
          <section className="rift-dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1} ref={dialogRef}>
            <div className="dialog-topline"><span>RIFT / FIELD NOTES</span><span className="dialog-number">AL—01</span></div>
            <p className="eyebrow dialog-eyebrow">THE RIFT PROTOCOL</p>
            <h2 id="help-title">A control room in preview.</h2>
            <p className="dialog-subtitle">R i F T is a visual interface prototype for PUBG: BATTLEGROUNDS. Presets, switches, activity history, and export are ready to explore.</p>
            <div className="protocol-list">
              <div><span>01</span><p><strong>Choose your configuration</strong><br />Select a preset, then tune each module.</p></div>
              <div><span>02</span><p><strong>Initialize the preview</strong><br />The terminal simulates a pass and logs its completion.</p></div>
              <div><span>03</span><p><strong>Initialize for real</strong><br />The desktop build executes your modules on this PC through the local PowerShell engine.</p></div>
            </div>
            <UIButton variant="primary" className="dialog-action" onClick={() => setHelpOpen(false)}>BACK TO CONTROL <Icon name="arrowRight" size={17} /></UIButton>
          </section>
        </div>
      )}

      {updateOpen && updateInfo?.state === 'available' && !updateDismissed && (
        <div className="modal-layer">
          <div className="modal-backdrop" onMouseDown={() => !['downloading', 'complete', 'installing'].includes(updateDownload?.state ?? '') && setUpdateDismissed(true)} />
          <section
            className="rift-dialog update-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
            tabIndex={-1}
          >
            <div className="dialog-topline">
              <span>RIFT / NEW BUILD</span>
              <span className="dialog-number">v{updateInfo.to}</span>
            </div>
            <p className="eyebrow dialog-eyebrow">UPDATE AVAILABLE</p>
            <h2 id="update-title">
              v{updateInfo.from} <em>→</em> v{updateInfo.to}
            </h2>
            <p className="dialog-subtitle">
              {updateDownload?.state === 'complete' || updateDownload?.state === 'installing'
                ? 'Download complete. RiFT is closing and reopening with the new version.'
                : updateInfo.downloadAvailable
                  ? 'Download the update here. RiFT will restart and open the new version when it finishes.'
                  : 'A newer build is ready, but its Windows app folder has not been attached yet.'}
            </p>
            {updateInfo.notes.length > 0 ? (
              <div className="update-notes">
                <span className="micro-label">CHANGELOG</span>
                <ul>
                  {updateInfo.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="dialog-subtitle">No changelog was published for this build.</p>
            )}
            {updateDownload && (
              <div className={`update-download update-download--${updateDownload.state}`}>
                <div className="update-download-heading">
                  <span>{updateDownload.state === 'downloading' ? 'DOWNLOADING UPDATE' : updateDownload.state === 'complete' ? 'DOWNLOAD COMPLETE' : updateDownload.state === 'installing' ? 'INSTALLING NEW VERSION' : 'UPDATE PAUSED'}</span>
                  <strong>{updateDownload.percent == null ? '—' : `${updateDownload.percent}%`}</strong>
                </div>
                <div
                  className={`update-progress-track${updateDownload.percent == null && updateDownload.state === 'downloading' ? ' is-indeterminate' : ''}`}
                  role="progressbar"
                  aria-label={`RiFT update download ${updateDownload.percent == null ? 'in progress' : `${updateDownload.percent}%`}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={updateDownload.percent ?? undefined}
                >
                  <span style={{ width: `${updateDownload.percent ?? 0}%` }} />
                </div>
                <div className="update-download-meta">
                  <span>{updateDownload.name}</span>
                  <span>{formatFileSize(updateDownload.downloadedBytes)}{updateDownload.totalBytes ? ` / ${formatFileSize(updateDownload.totalBytes)}` : ''}</span>
                </div>
                {updateDownload.message && <p className="update-download-error" role="alert">{updateDownload.message}</p>}
              </div>
            )}
            <div className="update-actions">
              <UIButton
                variant="primary"
                className="dialog-action"
                disabled={['downloading', 'complete', 'installing'].includes(updateDownload?.state ?? '')}
                onClick={updateDownload?.state === 'error' && updateDownload.percent === 100 ? showDownloadedUpdate : openDownload}
              >
                {updateDownload?.state === 'downloading'
                  ? 'DOWNLOADING…'
                  : updateDownload?.state === 'complete' || updateDownload?.state === 'installing'
                    ? 'INSTALLING…'
                    : updateDownload?.state === 'error' && updateDownload.percent === 100
                      ? 'SHOW UPDATE FILE'
                      : updateDownload?.state === 'error' && updateInfo.downloadAvailable
                        ? 'TRY AGAIN'
                        : 'UPDATE NOW'} <Icon name="arrowRight" size={17} />
              </UIButton>
              {!['downloading', 'complete', 'installing'].includes(updateDownload?.state ?? '') && (
                <button className="update-skip" type="button" onClick={() => setUpdateDismissed(true)}>
                  LATER
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {checkingUpdate && (
        <button className="update-probe" type="button" onClick={checkNow} title="Check for updates">
          {`CHECKING… v${appVersion}`}
        </button>
      )}
    </div>
  )
}

function useCommunity(node: string) {
  const [state, setState] = useState<CommunitySnapshot>({ online: 0, messages: [], votes: {}, versions: [], uptimeSeconds: 0 })
  const [link, setLink] = useState<'idle' | 'connecting' | 'live' | 'offline'>('idle')
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const [attached, setAttached] = useState<TabId | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef(name)
  nameRef.current = name

  useEffect(() => {
    let cancelled = false
    let retry = 0
    let timer = 0
    let socket: WebSocket | null = null

    const connect = () => {
      if (cancelled) return
      setLink((current) => (current === 'live' ? 'live' : 'connecting'))
      try {
        socket = new WebSocket(node.replace(/^http/, 'ws').replace(/\/$/, '') + '/chat')
      } catch {
        schedule()
        return
      }
      socketRef.current = socket

      socket.onopen = () => {
        retry = 0
        setLink('live')
        socket?.send(JSON.stringify({ type: 'name', name: nameRef.current }))
        fetch(node + '/api/version', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: APP_VERSION }),
        }).catch(() => undefined)
      }

      socket.onmessage = (event) => {
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(String(event.data))
        } catch {
          return
        }
        setState((current) => {
          switch (payload.type) {
            case 'snapshot':
              return {
                online: Number(payload.online ?? 0),
                messages: (payload.messages as ChatMessage[]) ?? [],
                votes: (payload.votes as Record<string, number>) ?? {},
                versions: (payload.versions as CommunitySnapshot['versions']) ?? [],
                uptimeSeconds: Number(payload.uptimeSeconds ?? 0),
              }
            case 'message':
              return { ...current, messages: [...current.messages.slice(-59), payload.message as ChatMessage] }
            case 'votes':
              return { ...current, votes: (payload.votes as Record<string, number>) ?? {} }
            case 'versions':
              return { ...current, versions: (payload.versions as CommunitySnapshot['versions']) ?? [] }
            case 'peers':
              return { ...current, online: Number(payload.online ?? 0) }
            default:
              return current
          }
        })
      }

      socket.onerror = () => setLink('offline')
      socket.onclose = () => {
        socketRef.current = null
        if (cancelled) return
        schedule()
      }
    }

    const schedule = () => {
      setLink('offline')
      retry += 1
      const wait = Math.min(15000, 900 * 2 ** Math.min(retry, 4))
      timer = window.setTimeout(connect, wait)
    }

    connect()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        /* already closed */
      }
      socketRef.current = null
    }
  }, [node])

  useEffect(() => {
    const feed = feedRef.current
    if (feed) feed.scrollTop = feed.scrollHeight
  }, [state.messages])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    try {
      await fetch(node + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, preset: attached, name }),
      })
      await fetch(node + '/api/identify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    } catch {
      /* the socket will reconnect and resync */
    }
  }, [attached, draft, name, node])

  const vote = useCallback(
    async (preset: string) => {
      try {
        await fetch(node + '/api/vote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preset }),
        })
      } catch {
        /* ignore */
      }
    },
    [node],
  )

  return { state, link, name, setName, draft, setDraft, attached, setAttached, send, vote }
}

function Community({ node }: { node: string }) {
  const feedRef = useRef<HTMLDivElement>(null)
  const { state, link, name, setName, draft, setDraft, attached, setAttached, send, vote } = useCommunity(node)
  const newest = state.versions[0]?.version ?? APP_VERSION
  const behind = newest !== APP_VERSION
  const totalVotes = Object.values(state.votes).reduce((sum, n) => sum + n, 0)

  return (
    <div className="screen sub-screen community-screen">
      <div className="breadcrumb">
        <span>CONTROL</span><i>/</i><b>COMMUNITY</b>
        <span className="breadcrumb-tail">
          <span className={['link-pill', 'link-pill--' + link].join(' ')}><i />{link.toUpperCase()}</span>
        </span>
      </div>

      <section className="section-intro">
        <p className="eyebrow"><span className="eyebrow-mark" />FIELD CHANNEL</p>
        <h1>Ask the people<br />who already tuned theirs.</h1>
        <p>Share what worked, tag the preset you are on, and see whether anyone else is running an older build.</p>
      </section>

      <div className="community-grid">
        <section className="chat-panel">
          <div className="panel-bar">
            <span><i className="panel-bar-mark" />LIVE CHANNEL</span>
            <span>{state.online} ONLINE</span>
          </div>

          <div className="chat-feed" ref={feedRef} aria-live="polite">
            {state.messages.length === 0 && (
              <div className="chat-empty">
                <p className="eyebrow">NO SIGNAL YET</p>
                <p>Be the first to post. Attach a preset so people know your setup.</p>
              </div>
            )}
            {state.messages.map((message) => (
              <article className="chat-row" key={message.id}>
                <span className="chat-avatar">{message.name.slice(0, 2).toUpperCase()}</span>
                <div className="chat-body">
                  <span className="chat-meta">
                    <b>{message.name}</b>
                    {message.preset && <span className="chat-preset">{message.preset}</span>}
                    <time>{new Date(message.at).toLocaleTimeString()}</time>
                  </span>
                  <p>{message.text}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="chat-composer">
            <div className="composer-row">
              <input
                className="composer-input"
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 24))}
                placeholder="your handle"
                aria-label="Your handle"
              />
              <div className="preset-picker" role="group" aria-label="Attach a preset">
                <button type="button" className={attached === null ? 'is-on' : ''} onClick={() => setAttached(null)}>none</button>
                {boostTabs.map((tab) => (
                  <button key={tab.id} type="button" className={attached === tab.id ? 'is-on' : ''} onClick={() => setAttached(tab.id)}>
                    {tab.label.toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="composer-row">
              <input
                className="composer-input composer-input--wide"
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 400))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                placeholder="share a setting, a result, or a question"
                aria-label="Message"
              />
              <UIButton variant="primary" className="composer-send" onClick={() => void send()} disabled={!draft.trim()}>
                SEND <Icon name="arrowRight" size={15} />
              </UIButton>
            </div>
          </div>
        </section>

        <aside className="community-side">
          <section className="version-panel">
            <div className="panel-bar">
              <span><i className="panel-bar-mark" />VERSION CENSUS</span>
              <span>YOU: {APP_VERSION}</span>
            </div>
            <div className="version-body">
              {behind && (
                <div className="version-warn">
                  <Icon name="lock" size={14} />
                  <span>Newer build in the field: <b>{newest}</b>. Pull the latest to match.</span>
                </div>
              )}
              {state.versions.length === 0 && <p className="version-empty">No versions reported yet.</p>}
              {state.versions.map((entry) => {
                const share = state.versions.reduce((sum, item) => sum + item.count, 0)
                const pct = share ? Math.round((entry.count / share) * 100) : 0
                return (
                  <div className="version-row" key={entry.version}>
                    <span className="version-tag">
                      {entry.version}
                      {entry.version === APP_VERSION && <em>YOU</em>}
                    </span>
                    <span className="version-bar"><i style={{ width: pct + '%' }} /></span>
                    <span className="version-count">{entry.count}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="vote-panel">
            <div className="panel-bar">
              <span><i className="panel-bar-mark" />PRESET VOTE</span>
              <span>{totalVotes} VOTES</span>
            </div>
            <div className="vote-body">
              {boostTabs.map((tab) => {
                const count = state.votes[tab.id] ?? 0
                const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0
                return (
                  <button key={tab.id} type="button" className="vote-row" onClick={() => void vote(tab.id)}>
                    <span className="vote-label">{tab.label}</span>
                    <span className="vote-bar"><i style={{ width: pct + '%' }} /></span>
                    <span className="vote-count">{count}</span>
                  </button>
                )
              })}
              <p className="vote-hint">Click a preset to cast a vote for the settings people should ship next.</p>
            </div>
          </section>

          <section className="node-panel">
            <div className="panel-bar"><span><i className="panel-bar-mark" />NODE</span><Icon name="plug" size={15} /></div>
            <div className="node-body">
              <SpecRow label="Address" value={node.replace(/^https?:\/\//, '')} note="start with npm run community" />
              <SpecRow label="Uptime" value={state.uptimeSeconds ? Math.round(state.uptimeSeconds / 60) + ' min' : '—'} />
              <SpecRow label="Peers" value={String(state.online)} />
              <p className="node-note">The node is a local relay. It stores nothing but the last few hundred messages in memory and never reads your machine.</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Ring({ size = 15, running = true }: { size?: number; running?: boolean }) {
  return (
    <span
      className={['ring-spinner', running ? 'is-running' : ''].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <i />
    </span>
  )
}

function Tuning(props: {
  tab: TabId
  onTab: (id: TabId) => void
  onRun: (id: TabId) => void
  engineReady: boolean
  bridgeLive: boolean
  device: DeviceStatus | null
  runState: RunState
  stage: string
}) {
  const current = boostTabs.find((item) => item.id === props.tab) ?? boostTabs[0]
  const busy = props.runState === 'running'
  const deviceOnline = Boolean(props.device?.online)
  const blocked = !props.engineReady || (current.needsDevice && !deviceOnline)
  const rootMissing = current.requiresRoot && !props.device?.root

  return (
    <div className="screen sub-screen tuning-screen">
      <div className="breadcrumb">
        <span>CONTROL</span><i>/</i><b>TUNING</b>
        <span className="breadcrumb-tail">{boostTabs.length} MODULES <i>·</i> {deviceOnline ? 'DEVICE ONLINE' : 'NO DEVICE'}</span>
      </div>

      <div className="tab-strip" role="tablist" aria-label="Boost presets">
        {boostTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={props.tab === item.id}
            className={['tab-button', props.tab === item.id ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => props.onTab(item.id)}
          >
            <span className="tab-glyph">{String(boostTabs.indexOf(item) + 1).padStart(2, '0')}</span>
            <span className="tab-label">{item.label}</span>
            <span className="tab-meta">{item.steps.length} STEPS</span>
            {item.requiresRoot && <span className="tab-flag">ROOT</span>}
          </button>
        ))}
      </div>

      <section className="tab-body">
        <div className="tab-intro">
          <p className="eyebrow"><span className="eyebrow-mark" />{current.kicker}</p>
          <h1>{current.title}</h1>
          <p>{current.blurb}</p>
          <div className="tab-actions">
            <UIButton variant="primary" className={['initialize-button', busy ? 'is-running' : ''].filter(Boolean).join(' ')} onClick={() => props.onRun(current.id)} disabled={blocked || busy}>
              <span className="initialize-emblem">{busy ? <Ring size={18} /> : 'R'}</span>
              <span>{busy ? 'WORKING' : 'RUN ' + current.label.toUpperCase()}<small>{busy ? props.stage.toUpperCase() : !props.engineReady ? 'ENGINE NOT READY' : current.needsDevice && !deviceOnline ? 'START THE EMULATOR' : current.steps.length + ' STEPS / LIVE'}</small></span>
              <Icon name="arrowRight" size={19} />
            </UIButton>
            {rootMissing && <span className="tab-warning"><Icon name="lock" size={14} /> Root not detected. Root steps will be skipped and logged.</span>}
          </div>
        </div>

        <ol className="step-list">
          {current.steps.map((step, index) => (
            <li key={step.name} className={'step-row step-row--' + step.kind}>
              <span className="step-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="step-main"><strong>{step.name}</strong><small>{step.detail}</small></span>
              <span className="step-kind">{step.kind}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function Sparkline({ points, max, tone }: { points: number[]; max: number; tone: string }) {
  const width = 220
  const height = 44
  const uid = 'spk-' + tone

  if (points.length < 2) {
    return (
      <svg className={'spark spark--' + tone} viewBox={'0 0 ' + width + ' ' + height} width={width} height={height} role="img" aria-label="collecting samples">
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} />
      </svg>
    )
  }

  const step = width / (points.length - 1)
  const coords = points.map((value, index) => {
    const x = index * step
    const clamped = Math.min(value, max)
    const y = height - (clamped / max) * (height - 4) - 2
    return [x, y] as const
  })

  const line = coords.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ')
  const area = line + ' L' + width + ' ' + height + ' L0 ' + height + ' Z'
  const last = coords[coords.length - 1]

  return (
    <svg className={'spark spark--' + tone} viewBox={'0 0 ' + width + ' ' + height} width={width} height={height} role="img" aria-label="recent samples">
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".38" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <filter id={uid + '-glow'} x="-20%" y="-40%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g className="spark-grid-lines">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={height * f} x2={width} y2={height * f} />
        ))}
      </g>
      <path className="spark-area" d={area} fill={'url(#' + uid + ')'} />
      <path className="spark-line" d={line} filter={'url(#' + uid + '-glow)'} />
      <circle className="spark-head" cx={last[0]} cy={last[1]} r="2.2" />
    </svg>
  )
}

function CoreBars({ loads, cores }: { loads: number[]; cores: number | null }) {
  const count = loads.length || cores || 0
  if (!count) return <div className="core-bars core-bars--empty">collecting per-core data</div>

  return (
    <div className="core-bars" role="img" aria-label={'per core load across ' + count + ' logical processors'}>
      {loads.map((value, index) => (
        <div className="core-cell" key={index} title={'core ' + index + ': ' + value + '%'}>
          <span className="core-track">
            <span
              className={'core-fill ' + (value > 85 ? 'is-hot' : value > 60 ? 'is-warm' : 'is-cool')}
              style={{ height: Math.max(1.5, Math.min(100, value)) + '%' }}
            />
          </span>
          <span className="core-index">{index}</span>
        </div>
      ))}
    </div>
  )
}

function Ticker({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {[0, 1].map((copy) => (
          <span className="ticker-group" key={copy}>
            {items.map((item) => (
              <span className="ticker-item" key={copy + item.label}>
                <b>{item.label}</b>
                {item.value}
                <i>·</i>
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  )
}

function EmberField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let width = 0
    let height = 0
    const ratio = Math.min(window.devicePixelRatio || 1, 2)

    type Ember = { x: number; y: number; r: number; vy: number; drift: number; phase: number; alpha: number }
    let embers: Ember[] = []

    const seed = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(width * ratio))
      canvas.height = Math.max(1, Math.floor(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      const density = Math.min(70, Math.max(18, Math.round((width * height) / 26000)))
      embers = Array.from({ length: density }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.6 + Math.random() * 1.9,
        vy: -(0.06 + Math.random() * 0.26),
        drift: (Math.random() - 0.5) * 0.16,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.12 + Math.random() * 0.4,
      }))
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)

      for (const ember of embers) {
        if (!reduce) {
          ember.y += ember.vy
          ember.x += ember.drift + Math.sin(ember.phase) * 0.09
          ember.phase += 0.012
          if (ember.y < -6) {
            ember.y = height + 6
            ember.x = Math.random() * width
          }
          if (ember.x < -6) ember.x = width + 6
          if (ember.x > width + 6) ember.x = -6
        }

        const flicker = 0.55 + 0.45 * Math.sin(ember.phase * 1.7)
        const alpha = ember.alpha * flicker
        const glow = context.createRadialGradient(ember.x, ember.y, 0, ember.x, ember.y, ember.r * 5)
        glow.addColorStop(0, 'rgba(238,238,242,' + alpha.toFixed(3) + ')')
        glow.addColorStop(0.4, 'rgba(178,181,188,' + (alpha * 0.32).toFixed(3) + ')')
        glow.addColorStop(1, 'rgba(90,40,160,0)')
        context.fillStyle = glow
        context.beginPath()
        context.arc(ember.x, ember.y, ember.r * 5, 0, Math.PI * 2)
        context.fill()
      }

      frame = window.requestAnimationFrame(draw)
    }

    seed()
    draw()
    const onResize = () => seed()
    window.addEventListener('resize', onResize)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas className="ember-field" ref={ref} aria-hidden="true" />
}

function Gauge({ label, value, unit, pct, tone, detail }: {
  label: string
  value: number | null
  unit: string
  pct: number | null
  tone: string
  detail: string
}) {
  const width = pct == null ? 0 : Math.max(0, Math.min(100, pct))
  const toneClass = width > 85 ? 'is-hot' : width > 60 ? 'is-warm' : 'is-cool'
  return (
    <div className={['gauge', toneClass].join(' ')}>
      <div className="gauge-head">
        <span className="micro-label">{label}</span>
        <strong>
          {value == null ? '--' : Math.round(value)}
          {value != null && <i>{unit}</i>}
        </strong>
      </div>
      <div className="gauge-track"><span className={'gauge-fill gauge-fill--' + tone} style={{ width: width + '%' }} /></div>
      <div className="gauge-foot"><span>{detail}</span><span>{pct == null ? 'no data' : String(Math.round(pct)) + '%'}</span></div>
    </div>
  )
}

function SpecRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="spec-row">
      <span className="micro-label">{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

function Hardware(props: {
  hardware: HardwareProfile | null
  live: Extract<HardwareEvent, { e: 'sample' }> | null
  history: { cpu: number[]; ram: number[]; gpu: number[] }
  feedLive: boolean
  error: string | null
  rateHz: number | null
}) {
  const hw = props.hardware
  const live = props.live
  const gpuList = Array.isArray(live?.gpu) ? live?.gpu : []
  const gpu = gpuList[0] ?? null
  const adapterList = Array.isArray(hw?.gpu) ? hw?.gpu : []
  const gpuInfo = adapterList[0] ?? null

  const totalGB = hw?.ram.totalMB ? (hw.ram.totalMB / 1024).toFixed(1) : null
  const usedGB = live?.ramUsedMB ? (live.ramUsedMB / 1024).toFixed(1) : null
  const vramNote = gpuInfo ? (gpuInfo.vramExact ? 'exact' : 'reported, may be capped at 4 GB by the OS') : null

  return (
    <div className="screen sub-screen hardware-screen">
      <div className="breadcrumb">
        <span>CONTROL</span><i>/</i><b>HARDWARE</b>
        <span className="breadcrumb-tail">
          {props.feedLive ? 'LIVE' : 'FEED IDLE'} <i>·</i>{' '}
          {props.rateHz != null ? props.rateHz.toFixed(1) + ' HZ' : 'PERFORMANCE COUNTERS'}
        </span>
      </div>

      <Ticker
        items={[
          { label: 'CPU', value: `${live?.cpuLoad ?? 0}%` },
          { label: 'RAM', value: `${live?.ramLoad ?? 0}%` },
          { label: 'GPU', value: `${gpu?.load ?? 0}%` },
          { label: 'DISK', value: `${live?.diskLoad ?? 0}%` },
          { label: 'VRAM', value: gpu?.memTotalMB != null ? `${((gpu.memUsedMB ?? 0) / 1024).toFixed(1)}/${(gpu.memTotalMB / 1024).toFixed(0)}G` : '—' },
          { label: 'GPU TEMP', value: gpu?.tempC != null ? `${gpu.tempC}°C` : '—' },
          { label: 'DRAW', value: gpu?.watt != null ? `${gpu.watt}W` : '—' },
          { label: 'CLOCK', value: gpu?.clockMHz != null ? `${gpu.clockMHz}M` : '—' },
          { label: 'THREADS', value: String(live?.cpuCores ?? hw?.cpu.threads ?? '—') },
          { label: 'UPTIME', value: live?.uptimeH != null ? `${live.uptimeH}H` : '—' },
        ]}
      />

      <section className="section-intro">
        <p className="eyebrow"><span className="eyebrow-mark" />SYSTEM / DETECTOR</p>
        <h1>What you are<br />actually running on.</h1>
        <p>Per-core CPU and memory straight from the kernel, graphics from the vendor telemetry. Sampled continuously.</p>
      </section>

      {props.error && (
        <div className="feed-notice"><Icon name="lock" size={16} /><span>{props.error}</span></div>
      )}

      <div className="gauge-grid">
        <Gauge
          label="CPU LOAD"
          value={live?.cpuLoad ?? null}
          unit="%"
          pct={live?.cpuLoad ?? null}
          tone="cpu"
          detail={hw?.cpu ? `${hw.cpu.cores ?? '?'}C / ${hw.cpu.threads ?? '?'}T` : 'no cpu read'}
        />
        <Gauge
          label="MEMORY"
          value={live?.ramLoad ?? null}
          unit="%"
          pct={live?.ramLoad ?? null}
          tone="ram"
          detail={usedGB && totalGB ? `${usedGB} / ${totalGB} GB` : 'no memory read'}
        />
        <Gauge
          label="GPU LOAD"
          value={gpu?.load ?? null}
          unit="%"
          pct={gpu?.load ?? null}
          tone="gpu"
          detail={live?.gpuSource ? `via ${live.gpuSource}` : 'no gpu counter'}
        />
        <Gauge
          label="DISK"
          value={live?.diskLoad ?? null}
          unit="%"
          pct={live?.diskLoad ?? null}
          tone="disk"
          detail={live?.uptimeH != null ? `up ${live.uptimeH}h` : 'physical disk total'}
        />
      </div>

      <section className="history-panel">
        <div className="panel-bar"><span><i className="panel-bar-mark" />LAST {props.history.cpu.length} SAMPLES</span><span>PERCENT</span></div>
        <div className="spark-grid">
          <div className="spark-cell"><span className="micro-label">CPU</span><Sparkline points={props.history.cpu} max={100} tone="cpu" /></div>
          <div className="spark-cell"><span className="micro-label">RAM</span><Sparkline points={props.history.ram} max={100} tone="ram" /></div>
          <div className="spark-cell"><span className="micro-label">GPU</span><Sparkline points={props.history.gpu} max={100} tone="gpu" /></div>
        </div>
      </section>

      <section className="history-panel">
        <div className="panel-bar">
          <span><i className="panel-bar-mark" />PER CORE LOAD</span>
          <span>{live?.cpuCores ?? hw?.cpu.threads ?? '—'} LOGICAL PROCESSORS</span>
        </div>
        <div className="core-panel">
          <CoreBars loads={live?.cpuCoreLoad ?? []} cores={live?.cpuCores ?? hw?.cpu.threads ?? null} />
        </div>
      </section>

      <div className="spec-grid">
        <section className="spec-panel">
          <div className="panel-bar"><span><i className="panel-bar-mark" />PROCESSOR</span><Icon name="core" size={16} /></div>
          <div className="spec-body">
            <SpecRow label="Model" value={hw?.cpu.name ?? 'unknown'} />
            <SpecRow label="Cores / threads" value={`${hw?.cpu.cores ?? '?'} / ${hw?.cpu.threads ?? '?'}`} />
            <SpecRow label="Base clock" value={hw?.cpu.baseGHz != null ? `${hw.cpu.baseGHz} GHz` : 'unknown'} />
            <SpecRow label="Cache" value={`L2 ${hw?.cpu.l2KB ?? '?'} KB · L3 ${((hw?.cpu.l3KB ?? 0) / 1024).toFixed(0)} MB`} />
          </div>
        </section>

        <section className="spec-panel">
          <div className="panel-bar"><span><i className="panel-bar-mark" />MEMORY</span><Icon name="memory" size={16} /></div>
          <div className="spec-body">
            <SpecRow label="Installed" value={totalGB ? `${totalGB} GB` : 'unknown'} />
            <SpecRow label="Speed" value={hw?.ram.speedMTs ? `${hw.ram.speedMTs} MT/s` : 'unknown'} note={hw?.ram.speedMTs ? 'effective data rate' : undefined} />
            <SpecRow label="Slots used" value={`${hw?.ram.modules.length ?? 0} of ${hw?.ram.slots ?? '?'}`} />
            {(hw?.ram.modules ?? []).map((module, index) => (
              <SpecRow
                key={index}
                label={module.bank ?? `DIMM ${index + 1}`}
                value={`${module.sizeGB ?? '?'} GB · ${module.speedMTs ?? '?'} MT/s`}
                note={[module.maker, module.part].filter(Boolean).join(' ')}
              />
            ))}
          </div>
        </section>

        <section className="spec-panel">
          <div className="panel-bar"><span><i className="panel-bar-mark" />GRAPHICS</span><Icon name="game" size={16} /></div>
          <div className="spec-body">
            {(hw?.gpu ?? []).length === 0 && <SpecRow label="Adapter" value="none detected" />}
            {(hw?.gpu ?? []).map((adapter, index) => (
              <div key={index}>
                <SpecRow label={adapter.name ?? 'Adapter'} value={adapter.vramGB != null ? `${adapter.vramGB} GB VRAM` : 'VRAM unknown'} note={vramNote ?? undefined} />
                <SpecRow label="Driver" value={adapter.driver ?? 'unknown'} note={adapter.date ?? undefined} />
                <SpecRow label="Output" value={adapter.resolution ?? 'unknown'} note={adapter.refreshHz != null ? `${adapter.refreshHz} Hz` : undefined} />
              </div>
            ))}
            {gpu && (
              <>
                <SpecRow
                  label="Live GPU"
                  value={`${gpu.tempC ?? '--'}°C · ${gpu.watt ?? '--'} W`}
                  note={gpu.clockMHz != null ? `${gpu.clockMHz} MHz core clock` : undefined}
                />
                <SpecRow
                  label="Live VRAM"
                  value={gpu.memTotalMB != null ? `${(gpu.memUsedMB ?? 0) / 1024} / ${(gpu.memTotalMB / 1024).toFixed(1)} GB` : 'not reported'}
                  note={gpu.memLoad != null ? `engine memory ${gpu.memLoad}%` : undefined}
                />
              </>
            )}
          </div>
        </section>

        <section className="spec-panel">
          <div className="panel-bar"><span><i className="panel-bar-mark" />PLATFORM</span><Icon name="plug" size={16} /></div>
          <div className="spec-body">
            <SpecRow label="Board" value={[hw?.board.maker, hw?.board.model].filter(Boolean).join(' ') || 'unknown'} />
            <SpecRow label="OS" value={hw?.os.caption ?? 'unknown'} note={hw?.os.build ?? undefined} />
            <SpecRow label="Uptime" value={live?.uptimeH != null ? `${live.uptimeH} hours` : 'unknown'} />
            <SpecRow label="Samples" value={live?.at ? new Date(live.at).toLocaleTimeString() : 'waiting'} />
          </div>
        </section>
      </div>
    </div>
  )
}

function Overview(props: {
  presetId: PresetId
  selectedSet: Set<ModuleId>
  activeModuleCount: number
  onPreset: (id: Exclude<PresetId, 'custom'>) => void
  onToggle: (id: ModuleId) => void
  onReset: () => void
  onInitialize: () => void
  onOptimizations: () => void
  engineReady: boolean
  bridgeLive: boolean
  device: DeviceStatus | null
  stage: string
  lastRun: RunResult | null
onMeasure: () => void
  bench: BenchResult | null
  benchBefore: BenchResult | null
  benching: boolean
  history: { cpu: number[]; ram: number[]; gpu: number[] }
  version: string
  }) {
  return (
    <div className="overview-layout">
    <LeftRail
      history={props.history}
      device={props.device}
      bench={props.bench}
      fpsTarget={props.device?.fpsPeak ?? 240}
      engineReady={props.engineReady}
    />
    <div className="screen screen-overview">
    <div className="breadcrumb"><span>CONTROL</span><i>/</i><b>OVERVIEW</b><span className="breadcrumb-tail">SECTOR 01 <i>Â·</i> PREVIEW MODE</span></div>
    <section className="hero-panel">
        <div className="hero-content">
          <p className="eyebrow"><span className="eyebrow-mark" />BEYOND THE DEFAULT</p>
          <h1>BREAK THE LIMIT.<span>ENTER THE RIFT.</span></h1>
          <p className="hero-copy">Your system. Unburdened. Your game. Unleashed.<br />A new dimension of control for the battleground.</p>
          <div className="hero-bottomline"><span><i className="hero-live-dot" />INTERFACE PREVIEW / 0.1.0</span><span>ALLIANCE <b>×</b> AL</span></div>
        </div>
        <div className="hero-coordinate" aria-hidden="true"><span>38° 53′ 12″ N</span><span>RIFT SECTOR / 01</span><span>DEPTH // 009.4</span></div>
        <div className="hero-corner hero-corner--tr" aria-hidden="true">R — 01</div>
      </section>

      <SystemStatus device={props.device} stage={props.stage} engineReady={props.engineReady} lastRun={props.lastRun} bench={props.bench} />

      <section className="bench-bar" aria-label="Measured frame rate">
        <span className="metric-icon"><Icon name="activity" size={16} /></span>
        <span className="bench-copy">
          <span className="micro-label">{props.bench?.ok && props.bench.source === 'host' ? 'HOST PRESENT RATE' : 'MEASURED FRAME RATE'}</span>
          <strong>
            {props.benching
              ? 'SAMPLING…'
              : props.bench?.ok
                ? props.bench.source === 'host' ? `${props.bench.rate}/S PRESENT` : `${props.bench.fps} FPS`
                : props.bench
                  ? 'UNAVAILABLE'
                  : 'NOT MEASURED'}
          </strong>
          <small>
            {props.benching
              ? 'watching the game draw frames'
              : props.bench?.ok
                ? props.bench.source === 'host'
                  ? `emulator window · ${props.bench.frames} presents over ${props.bench.seconds}s${props.bench.monitor ? ` · display ${props.bench.monitor}Hz` : ''}${props.bench.keepingUp != null ? ` · keeping up: ${props.bench.keepingUp ? 'yes' : 'no'}` : ''}`
                  : `${props.bench.package} · ${props.bench.frames} frames over ${props.bench.seconds}s${props.bench.jankPct != null ? ` · ${props.bench.jankPct}% jank` : ''}`
                : props.bench?.message ?? 'measure the real frame rate before and after a run so the numbers mean something'}
          </small>
        </span>
        {props.bench?.ok && props.benchBefore?.ok && (
          <span className={['bench-delta', benchNumber(props.bench) >= benchNumber(props.benchBefore) ? 'is-up' : 'is-down'].join(' ')}>
            {benchNumber(props.bench) - benchNumber(props.benchBefore) >= 0 ? '+' : ''}
            {Math.round((benchNumber(props.bench) - benchNumber(props.benchBefore)) * 100) / 100} VS BEFORE
          </span>
        )}
        <UIButton variant="outline" className="bench-action" onClick={props.onMeasure} disabled={!props.engineReady || props.benching}>
          <Icon name="activity" size={14} />MEASURE
        </UIButton>
      </section>

      <section className="content-section preset-section" aria-labelledby="preset-heading">
        <SectionHeading headingId="preset-heading" kicker="01 / CALIBRATION" title="Your play. Your rules." action={<UIButton className="text-action" onClick={props.onReset}><Icon name="reset" size={14} />RESET COMPETITIVE</UIButton>} />
        <div className="preset-grid" role="radiogroup" aria-labelledby="preset-heading">
          {presets.map((preset, index) => (
            <label key={preset.id} className={['preset-card', props.presetId === preset.id ? 'is-selected' : ''].join(' ')}>
              <input type="radio" name="rift-preset" value={preset.id} checked={props.presetId === preset.id} onChange={() => props.onPreset(preset.id)} />
              <span className="preset-card-top"><span className="preset-glyph">{String(index + 1).padStart(2, '0')}</span>{preset.marker && <span className="preset-recommended">{preset.marker}</span>}<span className="radio-indicator" /></span>
              <strong>{preset.name}</strong>
              <span className="preset-description">{preset.description}</span>
              <span className="preset-foot"><span>{preset.modules.length} MODULES</span><span className="preset-card-arrow">↗</span></span>
            </label>
          ))}
        </div>
      </section>

      <section className="content-section modules-section" aria-labelledby="modules-heading">
        <SectionHeading
          headingId="modules-heading"
          kicker="02 / MODULE MATRIX"
          title="Optimization modules"
          subtitle={<span className="module-count"><b>{String(props.activeModuleCount).padStart(2, '0')}</b> / 06 ACTIVE</span>}
          action={<UIButton className="text-action" onClick={props.onOptimizations}>VIEW ALL <Icon name="arrowRight" size={14} /></UIButton>}
        />
        <ModuleGrid selectedSet={props.selectedSet} onToggle={props.onToggle} />
</section>

      <SafetyBar activeCount={props.activeModuleCount} onInitialize={props.onInitialize} engineReady={props.engineReady} bridgeLive={props.bridgeLive} />
    </div>
    <RightRail version={props.version} moduleCount={props.activeModuleCount} />
    </div>
  )
}

function Optimizations(props: {
  presetId: PresetId
  selectedSet: Set<ModuleId>
  activeModuleCount: number
  onPreset: (id: Exclude<PresetId, 'custom'>) => void
  onToggle: (id: ModuleId) => void
  onReset: () => void
  onInitialize: () => void
  engineReady: boolean
  bridgeLive: boolean
}) {
  return (
    <div className="screen sub-screen">
      <div className="breadcrumb"><span>CONTROL</span><i>/</i><b>OPTIMIZATION MODULES</b><span className="breadcrumb-tail">6 MODULES <i>·</i> {String(props.activeModuleCount).padStart(2, '0')} ACTIVE</span></div>
      <section className="section-intro">
        <p className="eyebrow"><span className="eyebrow-mark" />CONFIGURATION MATRIX</p>
        <div className="section-intro-row"><div><h1>Choose what<br />enters the rift.</h1><p>Set the profile, then tune every module by hand. Nothing leaves preview mode.</p></div><div className="section-count"><span>ACTIVE MODULES</span><strong>{String(props.activeModuleCount).padStart(2, '0')}<i>/06</i></strong><span>PROFILE / {presetNames[props.presetId].toUpperCase()}</span></div></div>
      </section>
      <section className="content-section preset-section" aria-labelledby="preset-heading">
        <SectionHeading headingId="preset-heading" kicker="01 / QUICK CONFIG" title="Start from a preset" action={<UIButton className="text-action" onClick={props.onReset}><Icon name="reset" size={14} />RESET COMPETITIVE</UIButton>} />
        <div className="preset-grid" role="radiogroup" aria-labelledby="preset-heading">
          {presets.map((preset, index) => (
            <label key={preset.id} className={['preset-card', props.presetId === preset.id ? 'is-selected' : ''].join(' ')}>
              <input type="radio" name="rift-preset" value={preset.id} checked={props.presetId === preset.id} onChange={() => props.onPreset(preset.id)} />
              <span className="preset-card-top"><span className="preset-glyph">{String(index + 1).padStart(2, '0')}</span>{preset.marker && <span className="preset-recommended">{preset.marker}</span>}<span className="radio-indicator" /></span>
              <strong>{preset.name}</strong><span className="preset-description">{preset.description}</span>
              <span className="preset-foot"><span>{preset.modules.length} MODULES</span><span className="preset-card-arrow">↗</span></span>
            </label>
          ))}
        </div>
      </section>
      <section className="content-section modules-section" aria-labelledby="modules-heading">
        <SectionHeading headingId="modules-heading" kicker="02 / MODULE MATRIX" title="Tune the matrix" subtitle={<span className="module-count"><b>{String(props.activeModuleCount).padStart(2, '0')}</b> / 06 ACTIVE</span>} />
        <ModuleGrid selectedSet={props.selectedSet} onToggle={props.onToggle} />
      </section>
      <SafetyBar activeCount={props.activeModuleCount} onInitialize={props.onInitialize} engineReady={props.engineReady} bridgeLive={props.bridgeLive} />
    </div>
  )
}

function SectionHeading({ headingId, kicker, title, subtitle, action }: { headingId: string; kicker: string; title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return <div className="section-heading"><div><p className="eyebrow">{kicker}</p><div className="section-title-row"><h2 id={headingId}>{title}</h2>{subtitle}</div></div>{action}</div>
}

function benchNumber(result: BenchResult): number {
  return result.source === 'host' ? (result.rate ?? 0) : (result.fps ?? 0)
}

function SystemStatus(props: { device: DeviceStatus | null; stage: string; engineReady: boolean; lastRun: RunResult | null; bench: BenchResult | null }) {
  const d = props.device
  const connected = Boolean(d?.online)
  // a benchmark is the only thing in this app that produces a real frame rate.
  // the config numbers are targets, so they must never be shown as measured.
  const measured = props.bench?.ok ? (props.bench.source === 'host' ? props.bench.rate : props.bench.fps) : null

  const items = [
    {
      label: 'DEVICE',
      value: d?.device ? String(d.device).toUpperCase() : 'NONE',
      note: d?.brand ? [d.brand, d.model].filter(Boolean).join(' ') : connected ? 'connecting' : 'no device on adb',
      icon: 'core' as const,
      live: connected,
    },
    {
      label: 'PLATFORM',
      value: d?.android ? `ANDROID ${d.android}` : 'AWAITING',
      note: d ? (d.root ? 'root available' : d.loop ? 'emulator, no root' : 'no root') : 'local bridge required',
      icon: 'memory' as const,
      live: Boolean(d),
    },
    {
      // Only a benchmark gives us a real frame rate. Everything else here is a
      // configured number, so showing one as if it were measured would be a lie.
      label: 'FRAME GOAL',
      value: measured ? `${measured} → ${d?.fpsPeak ?? 240} FPS` : `${d?.fpsPeak ?? 240} FPS`,
      note: measured
        ? `measured ${measured} · target ${d?.fpsPeak ?? 240}`
        : 'run the benchmark for a measured rate',
      icon: 'network' as const,
      live: Boolean(props.device),
    },
    {
      label: 'ENGINE',
      value: props.engineReady ? props.stage.toUpperCase().slice(0, 22) : 'STANDBY',
      note: props.lastRun ? `last run ${props.lastRun.ok} ok / ${props.lastRun.err} failed` : props.engineReady ? 'ready to execute' : 'preview mode',
      icon: 'game' as const,
      live: props.engineReady,
    },
  ]

  return (
    <section className="system-strip" aria-label="System status">
      {items.map((item) => (
        <div className={['system-metric', item.live ? 'system-metric--live' : ''].filter(Boolean).join(' ')} key={item.label}>
          <span className="metric-icon"><Icon name={item.icon} size={16} /></span>
          <div className="metric-text"><span className="micro-label">{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div>
          <span className="metric-end" />
        </div>
      ))}
    </section>
  )
}

function ModuleGrid({ selectedSet, onToggle }: { selectedSet: Set<ModuleId>; onToggle: (id: ModuleId) => void }) {
  return <div className="module-grid">{modules.map((item) => {
    const active = selectedSet.has(item.id)
    return (
      <article className={['module-card', active ? 'is-active' : ''].join(' ')} key={item.id}>
        <div className="module-card-top"><span className="module-icon"><Icon name={item.icon} size={20} /></span><span className="module-index">{item.index} / 06</span><button className="switch" type="button" role="switch" aria-checked={active} aria-label={'Toggle ' + item.name} onClick={() => onToggle(item.id)}><span /></button></div>
        <div className="module-copy"><p className="micro-label">{item.category}</p><h3>{item.name}</h3><p>{item.description}</p></div>
        <div className="module-card-foot"><span className={active ? 'module-state module-state--on' : 'module-state'}><i />{active ? 'ARMED FOR PREVIEW' : 'STANDBY'}</span><span className="module-index">R—{item.index}</span></div>
      </article>
    )
  })}</div>
}

function SafetyBar({ activeCount, onInitialize, engineReady, bridgeLive }: { activeCount: number; onInitialize: () => void; engineReady: boolean; bridgeLive: boolean }) {
  const armed = activeCount > 0 && engineReady

  return (
    <section className="safety-bar">
      <div className="safety-symbol"><Icon name="shield" size={19} /></div>
      <div className="safety-copy">
        <p className="micro-label">{engineReady ? 'EXECUTES ON THIS MACHINE.' : 'PREVIEW MODE.'}</p>
        <strong>{engineReady ? 'Initialization runs real changes on your PC.' : 'Nothing is sent to Windows from the browser.'}</strong>
        <span>{engineReady ? 'Selected modules are applied through the local PowerShell engine. Every setting is backed up first so it can be rolled back.' : 'The tuning engine ships with the desktop app. Start R i F T from the desktop build to execute against this PC.'}</span>
      </div>
      <UIButton variant="primary" className="initialize-button" onClick={onInitialize} disabled={!armed}>
        <span className="initialize-emblem">R</span>
        <span>INITIALIZE RIFT<small>{activeCount === 0 ? 'SELECT A MODULE' : !engineReady ? 'ENGINE NOT READY' : String(activeCount).padStart(2, '0') + (bridgeLive ? ' MODULES / LIVE' : ' MODULES')}</small></span>
        <Icon name="arrowRight" size={19} />
      </UIButton>
    </section>
  )
}

function Activity({ sessions, onClear }: { sessions: Session[]; onClear: () => void }) {
  return <div className="screen sub-screen activity-screen">
    <div className="breadcrumb"><span>CONTROL</span><i>/</i><b>ACTIVITY LOG</b><span className="breadcrumb-tail">LOCAL SESSION <i>·</i> MEMORY ONLY</span></div>
    <section className="section-intro section-intro--row"><div><p className="eyebrow"><span className="eyebrow-mark" />FLIGHT RECORDER / 03</p><h1>EVERY MOVE.<br />RECORDED.</h1><p>Completed preview sessions, newest first. History remains in memory for this visit.</p></div><UIButton variant="outline" className="clear-log-button" onClick={onClear} disabled={sessions.length === 0}><Icon name="trash" size={15} />CLEAR LOG</UIButton></section>
    <section className="activity-panel"><div className="panel-bar"><span><i className="panel-bar-mark" />SESSION ARCHIVE</span><span>{String(sessions.length).padStart(2, '0')} ENTRIES <b>·</b> EPHEMERAL</span></div>
      {sessions.length === 0 ? <div className="empty-log"><div className="empty-log-mark"><span /><span /><span /></div><p className="eyebrow">NO SIGNALS RECORDED</p><h2>The ledger is quiet.</h2><p>Completed preview runs will appear here with their preset, module count, and timestamp.</p><span className="empty-log-code">WAITING FOR FIRST CROSSING <i>_</i></span></div> : <div className="session-list">{sessions.map((session, index) => <article className="session-row" key={session.id}><span className="session-index">{String(sessions.length - index).padStart(2, '0')}</span><div className="session-main"><span className="micro-label">{formatTimestamp(session.timestamp)}</span><strong>{session.preset}</strong><span>{session.moduleCount} modules simulated · No system changes made</span></div><span className="session-status"><i />{session.status}</span><Icon name="arrowRight" size={15} />{session.output && session.output.length > 0 ? <details className="session-output"><summary>RUN OUTPUT <i>{session.output.length} LINES</i></summary><div className="session-output-body">{session.output.map((line) => <p key={line.id} className={'terminal-line terminal-line--' + line.level}><span className="terminal-prompt">{line.level === 'stage' ? '·' : line.level === 'err' ? 'x' : line.level === 'warn' ? '!' : line.level === 'ok' ? '+' : '>'}</span>{line.text}</p>)}</div></details> : null}</article>)}</div>}
    </section>
    <div className="activity-footnote"><Icon name="memory" size={15} /><span>SESSION HISTORY IS HELD IN MEMORY AND CLEARS WHEN THIS PAGE IS CLOSED.</span></div>
  </div>
}

function Settings({ livingEnvironment, onEnvironment, systemReducedMotion, onExport, engine, device, onRestore, restoring, onPreview }: { livingEnvironment: boolean; onEnvironment: (value: boolean) => void; systemReducedMotion: boolean; onExport: () => void; engine: EngineInfo | null; device: DeviceStatus | null; onRestore: () => void; restoring: boolean; onPreview: () => void }) {
  return <div className="screen sub-screen settings-screen">
    <div className="breadcrumb"><span>CONTROL</span><i>/</i><b>SETTINGS</b><span className="breadcrumb-tail">LOCAL PREFERENCES</span></div>
    <section className="section-intro"><p className="eyebrow"><span className="eyebrow-mark" />RIFT / CONFIGURATION</p><h1>Set the atmosphere.</h1><p>Shape the room around your setup. Your preferences stay in this browser session.</p></section>
    <div className="settings-grid">
      <section className="settings-panel"><div className="panel-bar"><span><i className="panel-bar-mark" />01 / LIVING ENVIRONMENT</span><Icon name="overview" size={16} /></div><div className="setting-row"><div className="setting-icon"><Icon name="orbit" size={18} /></div><div className="setting-copy"><strong>Cathedral atmosphere</strong><span>Slow light drift and a soft glow behind your control deck.</span>{systemReducedMotion && <small className="setting-note">Your device requests reduced motion; the background stays still.</small>}</div><button className="switch setting-switch" type="button" role="switch" aria-checked={livingEnvironment} aria-label="Enable animated background" onClick={() => onEnvironment(!livingEnvironment)}><span /></button></div><div className="setting-meta"><span>CATHEDRAL IMAGE / LOCAL ASSET</span><span>{livingEnvironment && !systemReducedMotion ? 'MOTION ENABLED' : 'STILL FRAME'}</span></div></section>
      <section className="settings-panel"><div className="panel-bar"><span><i className="panel-bar-mark" />02 / CONFIGURATION EXPORT</span><Icon name="export" size={16} /></div><div className="setting-row"><div className="setting-icon"><Icon name="file" size={18} /></div><div className="setting-copy"><strong>Carry your selection</strong><span>Download the preset and active module list as JSON.</span></div><UIButton variant="outline" className="setting-action" onClick={onExport}>EXPORT JSON <Icon name="arrowDown" size={14} /></UIButton></div><div className="setting-meta"><span>FORMAT / JSON</span><span>PREVIEW DATA ONLY</span></div></section>
      <section className="settings-panel settings-panel--wide"><div className="panel-bar"><span><i className="panel-bar-mark" />03 / DESKTOP CONNECTION</span><span className={['offline-chip', engine?.available ? 'offline-chip--live' : ''].filter(Boolean).join(' ')}><i />{engine?.available ? 'ENGINE FOUND' : 'OFFLINE'}</span></div><div className="connection-detail"><div className="bridge-emblem"><Icon name="plug" size={22} /></div><div className="setting-copy"><strong>PowerShell engine</strong><span>{engine?.available ? 'The tuning engine is on disk and ready. Initialization is the only action that changes this PC, and it backs up every setting first.' : engine?.reason ?? 'Looking for the tuning engine next to the app.'}</span>{device?.device && <small className="setting-note">Connected: {device.device} · {device.brand} {device.model} · root {device.root ? 'yes' : 'no'}</small>}</div><span className="bridge-version">{engine?.available ? 'ENGINE' : 'BRIDGE'} <b>{engine?.name ?? '—'}</b></span></div><div className="setting-meta"><span>LOCAL EXECUTION / {engine?.available ? 'ARMED' : 'DISABLED'}</span><span>{engine?.available ? 'ENGINE DISCOVERED' : 'AWAITING VERIFIED DESKTOP CONNECTION'}</span></div><div className="setting-row"><div className="setting-icon"><Icon name="reset" size={18} /></div><div className="setting-copy"><strong>Roll back the last run</strong><span>Restores every setting from the most recent engine backup.</span></div><UIButton variant="outline" className="setting-action" onClick={onPreview} disabled={restoring || !engine?.available}>PREVIEW</UIButton><UIButton variant="outline" className="setting-action" onClick={onRestore} disabled={restoring || !engine?.available}>{restoring ? 'RESTORING' : 'RESTORE'} <Icon name="reset" size={14} /></UIButton></div></section>
    </div>
  </div>
}

function GameProfile({ onOpenSettings, engineReady }: { onOpenSettings: () => void; engineReady: boolean }) {
  return <div className="screen sub-screen game-screen">
    <div className="breadcrumb"><span>CONTROL</span><i>/</i><b>GAME PROFILE</b><span className="breadcrumb-tail">PROFILE 001</span></div>
    <section className="game-profile-card"><div className="profile-lines" aria-hidden="true" /><div className="profile-topline"><span className="eyebrow"><span className="eyebrow-mark" />ACTIVE GAME PROFILE</span><span className="profile-id">R—GAME / 001</span></div><div className="profile-title"><div className="profile-insignia"><Icon name="game" size={36} /></div><div><p className="micro-label">KRAFTON / BATTLEGROUNDS</p><h1>PUBG:<br /><span>BATTLEGROUNDS</span></h1></div></div><div className="profile-bottom"><p>{engineReady ? 'The engine detects PUBG on the connected device and patches its config for the selected frame target.' : 'This interface is a preview for PUBG: BATTLEGROUNDS. The profile does not detect the game or read your system.'}</p><div className="profile-status"><span className="status-dot" />PROFILE READY <b>·</b> {engineReady ? 'ENGINE READY' : 'BRIDGE OFFLINE'}</div></div></section>
    <section className="profile-note"><div className="safety-symbol"><Icon name="lock" size={18} /></div><div><p className="micro-label">DESKTOP CONNECTION</p><strong>{engineReady ? 'This build can execute against your PC.' : 'A browser cannot execute PowerShell or apply Windows changes.'}</strong><span>{engineReady ? 'Initialization applies the selected modules through the local engine. Settings are backed up first and can be rolled back from Settings.' : 'Real optimization requires the desktop build with the local engine.'}</span></div><UIButton variant="outline" onClick={onOpenSettings}>VIEW CONNECTION <Icon name="arrowRight" size={15} /></UIButton></section>
    <div className="profile-source"><span>PROFILE STATUS / PREVIEW ONLY</span><span>RIFT <i>BY ALI ESSAM</i></span></div>
  </div>
}

function NavButton({ item, active, onClick, compact = false }: { item: { id: SectionId; label: string; icon: IconName }; active: boolean; onClick: () => void; compact?: boolean }) {
  return <button className={['nav-button', active ? 'is-current' : '', compact ? 'nav-button--compact' : ''].filter(Boolean).join(' ')} type="button" onClick={onClick} aria-current={active ? 'page' : undefined}>
    <Icon name={item.icon} size={17} /><span>{item.label}</span>{item.id === 'optimizations' && <span className="nav-count">06</span>}
  </button>
}

function RgbFan({ compact = false, size = 44 }: { compact?: boolean; size?: number }) {
  return <div
    className={['rgb-fan', compact ? 'rgb-fan--compact' : ''].filter(Boolean).join(' ')}
    style={compact ? undefined : { width: size, height: size, flexBasis: size }}
    role="img"
    aria-label="Spinning RGB alliance fan with AL in the centre"
  >
    <span className="rgb-fan-blades" />
    <span className="rgb-fan-ring" />
    <span className="rgb-fan-hub">
      <span className="rgb-fan-core">
        <span className="rgb-fan-al">AL</span>
      </span>
    </span>
  </div>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={['brand-lockup', compact ? 'brand-lockup--compact' : ''].join(' ')}>
    <RgbFan compact={compact} />
    <div className="brand-type"><span className="brand-name">RIFT</span><span className="brand-alliance">BY ALI ESSAM</span></div>
    {!compact && <span className="brand-seal">01</span>}
  </div>
}

function PortalScene({ animate }: { animate: boolean }) {
  return <div className={['rift-scene', animate ? '' : 'rift-scene--still'].filter(Boolean).join(' ')} aria-hidden="true">
    <div className="scene-rgb" />
    <div className="scene-veil" />
    <div className="rift-emblem"><img src="/rift-emblem.jpg" alt="" width={1024} height={1024} decoding="async" /></div>
    <svg className="cathedral-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="void" cx="72%" cy="43%" r="54%"><stop offset="0" stopColor="#151119" /><stop offset=".38" stopColor="#0c0a0e" /><stop offset="1" stopColor="#050506" /></radialGradient>
        <radialGradient id="gate" cx="50%" cy="49%" r="57%"><stop offset="0" stopColor="#b57df5" stopOpacity=".95" /><stop offset=".12" stopColor="#6e38ab" stopOpacity=".72" /><stop offset=".34" stopColor="#2a1a3c" stopOpacity=".8" /><stop offset=".72" stopColor="#0a080d" /><stop offset="1" stopColor="#030304" /></radialGradient>
        <linearGradient id="stone" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#2c2930" /><stop offset=".44" stopColor="#121014" /><stop offset="1" stopColor="#060507" /></linearGradient>
        <linearGradient id="floor" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#28252c" stopOpacity=".05" /><stop offset=".52" stopColor="#09080b" stopOpacity=".65" /><stop offset="1" stopColor="#030304" /></linearGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="15" /></filter>
        <filter id="glow"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect width="1600" height="900" fill="url(#void)" />
      <g className="architecture-back" fill="none" stroke="#879182" strokeOpacity=".17" strokeWidth="2">
        <path d="M0 690V325l54-28 58-129 58 129 55 28v-82l37-24 34-91 42 91 36 24v447" />
        <path d="M1280 750V300l49-26 49-140 52 140 49 26v-96l31-19 38-120 43 120 29 19v446" />
        <path d="M42 540h278M47 561h270M1290 529h276M1295 550h270" />
        <path d="M0 731h354M1258 733h342" strokeOpacity=".1" />
        <path d="M86 680V405q36-60 72 0v280M1365 697V415q34-59 68 0v282" stroke="#aeb9a5" strokeOpacity=".12" />
        <path d="M0 0 320 218M50 0l260 182M1598 0l-295 206M1514 0l-225 174" stroke="#a3ad9d" strokeOpacity=".09" />
      </g>
      <g className="cables" fill="none" stroke="#080a08" strokeWidth="12">
        <path d="M0 168C190 230 180 436 330 495S420 590 375 714" /><path d="M1598 88c-170 107-117 278-256 356s-91 180-52 310" />
        <path d="M117 0c72 180-36 277 78 389s100 201 30 382" stroke="#353c35" strokeWidth="2" />
        <path d="M1468 0c-104 132 38 247-91 352s-102 210-31 420" stroke="#353c35" strokeWidth="2" />
      </g>
      <g className="gate-light" filter="url(#blur)" opacity=".45"><ellipse cx="1072" cy="392" rx="273" ry="330" fill="#6633a0" /></g>
      <g className="gate-structure">
        <path d="M790 690V399c0-191 122-315 282-315s282 124 282 315v291h-65V401c0-149-90-248-217-248s-217 99-217 248v289z" fill="url(#stone)" stroke="#798274" strokeOpacity=".43" strokeWidth="4" />
        <path d="M847 685V406c0-149 94-253 225-253s225 104 225 253v279" fill="none" stroke="#b6c0ad" strokeOpacity=".16" strokeWidth="3" />
        <path d="M909 688V409c0-106 65-184 163-184s163 78 163 184v279" fill="url(#gate)" stroke="#a9d76c" strokeOpacity=".64" strokeWidth="5" className="gate-core" />
        <ellipse cx="1072" cy="397" rx="161" ry="221" fill="none" stroke="#d5ff9b" strokeOpacity=".7" strokeWidth="2" className="gate-ring" />
        <ellipse cx="1072" cy="397" rx="179" ry="240" fill="none" stroke="#8dbd52" strokeOpacity=".26" strokeWidth="1" className="gate-ring gate-ring--outer" />
        <path d="M953 473c48-65 190-69 239-5M951 502c62-33 185-31 245 4" stroke="#d5ff9b" strokeOpacity=".45" strokeWidth="2" fill="none" className="gate-etch" />
        <circle cx="1072" cy="390" r="21" fill="#e5d1fc" opacity=".75" filter="url(#glow)" className="gate-heart" />
        <path d="M825 681V405q0-243 247-243t247 243v276" fill="none" stroke="#d6e5ca" strokeOpacity=".29" strokeWidth="11" strokeDasharray="2 18" />
        <path d="M790 506h-50m616 0h-49M800 579h-58m602 0h-57" stroke="#b4c19f" strokeOpacity=".26" strokeWidth="4" />
      </g>
      <g className="spires" fill="url(#stone)" stroke="#667061" strokeOpacity=".28" strokeWidth="2">
        <path d="M698 691V510l42-40 43 40v181zM1373 691V504l44-42 44 42v187z" />
        <path d="M708 519h64v10h-64zM1384 514h66v10h-66z" fill="#8b8196" fillOpacity=".25" />
        <path d="M725 469v-69l15-41 16 41v69M1402 461v-73l15-39 16 39v73" />
        <path d="M740 345v-48m677 52v-55" stroke="#9bac8d" strokeOpacity=".42" />
      </g>
      <g className="floor-grid" fill="none" stroke="#8a9585" strokeOpacity=".15" strokeWidth="2">
        <path d="M0 716h1600M0 760h1600M0 817h1600M0 876h1600" />
        <path d="m0 900 630-210m90 210 235-210m74 210-20-210m124 210-210-210m677 210-768-210" />
        <path d="M784 693h576" stroke="#d0e4c2" strokeOpacity=".24" />
      </g>
      <rect y="675" width="1600" height="225" fill="url(#floor)" />
      <path className="reflection" d="M915 680h314l75 220H827z" fill="#8859be" opacity=".08" filter="url(#blur)" />
      <g className="architecture-front" fill="none" stroke="#c3c9bc" strokeOpacity=".12" strokeWidth="2">
        <path d="M0 178h298M0 196h268M1600 140h-255m255 19h-224" />
        <path d="M411 0v198m18-198v178m789-178v183m17-183v204" />
        <path d="m342 696 83-36 42 24m737 3 62-36 68 22" />
      </g>
    </svg>
    <div className="scene-smoke scene-smoke--one" /><div className="scene-smoke scene-smoke--two" /><div className="scene-smoke scene-smoke--three" />
    <div className="scene-scan" />
    <div className="scene-grain" />
  </div>
}

function formatTimestamp(iso: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const megabytes = bytes / (1024 * 1024)
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(2)} GB` : `${megabytes.toFixed(1)} MB`
}

type IconName = 'overview' | 'sliders' | 'activity' | 'settings' | 'game' | 'export' | 'arrowDown' | 'arrowRight' | 'help' | 'core' | 'network' | 'memory' | 'input' | 'privacy' | 'reset' | 'shield' | 'trash' | 'orbit' | 'file' | 'plug' | 'lock'

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.65 }
  const drawings: Record<IconName, ReactNode> = {
    overview: <><path d="M3.5 9.2 12 3l8.5 6.2v9.5a1.8 1.8 0 0 1-1.8 1.8h-13a1.8 1.8 0 0 1-1.8-1.8z" /><path d="M8.5 20.5v-7h7v7M3.5 9.2h17" /></>,
    sliders: <><path d="M4 6h6M14 6h6M4 12h2M10 12h10M4 18h8M16 18h4" /><circle cx="12" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" /></>,
    activity: <><path d="M3 12h4l2.1-6 4 12 2.2-6H21" /><path d="M3 4v16M21 4v16" opacity=".4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.5 2.6-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-3l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.5-2.6 1.4-1.1A7 7 0 0 1 9 13.3l-1.7-1 1.5-2.6 1.8.5a8 8 0 0 1 1.5-.9l.3-1.8h3l.3 1.8a8 8 0 0 1 1.5.9l1.7-.5 1.5 2.6-1.4 1.1a7 7 0 0 1-.1 1.6Z" transform="translate(-1 -1)" /></>,
    game: <><path d="M7.5 8h9a4.5 4.5 0 0 1 4.2 3l1.1 3.1a2.8 2.8 0 0 1-4.3 3.1l-2-1.5h-7l-2 1.5a2.8 2.8 0 0 1-4.3-3.1L3.3 11a4.5 4.5 0 0 1 4.2-3Z" /><path d="M7 11v4m-2-2h4m6.5-.5h.01m3 2h.01" /></>,
    export: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></>,
    arrowDown: <><path d="M12 4v15m-5-5 5 5 5-5" /></>,
    arrowRight: <><path d="M4 12h15m-5-5 5 5-5 5" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 1 1 3.7 1.8c-.9.7-1.5 1-1.5 2.4m0 3h.01" /></>,
    core: <><path d="M9 3h6l1 2.4 2 .9 2.4-.8 3 5.2-1.5 2 .1 2.2 1.4 2.1-3 5.1-2.4-.7-2 .9-1 2.4H9l-1-2.4-2-.9-2.4.7-3-5.1L2 15l.1-2.2-1.5-2 3-5.2 2.4.8 2-.9z" transform="translate(1 -1) scale(.9)" /><circle cx="12" cy="12" r="3" /></>,
    network: <><circle cx="5" cy="12" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="19" cy="19" r="2" /><path d="m7 11 10-5M7 13l10 5" /></>,
    memory: <><rect x="5" y="6" width="14" height="12" rx="1" /><path d="M8 9h8v6H8zM2 9h3m-3 6h3m14-6h3m-3 6h3M9 3v3m6-3v3m-6 12v3m6-3v3" /></>,
    input: <><path d="M8 3v7m4-7v7m-4 0H6a2 2 0 0 0-2 2v2a8 8 0 0 0 16 0v-2a2 2 0 0 0-2-2h-2" /><path d="M12 14v7" /></>,
    privacy: <><path d="M12 3 20 6v5c0 5-3.4 8.1-8 10-4.6-1.9-8-5-8-10V6z" /><path d="m8 12 2.5 2.5L16 9" /></>,
    reset: <><path d="M4 11a8 8 0 1 1 1.5 5M4 5v6h6" /><path d="M12 8v4l3 2" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.1-8 10-4.6-1.9-8-5-8-10V6z" /><path d="M9 12h6m-3-3v6" /></>,
    trash: <><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    orbit: <><circle cx="12" cy="12" r="2.5" /><ellipse cx="12" cy="12" rx="9" ry="4.4" transform="rotate(-28 12 12)" /><path d="m18.6 6.3.01.01" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5m-9 4h5m-5 4h5" /></>,
    plug: <><path d="M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-5 5h0a5 5 0 0 1-5-5z" /><path d="M12 16v5" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>{drawings[name]}</svg>
}

function SignInGate({ onSignedIn, hwid }: { onSignedIn: (account: Account) => void; hwid: string }) {
  const [busy, setBusy] = useState<AuthProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)
  // resolved on mount so the click below can open the popup without awaiting
  const signInRef = useRef<((id: AuthProviderId) => Promise<Account>) | null>(null)

  useEffect(() => {
    let cancelled = false
    import('../lib/firebase')
      .then(async (mod) => {
        await mod.prepareAuth()
        if (!cancelled) signInRef.current = mod.signInWith
      })
      .catch((caught) => {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught)
          setError(`Google sign-in could not initialize: ${message}`)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const providers = [{ id: 'google.com' as const, label: 'Google', mark: 'G' }]

  const begin = useCallback(
    async (id: AuthProviderId) => {
      setError(null)
      const signIn = signInRef.current
      if (!signIn) {
        setError('Sign-in is still loading. Try again in a moment.')
        return
      }
      setBusy(id)
      try {
        // The popup resolves with the signed-in account and Firebase persists it.
        const signedIn = await signIn(id)
        onSignedIn(signedIn)
      } catch (caught) {
        const code = caught && typeof caught === 'object' && 'code' in caught ? String(caught.code) : ''
        const message = caught instanceof Error ? caught.message : String(caught)
        setError(
          [
            code || message,
            code === 'auth/operation-not-allowed'
              ? 'That provider is not enabled in the Firebase console.'
              : null,
            code === 'auth/unauthorized-domain'
              ? 'This app origin is not in the Firebase authorised domains list.'
              : null,
            code === 'auth/network-request-failed'
              ? 'The provider could not be reached. Check your connection.'
              : null,
            code === 'auth/popup-blocked'
              ? 'The sign-in window was blocked. Allow the app to open its Google sign-in window and try again.'
              : null,
            code === 'auth/popup-closed-by-user'
              ? 'The Google sign-in window was closed before sign-in finished.'
              : null,
            !code ? 'Sign-in failed.' : null,
          ]
            .filter(Boolean)
            .join(' '),
        )
      } finally {
        setBusy(null)
      }
    },
    [onSignedIn],
  )

  return (
    <div className="rift-app rift-app--still">
      <CathedralScene animate={false} />
      <div className="scene-scrim" aria-hidden="true" />
      <div className="signin-gate">
        <section className="signin-card">
          <div className="dialog-topline">
            <span>RIFT / IDENTITY</span>
            <span className="dialog-number">AL-01</span>
          </div>
          <div className="brand-lockup signin-brand">
            <Brand />
          </div>
          <p className="eyebrow dialog-eyebrow">SIGN IN TO CONTINUE</p>
          <h2 className="signin-title">One account. This machine.</h2>
          <p className="dialog-subtitle">
            R i F T binds to a single PC. Sign in once and this install keeps its licence.
          </p>

          <div className="signin-providers">
            {providers.map((provider) => (
              <UIButton
                key={provider.id}
                variant="outline"
                className="signin-provider"
                disabled={busy !== null}
                onClick={() => begin(provider.id)}
              >
                <span className="signin-mark" aria-hidden="true">{provider.mark || ''}</span>
                <span>{busy === provider.id ? 'Waiting for Google...' : `Continue with ${provider.label}`}</span>
              </UIButton>
            ))}
          </div>

          {error && <p className="signin-error" role="alert">{error}</p>}

          <div className="signin-foot">
            <span className="micro-label">MACHINE ID</span>
            <code>{hwid ? hwid.slice(0, 18) : 'reading...'}</code>
          </div>
          <p className="signin-note">
            We never see or store your password. The provider handles sign-in and hands us a token.
          </p>
        </section>
      </div>
    </div>
  )
}
