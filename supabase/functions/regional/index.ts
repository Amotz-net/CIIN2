// =====================================================================
// CIIN Regional — the Caribbean-wide picture, from SATsum (CONABIO).
//
// Reads SATsum's published daily figures and 10-day drift forecast, stores a
// copy, and returns one combined answer. CIIN does not produce these numbers:
// every panel that shows them names SATsum as the source (CC BY 4.0).
// If SATsum cannot be reached, the last stored copy is returned with its date.
//
// Deploy: supabase functions deploy regional --no-verify-jwt
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const SITE = 'https://simar.conabio.gob.mx/satsum'
const API = SITE + '/api/satsum'
const UA = { 'User-Agent': 'CIIN-CaribbeanSargassumNetwork/1.0 (regional view; contact: ops@watersolutions.example)' }

async function text(url: string) {
  const r = await fetch(url, { headers: UA })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}
function csv(t: string) {
  const [head, ...lines] = t.trim().split('\n')
  const cols = head.split(',')
  return lines.filter(Boolean).map(l => {
    const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i]]))
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const country = new URL(req.url).searchParams.get('country') ?? 'Jamaica'
  const out: any = { ok: true, source: 'SATsum / SIMAR, CONABIO (CC BY 4.0)', source_url: SITE + '/', country, stale: [] }
  const year = new Date().getUTCFullYear()

  async function part(kind: string, load: () => Promise<{ as_of: string, payload: any }>) {
    try {
      const { as_of, payload } = await load()
      await admin.from('regional_snapshots').upsert({ kind, as_of, payload, fetched_at: new Date().toISOString() }, { onConflict: 'kind,as_of' })
      return { as_of, payload }
    } catch (e) {
      const { data } = await admin.from('regional_snapshots').select('as_of, payload').eq('kind', kind)
        .order('as_of', { ascending: false }).limit(1).maybeSingle()
      out.stale.push({ kind, reason: String(e).slice(0, 120), using: data?.as_of ?? null })
      return data ?? null
    }
  }

  // 1. Regional daily series (whole Greater Caribbean, and the Caribbean Sea)
  const series = await part('series', async () => {
    const [gc, cs] = await Promise.all(['gran_caribe', 'caribbean'].map(async reg =>
      csv(await text(`${API}/satsum-daily/?satsum_region=${reg}&year=${year}&download=csv`))
        .map(r => ({ d: r.fecha, t: Number(r.weight), km2: Number(r.area), t1d: Number(r.dia) }))))
    return { as_of: gc[gc.length - 1].d, payload: { greater_caribbean: gc, caribbean_sea: cs } }
  })

  // 2. Per-country figures for the latest published day
  const eez = await part('eez', async () => {
    const periods = csv(await text(`${API}/satsum-eez/?nivel=periodos`)).filter(p => p.nivel === '1d')
    const last = periods[periods.length - 1].periodo
    const rows = csv(await text(`${API}/satsum-eez/?nivel=1d&periodo=${last}`))
      .map(r => ({ zone: r.zee, kind: r.tipo, sovereign: r.soberano, t: Number(r.biomasa_t), km2: Number(r.area_km2) }))
    return { as_of: `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}`, payload: rows }
  })

  // 3. Alert thresholds per country (from SATsum's monthly record)
  const thresholds = await part('thresholds', async () => {
    const u = JSON.parse(await text(`${SITE}/umbrales_alerta.json`))
    return { as_of: String(u.generado ?? new Date().toISOString()).slice(0, 10), payload: { base: u.periodo_base, method: u.metodo, zee: u.zee } }
  })

  // 4. 10-day drift forecast
  const forecast = await part('forecast', async () => {
    const m = JSON.parse(await text(`${SITE}/pronostico/ultimo/manifest.json`))
    const zoneKey = Object.keys(m.destino_zee).find(k => k.toLowerCase().includes(country.toLowerCase().slice(0, 6)))
    const top = Object.entries(m.destino_zee as Record<string, any>)
      .map(([k, v]) => ({ zone: k, stranded: v.varado, afloat: v.a_flote, left: v.salio }))
      .sort((a, b) => (b.stranded + b.afloat) - (a.stranded + a.afloat)).slice(0, 12)
    return { as_of: m.analysis_time, payload: {
      analysis: m.analysis_time, horizon_days: m.horizon_days, scenarios: m.n_members, particles: m.n_particles,
      initial_biomass_t: m.initial_biomass_t, unobserved_fraction: m.cloud_or_land_fraction,
      total_stranded_t: m.total_stranded_t_ensemble_mean, beaching_note: m.beaching_note,
      spread_km: m.ensemble_spread,
      country_zone: zoneKey ?? null,
      country_total: zoneKey ? m.destino_zee[zoneKey] : null,
      country_daily_stranding: zoneKey ? m.destino_zee_dia?.[zoneKey] ?? null : null,
      destinations: top,
      passages: Object.entries(m.caudal_puertas as Record<string, any>).map(([k, v]) => ({
        name: k, net_t: v.neto_t, min_t: v.min_t, max_t: v.max_t, speed_ms: v.vel_ms })),
      animation_url: `${SITE}/pronostico/ultimo/animacion_${country.toLowerCase()}.gif`,
    } }
  })

  out.series = series; out.eez = eez; out.forecast = forecast
  const th = thresholds?.payload?.zee?.[country]
  out.thresholds = th ? { as_of: thresholds!.as_of, base: thresholds!.payload.base, ...th } : null
  if (!series && !eez && !forecast) return json({ ok: false, reason: 'SATsum unreachable and no stored copy', stale: out.stale })
  return json(out)
})
