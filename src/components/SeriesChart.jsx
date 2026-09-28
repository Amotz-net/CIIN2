import { useEffect, useMemo, useRef, useState } from 'react'

// Interactive daily series: hover to read a day, click a statistic to draw it,
// play to watch the period build up. Gaps in the data break the line rather
// than being drawn through: an absent day is not a zero.

const W = 780, H = 210, P = { l: 48, r: 10, t: 10, b: 22 }

export function stats(rows, key = 't') {
  const v = rows.map(r => r[key]).filter(n => Number.isFinite(n))
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b), n = v.length
  const q = p => { const i = (n - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
  const mean = v.reduce((a, b) => a + b, 0) / n
  // least-squares trend; reported per 30 days
  const xm = (n - 1) / 2
  let num = 0, den = 0; v.forEach((y, i) => { num += (i - xm) * (y - mean); den += (i - xm) ** 2 })
  const slope = den ? num / den : 0
  const at = val => rows.find(r => r[key] === val)?.d
  return { n, mean, median: q(0.5), p90: q(0.9), max: s[n - 1], maxDate: at(s[n - 1]), min: s[0], minDate: at(s[0]),
           slope, intercept: mean - slope * xm }
}

const short = n => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n))
const full = n => Math.round(n).toLocaleString()
const nice = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const BAND = ['#6FC08C', '#57C4AE', '#E0A94F', '#D9736A', '#C2453B']

export function SeriesChart({ rows, color = '#57C4AE', second = null, bands = null, unit = 't', label }) {
  const [hover, setHover] = useState(null)
  const [shown, setShown] = useState({})          // which statistics are drawn
  const [upTo, setUpTo] = useState(null)          // play head; null = whole series
  const [playing, setPlaying] = useState(false)
  const svg = useRef(null)
  const st = useMemo(() => stats(rows || []), [rows])

  useEffect(() => { setHover(null); setUpTo(null); setPlaying(false) }, [rows])
  useEffect(() => {
    if (!playing) return
    const step = Math.max(1, Math.round(rows.length / 120))
    const id = setInterval(() => setUpTo(u => {
      const next = (u ?? 0) + step
      if (next >= rows.length - 1) { setPlaying(false); return null }
      return next
    }), 40)
    return () => clearInterval(id)
  }, [playing, rows])

  if (!rows?.length || !st) return <div className="empty"><span className="muted">No series to draw.</span></div>
  const end = upTo ?? rows.length - 1
  const top = Math.max(st.max, bands ? bands[bands.length - 1] * 1.05 : 0) * 1.06 || 1
  const x = i => P.l + (rows.length === 1 ? 0 : (i / (rows.length - 1)) * (W - P.l - P.r))
  const y = v => P.t + (1 - Math.max(0, v) / top) * (H - P.t - P.b)
  const runs = key => {
    const out = []; let cur = []
    rows.slice(0, end + 1).forEach((r, i) => {
      if (Number.isFinite(r[key])) cur.push(`${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`)
      else if (cur.length) { out.push(cur); cur = [] }
    })
    if (cur.length) out.push(cur)
    return out
  }
  const at = hover ?? end, row = rows[at], prev = rows[at - 1]
  const delta = row && prev && prev.t ? ((row.t - prev.t) / prev.t) * 100 : null
  const ticks = rows.map((r, i) => [r.d, i]).filter(([d]) => d.slice(8) === '01' || (rows.length <= 70 && d.slice(8) === '15'))
  const move = e => {
    const b = svg.current.getBoundingClientRect()
    const px = ((e.clientX - b.left) / b.width) * W
    const i = Math.round(((px - P.l) / (W - P.l - P.r)) * (rows.length - 1))
    setHover(Math.max(0, Math.min(rows.length - 1, i)))
  }
  const STATS = [
    ['mean', 'Mean', st.mean], ['median', 'Median', st.median], ['max', 'Maximum', st.max, st.maxDate],
    ['min', 'Minimum', st.min, st.minDate], ['p90', 'P90', st.p90], ['trend', 'Trend', st.slope * 30],
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {row ? full(row.t) : '—'} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{unit}</span></div>
        {delta != null && <span style={{ fontSize: 12.5, color: delta >= 0 ? 'var(--red)' : 'var(--green)' }}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs previous day</span>}
        <span className="muted" style={{ fontSize: 12.5 }}>{row ? nice(row.d) : ''}{label ? ' · ' + label : ''}</span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => { if (playing) { setPlaying(false); setUpTo(null) } else { setUpTo(0); setPlaying(true) } }}>
          {playing ? '■ Stop' : '▶ Play'}</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 440, display: 'block', cursor: 'crosshair' }}
             onMouseMove={move} onMouseLeave={() => setHover(null)} role="img" aria-label="Daily wet sargassum biomass">
          {bands && [0, ...bands].map((lo, i) => {
            const hi = i < bands.length ? bands[i] : top
            return <rect key={i} x={P.l} width={W - P.l - P.r} y={y(Math.min(hi, top))}
                         height={Math.max(0, y(lo) - y(Math.min(hi, top)))} fill={BAND[i]} opacity=".12" />
          })}
          {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}>
            <line x1={P.l} x2={W - P.r} y1={y(top * f)} y2={y(top * f)} stroke="#3C454E" strokeWidth=".6" />
            <text x={P.l - 6} y={y(top * f) + 3} textAnchor="end" fontSize="9.5" fill="#9AA6A3">{short(top * f)}</text></g>)}
          {second && runs(second).map((r, i) => <polyline key={'s' + i} points={r.join(' ')} fill="none" stroke="#9AA6A3" strokeWidth=".8" opacity=".6" />)}
          {runs('t').map((r, i) => <polyline key={i} points={r.join(' ')} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />)}
          {STATS.filter(([k]) => shown[k]).map(([k, name, v]) => k === 'trend'
            ? <line key={k} x1={x(0)} x2={x(rows.length - 1)} y1={y(st.intercept)} y2={y(st.intercept + st.slope * (rows.length - 1))} stroke="#E58FC0" strokeWidth="1.4" />
            : <g key={k}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#E0A94F" strokeWidth="1" strokeDasharray="5 4" />
                <text x={W - P.r - 4} y={y(v) - 4} textAnchor="end" fontSize="9.5" fill="#E0A94F">{name}</text></g>)}
          {row && Number.isFinite(row.t) && <g>
            <line x1={x(at)} x2={x(at)} y1={P.t} y2={H - P.b} stroke="#EAF0EF" strokeWidth=".7" opacity=".5" />
            <circle cx={x(at)} cy={y(row.t)} r="3.6" fill="#EAF0EF" /></g>}
          {ticks.map(([d, i]) => <text key={d} x={x(i)} y={H - 6} fontSize="9.5" fill="#9AA6A3" textAnchor="middle">
            {new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</text>)}
        </svg>
      </div>

      <div className="statstrip">
        {STATS.map(([k, name, v, when]) => (
          <button key={k} className={'stat' + (shown[k] ? ' on' : '')} onClick={() => setShown(s => ({ ...s, [k]: !s[k] }))}>
            <span className="stat-k">{name}</span>
            <span className="stat-v" style={k === 'trend' ? { color: '#E58FC0' } : undefined}>
              {(k === 'trend' && v >= 0 ? '+' : '') + full(v) + ' ' + unit}</span>
            <span className="stat-s">{k === 'trend' ? 'per 30 days' : when || ' '}</span>
          </button>
        ))}
        <div className="stat" style={{ cursor: 'default' }}>
          <span className="stat-k">Days with data</span><span className="stat-v">{st.n}</span>
          <span className="stat-s">{rows[0].d} to {rows[rows.length - 1].d}</span>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Move over the chart to read any day. Click a statistic to draw it.</div>
    </div>
  )
}
