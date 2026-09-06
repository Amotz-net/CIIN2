import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getAfai } from '../../lib/feeds'

// Filterable coast map (SVG, dependency-free). Plots beach segments + orgs by
// coordinate, colours segments by live inundation risk, with type filters.
// `lite` = compact version for the Overview tab.
const TYPES = [
  { key: 'segment',      label: 'Beaches',    color: '#57C4AE' },
  { key: 'hotel',        label: 'Hotels',     color: '#6EA8D6' },
  { key: 'processor',    label: 'Processors', color: '#9B8BD6' },
  { key: 'recovery_hub', label: 'Hubs',       color: '#E0A94F' },
  { key: 'university_lab',label: 'Labs',      color: '#6FC08C' },
]

export function CoastMap({ lite = false }) {
  const [segments, setSegments] = useState([])
  const [orgs, setOrgs] = useState([])
  const [reads, setReads] = useState({})
  const [on, setOn] = useState(() => Object.fromEntries(TYPES.map(t => [t.key, true])))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      const [{ data: seg }, { data: org }] = await Promise.all([
        supabase.from('beach_segments').select('*'),
        supabase.from('organizations').select('id, name, role, country_code'),
      ])
      if (!alive) return
      setSegments(seg ?? []); setOrgs(org ?? []); setLoading(false)
      if (!lite) {
        const r = {}
        for (const s of (seg ?? []).filter(x => x.lat && x.lng)) r[s.id] = await getAfai(s.lat, s.lng)
        if (alive) setReads(r)
      }
    }
    load()
    return () => { alive = false }
  }, [lite])

  if (loading) return <div className="card"><span className="muted">Loading coast map…</span></div>

  // Build points: segments (with coords) + orgs (jittered near segment centroid,
  // since org rows have no coords — placed illustratively by type).
  const segPts = segments.filter(s => s.lat && s.lng)
  if (!segPts.length) return <div className="card"><h2>Coast map</h2><div className="empty"><span className="muted">No geo-located coast segments yet.</span></div></div>

  const lats = segPts.map(s => s.lat), lngs = segPts.map(s => s.lng)
  const minLat = Math.min(...lats) - 0.05, maxLat = Math.max(...lats) + 0.05
  const minLng = Math.min(...lngs) - 0.05, maxLng = Math.max(...lngs) + 0.05
  const W = 640, H = lite ? 180 : 320, PAD = 24
  const x = (lng) => PAD + ((lng - minLng) / (maxLng - minLng || 1)) * (W - 2 * PAD)
  const y = (lat) => PAD + (1 - (lat - minLat) / (maxLat - minLat || 1)) * (H - 2 * PAD)
  const riskColor = (sir) => sir === 'high' ? '#D9736A' : sir === 'medium' ? '#E0A94F' : '#6FC08C'

  // place org markers illustratively around the first segment (no real coords)
  const anchor = segPts[0]
  const orgPts = orgs.filter(o => o.role !== 'government' && o.role !== 'buyer' && o.role !== 'finance')
    .map((o, i) => ({ ...o, lat: anchor.lat + 0.02 * Math.cos(i), lng: anchor.lng + 0.02 * Math.sin(i) }))

  return (
    <div className="card" style={{ gridColumn: lite ? undefined : '1 / -1' }}>
      <h2>Coast map {!lite && <span className="pill" style={{ fontSize: 10 }}>live risk</span>}</h2>
      {!lite && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {TYPES.map(t => (
            <button key={t.key} className={'btn sm ' + (on[t.key] ? '' : 'ghost')}
              style={{ borderColor: t.color, ...(on[t.key] ? { background: t.color, color: '#0c1a17' } : { color: t.color }) }}
              onClick={() => setOn(v => ({ ...v, [t.key]: !v[t.key] }))}>{t.label}</button>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', background: '#1a2024', borderRadius: 8, border: '1px solid var(--line)' }}>
        {/* coastline suggestion */}
        <path d={`M0 ${H*0.7} Q ${W*0.3} ${H*0.5} ${W*0.6} ${H*0.65} T ${W} ${H*0.6}`} fill="none" stroke="#2f3a40" strokeWidth="2" />
        {/* segments */}
        {on.segment && segPts.map(s => {
          const r = reads[s.id]
          const col = r?.ok && !r.gap ? riskColor(r.sir) : '#57C4AE'
          return <g key={s.id}>
            <circle cx={x(s.lng)} cy={y(s.lat)} r={lite ? 4 : 6} fill={col} />
            {!lite && <text x={x(s.lng) + 9} y={y(s.lat) + 4} fill="#9AA6A3" fontSize="10">{s.name}</text>}
          </g>
        })}
        {/* orgs by type */}
        {orgPts.filter(o => on[o.role]).map((o, i) => {
          const t = TYPES.find(t => t.key === o.role)
          return <g key={i}>
            <rect x={x(o.lng) - 4} y={y(o.lat) - 4} width="8" height="8" fill={t?.color || '#888'} rx="1" />
            {!lite && <text x={x(o.lng) + 8} y={y(o.lat) + 3} fill="#9AA6A3" fontSize="9">{o.name}</text>}
          </g>
        })}
      </svg>
      {!lite && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Segments coloured by live inundation risk (green/amber/red). Org markers placed illustratively — precise geolocation attaches when orgs register coordinates.</div>}
    </div>
  )
}
