'use strict'

// One command from a clean tree to a published release:
//   npm run release -- 0.2.1
//
// Order matters. The build has to succeed before anything is tagged, and the
// tag has to exist before the release, or the updater feed points at nothing.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const pkgPath = path.join(root, 'package.json')

function run(command, args, label) {
  process.stdout.write(`\n[${label}]\n`)
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

function fail(message) {
  process.stderr.write(`\n${message}\n`)
  process.exit(1)
}

const requested = process.argv[2]
if (!requested || !/^\d+\.\d+\.\d+$/.test(requested)) {
  fail(`usage: npm run release -- <version>\n   example: npm run release -- 0.2.1`)
}

const tag = `v${requested}`
const notesPath = path.join(root, 'CHANGELOG.md')
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

const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
if (dirty.trim()) fail('working tree is not clean. commit or stash first:\n' + dirty)

if (!fs.existsSync(notesPath)) fail(`missing ${notesPath} - the release notes are the changelog the app shows`)

process.stdout.write(`\nR i F T  ${current} -> ${requested}\n`)

pkg.version = requested
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
process.stdout.write(`version bumped to ${requested}\n`)

run('npm', ['run', 'package:win'], 'build and package')
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
execFileSync('gh', ['release', 'create', tag, '--title', `R i F T ${tag}`, '--notes-file', notesPath], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.stdout.write(`\ndone. ${tag} is published.\n`)
process.stdout.write(`installed apps will offer ${current} -> ${requested} on next launch.\n`)