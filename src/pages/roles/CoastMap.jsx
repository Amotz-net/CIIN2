import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getAfai } from '../../lib/feeds'

// Production Coast Map — Leaflet + OSM, styled to match the command-center map:
// dark theme, floating layer panel (on-map toggles w/ swatches), legend, dark
// popups. Segments at real coords coloured by live inundation risk; orgs at
// approximate positions, clearly labelled. `lite` = compact (no panel/legend).

const TYPES = [
  { key: 'segment',        label: 'Beaches',    color: '#57C4AE' },
  { key: 'hotel',          label: 'Hotels',     color: '#6EA8D6' },
  { key: 'processor',      label: 'Processors', color: '#9B8BD6' },
  { key: 'recovery_hub',   label: 'Hubs',       color: '#E0A94F' },
  { key: 'university_lab', label: 'Labs',       color: '#6FC08C' },
]
const RISK = { high: '#D9736A', medium: '#E0A94F', low: '#6FC08C' }
const riskColor = (sir) => RISK[sir] || '#57C4AE'

let _leaflet = null
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (_leaflet) return _leaflet
  _leaflet = new Promise((res, rej) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    js.onload = () => res(window.L); js.onerror = () => rej(new Error('leaflet cdn'))
    document.head.appendChild(js)
  })
  return _leaflet
}

export function CoastMap({ lite = false }) {
  const mapEl = useRef(null), mapRef = useRef(null), layerRef = useRef(null)
  const [segments, setSegments] = useState([])
  const [orgs, setOrgs] = useState([])
  const [reads, setReads] = useState({})
  const [on, setOn] = useState(() => Object.fromEntries(TYPES.map(t => [t.key, true])))
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [{ data: seg }, { data: org }] = await Promise.all([
        supabase.from('beach_segments').select('*'),
        supabase.from('organizations').select('id, name, role, country_code'),
      ])
      if (!alive) return
      setSegments(seg ?? []); setOrgs(org ?? [])
      const wc = (seg ?? []).filter(s => s.lat && s.lng)
      if (wc.length) { const r = {}; for (const s of wc) r[s.id] = await getAfai(s.lat, s.lng); if (alive) setReads(r) }
      if (alive) setStatus('data')
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (status !== 'data') return
    const segPts = segments.filter(s => s.lat && s.lng)
    if (!segPts.length) { setStatus('nogeo'); return }
    let cancelled = false
    loadLeaflet().then(L => {
      if (cancelled || !mapEl.current) return
      if (!mapRef.current) {
        const c = [segPts.reduce((a, s) => a + s.lat, 0) / segPts.length, segPts.reduce((a, s) => a + s.lng, 0) / segPts.length]
        mapRef.current = L.map(mapEl.current, { zoomControl: !lite, attributionControl: true, scrollWheelZoom: !lite }).setView(c, 11)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(mapRef.current)
      }
      if (layerRef.current) layerRef.current.remove()
      layerRef.current = L.layerGroup().addTo(mapRef.current)

      if (on.segment) segPts.forEach(s => {
        const r = reads[s.id]; const col = r?.ok && !r.gap ? riskColor(r.sir) : '#57C4AE'
        L.circleMarker([s.lat, s.lng], { radius: lite ? 6 : 9, color: col, fillColor: col, fillOpacity: .85, weight: 2 })
          .addTo(layerRef.current)
          .bindPopup(`<b>${s.name}</b><br/>${r?.ok && !r.gap ? 'Inundation risk: <b style="color:${col}">' + r.sir + '</b>' : 'awaiting live read'}`)
      })
      const anchor = segPts[0]
      orgs.filter(o => ['hotel','processor','recovery_hub','university_lab'].includes(o.role) && on[o.role]).forEach((o, i) => {
        const lat = anchor.lat + 0.015 * Math.cos(i * 1.7), lng = anchor.lng + 0.015 * Math.sin(i * 1.7)
        const t = TYPES.find(t => t.key === o.role)
        L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<div style="width:13px;height:13px;background:${t?.color};border:2px solid #141a1f;border-radius:3px;box-shadow:0 0 0 1px ${t?.color}55"></div>`, iconSize: [13,13] }) })
          .addTo(layerRef.current).bindPopup(`<b>${o.name}</b><br/>${t?.label} · <span style="color:#9AA6A3">approx location</span>`)
      })
      setStatus('ready')
    }).catch(() => setStatus('cdnfail'))
    return () => { cancelled = true }
  }, [status, segments, orgs, reads, on, lite])

  const toggle = (k) => setOn(v => ({ ...v, [k]: !v[k] }))

  return (
    <div className="card" style={{ gridColumn: lite ? undefined : '1 / -1' }}>
      <h2>Coast map {!lite && <span className="pill" style={{ fontSize: 10 }}>live risk</span>}</h2>
      <div style={{ position: 'relative' }}>
        {status === 'nogeo' ? <div className="empty"><span className="muted">No geo-located coast segments yet.</span></div>
         : status === 'cdnfail' ? <div className="empty"><span className="muted">Map tiles unavailable (offline). Segment data is shown in the other panels.</span></div>
         : <div ref={mapEl} className="coastmap" style={{ height: lite ? 200 : 420 }} />}

        {/* floating layer panel (command-center style) */}
        {!lite && status === 'ready' && (
          <div className="mappanel">
            <div className="mph">Layers</div>
            {TYPES.map(t => (
              <button key={t.key} className={'lyrbtn' + (on[t.key] ? '' : ' off')} onClick={() => toggle(t.key)}>
                <span className="chk">{on[t.key] ? '✓' : ''}</span>
                <span className="sw" style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        )}
        {/* legend */}
        {!lite && status === 'ready' && (
          <div className="maplegend">
            <div><span className="sw" style={{ background: RISK.high }} /> High risk</div>
            <div><span className="sw" style={{ background: RISK.medium }} /> Medium</div>
            <div><span className="sw" style={{ background: RISK.low }} /> Low</div>
          </div>
        )}
      </div>
      {!lite && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Beaches at real coordinates, coloured by live inundation risk. Org markers approximate. © OpenStreetMap contributors.</div>}
    </div>
  )
}
