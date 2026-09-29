import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getAfai, getDrift, getBand, getForecast } from '../lib/feeds'
import { computeLandfall } from '../lib/landfall'
import { computeScores } from '../lib/riskscores'
import { loadRuleset, gradeBatch, permittedUses } from '../lib/grading'
import { LEVELS, levelFor } from '../lib/alert'
import { COUNTRY, CENTRE, countryOf } from '../lib/countries'

// One loader for every console, so the same figure is the same number on every
// role's screen. Row-level security decides what comes back; `scope` narrows it
// further to one organisation, which matters when a platform admin is viewing
// as that organisation and the database would otherwise return everything.
//   scope: 'all' | 'org' | 'hub'

export { COUNTRY, CENTRE }
export const REGION_BOX = { s: 8, n: 32, w: -98, e: -55, k: 36 }
const KM = 111.32

export function offset(lat, lng, bearingDeg, km) {
  const t = (bearingDeg * Math.PI) / 180
  return [lat + (km * Math.cos(t)) / KM, lng + (km * Math.sin(t)) / (KM * Math.cos((lat * Math.PI) / 180))]
}
// A box around some points, widened to take in the approach zone offshore.
export function boxAround(points, km = 60, k = 66) {
  if (!points.length) return null
  const la = points.map(p => p[0]), lo = points.map(p => p[1]), d = km / KM
  const r = v => Math.round(v * 100) / 100
  return { s: r(Math.min(...la) - d), n: r(Math.max(...la) + d), w: r(Math.min(...lo) - d), e: r(Math.max(...lo) + d), k }
}
// The three framings every role's map offers: the Caribbean, the organisation's
// own island, and (where it has them) its beaches. The map opens on the
// Caribbean and then settles on the island.
export function mapViews(code, pts = []) {
  const c = countryOf(code)
  const out = [{ key: 'region', label: 'Caribbean', icon: 'satellite', bounds: [[10, -90], [27, -59]] }]
  if (c) out.push({ key: 'island', label: c.name, icon: 'pin', bounds: [[c.box[0] - 0.35, c.box[1] - 0.35], [c.box[2] + 0.35, c.box[3] + 0.35]], maxZoom: 11 })
  if (pts.length) out.push({ key: 'beach', label: 'Beaches', icon: 'umbrella', points: pts, maxZoom: 14, pad: 0.5 })
  return out
}
export const segPoints = segs => segs.flatMap(s => (Array.isArray(s.path) && s.path.length > 1 ? s.path : s.lat && s.lng ? [[s.lat, s.lng]] : []))

const OPEN = m => !['completed', 'rejected'].includes(m.status)

export function useConsole(profile, { scope = 'all', feeds = true, regional = true, history = false, weather = false, admin = false, allSegments = false } = {}) {
  const orgId = profile?.org_id
  const code = profile?.organizations?.country_code
  const country = COUNTRY[code] || 'Jamaica'
  const [db, setDb] = useState(null)
  const [reg, setReg] = useState(null)
  const [hist, setHist] = useState(null)
  const [live, setLive] = useState({ reads: {}, drifts: {}, bands: {}, bases: {}, weather: null, done: false })
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async () => {
    if (!orgId) return
    const own = q => (scope === 'org' ? q.eq('org_id', orgId) : q)
    const [seg, org, mis, mh, bat, inv, rates, rs, invites, loads] = await Promise.all([
      allSegments ? supabase.from('beach_segments').select('*') : own(supabase.from('beach_segments').select('*')),
      supabase.from('organizations').select('id, name, role, country_code, approved, capacity_t, created_at'),
      scope === 'hub' ? supabase.from('missions').select('*').eq('org_id', orgId) : own(supabase.from('missions').select('*')),
      scope === 'hub' ? supabase.from('mission_hubs').select('*, missions(*)').eq('org_id', orgId) : supabase.from('mission_hubs').select('*'),
      (scope === 'all' ? supabase.from('batches').select('*') : supabase.from('batches').select('*').eq('org_id', orgId)).order('created_at', { ascending: false }),
      scope === 'all' ? supabase.from('invoices').select('*')
        : supabase.from('invoices').select('*').or(`issuer_org_id.eq.${orgId},payer_org_id.eq.${orgId}`),
      supabase.from('cost_rates').select('*').is('effective_to', null),
      loadRuleset().catch(() => null),
      admin ? supabase.from('invitations').select('id, email, org_id, level, status, created_at, expires_at') : Promise.resolve({ data: [] }),
      own(supabase.from('load_summaries').select('*')),
    ])
    if (!alive.current) return
    let missions = mis.data ?? []
    const pools = {}
    if (scope === 'hub') {
      const by = new Map(missions.map(m => [m.id, { ...m, pool: null }]))
      for (const p of mh.data ?? []) { if (p.missions) by.set(p.missions.id, { ...(by.get(p.missions.id) || {}), ...p.missions, pool: p }) }
      missions = [...by.values()]
    }
    for (const p of mh.data ?? []) (pools[p.mission_id] ||= []).push(p)
    missions.sort((a, b) => String(a.eta_at || '').localeCompare(String(b.eta_at || '')))
    const ruleset = rs
    const batches = (bat.data ?? []).map(b => {
      const result = ruleset ? gradeBatch({ arsenic_total: b.arsenic_total, arsenic_inorganic: b.arsenic_inorganic,
        foreign_matter: b.foreign_matter, age_hours: b.age_hours, chain_valid: b.chain_valid, signature_valid: b.signature_valid }, ruleset) : { grade: null }
      const confirmed = b.measurement_conf === 'confirmed'
      return { ...b, result, grade: result.grade, confirmed, uses: permittedUses(result.grade, confirmed) }
    })
    setDb({ segments: (seg.data ?? []), orgs: org.data ?? [], missions, pools, batches, invoices: inv.data ?? [],
            rates: rates.data ?? [], invitations: invites.data ?? [], loads: loads.data ?? [] })
  }, [orgId, scope, admin, allSegments])
  useEffect(() => { load() }, [load])

  // Regional picture (SATsum) — checked hourly; it is issued once a day.
  useEffect(() => {
    if (!regional) return
    let on = true
    const pull = () => supabase.functions.invoke('regional?country=' + encodeURIComponent(country), { body: {} })
      .then(({ data }) => { if (on && data?.ok) setReg(data) })
    pull(); const id = setInterval(pull, 60 * 60 * 1000)
    if (history) supabase.functions.invoke('regional?action=history&days=60', { body: {} })
      .then(({ data }) => { if (on && data?.ok) setHist(data) })
    return () => { on = false; clearInterval(id) }
  }, [country, regional, history])

  // Satellite and current feeds per beach.
  const segKey = (db?.segments ?? []).map(s => s.id).join(',')
  useEffect(() => {
    if (!feeds || !db) return
    const geo = db.segments.filter(s => s.lat && s.lng)
    if (!geo.length) { setLive(l => ({ ...l, done: true })); return }
    let on = true
    ;(async () => {
      const { data } = await supabase.from('segment_baselines').select('*').eq('afai_window', '7D').in('segment_id', geo.map(s => s.id))
      if (on) setLive(l => ({ ...l, bases: Object.fromEntries((data ?? []).map(b => [b.segment_id, b])) }))
      if (weather) getForecast(geo[0].lat, geo[0].lng).then(w => on && setLive(l => ({ ...l, weather: w })))
      for (const s of geo) {
        const [a, d, b] = await Promise.all([getAfai(s.lat, s.lng), getDrift(s.lat, s.lng), getBand(s, { days: 30 })])
        if (!on) return
        setLive(l => ({ ...l, reads: { ...l.reads, [s.id]: a }, drifts: { ...l.drifts, [s.id]: d }, bands: { ...l.bands, [s.id]: b } }))
      }
      if (on) setLive(l => ({ ...l, done: true }))
    })()
    return () => { on = false }
  }, [segKey, feeds, weather])

  return useMemo(() => {
    const d = db ?? { segments: [], orgs: [], missions: [], pools: {}, batches: [], invoices: [], rates: [], invitations: [], loads: [] }
    const geo = d.segments.filter(s => s.lat && s.lng)
    // Each beach with its alert level, on its own ten-year scale.
    const beaches = geo.map(s => {
      const band = live.bands[s.id], latest = band?.ok && !band.gap ? band.latest : null
      const level = levelFor(latest?.density, live.bases[s.id])
      return { ...s, band, latest, level, rank: level ? LEVELS.indexOf(level) : -1, drift: live.drifts[s.id], read: live.reads[s.id],
               color: level?.hex, tag: level?.label ?? (band?.ok && band.gap ? 'no clear read' : band ? 'no baseline' : '') }
    })
    const worst = [...beaches].sort((a, b) => b.rank - a.rank)[0] ?? null
    // The near-shore index is a coastal artefact (bright all year), so the
    // arrival headline is driven by the offshore level on the beach's own
    // scale, not by the reading at the waterline.
    const offshore = Object.fromEntries(beaches.map(b => [b.id, !b.band ? null : !b.band.ok || b.band.gap || !b.level
      ? { ok: b.band.ok, gap: true } : { ok: true, gap: false, asOf: b.latest?.t, sir: b.rank >= 3 ? 'high' : b.rank === 2 ? 'medium' : 'low' }]))
    const landfall = computeLandfall({ segments: d.segments, reads: offshore, drifts: live.drifts })
    // Arrows: 24 hours of travel at the observed speed.
    const vectors = beaches.filter(b => b.drift?.ok).map(b => {
      const km = Math.max(3, Math.min(30, b.drift.speed_km_day || 0))
      const tip = Array.isArray(b.path) && b.path.length > 1 ? b.path[Math.floor(b.path.length / 2)] : [b.lat, b.lng]
      // Drawn from the beach in the direction the water is moving, so an arrow
      // heading out to sea reads as exactly that.
      return { from: tip, to: offset(tip[0], tip[1], b.drift.bearing_deg, km), color: '#EAF0EF',
               note: `<b>${b.name}</b><br/>Water is moving ${b.drift.bearing} at about ${b.drift.speed_km_day} km a day.<br/><span style="color:#9AA6A3">Arrow is 24 hours of travel. Indicative, not a forecast.</span>` }
    })
    const open = d.missions.filter(OPEN)
    const orgName = id => d.orgs.find(o => o.id === id)?.name || '—'
    const gc = reg?.series?.payload?.greater_caribbean ?? []
    const zones = [...(reg?.eez?.payload ?? [])].sort((a, b) => b.t - a.t)
    const mine = zones.find(z => z.zone === country), th = reg?.thresholds
    const density = mine && th ? mine.t / th.area_km2 : null
    const forecast = reg?.forecast?.payload
    return {
      ...d, loading: !db, reload: load, country, code, orgId, orgName,
      beaches, worst, landfall, vectors, open, scores: computeScores(offshore), feedsDone: live.done, weather: live.weather,
      regional: reg, hist, gc, zones, mine, waterLevel: density == null ? null : LEVELS[th.umbrales.filter(u => density >= u).length],
      forecast, stale: reg?.stale ?? [],
    }
  }, [db, live, reg, hist, country, code, orgId, load])
}

// Headline for the arrival tile, from the landfall projection.
export function arrivalText(lf) {
  if (!lf || lf.state === 'unknown') return { value: '—', sub: 'awaiting a clear satellite read', tone: 'grey' }
  if (lf.state === 'active') return { value: 'Now', sub: `${lf.segment.name} · severe offshore`, tone: 'red' }
  if (lf.state === 'beyond') return { value: '> 3 days', sub: 'nothing carried to this coast within the horizon', tone: 'green' }
  const h = ms => Math.round((ms - Date.now()) / 3.6e6)
  if (h(lf.closes) <= 0) return { value: 'Window passed', sub: `${lf.segment.name} · awaiting the next reading`, tone: 'grey' }
  return { value: h(lf.opens) <= 0 ? `Within ${h(lf.closes)}h` : `${h(lf.opens)} – ${h(lf.closes)}h`, sub: `${lf.segment.name} · indicative`, tone: 'amber' }
}
