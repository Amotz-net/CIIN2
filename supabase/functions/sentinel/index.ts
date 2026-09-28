// =====================================================================
// CIIN Sentinel — Sentinel-2 access through the Copernicus Data Space.
// Step 1 (this file): authenticate and list recent passes over a beach.
// Credentials are Supabase secrets CDSE_CLIENT_ID / CDSE_CLIENT_SECRET and
// never leave the server.
// =====================================================================
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const CATALOG_URL = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search'
const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics'
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process'

// Raw bands for one day, for the Wang & Hu (2021) Sentinel-2 method:
// B04 (665), B8A (865), B11 (1610), B12 (2190) reflectance, the L2A scene
// classification, and dataMask. FLOAT32 GeoTIFF at ~20 m.
const RASTER_SCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B03", "B04", "B8A", "B11", "B12", "SCL", "dataMask"] }],
           output: { bands: 8, sampleType: "FLOAT32" } };
}
function evaluatePixel(s) {
  return [s.B02, s.B03, s.B04, s.B8A, s.B11, s.B12, s.SCL, s.dataMask];
}`

// Floating Algae Index (Hu 2009) on Sentinel-2: NIR (B08, 842 nm) above the
// baseline between red (B04, 665 nm) and SWIR (B11, 1610 nm). Pixels are
// dropped when cloud, shadow or no-data per the L2A scene classification, and
// when SWIR is bright, which is land or beach sand rather than water.
const EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B04", "B08", "B11", "SCL", "dataMask"] }],
           output: [{ id: "fai", bands: 1, sampleType: "FLOAT32" }, { id: "dataMask", bands: 1 }] };
}
function evaluatePixel(s) {
  var bad = [0, 1, 3, 8, 9, 10, 11].indexOf(s.SCL) >= 0;
  var land = s.B11 > 0.12;
  var fai = s.B08 - (s.B04 + (s.B11 - s.B04) * (842 - 665) / (1610 - 665));
  return { fai: [fai], dataMask: [(s.dataMask && !bad && !land) ? 1 : 0] };
}`

async function token() {
  const id = Deno.env.get('CDSE_CLIENT_ID'), secret = Deno.env.get('CDSE_CLIENT_SECRET')
  if (!id || !secret) return { ok: false as const, reason: 'CDSE credentials not set' }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  })
  if (!r.ok) return { ok: false as const, reason: `auth ${r.status}`, detail: (await r.text()).slice(0, 200) }
  const j = await r.json()
  return { ok: true as const, access: j.access_token as string, expires_in: j.expires_in }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const u = new URL(req.url)
    const lat = parseFloat(u.searchParams.get('lat') ?? '18.305')
    const lng = parseFloat(u.searchParams.get('lng') ?? '-78.339')
    const days = Math.min(90, Number(u.searchParams.get('days') ?? 30))
    const t = await token()
    if (!t.ok) return json({ ok: false, stage: 'auth', ...t })

    if (u.searchParams.get('action') === 'raster') {
      const bbox = (u.searchParams.get('bbox') ?? '').split(',').map(Number)
      const date = u.searchParams.get('date')
      const res = Number(u.searchParams.get('res') ?? 0.00018)
      const r = await fetch(PROCESS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json', Accept: 'image/tiff' },
        body: JSON.stringify({
          input: {
            bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
            data: [{ type: 'sentinel-2-l2a', dataFilter: { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` } } }],
          },
          output: { resx: res, resy: res, responses: [{ identifier: 'default', format: { type: 'image/tiff' } }] },
          evalscript: RASTER_SCRIPT,
        }),
      })
      if (!r.ok) return json({ ok: false, stage: 'raster', reason: `process ${r.status}`, detail: (await r.text()).slice(0, 400) })
      const buf = new Uint8Array(await r.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return json({ ok: true, stage: 'raster', date, bbox, res, tiff_b64: btoa(bin), bytes: buf.length,
                    pu: r.headers.get('x-processingunits-spent') })
    }

    if (u.searchParams.get('action') === 'stats') {
      // bbox = minLng,minLat,maxLng,maxLat ; from/to = ISO dates
      const bbox = (u.searchParams.get('bbox') ?? '').split(',').map(Number)
      const from = u.searchParams.get('from'), to = u.searchParams.get('to')
      const res = Number(u.searchParams.get('res') ?? 0.0002)
      const r = await fetch(STATS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
            data: [{ type: 'sentinel-2-l2a', dataFilter: { maxCloudCoverage: 70 } }],
          },
          aggregation: {
            timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
            aggregationInterval: { of: 'P1D' },
            evalscript: EVALSCRIPT, resx: res, resy: res,
          },
          calculations: { fai: {
            statistics: { default: { percentiles: { k: [10, 50, 90, 99] } } },
            histograms: { default: { lowEdge: -0.05, highEdge: 0.25, binWidth: 0.0025 } },
          } },
        }),
      })
      if (!r.ok) return json({ ok: false, stage: 'stats', reason: `stats ${r.status}`, detail: (await r.text()).slice(0, 400) })
      const j = await r.json()
      const rows = (j.data ?? []).map((x: any) => {
        const b = x.outputs?.fai?.bands?.B0
        const st = b?.stats
        return st && {
          hist: (b.histogram?.bins ?? []).map((h: any) => [h.lowEdge, h.count]),
          date: x.interval?.from?.slice(0, 10),
          valid: st.sampleCount - st.noDataCount, total: st.sampleCount,
          mean: st.mean, p10: st.percentiles?.['10.0'], p50: st.percentiles?.['50.0'],
          p90: st.percentiles?.['90.0'], p99: st.percentiles?.['99.0'], max: st.max,
        }
      }).filter(Boolean)
      return json({ ok: true, stage: 'stats', rows })
    }

    const d = 0.03
    const end = u.searchParams.get('to') ? new Date(u.searchParams.get('to') + 'T23:59:59Z') : new Date()
    const start = u.searchParams.get('from') ? new Date(u.searchParams.get('from') + 'T00:00:00Z') : new Date(end.getTime() - days * 86400000)
    const cbbox = u.searchParams.get('bbox') ? u.searchParams.get('bbox')!.split(',').map(Number) : [lng - d, lat - d, lng + d, lat + d]
    const r = await fetch(CATALOG_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox: cbbox,
        datetime: `${start.toISOString()}/${end.toISOString()}`,
        limit: 100,
        fields: { include: ['properties.datetime', 'properties.eo:cloud_cover', 'properties.platform'], exclude: [] },
      }),
    })
    if (!r.ok) return json({ ok: false, stage: 'catalog', reason: `catalog ${r.status}`, detail: (await r.text()).slice(0, 300) })
    const j = await r.json()
    const passes = (j.features ?? []).map((f: any) => ({
      date: f.properties?.datetime, cloud_pct: f.properties?.['eo:cloud_cover'], platform: f.properties?.platform,
    })).sort((a: any, b: any) => (a.date < b.date ? 1 : -1))
    return json({ ok: true, stage: 'catalog', token_expires_in: t.expires_in, days, passes })
  } catch (e) {
    return json({ ok: false, reason: 'sentinel failed', detail: String(e) }, 500)
  }
})
