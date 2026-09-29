import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './kit.jsx'

// The console map. Satellite basemap, CIIN's own drawing of the floating-algae
// field, beaches at their traced footprints, organisations, drift arrows.
//
// The sargassum layer is drawn here from NOAA's AFAI index, not taken from
// anyone's finished picture. Two rules keep it honest:
//   - only cells above THRESHOLD are drawn (below it the index is mostly noise);
//   - nothing is drawn within about 20 km of land, cloud or uncovered sea,
//     because the index there is a coastal artefact, bright all year.
// So the layer shows sargassum offshore. It is not a picture of the beach.

const FN = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/raster'
const THRESHOLD = 0.0008, FULL = 0.003, SCALE = 0.004
const KEEP_OFF_KM = 20

let _leaflet = null
export function loadLeaflet() {
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

const mercY = lat => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const invY = y => (360 / Math.PI) * Math.atan(Math.exp((y * Math.PI) / 180)) - 90

const cache = new Map()
// Fetch the greyscale index for a box and return a coloured, map-ready picture.
async function drawField({ s, n, w, e, k, back = 0 }) {
  const key = [s, n, w, e, k, back].join(',')
  if (cache.has(key)) return cache.get(key)
  const job = (async () => {
    const r = await fetch(`${FN}?s=${s}&n=${n}&w=${w}&e=${e}&k=${k}&back=${back}`)
    if (!r.ok) throw new Error('satellite layer unavailable')
    const bmp = await createImageBitmap(await r.blob())
    const W = bmp.width, H = bmp.height
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0)
    const src = g.getImageData(0, 0, W, H).data

    // 1. cells with no reading, grown outward by the keep-off distance
    const R = Math.max(1, Math.round((KEEP_OFF_KM / 111) * k))
    const blank = new Uint8Array(W * H), rowPass = new Uint8Array(W * H), near = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) blank[i] = src[i * 4 + 3] < 128 ? 1 : 0
    for (let y = 0; y < H; y++) { let run = 0
      for (let x = -R; x < W; x++) {                       // sliding window of width 2R+1
        const add = x + R; if (add < W) run += blank[y * W + add]
        const drop = x - R - 1; if (drop >= 0) run -= blank[y * W + drop]
        if (x >= 0) rowPass[y * W + x] = run > 0 ? 1 : 0
      } }
    for (let x = 0; x < W; x++) { let run = 0
      for (let y = -R; y < H; y++) {
        const add = y + R; if (add < H) run += rowPass[add * W + x]
        const drop = y - R - 1; if (drop >= 0) run -= rowPass[drop * W + x]
        if (y >= 0) near[y * W + x] = run > 0 ? 1 : 0
      } }

    // 2. strength of each drawn cell, 0..1
    const t = new Float32Array(W * H); let cells = 0
    for (let i = 0; i < W * H; i++) {
      if (near[i]) continue
      const v = (src[i * 4] / 255) * SCALE
      if (v >= THRESHOLD) { t[i] = Math.max(0.05, Math.min(1, (v - THRESHOLD) / (FULL - THRESHOLD))); cells++ }
    }

    // 3. colour, with a soft edge so single cells stay visible when zoomed out
    const eq = new Uint8ClampedArray(W * H * 4)
    const paint = (i, s2, a) => {
      const o = i * 4; if (eq[o + 3] >= a) return
      eq[o] = 242 - 18 * s2; eq[o + 1] = 193 - 110 * s2; eq[o + 2] = 78 - 20 * s2; eq[o + 3] = a
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, s2 = t[i]; if (!s2) continue
      paint(i, s2, 245)
      paint(i - 1, s2, 170); paint(i + 1, s2, 170); paint(i - W, s2, 170); paint(i + W, s2, 170)
      paint(i - W - 1, s2, 90); paint(i - W + 1, s2, 90); paint(i + W - 1, s2, 90); paint(i + W + 1, s2, 90)
    }

    // 4. the source has equal steps of latitude; the map does not. Re-space rows.
    const Hm = Math.max(1, Math.round(k * (mercY(n) - mercY(s))))
    const out = new ImageData(W, Hm), top = mercY(n)
    for (let j = 0; j < Hm; j++) {
      const lat = invY(top - (j + 0.5) / k)
      const row = Math.min(H - 1, Math.max(0, Math.floor((n - lat) * k)))
      out.data.set(eq.subarray(row * W * 4, (row + 1) * W * 4), j * W * 4)
    }
    const oc = document.createElement('canvas'); oc.width = W; oc.height = Hm
    oc.getContext('2d').putImageData(out, 0, 0)
    return { url: oc.toDataURL('image/png'), cells, km2: cells * Math.pow(111 / k, 2) }
  })()
  cache.set(key, job)
  job.catch(() => cache.delete(key))
  return job
}

let _meta = null
const loadMeta = () => (_meta ??= fetch(FN + '?meta=1').then(r => r.json()).catch(() => ({ ok: false })))

const KIND = {
  hotel: ['#6EA8D6', 'building'], hub: ['#E0A94F', 'leaf'], processor: ['#9B8BD6', 'flask'],
  lab: ['#6FC08C', 'flask'], agency: ['#EAF0EF', 'bank'], buyer: ['#6EA8D6', 'cart'], mission: ['#D9736A', 'target'],
}
const SVG = {
  building: 'M4 21V5l8-2v18M12 9l8 2v10M2 21h20', leaf: 'M5 19c0-9 5-14 15-14 0 10-5 15-14 15zM5 19l8-8',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3', bank: 'M3 10l9-6 9 6M5 10v8M12 10v8M19 10v8M3 20h18',
  cart: 'M3 4h2l2.5 11h10L20 7H6.5', target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 15a3 3 0 100-6 3 3 0 000 6z',
}
const pinHtml = (kind, count) => {
  const [col, ic] = KIND[kind] || KIND.agency
  return `<div class="k-pin" style="--c:${col}">${count > 1 ? `<b>${count}</b>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${SVG[ic]}"/></svg>`}</div>`
}

// props
//   raster    {s,n,w,e,k} box for the sargassum layer, or null
//   views     [{key,label,points|bounds,maxZoom}] first is the opening view
//   segments  [{id,name,lat,lng,path,color,tag}]
//   markers   [{lat,lng,kind,label,note,count}]
//   vectors   [{from,to,color,note}]
//   layers    [{key,label,color}] toggles; keys: sargassum, segments, vectors, or a marker kind
//   legend    [{type:'fill'|'line'|'dash'|'pin', color, label, kind}]
export function SargassumMap({ title, note, raster = null, views = [], segments = [], markers = [], vectors = [],
                               layers = [], legend = [], height = 430, timeline = true, onField, focus = null }) {
  const el = useRef(null), map = useRef(null), group = useRef(null), field = useRef(null)
  const [on, setOn] = useState(() => Object.fromEntries(layers.map(l => [l.key, l.off ? false : true])))
  const [view, setView] = useState(views[0]?.key)
  const moved = useRef(false)
  const [meta, setMeta] = useState(null)
  const [step, setStep] = useState(3)
  const [playing, setPlaying] = useState(false)
  const [state, setState] = useState(raster ? 'loading' : 'none')
  // Counts each time the map is created, so framing and drawing run again if it is ever rebuilt.
  const [ready, setReady] = useState(0)
  const shown = k => on[k] !== false

  useEffect(() => { if (raster) loadMeta().then(setMeta) }, [!!raster])

  useEffect(() => {
    let dead = false
    loadLeaflet().then(L => {
      if (dead || !el.current || map.current) return
      map.current = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, worldCopyJump: false })
      L.control.zoom({ position: 'bottomright' }).addTo(map.current)
      L.control.scale({ position: 'bottomright', imperial: false }).addTo(map.current)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18, className: 'k-tiles', attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
      }).addTo(map.current)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18, className: 'k-labels', opacity: 0.85,
      }).addTo(map.current)
      map.current.createPane('field').style.zIndex = 350
      group.current = L.layerGroup().addTo(map.current)
      map.current.setView([18, -76], 5)
      setReady(n => n + 1)
      ;[200, 700, 1500].forEach(ms => setTimeout(() => map.current && map.current.invalidateSize(), ms))
    })
    return () => { dead = true; if (map.current) { map.current.remove(); map.current = null; group.current = null; field.current = null } }
  }, [])

  // Framing
  const viewKey = JSON.stringify(views.map(v => [v.key, v.points?.length, v.bounds]))
  useEffect(() => {
    if (!ready || !map.current) return
    const L = window.L, v = views.find(x => x.key === view) || views[0]
    if (!v) return
    const b = v.bounds ? L.latLngBounds(v.bounds) : v.points?.length ? L.latLngBounds(v.points).pad(v.pad ?? 0.25) : null
    if (!b || !b.isValid()) return
    const fit = () => map.current && map.current.fitBounds(b, { maxZoom: v.maxZoom ?? 14, animate: false })
    if (moved.current) { map.current.flyToBounds(b, { maxZoom: v.maxZoom ?? 14, duration: 1.4 }); return }
    fit(); const id = setTimeout(() => { map.current && map.current.invalidateSize(); fit() }, 400)
    return () => clearTimeout(id)
  }, [ready, view, viewKey])

  // Open on the whole Caribbean, then settle on the organisation's own island.
  const hasFocus = !!focus && views.some(v => v.key === focus)
  useEffect(() => {
    if (!ready || !hasFocus || moved.current) return
    const id = setTimeout(() => { moved.current = true; setView(focus) }, 2600)
    return () => clearTimeout(id)
  }, [ready, hasFocus, focus])

  // Sargassum layer
  const back = 3 - step
  const rkey = raster ? [raster.s, raster.n, raster.w, raster.e, raster.k].join(',') : ''
  useEffect(() => {
    if (!ready || !raster || !map.current) return
    let dead = false
    const L = window.L
    if (!shown('sargassum')) { if (field.current) { field.current.remove(); field.current = null } return }
    setState(s => (s === 'shown' ? s : 'loading'))
    drawField({ ...raster, back }).then(f => {
      if (dead || !map.current) return
      const b = [[raster.s, raster.w], [raster.n, raster.e]]
      if (field.current) field.current.setUrl(f.url)
      else field.current = L.imageOverlay(f.url, b, { pane: 'field', opacity: 0.95, className: 'k-field' }).addTo(map.current)
      setState('shown'); onField && onField({ ...f, back })
    }).catch(() => { if (!dead) setState('failed') })
    return () => { dead = true }
  }, [ready, rkey, back, on.sargassum])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setStep(s => { if (s >= 3) { setPlaying(false); return 3 } return s + 1 }), 1400)
    return () => clearInterval(id)
  }, [playing])

  // Beaches, organisations, arrows
  const drawKey = JSON.stringify([segments.map(s => [s.id, s.color, s.tag]), markers.map(m => [m.lat, m.lng, m.kind, m.label, m.count]), vectors, on])
  useEffect(() => {
    if (!ready || !group.current || !map.current) return
    const L = window.L; group.current.clearLayers()
    if (shown('segments')) segments.forEach(s => {
      const col = s.color || '#57C4AE'
      const pth = Array.isArray(s.path) && s.path.length > 1 ? s.path : null
      const at = pth ? pth[Math.floor(pth.length / 2)] : [s.lat, s.lng]
      if (pth) {
        L.polyline(pth, { color: '#1C2126', weight: 9, opacity: 0.55 }).addTo(group.current)
        L.polyline(pth, { color: col, weight: 5, opacity: 1, lineCap: 'round' }).addTo(group.current)
      } else L.circleMarker(at, { radius: 8, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 }).addTo(group.current)
      L.marker(at, { interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0],
        html: `<div class="k-maplabel"><b>${s.name}</b>${s.tag ? `<span style="color:${col}">${s.tag}</span>` : ''}</div>` }) }).addTo(group.current)
    })
    markers.filter(m => shown(m.kind)).forEach(m => {
      const mk = L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: pinHtml(m.kind, m.count) }) })
        .addTo(group.current)
      mk.bindPopup(`<b>${m.label}</b>${m.note ? `<br/><span style="color:#9AA6A3">${m.note}</span>` : ''}`)
      if (m.showLabel) mk.bindTooltip(m.label, { permanent: true, direction: 'right', offset: [14, 0], className: 'k-tip' })
    })
    if (shown('vectors')) vectors.forEach(v => {
      L.polyline([v.from, v.to], { color: v.color || '#EAF0EF', weight: 2, opacity: 0.9, dashArray: '6 5' }).addTo(group.current)
        .bindPopup(v.note || 'Drift direction')
      const dy = v.to[0] - v.from[0], dx = (v.to[1] - v.from[1]) * Math.cos((v.to[0] * Math.PI) / 180)
      const ang = Math.atan2(dx, dy), len = Math.hypot(dx, dy) * 0.28
      ;[2.6, -2.6].forEach(a => L.polyline([[v.to[0] + len * Math.cos(ang + a), v.to[1] + (len * Math.sin(ang + a)) / Math.cos((v.to[0] * Math.PI) / 180)], v.to],
        { color: v.color || '#EAF0EF', weight: 2, opacity: 0.9 }).addTo(group.current))
    })
  }, [ready, drawKey])

  const times = meta?.ok ? meta.times : null
  const stamp = i => times?.[i] ? new Date(times[i]).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''
  const marks = useMemo(() => ['−72h', '−48h', '−24h', 'Latest'], [])

  return (
    <div className="k-map">
      <div className="k-map-frame" style={{ height }}>
        <div ref={el} className="k-map-el" />
        <div className="k-map-title"><b>{title}</b>{note && <span> • {note}</span>}
          {raster && <em>{state === 'loading' ? 'reading satellite…' : state === 'failed' ? 'satellite layer unavailable' : times ? `satellite · 7 days to ${stamp(step)}` : ''}</em>}</div>
        {layers.length > 0 && <div className="k-map-toggles">{layers.map(l => (
          <button key={l.key} className={'k-tog' + (shown(l.key) ? ' on' : '')} style={{ '--c': l.color || '#57C4AE' }}
                  aria-pressed={shown(l.key)} onClick={() => setOn(o => ({ ...o, [l.key]: !shown(l.key) }))}><i />{l.label}</button>))}</div>}
        {legend.length > 0 && <div className="k-map-legend">{legend.map((g, i) => (
          <span key={i}>{g.type === 'pin' ? <i className="pin" style={{ background: (KIND[g.kind] || [])[0] || g.color }} />
            : g.type === 'fill' ? <i className="fill" style={{ background: g.color }} />
            : <i className="line" style={{ borderTop: `2px ${g.type === 'dash' ? 'dashed' : 'solid'} ${g.color}` }} />}{g.label}</span>))}</div>}
        {views.length > 1 && <div className="k-map-views">{views.map(v => (
          <button key={v.key} className={view === v.key ? 'on' : ''} onClick={() => { moved.current = true; setView(v.key) }}>{v.icon && <Icon name={v.icon} size={15} />}{v.label}</button>))}</div>}
      </div>
      {raster && timeline && <div className="k-time">
        <button className="k-play" aria-label={playing ? 'Stop' : 'Play'} onClick={() => { if (playing) setPlaying(false); else { setStep(0); setPlaying(true) } }}>{playing ? '■' : '▶'}</button>
        <div className="k-track">
          <div className="k-track-line"><i style={{ width: (step / 3) * 100 + '%' }} /></div>
          {marks.map((m, i) => <button key={m} className={'k-stop' + (i === step ? ' on' : '') + (i < step ? ' past' : '')}
            style={{ left: (i / 3) * 100 + '%' }} onClick={() => { setPlaying(false); setStep(i) }}><i /><span>{m}</span><small>{stamp(i)}</small></button>)}
        </div>
        <span className="k-time-note">Observed, not forecast</span>
      </div>}
    </div>
  )
}
