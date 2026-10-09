const { spawn } = require('node:child_process')
const path = require('node:path')
const electron = require('electron')

const root = path.join(__dirname, '..')

let shuttingDown = false

function run(name, cmd, args) {
  const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
  const tag = `[${name}]`

  const pipe = (stream, out) => {
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) out.write(`${tag} ${line}\n`)
    })
  }

  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)

  child.on('exit', (code) => {
    if (shuttingDown) return
    process.stdout.write(`${tag} exited with ${code}, stopping the other process\n`)
    shutdown(code ?? 0)
  })

  return child
}

let vite
let app

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of [vite, app]) {
    if (c && c.exitCode === null) {
      try {
        if (process.platform === 'win32' && c.pid) {
          spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' })
        } else {
          c.kill('SIGTERM')
        }
      } catch {}
    }
  }
  setTimeout(() => process.exit(code), 400)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// vite has to be listening before electron opens a window against it.
// vite is launched through node directly because npm.cmd is a batch file and
// cannot be spawned without a shell on windows
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

vite = run('vite', process.execPath, [viteBin, 'dev', '--configLoader', 'native'])

setTimeout(() => {
  app = run('electron', electron, ['.'])
}, 2500)