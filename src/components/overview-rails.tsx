// The two rails from the reference layout.
//
// Left rail: the numbers that matter while you play, each with its own
// sparkline so a spike is visible without reading the figure. Right rail:
// what changed in the build, plus the current version.
//
// Both read only from props, so they cannot reach for state of their own.

import type { DeviceStatus } from '../lib/rift-bridge'

// Only the fields the rails actually read. The full BenchResult carries more
// than this, and narrowing here keeps the component honest about its needs.
type RailBench = {
  ok: boolean
  source?: 'device' | 'host'
  fps?: number
  rate?: number
}

// A local copy of the sparkline so this file does not have to reach back into
// the route module. Same geometry and gradient ids as the one over there.
function Sparkline({ points, max, tone }: { points: number[]; max: number; tone: string }) {
  const width = 150
  const height = 34
  const uid = `rail-spk-${tone}`
  const usable = points.filter((point) => point != null) as number[]

  if (usable.length < 2) {
    return <span className="rail-spark-empty" aria-hidden="true" />
  }

  const step = width / (usable.length - 1)
  const coords = usable.map((value, index) => {
    const clamped = Math.max(0, Math.min(max, value || 0))
    const x = index * step
    const y = height - (clamped / max) * height
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const area = `M0,${height} L${coords.join(' L')} L${width},${height} Z`
  const last = coords[coords.length - 1].split(',')
  const gradientId = `fill-${uid}`

  return (
    <svg className="rail-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={`var(--${tone})`} stopOpacity=".3" />
          <stop offset="1" stopColor={`var(--${tone})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <polyline points={coords.join(' ')} fill="none" stroke={`var(--${tone})`} strokeWidth="1.4" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={`var(--${tone})`} />
    </svg>
  )
}

function RailMetric({
  label,
  value,
  unit,
  points,
  tone,
  note,
}: {
  label: string
  value: string | number
  unit?: string
  points: number[]
  tone: string
  note?: string
}) {
  const hasData = points.filter((point) => point != null).length > 1
  const latest = points.length ? points[points.length - 1] : null

  return (
    <div className="rail-metric">
      <div className="rail-metric-head">
        <span className="rail-metric-label">{label}</span>
        {note && <span className="rail-metric-note">{note}</span>}
      </div>
      <div className="rail-metric-value">
        <strong>{value}</strong>
        {unit && <span>{unit}</span>}
      </div>
      {hasData ? (
        <Sparkline points={points} max={100} tone={tone} />
      ) : (
        <span className="rail-metric-empty">collecting</span>
      )}
      <span className="rail-metric-foot">
        {hasData && latest != null ? `now ${Math.round(latest)}%` : 'awaiting samples'}
      </span>
    </div>
  )
}

export function LeftRail(props: {
  history: { cpu: number[]; ram: number[]; gpu: number[] }
  device: DeviceStatus | null
  bench: RailBench | null
  fpsTarget: number
  engineReady: boolean
}) {
  const d = props.device
  const measured = props.bench?.ok
    ? props.bench.source === 'host'
      ? props.bench.rate
      : props.bench.fps
    : null

  return (
    <aside className="overview-rail overview-rail--left" aria-label="Live system readings">
      <div className="rail-fps">
        <div className="rail-fps-pair">
          <span className="rail-fps-label">FPS</span>
          <span className="rail-fps-measured">{measured ?? '—'}</span>
          <span className="rail-fps-label">Target</span>
          <span className="rail-fps-target">{props.fpsTarget}</span>
        </div>
        <div className="rail-fps-bar">
          <i style={{ width: measured != null ? `${Math.min(100, (measured / props.fpsTarget) * 100)}%` : '0%' }} />
        </div>
        <span className="rail-fps-note">
          {measured != null ? 'measured this session' : 'run MEASURE for a real rate'}
        </span>
      </div>

<RailMetric label="CPU USAGE" value={props.history.cpu.at(-1) ?? 0} unit="%" points={props.history.cpu} tone="acid" />
    <RailMetric label="GPU USAGE" value={props.history.gpu.at(-1) ?? 0} unit="%" points={props.history.gpu} tone="rgb-e" />
    <RailMetric label="RAM USAGE" value={props.history.ram.at(-1) ?? 0} unit="%" points={props.history.ram} tone="warning" />

      <div className="rail-device">
        <span className="rail-metric-label">EMULATOR</span>
        <strong>{d?.device ?? 'searching'}</strong>
        <span className={['rail-device-state', d?.online ? 'is-online' : ''].join(' ')}>
          <i />{d?.online ? 'connected' : d ? 'not connected' : 'no bridge'}
        </span>
        {d?.root ? <span className="rail-device-root">root available</span> : null}
      </div>
    </aside>
  )
}

const NEWS = [
  {
    title: 'Game frame target raised',
    body: 'The emulator pipeline measures what it delivers; the game is configured above that on purpose.',
    tag: 'tuning',
  },
  {
    title: 'Every setting is reversible',
    body: 'A baseline is written before anything changes, and restore puts every value back.',
    tag: 'safety',
  },
  {
    title: 'Nothing leaves your machine',
    body: 'Tuning runs locally. Only your sign-in and machine id are ever sent anywhere.',
    tag: 'privacy',
  },
  {
    title: 'One licence, one PC',
    body: 'A hardware fingerprint keeps the install bound to this computer.',
    tag: 'licence',
  },
]

export function RightRail(props: { version: string; moduleCount: number }) {
  return (
    <aside className="overview-rail overview-rail--right" aria-label="Release notes and status">
      <div className="rail-creed">
        <span className="rail-creed-mark" aria-hidden="true">+</span>
        <p>Discipline<br />Builds<br />Freedom.</p>
      </div>

      <section className="rail-news">
        <h2 className="rail-heading">News &amp; Updates</h2>
        <ul>
          {NEWS.map((item) => (
            <li key={item.tag}>
              <span className={`rail-news-tag rail-news-tag--${item.tag}`}>{item.tag}</span>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rail-status">
        <h2 className="rail-heading">Build</h2>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>v{props.version}</dd>
          </div>
          <div>
            <dt>Modules</dt>
            <dd>{String(props.moduleCount).padStart(2, '0')}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>Private</dd>
          </div>
        </dl>
      </section>
    </aside>
  )
}