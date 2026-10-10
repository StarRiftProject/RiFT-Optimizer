'use strict'

// One command from a clean tree to a published release:
//   npm run release -- 0.2.1
//
// Order matters. The build has to succeed before anything is tagged, and the
// tag has to exist before the release, or the updater feed points at nothing.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.join(__dirname, '..')
const pkgPath = path.join(root, 'package.json')

function run(command, args, label) {
  process.stdout.write(`\n[${label}]\n`)
  const gitArgs = command === 'git' ? ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, ...args] : args
  const useShell = process.platform === 'win32' && command === 'npm'
  execFileSync(command, gitArgs, { cwd: root, stdio: 'inherit', shell: useShell })
}

function fail(message) {
  process.stderr.write(`\n${message}\n`)
  process.exit(1)
}

function releaseNotesFor(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => {
    const match = line.match(/^##\s+v?(\d+\.\d+\.\d+)\s*$/i)
    return match?.[1] === version
  })
  if (start < 0) fail(`missing a ## ${version} section in CHANGELOG.md`)

  const nextSection = lines.findIndex((line, index) => index > start && /^##\s+/.test(line))
  const notes = lines.slice(start + 1, nextSection < 0 ? lines.length : nextSection).join('\n').trim()
  if (!notes) fail(`the ## ${version} section in CHANGELOG.md is empty`)
  return notes
}

const requested = process.argv[2]
if (!requested || !/^\d+\.\d+\.\d+$/.test(requested)) {
  fail(`usage: npm run release -- <version>\n   example: npm run release -- 0.2.2`)
}

const tag = `v${requested}`
const notesPath = path.join(root, 'CHANGELOG.md')
const lockPath = path.join(root, 'package-lock.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const current = pkg.version

if (requested === current) fail(`version ${requested} is already the installed version`)
if (compare(requested, current) <= 0) {
  fail(`version must increase: ${current} -> ${requested}`)
}

function compare(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1
  }
  return 0
}

const dirty = execFileSync(
  'git',
  ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, 'status', '--porcelain'],
  { cwd: root, encoding: 'utf8' },
)
if (dirty.trim()) fail('working tree is not clean. commit or stash first:\n' + dirty)

if (!fs.existsSync(notesPath)) fail(`missing ${notesPath} - the release notes are the changelog the app shows`)
const releaseNotes = releaseNotesFor(fs.readFileSync(notesPath, 'utf8'), requested)

process.stdout.write(`\nR i F T  ${current} -> ${requested}\n`)

pkg.version = requested
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
lock.version = requested
if (lock.packages?.['']) lock.packages[''].version = requested
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
process.stdout.write(`version bumped to ${requested}\n`)

run('npm', ['run', 'package:release'], 'build and package the Windows update')
const updateAsset = path.join(root, 'release', `R-i-F-T-${requested}-win-x64.zip`)
if (!fs.existsSync(updateAsset)) {
  fail(`missing ${updateAsset} - the Windows update asset was not created`)
}
run('git', ['add', 'package.json', 'package-lock.json'], 'stage version bump')
run(
  'git',
  ['-c', 'user.name=NEXUSxINFINITY', '-c', 'user.email=loverboydemcheese@gmail.com', 'commit', '-m', `release ${tag}`],
  'commit version bump',
)
run('git', ['tag', '-a', tag, '-m', `R i F T ${tag}`], 'tag')
run('git', ['push', 'origin', 'main'], 'push main')
run('git', ['push', 'origin', tag], 'push tag')

process.stdout.write(`\npublishing release ${tag} from CHANGELOG.md ...\n`)
const releaseNotesPath = path.join(os.tmpdir(), `rift-release-${requested}-${process.pid}.md`)
fs.writeFileSync(releaseNotesPath, `${releaseNotes}\n`, 'utf8')
try {
  execFileSync(
    'gh',
    ['release', 'create', tag, '--title', `R i F T ${tag}`, '--notes-file', releaseNotesPath, updateAsset],
    {
      cwd: root,
      stdio: 'inherit',
    },
  )
} finally {
  fs.rmSync(releaseNotesPath, { force: true })
}

process.stdout.write(`\ndone. ${tag} is published.\n`)
process.stdout.write(`installed apps will offer ${current} -> ${requested} on next launch.\n`)
