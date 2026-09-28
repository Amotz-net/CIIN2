// =====================================================================
// CIIN Baseline — computes each beach's own alert scale from its history.
//
// For every geo-located segment: pull the 7-day AFAI field once a week back
// to 2016, compute biomass density in the approach zone (20-40 km offshore) for each slice,
// and store the 75th/90th/95th/99th percentiles. Slices with no clear read
// are counted as gaps and excluded — a cloudy week is not a clear beach.
//
// Run on demand (and re-run occasionally; a baseline drifts slowly).
// Deploy: supabase functions deploy baseline --no-verify-jwt
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchGrid, bandStats, percentile, type Pt } from '../_shared/afai.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const WINDOW = '7D'
const SINCE = '2016-07-01T12:00:00Z'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: segs } = await admin.from('beach_segments').select('id, name, lat, lng, path')
    const results: any[] = []
    for (const s of (segs ?? []).filter(x => x.lat && x.lng)) {
      const shape: Pt[] = Array.isArray(s.path) && s.path.length > 1 ? s.path : [[s.lat, s.lng]]
      const grid = await fetchGrid(WINDOW, `(${SINCE}):7:(last)`, shape, 3)
      if (!grid.ok) { results.push({ segment: s.name, ok: false, reason: grid.reason }); continue }
      const stats = bandStats(grid.rows, shape, 3)
      const clear = stats.filter(x => !x.gap)
      if (clear.length < 52) {
        results.push({ segment: s.name, ok: false, reason: `only ${clear.length} clear slices — too few for a baseline` })
        continue
      }
      const d = clear.map(x => x.density).sort((a, b) => a - b)
      const row = {
        segment_id: s.id, afai_window: WINDOW,
        p75: percentile(d, 0.75), p90: percentile(d, 0.90), p95: percentile(d, 0.95), p99: percentile(d, 0.99),
        sample_n: clear.length, gap_n: stats.length - clear.length,
        history_from: clear[0].t, history_to: clear[clear.length - 1].t,
        computed_at: new Date().toISOString(),
      }
      const { error } = await admin.from('segment_baselines').upsert(row, { onConflict: 'segment_id,afai_window' })
      results.push({ segment: s.name, ok: !error, error: error?.message, ...row })
    }
    return json({ ok: true, results })
  } catch (e) {
    return json({ ok: false, reason: 'baseline failed', detail: String(e) }, 500)
  }
})
