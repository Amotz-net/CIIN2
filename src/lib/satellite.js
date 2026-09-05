// =====================================================================
// CIIN satellite sargassum feed — NOAA CoastWatch / AOML ERDDAP (AFAI).
// Free, no API key, US Government work (redistributable). Per the satellite
// decision note (5 Sep 2026), this reclassifies satellite detection from
// "integration point / unreachable" to a LIVE feed.
//
// AFAI = Alternative Floating Algae Index (reflectance, estimated by USF).
// It is an INDEX, not ground truth — it saturates under cloud, sun glint and
// Saharan dust. So coverage gaps are shown HONESTLY (no silent interpolation).
//
// Attribution required on screen: "USF Optical Oceanography Lab (AFAI),
// redistributed by NOAA CoastWatch–AOML" + the US Gov inaccuracy disclaimer.
// =====================================================================

const ERDDAP = 'https://cwcgom.aoml.noaa.gov/erddap/griddap'
const DATASET = 'noaa_aoml_atlantic_oceanwatch_AFAI_7D' // 7-day composite = fewer cloud gaps

export const AFAI_ATTRIBUTION =
  'USF Optical Oceanography Lab (AFAI), redistributed by NOAA CoastWatch–AOML. ' +
  'Reflectance index, not ground truth; may contain inaccuracies (US Government work).'

// Query the latest AFAI value near a coastal segment. Returns a small window
// average so a single pixel's cloud gap doesn't null the whole read.
// lat/lng = segment centre; box = degrees half-width (~0.1 ~= 11km).
export async function getAfai(lat, lng, box = 0.1) {
  try {
    // ERDDAP griddap: latest time, small lat/lng box, AFAI variable, JSON out.
    // [(last)] selects the most recent time slice.
    const latLo = (lat - box).toFixed(3), latHi = (lat + box).toFixed(3)
    const lngLo = (lng - box).toFixed(3), lngHi = (lng + box).toFixed(3)
    const url =
      `${ERDDAP}/${DATASET}.json?AFAI` +
      `[(last)]` +
      `[(${latHi}):(${latLo})]` +   // ERDDAP lat is often descending
      `[(${lngLo}):(${lngHi})]`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return { ok: false, reason: `ERDDAP ${res.status}`, source: 'live_feed' }
    const j = await res.json()
    const rows = j?.table?.rows ?? []
    // rows: [time, lat, lng, AFAI]; filter out nulls (cloud/glint gaps)
    const vals = rows.map(r => r[3]).filter(v => typeof v === 'number' && !Number.isNaN(v))
    if (!vals.length) {
      return { ok: true, gap: true, source: 'live_feed',
               note: 'No clear satellite read (cloud, sun glint or dust). Coverage gap shown honestly.' }
    }
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    // AFAI is a small reflectance number; higher = more likely floating algae.
    // We report the raw index + a coarse qualitative band, clearly labelled.
    const level = mean > 0.0008 ? 'elevated' : mean > 0.0002 ? 'moderate' : 'low'
    const time = rows[0]?.[0] ?? null
    return { ok: true, gap: false, source: 'live_feed', afai: mean, level, coverage: vals.length, asOf: time }
  } catch (e) {
    return { ok: false, reason: 'Satellite request failed', source: 'live_feed' }
  }
}
