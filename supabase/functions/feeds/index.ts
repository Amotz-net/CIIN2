// =====================================================================
// CIIN Edge Function: feeds
// Fetches external feeds SERVER-SIDE (no browser CORS wall) and returns JSON.
// Accepts params from JSON body (supabase.functions.invoke POST) OR query
// string (direct GET, for browser testing).
// Deploy: supabase functions deploy feeds --no-verify-jwt   (run from repo root)
// =====================================================================

import { fetchGrid, bandStats, AFAI_DATASETS, ZONE_INNER_KM, ZONE_OUTER_KM, MODEL_UNCERTAINTY, type Pt } from '../_shared/afai.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const UA = 'CIIN-CaribbeanSargassumNetwork (contact: ops@watersolutions.example)'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// WMO weather codes -> short text. Open-Meteo returns the code, not a phrase.
const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail',
}
const compass = (deg: number) => ['N','NE','E','SE','S','SW','W','NW'][Math.round(((deg % 360) / 45)) % 8]

// Open-Meteo, because the US National Weather Service (used before) only
// covers the US and its territories: it answered for Puerto Rico and returned
// nothing for Jamaica or the rest of the Caribbean.
async function weather(lat: number, lng: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
    + '&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_probability_max'
    + '&forecast_days=4&timezone=auto'
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) return { ok: false, reason: `Open-Meteo ${r.status}`, source: 'live_feed' }
  const j = await r.json()
  const d = j?.daily
  if (!d?.time?.length) return { ok: false, reason: 'No forecast for this location', source: 'live_feed' }
  const periods = d.time.map((day: string, i: number) => ({
    name: i === 0 ? 'Today' : new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }),
    temp: `${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°C`,
    wind: `${Math.round(d.wind_speed_10m_max[i])} km/h ${compass(d.wind_direction_10m_dominant[i])}`,
    short: WMO[d.weather_code[i]] ?? 'Mixed',
    rain_chance: d.precipitation_probability_max?.[i] ?? null,
    isDay: true,
  }))
  const c = j.current
  return {
    ok: true, periods, source: 'live_feed', provider: 'Open-Meteo',
    current: c ? { temp_c: c.temperature_2m, wind_kmh: c.wind_speed_10m, wind_dir: compass(c.wind_direction_10m),
                   short: WMO[c.weather_code] ?? 'Mixed', asOf: c.time } : null,
  }
}

// Biomass in the approach zone off a beach: the latest slice (days = 1)
// or a daily series. `shape` is the traced beach footprint, or one point.
async function band(shape: Pt[], win: string, days: number, at: string | null) {
  const w = AFAI_DATASETS[win] ? win : '7D'
  const end = at ? `(${at})` : '(last)'
  // ERDDAP accepts "(last-N)" arithmetic only on 'last'; for a dated series we
  // ask for the explicit start date instead.
  let timeSel = end
  if (days > 1) {
    if (at) {
      const start = new Date(new Date(at).getTime() - (days - 1) * 86400000).toISOString().slice(0, 19) + 'Z'
      timeSel = `(${start}):1:(${at})`
    } else timeSel = `last-${days - 1}:1:last`   // index arithmetic: no parentheses
  }
  const stride = days > 1 ? 3 : 1
  const grid = await fetchGrid(w, timeSel, shape, stride)
  if (!grid.ok) return { ok: false, reason: grid.reason, source: 'live_feed', window: w }
  const series = bandStats(grid.rows, shape, stride)
  const clear = series.filter(x => !x.gap)
  const latest = clear[clear.length - 1] ?? null
  return {
    ok: true, source: 'live_feed', window: w, zone_km: [ZONE_INNER_KM, ZONE_OUTER_KM],
    gap: !latest,
    latest: latest && {
      ...latest,
      tonnes_low: Math.round(latest.tonnes * (1 - MODEL_UNCERTAINTY) * 10) / 10,
      tonnes_high: Math.round(latest.tonnes * (1 + MODEL_UNCERTAINTY) * 10) / 10,
    },
    series: days > 1 ? series : undefined,
    basis: 'modelled',
    note: 'Biomass from AFAI by the Wang et al. (2018) model, in the approach zone 20 to 40 km offshore of this beach. The last 20 km to shore is not observed: the satellite product is unreliable there. A lower bound: '
        + 'a 1 km pixel cannot see small patches or sargassum piled vertically, and the NOAA product clips dense mats.',
  }
}

async function afai(lat: number, lng: number, box = 0.1, win = '7D', at: string | null = null) {
  const w = AFAI_DATASETS[win] ? win : '7D'
  const ds = AFAI_DATASETS[w]
  const latHi = (lat + box).toFixed(3), latLo = (lat - box).toFixed(3)
  const lngLo = (lng - box).toFixed(3), lngHi = (lng + box).toFixed(3)
  const url = `https://cwcgom.aoml.noaa.gov/erddap/griddap/${ds}.json?AFAI[${at ? `(${at})` : '(last)'}][(${latHi}):(${latLo})][(${lngLo}):(${lngHi})]`
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
           sir, sir_peak: peak, coverage: vals.length, asOf: rows[0]?.[0] ?? null, window: w }
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
  // Near-Real-Time Geostrophic Currents (NOAA AOML CoastWatch Caribbean node) —
  // same server as AFAI. Global 0.2°, u/v in m/s, dims [time][lat][lon] (no depth).
  const ds = 'miamicurrents'
  const box = 0.5
  const q = `[(last)][(${(lat+box).toFixed(2)}):(${(lat-box).toFixed(2)})][(${(lng-box).toFixed(2)}):(${(lng+box).toFixed(2)})]`
  const url = `https://cwcgom.aoml.noaa.gov/erddap/griddap/${ds}.json?u_current${q},v_current${q}`
  let u = NaN, v = NaN, asOf: string | null = null, debug = ''
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!r.ok) {
      debug = `currents ${r.status}`
    } else {
      const j = await r.json()
      const rows = j?.table?.rows ?? []
      const cols = j?.table?.columnNames ?? []
      const ui = cols.indexOf('u_current'), vi = cols.indexOf('v_current')
      const us = rows.map((x: any[]) => x[ui]).filter((n: any) => typeof n === 'number' && !Number.isNaN(n))
      const vs = rows.map((x: any[]) => x[vi]).filter((n: any) => typeof n === 'number' && !Number.isNaN(n))
      if (us.length && vs.length) {
        u = us.reduce((s: number, n: number) => s + n, 0) / us.length
        v = vs.reduce((s: number, n: number) => s + n, 0) / vs.length
        asOf = rows[0]?.[0] ?? null
      } else {
        debug = `rows=${rows.length} cols=${JSON.stringify(cols)}`
      }
    }
  } catch (e) { debug = 'fetch failed: ' + String(e) }

  if (Number.isNaN(u) || Number.isNaN(v)) {
    return { ok: false, reason: 'No current data for this location', debug, source: 'live_feed' }
  }

  const uw = u - 0.015, vw = v
  const speed = Math.sqrt(uw*uw + vw*vw)
  const bearingDeg = (Math.atan2(uw, vw) * 180/Math.PI + 360) % 360
  const kmPerDay = speed * 86.4
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
    note: 'Indicative first-order drift (NOAA geostrophic current + windage). Not a validated forecast.',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    let feed: string | null = null, lat = NaN, lng = NaN
    let body: any = {}

    // 1) Try query string first (works for GET and for invoke if it appends).
    const u = new URL(req.url)
    if (u.searchParams.get('feed')) {
      feed = u.searchParams.get('feed')
      lat = parseFloat(u.searchParams.get('lat') ?? '')
      lng = parseFloat(u.searchParams.get('lng') ?? '')
    }

    // 2) If not found, try the request body (POST from invoke). Read as text
    //    then JSON.parse, so a missing/odd Content-Type can't silently break it.
    // 2) Always read the body on POST: the beach footprint and other options
    //    travel there even when feed/lat/lng came in the query string.
    if (req.method !== 'GET') {
      const raw = await req.text().catch(() => '')
      if (raw) {
        try {
          body = JSON.parse(raw) ?? {}
          feed = feed ?? body.feed ?? null
          if (Number.isNaN(lat)) lat = typeof body.lat === 'number' ? body.lat : parseFloat(body.lat)
          if (Number.isNaN(lng)) lng = typeof body.lng === 'number' ? body.lng : parseFloat(body.lng)
        } catch (_) { /* leave for the debug echo below */ }
      }
    }

    if (Number.isNaN(lat) || Number.isNaN(lng) || !feed) {
      // Debug echo: show exactly what the function received, so a bad call is diagnosable.
      return json({ ok: false, reason: 'lat/lng required',
        debug: { method: req.method, feed, lat, lng, query: u.search, hasBody: req.method !== 'GET' } }, 400)
    }
    if (feed === 'weather') return json(await weather(lat, lng))
    const win = u.searchParams.get('window') ?? body.window ?? '7D'
    const at = u.searchParams.get('at') ?? body.at ?? null
    if (feed === 'afai') return json(await afai(lat, lng, 0.1, win, at))
    if (feed === 'band') {
      const shape: Pt[] = Array.isArray(body.path) && body.path.length > 1 ? body.path : [[lat, lng]]
      const days = Math.max(1, Math.min(120, Number(u.searchParams.get('days') ?? body.days ?? 1)))
      return json(await band(shape, win, days, at))
    }
    if (feed === 'drift') return json(await drift(lat, lng))
    return json({ ok: false, reason: 'unknown feed (use weather|afai|drift)' }, 400)
  } catch (e) {
    return json({ ok: false, reason: 'feed fetch failed', detail: String(e), source: 'live_feed' })
  }
})
