// =====================================================================
// CIIN Raster — the satellite floating-algae field as a picture CIIN can
// draw itself.
//
// NOAA's server does not allow a browser on another site to read its images,
// so this function fetches the image and hands it on unchanged. It is a
// greyscale picture of the AFAI index (black = 0, white = 0.004); the browser
// decides what counts as sargassum and how to colour it. Land, cloud and
// uncovered sea arrive transparent.
//
// ?meta=1 returns the dates of the latest slices instead of an image.
//
// Deploy: supabase functions deploy raster --no-verify-jwt
// =====================================================================
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const ERDDAP = 'https://cwcgom.aoml.noaa.gov/erddap/griddap'
const SETS: Record<string, string> = {
  '1D': 'noaa_aoml_atlantic_oceanwatch_AFAI_1D',
  '3D': 'noaa_aoml_atlantic_oceanwatch_AFAI_3D',
  '7D': 'noaa_aoml_atlantic_oceanwatch_AFAI_7D',
}
const num = (v: string | null, d: number, lo: number, hi: number) => {
  const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, n)) : d
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const p = new URL(req.url).searchParams
  const set = SETS[p.get('window') ?? '7D'] ?? SETS['7D']
  try {
    if (p.get('meta')) {
      const r = await fetch(`${ERDDAP}/${set}.json?time%5Blast-3:1:last%5D`)
      if (!r.ok) throw new Error('NOAA ' + r.status)
      const j = await r.json()
      const times = (j.table.rows as string[][]).map(x => x[0])
      return new Response(JSON.stringify({ ok: true, times, window: p.get('window') ?? '7D',
        source: 'USF Optical Oceanography Lab AFAI, via NOAA CoastWatch-AOML' }),
        { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' } })
    }
    const s = num(p.get('s'), 8, -5, 45), n = num(p.get('n'), 32, -5, 45)
    const w = num(p.get('w'), -98, -110, -5), e = num(p.get('e'), -55, -110, -5)
    const back = Math.round(num(p.get('back'), 0, 0, 30))
    // One pixel per equal step of latitude and longitude, so the browser can
    // place every row and column exactly.
    const k = num(p.get('k'), 36, 4, 66)
    const W = Math.round((e - w) * k), H = Math.round((n - s) * k)
    const t = back ? `last-${back}` : 'last'
    const q = `AFAI%5B${t}%5D%5B(${s}):(${n})%5D%5B(${w}):(${e})%5D`
      + `&.draw=surface&.vars=longitude%7Clatitude%7CAFAI&.colorBar=BlackWhite%7C%7C%7C0%7C0.004%7C&.size=${W}%7C${H}`
    const r = await fetch(`${ERDDAP}/${set}.transparentPng?${q}`)
    if (!r.ok) throw new Error('NOAA ' + r.status)
    return new Response(r.body, { headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, reason: String(err).slice(0, 160) }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
