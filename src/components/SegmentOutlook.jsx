import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getBand } from '../lib/feeds'
import { LEVELS, levelFor } from '../lib/alert'

// Offshore outlook per beach: a five-level alert on the beach's own ten-year
// scale, modelled biomass in its approach zone, and the last 60 days.
// Everything here describes the water 20-40 km offshore — the nearest the
// satellite product can be trusted. It is not a measurement of the beach.

const W = 520, H = 120, PAD = { l: 34, r: 8, t: 8, b: 18 }

function Chart({ series, base }) {
  const pts = series.filter(s => !s.gap)
  if (pts.length < 2) return <div className="empty"><span className="muted">Not enough clear days to draw a series.</span></div>
  const top = Math.max(Number(base?.p99 ?? 0) * 1.15, ...pts.map(p => p.density), 1)
  const x = (i) => PAD.l + (i / (series.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b)
  const line = series.map((s, i) => (s.gap ? null : `${x(i).toFixed(1)},${y(s.density).toFixed(1)}`))
  // Break the line at coverage gaps rather than drawing across them.
  const runs = []; let cur = []
  line.forEach(p => { if (p) cur.push(p); else if (cur.length) { runs.push(cur); cur = [] } })
  if (cur.length) runs.push(cur)
  const bands = base ? [
    [0, base.p75, LEVELS[0]], [base.p75, base.p90, LEVELS[1]], [base.p90, base.p95, LEVELS[2]],
    [base.p95, base.p99, LEVELS[3]], [base.p99, top, LEVELS[4]],
  ] : []
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 320, display: 'block' }} role="img"
           aria-label="Biomass density in the approach zone over the last 60 days, against this beach's alert levels">
        {bands.map(([lo, hi, l], i) => (
          <rect key={i} x={PAD.l} width={W - PAD.l - PAD.r} y={y(Math.min(hi, top))}
                height={Math.max(0, y(lo) - y(Math.min(hi, top)))} fill={l.hex} opacity=".13" />
        ))}
        {[0, top / 2, top].map((v, i) => (
          <text key={i} x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#9AA6A3">{Math.round(v)}</text>
        ))}
        {runs.map((r, i) => <polyline key={i} points={r.join(' ')} fill="none" stroke="#EAF0EF" strokeWidth="1.6" strokeLinejoin="round" />)}
        <circle cx={x(series.length - 1 - [...series].reverse().findIndex(s => !s.gap))} cy={y(pts[pts.length - 1].density)} r="3" fill="#EAF0EF" />
        <text x={PAD.l} y={H - 4} fontSize="9" fill="#9AA6A3">{series[0].t.slice(0, 10)}</text>
        <text x={W - PAD.r} y={H - 4} fontSize="9" fill="#9AA6A3" textAnchor="end">{series[series.length - 1].t.slice(0, 10)}</text>
      </svg>
    </div>
  )
}

export function SegmentOutlook({ segments }) {
  const [rows, setRows] = useState({})
  const [bases, setBases] = useState({})
  const geo = (segments || []).filter(s => s.lat && s.lng)

  useEffect(() => {
    if (!geo.length) return
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('segment_baselines').select('*').eq('afai_window', '7D')
        .in('segment_id', geo.map(s => s.id))
      if (alive) setBases(Object.fromEntries((data ?? []).map(b => [b.segment_id, b])))
      for (const s of geo) {
        const r = await getBand(s, { days: 60 })
        if (alive) setRows(prev => ({ ...prev, [s.id]: r }))
      }
    })()
    return () => { alive = false }
  }, [geo.map(s => s.id).join(',')])

  if (!geo.length) return null
  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <h2>Offshore outlook <span className="pill" style={{ fontSize: 10 }}>live</span>{' '}
        <span className="pill amber" style={{ fontSize: 10 }}>biomass modelled</span></h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Sargassum in the water 20 to 40 km off each beach, against that beach's own ten-year record.
      </div>
      {geo.map(s => {
        const r = rows[s.id], base = bases[s.id]
        const latest = r?.ok && !r.gap ? r.latest : null
        const lvl = levelFor(latest?.density, base)
        return (
          <div key={s.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b>{s.name}</b>
              {!r ? <span className="muted" style={{ fontSize: 12 }}>reading satellite…</span>
                : !r.ok ? <span className="pill grey">unavailable · {r.reason}</span>
                : r.gap ? <span className="pill grey">no clear read</span>
                : lvl ? <span className={'pill ' + lvl.tone} style={lvl.key === 'extreme' ? { background: lvl.hex, color: '#fff' } : undefined}>{lvl.label}</span>
                : <span className="pill grey">no baseline yet</span>}
              {lvl && <span className="muted" style={{ fontSize: 12 }}>{lvl.means}</span>}
            </div>
            {latest && (
              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', margin: '8px 0 10px' }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{latest.density} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>t/km²</span></div>
                  <div className="muted" style={{ fontSize: 11 }}>biomass density offshore</div>
                </div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(latest.tonnes_low).toLocaleString()}–{Math.round(latest.tonnes_high).toLocaleString()} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>t</span></div>
                  <div className="muted" style={{ fontSize: 11 }}>floating in the zone, not the amount that will land</div>
                </div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{latest.t.slice(0, 10)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>satellite date · {r.window === '7D' ? '7-day field' : r.window + ' field'}</div>
                </div>
              </div>
            )}
            {r?.ok && r.series && <Chart series={r.series} base={base} />}
          </div>
        )
      })}
      <div className="muted" style={{ fontSize: 10.5, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 9 }}>
        Measured 20 to 40 km offshore because the satellite product is unreliable nearer land: coastal water reads bright all
        year whether or not sargassum is present. The last 20 km to the beach is not observed. Levels are each beach's own
        75th, 90th, 95th and 99th percentiles and are not comparable between beaches. Biomass uses the Wang et al. (2018)
        model and is a lower bound. Data: USF AFAI via NOAA CoastWatch–AOML.
      </div>
    </div>
  )
}
