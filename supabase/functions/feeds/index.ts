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
  return { ok: true, gap: false, source: 'live_feed', afai: mean, level, coverage: vals.length, asOf: rows[0]?.[0] ?? null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    let feed: string | null = null, lat = NaN, lng = NaN
    // Prefer JSON body (from invoke); fall back to query string (direct GET).
    if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}))
      feed = b.feed ?? null; lat = parseFloat(b.lat); lng = parseFloat(b.lng)
    }
    if (!feed) {
      const u = new URL(req.url)
      feed = u.searchParams.get('feed')
      lat = parseFloat(u.searchParams.get('lat') ?? '')
      lng = parseFloat(u.searchParams.get('lng') ?? '')
    }
    if (Number.isNaN(lat) || Number.isNaN(lng)) return json({ ok: false, reason: 'lat/lng required' }, 400)
    if (feed === 'weather') return json(await weather(lat, lng))
    if (feed === 'afai') return json(await afai(lat, lng))
    return json({ ok: false, reason: 'unknown feed (use weather|afai)' }, 400)
  } catch (e) {
    return json({ ok: false, reason: 'feed fetch failed', detail: String(e), source: 'live_feed' })
  }
})
