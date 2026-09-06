import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getAfai } from '../../lib/feeds'

// Real Leaflet + OpenStreetMap coast map (CDN-loaded, no API key, no build dep).
// Segments plot at their real coordinates, coloured by live inundation risk.
// Orgs (no coords in schema) plot at approximate positions near a segment,
// clearly labelled "approx". `lite` = compact map for the Overview tab.

const TYPES = [
  { key: 'segment',       label: 'Beaches',    color: '#57C4AE' },
  { key: 'hotel',         label: 'Hotels',     color: '#6EA8D6' },
  { key: 'processor',     label: 'Processors', color: '#9B8BD6' },
  { key: 'recovery_hub',  label: 'Hubs',       color: '#E0A94F' },
  { key: 'university_lab',label: 'Labs',       color: '#6FC08C' },
]
const riskColor = (sir) => sir === 'high' ? '#D9736A' : sir === 'medium' ? '#E0A94F' : '#6FC08C'

// Load Leaflet from CDN once (CSS + JS), resolve when window.L is ready.
let _leafletPromise = null
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (_leafletPromise) return _leafletPromise
  _leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    js.onload = () => resolve(window.L)
    js.onerror = () => reject(new Error('Leaflet failed to load'))
    document.head.appendChild(js)
  })
  return _leafletPromise
}

export function CoastMap({ lite = false }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const [segments, setSegments] = useState([])
  const [orgs, setOrgs] = useState([])
  const [reads, setReads] = useState({})
  const [on, setOn] = useState(() => Object.fromEntries(TYPES.map(t => [t.key, true])))
  const [status, setStatus] = useState('loading')

  // fetch data
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [{ data: seg }, { data: org }] = await Promise.all([
        supabase.from('beach_segments').select('*'),
        supabase.from('organizations').select('id, name, role, country_code'),
      ])
      if (!alive) return
      setSegments(seg ?? []); setOrgs(org ?? [])
      const withCoords = (seg ?? []).filter(s => s.lat && s.lng)
      if (!lite && withCoords.length) {
        const r = {}
        for (const s of withCoords) r[s.id] = await getAfai(s.lat, s.lng)
        if (alive) setReads(r)
      }
      if (alive) setStatus('data')
    })()
    return () => { alive = false }
  }, [lite])

  // init map + draw markers whenever data/filters change
  useEffect(() => {
    if (status !== 'data') return
    const segPts = segments.filter(s => s.lat && s.lng)
    if (!segPts.length) { setStatus('nogeo'); return }
    let cancelled = false
    loadLeaflet().then(L => {
      if (cancelled || !mapEl.current) return
      // init once
      if (!mapRef.current) {
        const c = [segPts.reduce((a, s) => a + s.lat, 0) / segPts.length,
                   segPts.reduce((a, s) => a + s.lng, 0) / segPts.length]
        mapRef.current = L.map(mapEl.current, { zoomControl: !lite, attributionControl: true, scrollWheelZoom: !lite }).setView(c, 11)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(mapRef.current)
      }
      // redraw markers
      if (layerRef.current) layerRef.current.remove()
      layerRef.current = L.layerGroup().addTo(mapRef.current)

      if (on.segment) segPts.forEach(s => {
        const r = reads[s.id]
        const col = r?.ok && !r.gap ? riskColor(r.sir) : '#57C4AE'
        L.circleMarker([s.lat, s.lng], { radius: lite ? 6 : 9, color: col, fillColor: col, fillOpacity: 0.8, weight: 2 })
          .addTo(layerRef.current)
          .bindPopup(`<b>${s.name}</b><br/>${r?.ok && !r.gap ? 'Inundation risk: ' + r.sir : 'awaiting live read'}`)
      })

      // orgs — approximate positions near the first segment (no real coords)
      const anchor = segPts[0]
      orgs.filter(o => ['hotel','processor','recovery_hub','university_lab'].includes(o.role) && on[o.role])
        .forEach((o, i) => {
          const lat = anchor.lat + 0.015 * Math.cos(i * 1.7)
          const lng = anchor.lng + 0.015 * Math.sin(i * 1.7)
          const t = TYPES.find(t => t.key === o.role)
          L.marker([lat, lng], {
            icon: L.divIcon({ className: '', html: `<div style="width:12px;height:12px;background:${t?.color||'#888'};border:2px solid #1a2024;border-radius:2px"></div>`, iconSize: [12,12] }),
          }).addTo(layerRef.current).bindPopup(`<b>${o.name}</b><br/>${t?.label} · approx location`)
        })

      setStatus('ready')
    }).catch(() => setStatus('cdnfail'))
    return () => { cancelled = true }
  }, [status, segments, orgs, reads, on, lite])

  return (
    <div className="card" style={{ gridColumn: lite ? undefined : '1 / -1' }}>
      <h2>Coast map {!lite && <span className="pill" style={{ fontSize: 10 }}>live risk</span>}</h2>
      {!lite && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {TYPES.map(t => (
            <button key={t.key} className={'btn sm ' + (on[t.key] ? '' : 'ghost')}
              style={on[t.key] ? { background: t.color, color: '#0c1a17', borderColor: t.color } : { color: t.color, borderColor: t.color }}
              onClick={() => setOn(v => ({ ...v, [t.key]: !v[t.key] }))}>{t.label}</button>
          ))}
        </div>
      )}
      {status === 'nogeo'
        ? <div className="empty"><span className="muted">No geo-located coast segments yet.</span></div>
        : status === 'cdnfail'
        ? <div className="empty"><span className="muted">Map tiles unavailable (offline). Segment data is still shown in the other panels.</span></div>
        : <div ref={mapEl} style={{ height: lite ? 200 : 400, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }} />}
      {!lite && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Beaches at real coordinates, coloured by live inundation risk. Org markers are approximate (precise geolocation attaches when orgs register coordinates). © OpenStreetMap contributors.</div>}
    </div>
  )
}
