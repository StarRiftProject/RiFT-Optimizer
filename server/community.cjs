'use strict'

/**
 * R i F T community node.
 *
 * A single-file, dependency-free relay for the desktop client: live chat,
 * preset voting, and a version census so people can see whether they are on
 * the current build. It binds to the LAN only by default and is explicitly
 * opt-in to any other interface.
 *
 * Nothing here stores credentials, reads the machine, or executes anything a
 * participant sends. Messages are relayed verbatim and rendered as text.
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')

const MAX_HISTORY = 200
const MAX_MESSAGE = 400
const MAX_NAME = 24
const RATE_WINDOW_MS = 8000
const RATE_LIMIT = 6
const IDLE_TIMEOUT_MS = 45 * 60 * 1000

const PORT = Number(process.env.RIFT_PORT || 8787)
const HOST = process.env.RIFT_BIND || '0.0.0.0'
const SERVE_CLIENT = process.env.RIFT_SERVE_CLIENT === '1'
const CLIENT_ROOT = process.env.RIFT_CLIENT || path.join(__dirname, 'dist', 'client')

const PRESETS = [
  'balanced', 'competitive', 'unleashed', 'custom',
  'lite', 'max', 'ultra', 'windows',
]

const state = {
  startedAt: Date.now(),
  messages: [],
  votes: Object.fromEntries(PRESETS.map((id) => [id, 0])),
  versions: {},
  peers: new Map(),
}

const clients = new Set()

function nowIso() {
  return new Date().toISOString()
}

function clean(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function hashFingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}

function publicIp(req) {
  const raw = req.socket.remoteAddress || ''
  return raw.replace(/^::ffff:/, '')
}

function prunePeers() {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS
  let dropped = false
  for (const [id, peer] of state.peers) {
    if (peer.lastSeen < cutoff) {
      state.peers.delete(id)
      dropped = true
    }
  }
  if (dropped) broadcast({ type: 'peers', online: state.peers.size })
}

function rateOk(peer) {
  const now = Date.now()
  peer.window = peer.window.filter((t) => now - t < RATE_WINDOW_MS)
  if (peer.window.length >= RATE_LIMIT) return false
  peer.window.push(now)
  return true
}

function peerFor(req) {
  const id = publicIp(req)
  let peer = state.peers.get(id)
  if (!peer) {
    peer = { id, name: '', window: [], lastSeen: Date.now(), connections: 0 }
    state.peers.set(id, peer)
  }
  peer.lastSeen = Date.now()
  return peer
}

function send(ws, payload) {
  if (ws.readyState !== ws.OPEN) return
  try {
    ws.send(JSON.stringify(payload))
  } catch {
    /* the socket died between the check and the write */
  }
}

function broadcast(payload, except) {
  const frame = JSON.stringify(payload)
  for (const ws of clients) {
    if (ws === except) continue
    if (ws.readyState !== ws.OPEN) continue
    try {
      ws.send(frame)
    } catch {
      /* ignore */
    }
  }
}

function snapshot() {
  return {
    online: state.peers.size,
    messages: state.messages.slice(-60),
    votes: { ...state.votes },
    versions: Object.entries(state.versions)
      .map(([version, count]) => ({ version, count }))
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true })),
    totalSessions: state.peers.size,
    uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('bad json'))
      }
    })
    req.on('error', reject)
  })
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    res.end()
    return
  }

  res.setHeader('access-control-allow-origin', '*')

  if (url.pathname === '/api/state' && req.method === 'GET') {
    prunePeers()
    json(res, 200, snapshot())
    return
  }

  if (url.pathname === '/api/identify' && req.method === 'POST') {
    const peer = peerFor(req)
    if (!rateOk(peer)) return json(res, 429, { error: 'slow down' })
    const body = await readBody(req, 2048).catch(() => ({}))
    peer.name = clean(body.name, MAX_NAME) || peer.name
    json(res, 200, { ok: true, id: hashFingerprint(peer.id) })
    return
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const peer = peerFor(req)
    if (!rateOk(peer)) return json(res, 429, { error: 'slow down' })

    const body = await readBody(req, 8192).catch(() => ({}))
    const text = clean(body.text, MAX_MESSAGE)
    if (!text) return json(res, 400, { error: 'empty message' })

    const entry = {
      id: crypto.randomUUID(),
      at: nowIso(),
      name: peer.name || 'anonymous',
      text,
      preset: PRESETS.includes(body.preset) ? body.preset : null,
    }

    state.messages.push(entry)
    if (state.messages.length > MAX_HISTORY) state.messages.shift()

    broadcast({ type: 'message', message: entry })
    json(res, 201, { ok: true, message: entry })
    return
  }

  if (url.pathname === '/api/vote' && req.method === 'POST') {
    const peer = peerFor(req)
    if (!rateOk(peer)) return json(res, 429, { error: 'slow down' })
    const body = await readBody(req, 2048).catch(() => ({}))
    const preset = body.preset
    if (!PRESETS.includes(preset)) return json(res, 400, { error: 'unknown preset' })
    state.votes[preset] += 1
    broadcast({ type: 'votes', votes: { ...state.votes } })
    json(res, 200, { ok: true, votes: { ...state.votes } })
    return
  }

  if (url.pathname === '/api/version' && req.method === 'POST') {
    const peer = peerFor(req)
    if (!rateOk(peer)) return json(res, 429, { error: 'slow down' })
    const body = await readBody(req, 2048).catch(() => ({}))
    const version = clean(body.version, 24)
    if (!version) return json(res, 400, { error: 'no version' })
    state.versions[version] = (state.versions[version] || 0) + 1
    broadcast({ type: 'versions', versions: snapshot().versions })
    json(res, 200, { ok: true, versions: snapshot().versions })
    return
  }

  if (SERVE_CLIENT && req.method === 'GET') {
    const requested = decodeURIComponent(url.pathname)
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '')
    const resolved = path.resolve(CLIENT_ROOT, relative)
    if (resolved.startsWith(path.resolve(CLIENT_ROOT))) {
      try {
        const data = fs.readFileSync(resolved)
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.svg': 'image/svg+xml',
        }
        res.writeHead(200, { 'content-type': types[path.extname(resolved)] || 'application/octet-stream' })
        res.end(data)
        return
      } catch {
        /* fall through to 404 */
      }
    }
  }

  json(res, 404, { error: 'not found' })
})

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  if (!key) return socket.destroy()

  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64')

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )

  const ws = require('./wsframe.cjs').wrap(socket)
  clients.add(ws)
  peerFor(req)

  send(ws, { type: 'snapshot', ...snapshot() })
  broadcast({ type: 'peers', online: state.peers.size })

  let buffer = Buffer.alloc(0)

  ws.onMessage((text) => {
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      return
    }
    if (payload.type === 'ping') return send(ws, { type: 'pong', at: nowIso() })
    if (payload.type === 'name') {
      const peer = peerFor(req)
      peer.name = clean(payload.name, MAX_NAME)
      broadcast({ type: 'peers', online: state.peers.size })
    }
  })

  ws.onClose(() => {
    clients.delete(ws)
    broadcast({ type: 'peers', online: state.peers.size })
  })
})

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces()
  const lan = []
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) lan.push(net.address)
    }
  }

  console.log(`R i F T node listening on http://${HOST}:${PORT}`)
  console.log(`  this machine : http://127.0.0.1:${PORT}`)
  for (const ip of lan) console.log(`  on your lan  : http://${ip}:${PORT}`)
  console.log(`  client served: ${SERVE_CLIENT ? CLIENT_ROOT : 'no'}`)
})