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
  const params = new URL(req.url).searchParams
  const country = params.get('country') ?? 'Jamaica'

  // Per-country daily history. SATsum serves one day per request, so CIIN
  // builds the series from its own stored daily copies and fills gaps a few
  // at a time, to stay a polite client of a service it does not run.
  if (params.get('action') === 'history') {
    try {
      const days = Math.max(7, Math.min(120, Number(params.get('days') ?? 60)))
      const iso = (p: string) => `${p.slice(0, 4)}-${p.slice(4, 6)}-${p.slice(6, 8)}`
      const periods = csv(await text(`${API}/satsum-eez/?nivel=periodos`)).filter(p => p.nivel === '1d').slice(-days).map(p => p.periodo)
      const { data: have } = await admin.from('regional_snapshots').select('as_of').eq('kind', 'eez').gte('as_of', iso(periods[0]))
      const stored = new Set((have ?? []).map(h => h.as_of))
      const missing = periods.filter(p => !stored.has(iso(p)))
      const batch = missing.slice(-30)
      for (let i = 0; i < batch.length; i += 5) {
        await Promise.all(batch.slice(i, i + 5).map(async p => {
          // The date goes in `fecha` (YYYY-MM-DD). Any other parameter name is
          // silently ignored and the LATEST day comes back, so the date the
          // server reports is checked against the date asked for before storing.
          const raw = csv(await text(`${API}/satsum-eez/?nivel=1d&fecha=${iso(p)}`))
          if (!raw.length || raw[0].mes !== iso(p)) return
          const rows = raw.map(r => ({ zone: r.zee, kind: r.tipo, sovereign: r.soberano, t: Number(r.biomasa_t), km2: Number(r.area_km2) }))
          await admin.from('regional_snapshots').upsert({ kind: 'eez', as_of: iso(p), payload: rows }, { onConflict: 'kind,as_of' })
        }))
      }
      const { data: all } = await admin.from('regional_snapshots').select('as_of, payload').eq('kind', 'eez')
        .gte('as_of', iso(periods[0])).order('as_of')
      const zones: Record<string, { d: string, t: number, km2: number }[]> = {}
      for (const row of all ?? []) for (const z of row.payload as any[]) (zones[z.zone] ??= []).push({ d: row.as_of, t: z.t, km2: z.km2 })
      return json({ ok: true, days, remaining: Math.max(0, missing.length - batch.length), zones,
                    source: 'SATsum / SIMAR, CONABIO (CC BY 4.0)' })
    } catch (e) {
      return json({ ok: false, reason: String(e).slice(0, 160) })
    }
  }
  // Map periods. Which days, months and years SATsum has published a map for,
  // and the per-country figures for the one asked about.
  if (params.get('action') === 'period') {
    try {
      const nivel = ['1d', 'mensual', 'anual'].includes(params.get('nivel') ?? '') ? params.get('nivel')! : '1d'
      const list = JSON.parse(await text(`${SITE}/mapas?nivel=${nivel}&var=biomasa${nivel === '1d' ? '&anio=' + new Date().getUTCFullYear() : ''}`))
      const dates: string[] = list.fechas ?? []
      const fecha = dates.includes(params.get('fecha') ?? '') ? params.get('fecha')! : dates[dates.length - 1]
      const dashed = nivel === '1d' ? `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`
        : nivel === 'mensual' ? `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}` : fecha
      let zones: any[] | null = null
      try {
        const raw = csv(await text(`${API}/satsum-eez/?nivel=${nivel}&fecha=${dashed}`))
        // An unrecognised date silently returns the latest period; only keep
        // figures whose reported period is the one asked for.
        if (raw.length && raw[0].mes === dashed)
          zones = raw.map(r => ({ zone: r.zee, t: Number(r.biomasa_t), km2: Number(r.area_km2) })).sort((a, b) => b.t - a.t)
      } catch (_) { /* the map still shows without the table */ }
      return json({ ok: true, nivel, fecha, period: dashed, dates, zones, source: 'SATsum / SIMAR, CONABIO (CC BY 4.0)' })
    } catch (e) {
      return json({ ok: false, reason: String(e).slice(0, 160) })
    }
  }

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
    const [gc, cs, gm, mx] = await Promise.all(['gran_caribe', 'caribbean', 'gulf', 'zee_caribbean'].map(async reg =>
      csv(await text(`${API}/satsum-daily/?satsum_region=${reg}&year=${year}&download=csv`))
        .map(r => ({ d: r.fecha, t: Number(r.weight), km2: Number(r.area), t1d: Number(r.dia) }))))
    return { as_of: gc[gc.length - 1].d, payload: { greater_caribbean: gc, caribbean_sea: cs, gulf_of_mexico: gm, mexican_caribbean: mx } }
  })

  // 2. Per-country figures for the latest published day
  const eez = await part('eez', async () => {
    const raw = csv(await text(`${API}/satsum-eez/?nivel=1d`))     // no date = latest published day
    const rows = raw.map(r => ({ zone: r.zee, kind: r.tipo, sovereign: r.soberano, t: Number(r.biomasa_t), km2: Number(r.area_km2) }))
    return { as_of: raw[0].mes, payload: rows }
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
  out.thresholds_all = thresholds?.payload?.zee ?? null
  out.fetched_at = new Date().toISOString()
  if (!series && !eez && !forecast) return json({ ok: false, reason: 'SATsum unreachable and no stored copy', stale: out.stale })
  return json(out)
})
