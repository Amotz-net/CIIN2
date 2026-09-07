import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getAfai, getDrift } from '../../lib/feeds'

// Production Coast Map — Leaflet + OSM, styled to match the command-center map:
// dark theme, floating layer panel (on-map toggles w/ swatches), legend, dark
// popups. Segments at real coords coloured by live inundation risk; orgs at
// approximate positions, clearly labelled. `lite` = compact (no panel/legend).
//
// Arrival vectors are drawn from the live drift feed: each dashed arrow runs
// from where a patch is now to where 24h of the observed current + windage
// would carry it, arrowhead at the segment. The LENGTH is therefore real
// (speed_km_day), not decorative. Everything stays georeferenced — we draw no
// coastline of our own, because beach_segments holds a point and a length, not
// a line, and an invented shoreline would read as survey data.

const TYPES = [
  { key: 'segment',        label: 'Beaches',    color: '#57C4AE' },
  { key: 'hotel',          label: 'Hotels',     color: '#6EA8D6' },
  { key: 'processor',      label: 'Processors', color: '#9B8BD6' },
  { key: 'recovery_hub',   label: 'Hubs',       color: '#E0A94F' },
  { key: 'university_lab', label: 'Labs',       color: '#6FC08C' },
]
const RISK = { high: '#D9736A', medium: '#E0A94F', low: '#6FC08C' }
const riskColor = (sir) => RISK[sir] || '#57C4AE'

const KM_PER_DEG = 111.32
// Offset a point by `km` along a compass bearing (degrees clockwise from north).
function offset(lat, lng, bearingDeg, km) {
  const t = (bearingDeg * Math.PI) / 180
  return [
    lat + (km * Math.cos(t)) / KM_PER_DEG,
    lng + (km * Math.sin(t)) / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180)),
  ]
}

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

// `orgId` scopes the map to one organisation's coast. Without it the map shows
// every segment the caller may read — which for a platform admin is all of them,
// so a hotel viewed through the admin switcher would otherwise open on the whole
// Caribbean instead of its own frontage.
export function CoastMap({ lite = false, orgId = null, height = null, title = 'Coast map' }) {
  const mapEl = useRef(null), mapRef = useRef(null), layerRef = useRef(null)
  const [segments, setSegments] = useState([])
  const [orgs, setOrgs] = useState([])
  const [reads, setReads] = useState({})
  const [drifts, setDrifts] = useState({})
  const [on, setOn] = useState(() => ({ ...Object.fromEntries(TYPES.map(t => [t.key, true])), vector: true }))
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const segQuery = supabase.from('beach_segments').select('*')
      const [{ data: seg }, { data: org }] = await Promise.all([
        orgId ? segQuery.eq('org_id', orgId) : segQuery,
        supabase.from('organizations').select('id, name, role, country_code'),
      ])
      if (!alive) return
      setSegments(seg ?? []); setOrgs(org ?? [])
      const wc = (seg ?? []).filter(s => s.lat && s.lng)
      if (wc.length) {
        const r = {}, d = {}
        for (const s of wc) {
          const [a, dr] = await Promise.all([getAfai(s.lat, s.lng), getDrift(s.lat, s.lng)])
          r[s.id] = a; d[s.id] = dr
        }
        if (alive) { setReads(r); setDrifts(d) }
      }
      if (alive) setStatus('data')
    })()
    return () => { alive = false }
  }, [orgId])

  useEffect(() => {
    if (status !== 'data') return
    const segPts = segments.filter(s => s.lat && s.lng)
    if (!segPts.length) { setStatus('nogeo'); return }
    let cancelled = false
    loadLeaflet().then(L => {
      if (cancelled || !mapEl.current) return
      if (!mapRef.current) {
        mapRef.current = L.map(mapEl.current, { zoomControl: !lite, attributionControl: true, scrollWheelZoom: !lite })
        // Fit to what exists rather than centring on the mean: segments spread
        // across countries (Jamaica + Puerto Rico) average to open ocean, which
        // opened the map on empty sea with every marker off-screen.
        const bounds = L.latLngBounds(segPts.map(s => [s.lat, s.lng]))
        mapRef.current.fitBounds(bounds.pad(0.35), { maxZoom: 13 })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(mapRef.current)
        // Fix blank tiles: the map often initialises before its card has final
        // dimensions, so Leaflet doesn't request tiles for the visible area.
        // invalidateSize() after layout settles forces a correct tile load.
        setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 200)
        setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 800)
      }
      if (layerRef.current) layerRef.current.remove()
      layerRef.current = L.layerGroup().addTo(mapRef.current)

      if (on.segment) segPts.forEach(s => {
        const r = reads[s.id]; const col = r?.ok && !r.gap ? riskColor(r.sir) : '#57C4AE'
        const risk = r?.ok && !r.gap ? `Inundation risk: <b style="color:${col}">${r.sir}</b>` : 'awaiting live read'
        const frontage = s.length_m ? `<br/><span style="color:#9AA6A3">${s.length_m} m frontage</span>` : ''
        // A traced shoreline (migration 0018) draws as a risk-coloured ribbon;
        // an untraced segment stays a point, because we will not invent a coast.
        const path = Array.isArray(s.path) && s.path.length > 1 ? s.path : null

        if (path) {
          // OSM maps a beach as an AREA. A closed ring renders as the beach's
          // real footprint; an open way renders as a ribbon along its length.
          const closed = path.length > 3
            && path[0][0] === path[path.length - 1][0] && path[0][1] === path[path.length - 1][1]
          const popup = `<b>${s.name}</b><br/>${risk}${frontage}`
            + `<br/><span style="color:#9AA6A3">beach footprint from OpenStreetMap</span>`
          let shape
          if (closed) {
            shape = L.polygon(path, { color: col, weight: 2.5, opacity: .95, fillColor: col, fillOpacity: .35 })
          } else {
            L.polyline(path, { color: '#0f1418', weight: 9, opacity: .55 }).addTo(layerRef.current)  // casing
            shape = L.polyline(path, { color: col, weight: 5, opacity: .95, lineCap: 'round', lineJoin: 'round' })
          }
          shape.addTo(layerRef.current).bindPopup(popup)
          if (!lite) L.tooltip({ permanent: true, direction: 'right', offset: [8, 0], className: 'mapcallout' })
            .setLatLng(closed ? shape.getBounds().getCenter() : shape.getCenter())
            .setContent(s.name).addTo(layerRef.current)
        } else {
          // Radius carries length_m — a longer frontage reads as a bigger stake.
          const base = lite ? 5 : 8
          const rad = base + Math.min(7, Math.sqrt(Math.max(0, s.length_m || 0)) / 14)
          L.circleMarker([s.lat, s.lng], { radius: rad, color: col, fillColor: col, fillOpacity: .85, weight: 2 })
            .addTo(layerRef.current)
            .bindPopup(`<b>${s.name}</b><br/>${risk}${frontage}<br/><span style="color:#9AA6A3">no traced shoreline — shown as a point</span>`)
          if (!lite) L.tooltip({ permanent: true, direction: 'right', offset: [rad + 3, 0], className: 'mapcallout' })
            .setLatLng([s.lat, s.lng]).setContent(s.name).addTo(layerRef.current)
        }
      })

      // ---- live arrival vectors (drift feed) ----
      // Arrow runs from the patch's present position to where 24h of the
      // observed current + windage carries it; the head lands on the segment.
      if (on.vector && !lite) segPts.forEach(s => {
        const d = drifts[s.id], r = reads[s.id]
        if (!d?.ok || d.bearing_deg == null) return
        // Aim the arrow at the middle of the traced shoreline when we have one.
        const pth = Array.isArray(s.path) && s.path.length > 1 ? s.path : null
        const tip = pth
          ? [pth.reduce((a, c) => a + c[0], 0) / pth.length, pth.reduce((a, c) => a + c[1], 0) / pth.length]
          : [s.lat, s.lng]
        const km = Math.max(1.5, Math.min(25, d.speed_km_day || 0))   // 24h of travel
        const col = r?.ok && !r.gap ? riskColor(r.sir) : '#D9736A'
        const from = offset(tip[0], tip[1], d.bearing_deg + 180, km)   // upstream origin
        L.polyline([from, tip], { color: col, weight: 2, opacity: .85, dashArray: '6 5' })
          .addTo(layerRef.current)
          .bindPopup(`<b>Arrival vector — ${s.name}</b><br/>Drifting ${d.bearing} at ${d.speed_km_day} km/day`
            + `<br/>Arrival window: ${d.arrival_window}`
            + `<br/><span style="color:#9AA6A3">Arrow = 24h of travel. First-order projection, not a validated forecast.</span>`)
        // arrowhead: two short barbs swept back from the bearing
        const barb = Math.max(0.8, km * 0.22)
        ;[150, -150].forEach(a => {
          L.polyline([offset(tip[0], tip[1], d.bearing_deg + a, barb), tip],
            { color: col, weight: 2, opacity: .9 }).addTo(layerRef.current)
        })
      })
      const anchor = segPts[0]
      orgs.filter(o => ['hotel','processor','recovery_hub','university_lab'].includes(o.role) && on[o.role]).forEach((o, i) => {
        const lat = anchor.lat + 0.015 * Math.cos(i * 1.7), lng = anchor.lng + 0.015 * Math.sin(i * 1.7)
        const t = TYPES.find(t => t.key === o.role)
        L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<div style="width:13px;height:13px;background:${t?.color};border:2px solid #141a1f;border-radius:3px;box-shadow:0 0 0 1px ${t?.color}55"></div>`, iconSize: [13,13] }) })
          .addTo(layerRef.current).bindPopup(`<b>${o.name}</b><br/>${t?.label} · <span style="color:#9AA6A3">approx location</span>`)
        if (!lite && o.role === 'recovery_hub') L.tooltip({ permanent: true, direction: 'right', offset: [9, 0], className: 'mapcallout hub' })
          .setLatLng([lat, lng]).setContent(o.name).addTo(layerRef.current)
      })
      setStatus('ready')
      setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 100)
    }).catch(() => setStatus('cdnfail'))
    return () => { cancelled = true }
  }, [status, segments, orgs, reads, drifts, on, lite])

  const toggle = (k) => setOn(v => ({ ...v, [k]: !v[k] }))

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <h2>{title} {!lite && <span className="pill" style={{ fontSize: 10 }}>live risk</span>}</h2>
      <div style={{ position: 'relative' }}>
        {status === 'nogeo' ? <div className="empty"><span className="muted">No geo-located coast segments yet.</span></div>
         : status === 'cdnfail' ? <div className="empty"><span className="muted">Map tiles unavailable (offline). Segment data is shown in the other panels.</span></div>
         : <div ref={mapEl} className="coastmap" style={{ height: height ?? (lite ? 200 : 420) }} />}

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
            <button className={'lyrbtn' + (on.vector ? '' : ' off')} onClick={() => toggle('vector')}>
              <span className="chk">{on.vector ? '✓' : ''}</span>
              <span className="sw dashed" />
              Arrival vectors
            </button>
          </div>
        )}
        {/* legend */}
        {!lite && status === 'ready' && (
          <div className="maplegend">
            <div><span className="sw" style={{ background: RISK.high }} /> High risk</div>
            <div><span className="sw" style={{ background: RISK.medium }} /> Medium</div>
            <div><span className="sw" style={{ background: RISK.low }} /> Low</div>
            <div><span className="sw dashed" /> Arrival vector · 24h drift</div>
          </div>
        )}
      </div>
      {!lite && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Beach footprints from OpenStreetMap (natural=beach), coloured by live inundation risk; untraced segments show as points sized by frontage. Dashed arrows show 24h of observed drift (first-order projection, not a validated forecast). Org markers approximate. © OpenStreetMap contributors, ODbL.
      </div>}
    </div>
  )
}
