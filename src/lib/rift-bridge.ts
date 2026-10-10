export type RunAction = 'status' | 'bench' | 'preview' | 'lite' | 'max' | 'ultra' | 'windows' | 'custom' | 'restore'

export type ModuleId = 'system' | 'pubg' | 'network' | 'memory' | 'input' | 'privacy'

export type EngineInfo = {
  available: boolean
  script: string | null
  name?: string
  folder?: string
  reason?: string
}

export type DeviceStatus = {
  e: 'status'
  device: string | null
  brand: string
  model: string
  android: string
  root: boolean
  rootMethod?: string
  rootManager?: string
  selinux?: string
  congestion?: string
  loop: boolean
  online: boolean
  adb: string | null
  fpsMin: number
  fpsMax: number
  fpsPeak: number
  version: string
}

export type BbrStatus = {
  e: 'bbr'
  available?: string
  current?: string
  result?: string
  kernel?: string
}

export type RunResult = { ok: number; warn: number; err: number; action: RunAction; log: string }

export type EngineEvent =
  | { e: 'start'; action: RunAction; modules: string[] }
  | { e: 'stage'; m: string }
  | { e: 'log'; l: 'ok' | 'warn' | 'err' | 'info' | 'dbg'; m: string; t?: string }
  | { e: 'progress'; p: number }
  | { e: 'root'; available: boolean; method: string; manager: string; selinux: string; probe: string }
  | BbrStatus
  | DeviceStatus
  | { e: 'done'; ok: number; warn: number; err: number; action: RunAction; log: string }
  | { e: 'fatal'; m: string }
  | { e: 'exit'; code: number | null; ok: boolean; reason: string }
  | BenchEvent

export type BenchEvent = {
  e: 'bench'
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

type RiftBridge = {
  isDesktop: true
  engine(): Promise<EngineInfo>
  hardware(): Promise<HardwareStatus>
  startHardware(): Promise<{ started: boolean; reason?: string }>
  stopHardware(): Promise<{ stopped: boolean }>
  run(action: RunAction, modules?: string[], benchSeconds?: number): Promise<{ started: boolean; ok?: boolean; reason?: string }>
cancel(): Promise<{ cancelled: boolean }>
  version(): Promise<{ version: string; repo: string }>
  hwid(): Promise<HwidInfo>
  checkUpdate(): Promise<UpdateStatus>
  recheckUpdate(): Promise<UpdateStatus>
  openUpdatePage(): Promise<boolean>
  downloadUpdate(): Promise<{ started: boolean; reason?: string; name?: string }>
  revealUpdateDownload(): Promise<boolean>
  onEvent(listener: (event: EngineEvent) => void): () => void
  onHardware(listener: (event: HardwareEvent) => void): () => void
  onUpdate(listener: (payload: UpdateStatus) => void): () => void
  onUpdateDownload(listener: (payload: UpdateDownloadStatus) => void): () => void
}

export type HwidInfo = {
  hwid: string
  reliable: boolean
  usableCount: number
  mismatch: boolean
  firstSeen?: string | null
}

export type Account = {
  uid: string
  email: string | null
  displayName: string | null
  photoUrl: string | null
  provider: 'google.com' | 'apple.com' | 'discord.com' | 'unknown'
  signInAt: string
}

export type UpdateStatus = {
  state: 'available' | 'current' | 'offline'
  from: string
  to: string
  notes: string[]
  url: string
  publishedAt?: string | null
  reason?: string
  downloadAvailable?: boolean
  assetName?: string
  assetSize?: number
}

export type UpdateDownloadStatus = {
  state: 'downloading' | 'complete' | 'installing' | 'error'
  version: string
  name: string
  downloadedBytes: number
  totalBytes: number | null
  percent: number | null
  message?: string
}

export type CpuInfo = {
  name: string | null
  cores: number | null
  threads: number | null
  baseGHz: number | null
  l2KB: number | null
  l3KB: number | null
  socket: number | null
}

export type RamModule = {
  bank: string | null
  sizeGB: number | null
  speedMTs: number | null
  type: string | null
  maker: string | null
  part: string | null
}

export type RamInfo = {
  totalMB: number | null
  slots: number | null
  speedMTs: number | null
  modules: RamModule[]
}

export type GpuInfo = {
  name: string | null
  driver: string | null
  date: string | null
  vramGB: number | null
  vramExact: boolean
  resolution: string | null
  refreshHz: number | null
  mode: string | null
}

export type HardwareProfile = {
  cpu: CpuInfo
  ram: RamInfo
  gpu: GpuInfo[]
  board: { maker: string | null; model: string | null }
  os: { caption: string | null; build: string | null }
}

export type GpuLive = {
  load: number | null
  memLoad: number | null
  memUsedMB: number | null
  memTotalMB: number | null
  tempC: number | null
  watt: number | null
  clockMHz: number | null
}

export type HardwareEvent =
  | { e: 'hello'; at: string; intervalMs: number; hw: HardwareProfile }
  | {
      e: 'sample'
      n: number
      at: string
      cpuLoad: number | null
      cpuSource?: string
      cpuCores?: number
      cpuCoreLoad?: number[]
      cpuClockMHz?: number | null
      ramLoad: number | null
      ramUsedMB: number | null
      ramTotalMB?: number | null
      ramCommitMB?: number | null
      ramSource?: string
      diskLoad: number | null
      uptimeH: number | null
      gpuSource: string | null
      gpu: GpuLive[] | null
    }
  | { e: 'sensors-stopped'; code: number | null }
  | { e: 'log'; l: 'ok' | 'warn' | 'err' | 'info'; m: string }
  | { e: 'fatal'; m: string }

export type HardwareStatus = {
  available: boolean
  script: string | null
  name: string | null
  intervalMs: number
  running: boolean
  latest: HardwareEvent | null
  reason?: string
}

declare global {
  interface Window {
    rift?: RiftBridge
  }
}

export const bridgeAvailable = (): boolean => typeof window !== 'undefined' && Boolean(window.rift?.isDesktop)

export const getEngine = async (): Promise<EngineInfo> => {
  if (!bridgeAvailable()) {
    return { available: false, script: null, reason: 'Browser preview has no local bridge.' }
  }
  try {
    return await window.rift!.engine()
  } catch (error) {
    return { available: false, script: null, reason: error instanceof Error ? error.message : String(error) }
  }
}

export const runEngine = async (
  action: RunAction,
  modules: string[] = [],
  benchSeconds?: number,
): Promise<{ started: boolean; ok?: boolean; reason?: string }> => {
  if (!bridgeAvailable()) return { started: false, reason: 'no-bridge' }
  try {
    return await window.rift!.run(action, modules, benchSeconds)
  } catch (error) {
    return { started: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export const cancelRun = async (): Promise<boolean> => {
  if (!bridgeAvailable()) return false
  try {
    const result = await window.rift!.cancel()
    return Boolean(result?.cancelled)
  } catch {
    return false
  }
}

export const subscribeEngine = (listener: (event: EngineEvent) => void): (() => void) => {
  if (!bridgeAvailable()) return () => {}
  return window.rift!.onEvent(listener)
}

export const getAppVersion = async (): Promise<string> => {
  if (!bridgeAvailable()) return '0.2.0'
  try {
    const info = await window.rift!.version()
    return info.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const checkForUpdate = async (): Promise<UpdateStatus> => {
  if (!bridgeAvailable()) {
    return { state: 'offline', from: '0.0.0', to: '0.0.0', notes: [], url: '', reason: 'no-bridge' }
  }
  try {
    return await window.rift!.checkUpdate()
  } catch (error) {
    return {
      state: 'offline',
      from: '0.0.0',
      to: '0.0.0',
      notes: [],
      url: '',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export const recheckForUpdate = async (): Promise<UpdateStatus> => {
  if (!bridgeAvailable()) return checkForUpdate()
  try {
    return await window.rift!.recheckUpdate()
  } catch {
    return checkForUpdate()
  }
}

export const openUpdatePage = async (): Promise<boolean> => {
  if (!bridgeAvailable()) return false
  try {
    return Boolean(await window.rift!.openUpdatePage())
  } catch {
    return false
  }
}

export const downloadUpdate = async (): Promise<{ started: boolean; reason?: string; name?: string }> => {
  if (!bridgeAvailable()) return { started: false, reason: 'no-bridge' }
  try {
    return await window.rift!.downloadUpdate()
  } catch (error) {
    return { started: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export const revealUpdateDownload = async (): Promise<boolean> => {
  if (!bridgeAvailable()) return false
  try {
    return Boolean(await window.rift!.revealUpdateDownload())
  } catch {
    return false
  }
}

export const subscribeUpdate = (listener: (payload: UpdateStatus) => void): (() => void) => {
  if (!bridgeAvailable()) return () => {}
  return window.rift!.onUpdate(listener)
}

export const subscribeUpdateDownload = (listener: (payload: UpdateDownloadStatus) => void): (() => void) => {
  if (!bridgeAvailable()) return () => {}
  return window.rift!.onUpdateDownload(listener)
}

export const subscribeHardware = (listener: (event: HardwareEvent) => void): (() => void) => {
  if (!bridgeAvailable()) return () => {}
  return window.rift!.onHardware(listener)
}

export const getHardware = async (): Promise<HardwareStatus> => {
  if (!bridgeAvailable()) {
    return {
      available: false,
      script: null,
      name: null,
      intervalMs: 0,
      running: false,
      latest: null,
      reason: 'Browser preview has no local sensor feed.',
    }
  }
  try {
    return await window.rift!.hardware()
  } catch (error) {
    return {
      available: false,
      script: null,
      name: null,
      intervalMs: 0,
      running: false,
      latest: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

const PRESET_ACTION: Record<string, RunAction> = {
  balanced: 'lite',
  competitive: 'max',
  unleashed: 'ultra',
  custom: 'custom',
}

export const actionForPreset = (presetId: string): RunAction => PRESET_ACTION[presetId] ?? 'max'
