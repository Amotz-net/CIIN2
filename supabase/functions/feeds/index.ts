// =====================================================================
// CIIN Edge Function: feeds
// Fetches external feeds SERVER-SIDE (no browser CORS wall) and returns JSON.
// Accepts params from JSON body (supabase.functions.invoke POST) OR query
// string (direct GET, for browser testing).
// Deploy: supabase functions deploy feeds --no-verify-jwt   (run from repo root)
// =====================================================================

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const UA = 'CIIN-CaribbeanSargassumNetwork (contact: ops@watersolutions.example)'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function weather(lat: number, lng: number) {
  const p = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
    { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } })
  if (!p.ok) return { ok: false, reason: `NWS point ${p.status}`, source: 'live_feed' }
  const point = await p.json()
  const url = point?.properties?.forecast
  if (!url) return { ok: false, reason: 'No forecast grid for this location', source: 'live_feed' }
  const f = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } })
  if (!f.ok) return { ok: false, reason: `NWS forecast ${f.status}`, source: 'live_feed' }
  const data = await f.json()
  const periods = (data?.properties?.periods ?? []).slice(0, 4).map((x: any) => ({
    name: x.name, temp: `${x.temperature}°${x.temperatureUnit}`,
    wind: `${x.windSpeed} ${x.windDirection}`, short: x.shortForecast, isDay: x.isDaytime,
  }))
  return { ok: true, periods, source: 'live_feed' }
}

async function afai(lat: number, lng: number, box = 0.1) {
  const ds = 'noaa_aoml_atlantic_oceanwatch_AFAI_7D'
  const latHi = (lat + box).toFixed(3), latLo = (lat - box).toFixed(3)
  const lngLo = (lng - box).toFixed(3), lngHi = (lng + box).toFixed(3)
  const url = `https://cwcgom.aoml.noaa.gov/erddap/griddap/${ds}.json?AFAI[(last)][(${latHi}):(${latLo})][(${lngLo}):(${lngHi})]`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) return { ok: false, reason: `ERDDAP ${r.status}`, source: 'live_feed' }
  const j = await r.json()
  const rows = j?.table?.rows ?? []
  const vals = rows.map((x: any[]) => x[3]).filter((v: any) => typeof v === 'number' && !Number.isNaN(v))
  if (!vals.length) return { ok: true, gap: true, source: 'live_feed',
    note: 'No clear satellite read (cloud, sun glint or dust). Coverage gap shown honestly.' }
  const mean = vals.reduce((s: number, v: number) => s + v, 0) / vals.length
  const level = mean > 0.0008 ? 'elevated' : mean > 0.0002 ? 'moderate' : 'low'
  // SIR-method inundation risk: NOAA CoastWatch classifies AFAI near the coast
  // against published thresholds 0.001 and 0.003 -> low / medium / high.
  // Computed from the same live AFAI input NOAA's SIR uses (not the official
  // SIR object). Uses the max nearby AFAI (worst-case pixel near the coast).
  const peak = Math.max(...vals)
  const sir = peak >= 0.003 ? 'high' : peak >= 0.001 ? 'medium' : 'low'
  return { ok: true, gap: false, source: 'live_feed', afai: mean, level,
           sir, sir_peak: peak, coverage: vals.length, asOf: rows[0]?.[0] ?? null }
}

// ---- first-order drift: advect an AFAI patch with OSCAR surface currents + windage ----
// HONEST SCOPE: this is a first-order projection (current vector at the patch +
// simple windage over a short horizon), NOT a validated Lagrangian model.
// Labelled "indicative, moderate confidence, 3-day horizon". A real forecast
// needs OpenDrift/OceanParcels advecting through changing fields (scaffolded separately).
function bearingToText(deg: number) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW']
  return dirs[Math.round(((deg % 360) / 45)) % 8]
}
async function drift(lat: number, lng: number) {
  // OSCAR sea-surface velocity (u=eastward, v=northward, m/s), latest slice.
  const ds = 'jplOscar_LonPM180'
  const box = 0.5
  const url = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/${ds}.json?u[(last)][(15.0)][(${(lat+box).toFixed(2)}):(${(lat-box).toFixed(2)})][(${(lng-box).toFixed(2)}):(${(lng+box).toFixed(2)})],v[(last)][(15.0)][(${(lat+box).toFixed(2)}):(${(lat-box).toFixed(2)})][(${(lng-box).toFixed(2)}):(${(lng+box).toFixed(2)})]`
  let u = NaN, v = NaN, asOf: string | null = null
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (r.ok) {
      const j = await r.json()
      const rows = j?.table?.rows ?? []
      // rows: [time, depth, lat, lng, u, v]
      const us = rows.map((x: any[]) => x[4]).filter((n: any) => typeof n === 'number' && !Number.isNaN(n))
      const vs = rows.map((x: any[]) => x[5]).filter((n: any) => typeof n === 'number' && !Number.isNaN(n))
      if (us.length && vs.length) {
        u = us.reduce((s: number, n: number) => s + n, 0) / us.length
        v = vs.reduce((s: number, n: number) => s + n, 0) / vs.length
        asOf = rows[0]?.[0] ?? null
      }
    }
  } catch (_) { /* fall through to unavailable */ }

  if (Number.isNaN(u) || Number.isNaN(v)) {
    return { ok: false, reason: 'No current data for this location', source: 'live_feed' }
  }

  // Speed (m/s) and bearing. Add a small windage nudge (Caribbean trade winds push
  // westward); first-order only, so we keep windage as a flat 1.5% westward add.
  const uw = u - 0.015, vw = v
  const speed = Math.sqrt(uw*uw + vw*vw)                 // m/s
  const bearingDeg = (Math.atan2(uw, vw) * 180/Math.PI + 360) % 360  // 0=N, 90=E
  const kmPerDay = speed * 86.4                          // m/s -> km/day
  // Indicative arrival window over a 3-day horizon (very rough): distance a patch
  // ~10-30 km offshore would cover. We express as a qualitative window, not a clock.
  const horizonKm = kmPerDay * 3
  let window = 'beyond 3 days'
  if (horizonKm >= 30) window = '1–2 days'
  else if (horizonKm >= 15) window = '2–4 days'
  else if (horizonKm >= 5) window = '3–5 days'
  return {
    ok: true, source: 'live_feed',
    bearing: bearingToText(bearingDeg), bearing_deg: Math.round(bearingDeg),
    speed_km_day: Math.round(kmPerDay * 10) / 10,
    arrival_window: window, horizon: '3-day', confidence: 'moderate',
    asOf,
    note: 'Indicative first-order drift (OSCAR current + windage). Not a validated forecast.',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    let feed: string | null = null, lat = NaN, lng = NaN

    // 1) Try query string first (works for GET and for invoke if it appends).
    const u = new URL(req.url)
    if (u.searchParams.get('feed')) {
      feed = u.searchParams.get('feed')
      lat = parseFloat(u.searchParams.get('lat') ?? '')
      lng = parseFloat(u.searchParams.get('lng') ?? '')
    }

    // 2) If not found, try the request body (POST from invoke). Read as text
    //    then JSON.parse, so a missing/odd Content-Type can't silently break it.
    if (!feed && req.method !== 'GET') {
      const raw = await req.text().catch(() => '')
      if (raw) {
        try {
          const b = JSON.parse(raw)
          feed = b.feed ?? null
          lat = typeof b.lat === 'number' ? b.lat : parseFloat(b.lat)
          lng = typeof b.lng === 'number' ? b.lng : parseFloat(b.lng)
        } catch (_) { /* leave for the debug echo below */ }
      }
    }

    if (Number.isNaN(lat) || Number.isNaN(lng) || !feed) {
      // Debug echo: show exactly what the function received, so a bad call is diagnosable.
      return json({ ok: false, reason: 'lat/lng required',
        debug: { method: req.method, feed, lat, lng, query: u.search, hasBody: req.method !== 'GET' } }, 400)
    }
    if (feed === 'weather') return json(await weather(lat, lng))
    if (feed === 'afai') return json(await afai(lat, lng))
    if (feed === 'drift') return json(await drift(lat, lng))
    return json({ ok: false, reason: 'unknown feed (use weather|afai|drift)' }, 400)
  } catch (e) {
    return json({ ok: false, reason: 'feed fetch failed', detail: String(e), source: 'live_feed' })
  }
})
