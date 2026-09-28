// =====================================================================
// Shared satellite maths for CIIN: AFAI -> sargassum biomass in the
// beaching band off a beach.
//
// MODEL. Wang et al. (2018), Geophys. Res. Lett. 45, eq. 3:
//     biomass density (kg/m2) = 23.34 * x        for 0 < x <= 0.04
// where x is IN-SITU AFAI, and MODIS AFAI is ~75% of in-situ, so
//     x = 1.33 * MODIS AFAI.
// The paper puts the uncertainty below 12% for a local patch and states the
// result is a LOWER BOUND: a 1 km pixel cannot see small patches, and
// sargassum piled vertically is invisible from above.
//
// TWO PROPERTIES OF THE NOAA PRODUCT that matter here:
//   - Open water reads NEGATIVE (about -0.001), so the sargassum signal is
//     AFAI above the local water background, not raw AFAI.
//   - Values are clipped at 0.004, so dense mats saturate. Another reason the
//     figure is a lower bound.
//
// WHERE CIIN MEASURES: the APPROACH ZONE, 20 to 40 km offshore of the beach.
// SATsum (CONABIO) counts sargassum within 4 km of shore. CIIN cannot, for two
// reasons established against ten years of this product off Negril:
//   1. The NOAA field is masked near land; the nearest valid pixel is ~6 km out.
//   2. Water within 20 km of the coast reads bright ALL YEAR, peaking in
//      December. That is a coastal artefact (shallow water, land adjacency),
//      not sargassum, which peaks June to September. Counting it would report
//      permanent inundation.
// Beyond 20 km the signal is clean: low in February, highest June-September,
// rising year on year. That is the water arriving sargassum crosses, so it is
// what CIIN measures. What happens in the last 20 km is NOT observed.
// =====================================================================

export const AFAI_DATASETS: Record<string, string> = {
  '1D': 'noaa_aoml_atlantic_oceanwatch_AFAI_1D',
  '3D': 'noaa_aoml_atlantic_oceanwatch_AFAI_3D',
  '7D': 'noaa_aoml_atlantic_oceanwatch_AFAI_7D',
}
export const ZONE_INNER_KM = 20
export const ZONE_OUTER_KM = 40
export const MODEL_SLOPE = 23.34          // kg/m2 per unit in-situ AFAI
export const MODIS_TO_INSITU = 1.33
export const MODEL_UNCERTAINTY = 0.12
// CIIN's noise floor on the background-subtracted signal. Below this a pixel
// counts as clear water. A CIIN choice, not a published constant.
export const NOISE_FLOOR = 0.0002
const BOX_DEG = 0.45                       // fetch box half-width: covers the 40 km zone
const ERDDAP = 'https://cwcgom.aoml.noaa.gov/erddap/griddap'

export type Pt = [number, number]          // [lat, lng]

function km(a: Pt, b: Pt) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

// Approximate area of one grid cell in km2 at this latitude.
function cellKm2(lat: number, res = 0.015) {
  return (res * 111.32) * (res * 111.32 * Math.cos(lat * Math.PI / 180))
}

// timeSel examples: '(last)', '(2026-06-01T12:00:00Z)', '(2016-07-01T12:00:00Z):7:(last)'
// `stride` thins the grid (every Nth cell) so a ten-year pull stays small.
export async function fetchGrid(win: string, timeSel: string, shape: Pt[], stride = 1) {
  const ds = AFAI_DATASETS[win] ?? AFAI_DATASETS['7D']
  const lats = shape.map(p => p[0]), lngs = shape.map(p => p[1])
  const latHi = (Math.max(...lats) + BOX_DEG).toFixed(3), latLo = (Math.min(...lats) - BOX_DEG).toFixed(3)
  const lngLo = (Math.min(...lngs) - BOX_DEG).toFixed(3), lngHi = (Math.max(...lngs) + BOX_DEG).toFixed(3)
  const url = `${ERDDAP}/${ds}.json?AFAI[${timeSel}][(${latHi}):${stride}:(${latLo})][(${lngLo}):${stride}:(${lngHi})]`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) return { ok: false as const, reason: `ERDDAP ${r.status}` }
  const j = await r.json()
  return { ok: true as const, rows: (j?.table?.rows ?? []) as [string, number, number, number | null][] }
}

// One result per time slice: biomass in the approach zone off `shape`.
export function bandStats(rows: [string, number, number, number | null][], shape: Pt[], stride = 1) {
  const byTime = new Map<string, [number, number, number][]>()
  for (const [t, lat, lng, v] of rows) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue
    if (!byTime.has(t)) byTime.set(t, [])
    byTime.get(t)!.push([lat, lng, v])
  }
  // Which grid cells fall inside the band is a property of the geometry, so
  // work it out once rather than per slice.
  const inBand = new Map<string, boolean>()
  const near = (lat: number, lng: number) => {
    const k = lat.toFixed(4) + ',' + lng.toFixed(4)
    if (!inBand.has(k)) {
      const d = Math.min(...shape.map(p => km([lat, lng], p)))   // distance to the nearest point of the beach
      inBand.set(k, d >= ZONE_INNER_KM && d <= ZONE_OUTER_KM)
    }
    return inBand.get(k)!
  }
  const out: any[] = []
  for (const [t, px] of byTime) {
    const band = px.filter(p => near(p[0], p[1]))
    // Too few clear cells is a coverage gap, not a clear sea.
    if (band.length < 20) { out.push({ t, gap: true }); continue }
    const background = median(band.map(p => p[2]))   // open-water level within the zone
    let tonnes = 0, sumDensity = 0, peak = -Infinity
    for (const [lat, , v] of band) {
      const signal = v - background
      peak = Math.max(peak, signal)
      const x = signal > NOISE_FLOOR ? Math.min(signal * MODIS_TO_INSITU, 0.04) : 0
      const tPerKm2 = MODEL_SLOPE * x * 1000       // kg/m2 -> t/km2
      sumDensity += tPerKm2
      tonnes += tPerKm2 * cellKm2(lat) * stride * stride
    }
    out.push({
      t, gap: false, pixels: band.length,
      density: Math.round((sumDensity / band.length) * 100) / 100,   // t/km2, band mean
      tonnes: Math.round(tonnes * 10) / 10,
      peak_signal: Math.round(peak * 1e6) / 1e6,
      background: Math.round(background * 1e6) / 1e6,
    })
  }
  return out.sort((a, b) => a.t.localeCompare(b.t))
}

// Percentile by linear interpolation on sorted values.
export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i)
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)) * 100) / 100
}
