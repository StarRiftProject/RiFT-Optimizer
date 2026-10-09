'use strict'

const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const { createServer } = require('node:http')
const { Readable } = require('node:stream')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { engineInfo, runEngine, killActiveRun, startWatch, stopWatch } = require('./engine.cjs')
const { sensorsInfo, sensorsStatus, startSensors, stopSensors, onHardware } = require('./hardware.cjs')
const updater = require('./updater.cjs')

const APP_ID = 'com.rift.alliance'
const DEV_PORT = 4317
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

let mainWindow
let devServerProcess
let packagedServer

function appIcon() {
  const fsSync = require('node:fs')
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(process.resourcesPath || '', 'build', 'icon.png'),
  ]
  return candidates.find((candidate) => candidate && fsSync.existsSync(candidate)) || undefined
}

app.enableSandbox()
app.setAppUserModelId(APP_ID)

const ownsAppLock = app.requestSingleInstanceLock()

if (!ownsAppLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(openRift).catch((error) => {
    const detail = error instanceof Error ? error.stack || error.message : String(error)
    console.error('R i F T startup failed:', detail)
    dialog.showErrorBox('R i F T could not open', detail)
    app.quit()
  })

  app.on('before-quit', () => {
    killActiveRun()
    stopWatch()
    stopSensors()
    devServerProcess?.kill()
    packagedServer?.close()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

async function openRift() {
  const appUrl = app.isPackaged ? await startPackagedServer() : await startDevelopmentServer()

  mainWindow = new BrowserWindow({
    title: 'R i F T — In alliance with AL',
    icon: appIcon(),
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#080a08',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow.removeMenu()
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, destination) => {
    if (new URL(destination).origin !== new URL(appUrl).origin) event.preventDefault()
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  registerBridgeHandlers()
  await mainWindow.loadURL(appUrl)
}

function registerBridgeHandlers() {
  updater.register()
  const hwid = require('./hwid.cjs')
  ipcMain.handle('rift:hwid', () => hwid.resolve())
  ipcMain.handle('rift:engine', () => engineInfo())

  ipcMain.handle('rift:hardware', async () => {
    const info = sensorsInfo()
    if (info.available && !info.running) startSensors()
    return sensorsStatus()
  })

  ipcMain.handle('rift:hardware-start', () => startSensors())
  ipcMain.handle('rift:hardware-stop', () => stopSensors())

  onHardware((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rift:hardware', payload)
  })

  // keeps a permanent eye out for emulator-5554 and pushes the state to the
  // ui whenever it changes, so the app never waits on a manual refresh
  startWatch((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rift:event', payload)
  })

  ipcMain.handle('rift:run', async (_event, action, modules, benchSeconds) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { started: false, reason: 'no-window' }
    }
    const send = (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rift:event', payload)
    }
    try {
      return await runEngine(action, modules, send, benchSeconds)
    } catch (error) {
      send({ e: 'fatal', m: error instanceof Error ? error.message : String(error) })
      return { started: false, reason: 'rejected' }
    }
  })

  ipcMain.handle('rift:cancel', () => ({ cancelled: killActiveRun() }))

  // the popup only ever appears on its own once, a few seconds after launch,
  // and it never blocks or replaces whatever the user is doing
  if (app.isPackaged) {
    setTimeout(async () => {
      const result = await updater.check()
      if (result.state !== 'available') return
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send('rift:update', result)
    }, 6000)
  }
}

async function startDevelopmentServer() {
  const projectDir = path.resolve(__dirname, '..')
  const viteBin = path.join(projectDir, 'node_modules', 'vite', 'bin', 'vite.js')
  const appUrl = `http://127.0.0.1:${DEV_PORT}/`

  devServerProcess = spawn('node', [viteBin, 'dev', '--configLoader', 'native', '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort'], {
    cwd: projectDir,
    windowsHide: true,
    stdio: 'ignore',
  })

  return waitForServer(appUrl, devServerProcess)
}

async function startPackagedServer() {
  const appRoot = app.getAppPath()
  const clientRoot = path.join(appRoot, 'dist', 'client')
  const serverEntry = path.join(appRoot, 'dist', 'server', 'server.js')
  const serverModule = await import(pathToFileURL(serverEntry).href)
  const fetchHandler = serverModule.default?.fetch

  if (typeof fetchHandler !== 'function') {
    throw new Error('The packaged R i F T interface server is missing its request handler.')
  }

  packagedServer = createServer(async (incoming, outgoing) => {
    try {
      const requestUrl = new URL(incoming.url || '/', 'http://127.0.0.1')
      const staticResponse = await serveStaticFile(clientRoot, requestUrl.pathname, incoming.method === 'HEAD')
      if (staticResponse) {
        outgoing.writeHead(staticResponse.status, staticResponse.headers)
        outgoing.end(staticResponse.body)
        return
      }

      const method = incoming.method || 'GET'
      const init = { method, headers: incoming.headers }
      if (method !== 'GET' && method !== 'HEAD') init.body = Readable.toWeb(incoming)
      const response = await fetchHandler(new Request(requestUrl, init))
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      if (!response.body || method === 'HEAD') {
        outgoing.end()
      } else {
        Readable.fromWeb(response.body).pipe(outgoing)
      }
    } catch (error) {
      outgoing.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      outgoing.end('R i F T could not render this screen.')
      console.error('R i F T local server error:', error)
    }
  })

  const port = await listenOnLoopback(packagedServer)
  const appUrl = `http://127.0.0.1:${port}/`
  await waitForServer(appUrl)
  return appUrl
}

async function serveStaticFile(clientRoot, pathname, isHeadRequest) {
  let decodedPath
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const relativePath = decodedPath.replace(/^\/+/, '')
  if (!relativePath || relativePath.includes('\0')) return null

  const root = path.resolve(clientRoot)
  const candidate = path.resolve(root, relativePath)
  if (!candidate.startsWith(`${root}${path.sep}`)) return null

  try {
    const stat = await fs.stat(candidate)
    if (!stat.isFile()) return null
    const headers = {
      'content-type': MIME_TYPES[path.extname(candidate).toLowerCase()] || 'application/octet-stream',
      'content-length': String(stat.size),
      'cache-control': pathname.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    }
    return { status: 200, headers, body: isHeadRequest ? undefined : await fs.readFile(candidate) }
  } catch {
    return null
  }
}

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address().port)
    })
  })
}

async function waitForServer(url, childProcess) {
  const deadline = Date.now() + 20000
  let lastError

  while (Date.now() < deadline) {
    if (childProcess?.exitCode !== null && childProcess?.exitCode !== undefined) {
      throw new Error('The local interface server stopped before R i F T opened.')
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200) })
      if (response.ok) {
        await response.body?.cancel()
        return url
      }
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`R i F T could not start its local interface. ${lastError instanceof Error ? lastError.message : ''}`.trim())
}
